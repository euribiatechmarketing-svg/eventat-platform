// Upload metadata (SPEC §14, DATA-MODEL §2.5). The bytes live in lib/storage
// (local disk in dev, R2/S3 in production); this module validates what may be
// uploaded by whom, records the `media` row and answers who may read a
// private file (/api/files/[id] calls canAccess()).
//
// Storage is not free hosting: an upload needs a reason (evidence needs a booking that can carry a
// dispute, a review photo a booking that can be reviewed, a gallery photo a free slot), each user has
// an hourly and a daily quota, review photos stay private until a published review shows them, and
// files nothing links to are deleted after a day (purgeUnlinkedMedia, from the cron tick).
import { and, count, eq, inArray, or, sql } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import {
  booking, brief, briefAttachment, briefInvitation, conversation, dispute, disputeAttachment, invoice, media, message, messageAttachment,
  partnerMember, partnerPhoto, payoutAccount, reportJob, request, requestAttachment, review, type MediaKind,
} from '@/db/schema';
import { deleteFile, putFile, type Visibility } from '@/lib/storage';
import { isSystem, type AnyActor } from './actor';
import { getSetting } from './settings';
import { hit } from './throttle';
import { DomainError, NotFoundError, withTx } from './catalogue-kit';

export type Media = typeof media.$inferSelect;

const JPG_PNG = ['image/jpeg', 'image/png'] as const;
const WITH_PDF = ['image/jpeg', 'image/png', 'application/pdf'] as const;
type Uploader = 'client' | 'partner' | 'admin' | 'system';

/** SPEC §14, per kind: accepted types, who uploads, public or private, minimum pixel size. */
export const MEDIA_RULES: Record<MediaKind, { mimes: readonly string[]; by: readonly Uploader[]; visibility: Visibility; minSide?: number }> = {
  request_attachment: { mimes: JPG_PNG, by: ['client'], visibility: 'private' },
  brief_attachment: { mimes: JPG_PNG, by: ['client'], visibility: 'private' },
  dispute_evidence: { mimes: WITH_PDF, by: ['client', 'partner', 'admin'], visibility: 'private' },
  // Private until reviews.publish() attaches it (then is_public, served through /api/files/<id>).
  review_photo: { mimes: JPG_PNG, by: ['client'], visibility: 'private' },
  message_attachment: { mimes: WITH_PDF, by: ['client', 'partner'], visibility: 'private' },
  partner_avatar: { mimes: JPG_PNG, by: ['partner'], visibility: 'public', minSide: 400 },
  user_avatar: { mimes: JPG_PNG, by: ['client', 'admin'], visibility: 'public' },
  partner_cover: { mimes: JPG_PNG, by: ['partner'], visibility: 'public' },
  gallery: { mimes: JPG_PNG, by: ['partner'], visibility: 'public' },
  service_cover: { mimes: JPG_PNG, by: ['partner'], visibility: 'public' },
  bank_proof: { mimes: WITH_PDF, by: ['partner'], visibility: 'private' },
  legal_document: { mimes: ['application/pdf'], by: ['admin', 'system'], visibility: 'public' },
  invoice_pdf: { mimes: ['application/pdf'], by: ['system'], visibility: 'private' },
  report_file: { mimes: ['application/pdf'], by: ['system'], visibility: 'private' },
};

export type UploadMeta = {
  kind: MediaKind;
  storageKey: string;
  mime: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  originalName?: string | null;
};

/** Validate an upload against SPEC §14 (type, size ≤ ⚙ uploads.max_mb, avatar ≥ 400 × 400, uploader). */
export async function validateUpload(actor: AnyActor, m: Omit<UploadMeta, 'storageKey'>, q: Tx | typeof db = db): Promise<void> {
  const rule = MEDIA_RULES[m.kind];
  if (!rule) throw new DomainError('upload_kind');
  const who: Uploader = isSystem(actor) ? 'system' : actor.role;
  if (!rule.by.includes(who)) throw new DomainError('upload_forbidden', `${who} cannot upload ${m.kind}`);
  if (!rule.mimes.includes(m.mime)) throw new DomainError('upload_type', `${m.mime} is not accepted for ${m.kind}`);
  const maxMb = await getSetting('uploads.max_mb', undefined, q);
  if (m.sizeBytes > maxMb * 1024 * 1024 || m.sizeBytes > 5_242_880) throw new DomainError('upload_size');
  if (rule.minSide && (!m.width || !m.height || m.width < rule.minSide || m.height < rule.minSide)) {
    throw new DomainError('upload_dimensions', `at least ${rule.minSide} × ${rule.minSide}`);
  }
}

/** Record an already stored file. */
export async function recordUpload(actor: AnyActor, m: UploadMeta, tx?: Tx): Promise<Media> {
  return withTx(tx, async t => {
    await validateUpload(actor, m, t);
    const [row] = await t.insert(media).values({
      ownerUserId: isSystem(actor) ? null : actor.userId,
      kind: m.kind, storageKey: m.storageKey, mime: m.mime, sizeBytes: m.sizeBytes,
      width: m.width ?? null, height: m.height ?? null, originalName: m.originalName ?? null,
      isPublic: MEDIA_RULES[m.kind].visibility === 'public',
    }).returning();
    return row;
  });
}

/** The file starts with the signature of its declared type (JPEG FF D8 FF, PNG \x89PNG\r\n\x1a\n, PDF %PDF-). */
export function matchesSignature(mime: string, b: Buffer): boolean {
  if (mime === 'image/jpeg') return b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  if (mime === 'image/png') return b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (mime === 'application/pdf') return b.length > 5 && b.subarray(0, 5).toString('latin1') === '%PDF-';
  return false;
}

/**
 * ‹Качи снимка› / ‹Прикачи файл›: validate, store through lib/storage, record. `media.upload()` in SCREENS.
 * The browser's declared type is not trusted: the bytes must carry that type's signature, so a page
 * or script renamed to .png never lands in public storage.
 */
export async function upload(actor: AnyActor, a: { kind: MediaKind; file: File }): Promise<Media> {
  const bytes = Buffer.from(await a.file.arrayBuffer());
  const size = a.file.type.startsWith('image/') ? imageSize(bytes) : null;
  const meta = { kind: a.kind, mime: a.file.type, sizeBytes: a.file.size, width: size?.width, height: size?.height, originalName: a.file.name };
  await validateUpload(actor, meta);
  if (!matchesSignature(a.file.type, bytes)) throw new DomainError('upload_type', `the file is not a ${a.file.type}`);
  // Nothing is stored without a reason for it, or past the uploader's quota.
  await assertUploadContext(actor, a.kind);
  if (!isSystem(actor) && !((await hit('uploadHour', actor.userId)) && (await hit('uploadDay', actor.userId)))) {
    throw new DomainError('upload_quota');
  }
  const owner = isSystem(actor) ? 'system' : actor.userId;
  const stored = await putFile(a.file, `${a.kind}/${owner}`, MEDIA_RULES[a.kind].visibility);
  return recordUpload(actor, { ...meta, storageKey: stored.key });
}

/** Booking statuses on which a dispute can be opened (disputes.ts DISPUTABLE). */
const DISPUTABLE = ['awaiting_payment', 'confirmed', 'cancellation_requested', 'completed'] as const;

/**
 * What an upload must be for, checked before anything is stored:
 *   dispute_evidence — a booking of the uploader's that can carry a dispute, or has an open one (the team: always);
 *   review_photo     — a completed, paid booking of the client's that has no review yet;
 *   gallery          — a free slot in the partner's gallery (⚙ partner.gallery_max).
 * Other kinds are tied to their target when they are attached (requests, briefs, messages, profiles).
 */
export async function assertUploadContext(actor: AnyActor, kind: MediaKind, q: Tx | typeof db = db): Promise<void> {
  if (isSystem(actor)) return;
  const uid = actor.userId;
  if (kind === 'dispute_evidence') {
    if (actor.role === 'admin') {
      if (!actor.teamRole) throw new DomainError('upload_forbidden');
      return;
    }
    const party = actor.role === 'client'
      ? eq(booking.clientId, uid)
      : sql`${booking.partnerId} in (select ${partnerMember.partnerId} from ${partnerMember} where ${partnerMember.userId} = ${uid})`;
    const openDispute = sql`exists (select 1 from ${dispute} where ${dispute.bookingId} = ${booking.id} and ${dispute.status} in ('collecting', 'awaiting_decision'))`;
    const [b] = await q.select({ id: booking.id }).from(booking)
      .where(and(party, or(inArray(booking.status, [...DISPUTABLE]), openDispute))).limit(1);
    if (!b) throw new DomainError('not_disputable');
  } else if (kind === 'review_photo') {
    const [b] = await q.select({ id: booking.id }).from(booking)
      .where(and(eq(booking.clientId, uid), eq(booking.status, 'completed'), sql`${booking.paidAt} is not null`,
        sql`not exists (select 1 from ${review} where ${review.bookingId} = ${booking.id})`)).limit(1);
    if (!b) throw new DomainError('not_reviewable');
  } else if (kind === 'gallery') {
    const [m] = await q.select({ partnerId: partnerMember.partnerId }).from(partnerMember).where(eq(partnerMember.userId, uid)).limit(1);
    if (!m) throw new DomainError('upload_forbidden');
    const [{ n }] = await q.select({ n: count() }).from(partnerPhoto).where(eq(partnerPhoto.partnerId, m.partnerId));
    if (Number(n) >= await getSetting('partner.gallery_max', undefined, q)) throw new DomainError('gallery_full');
  }
}

/** A published review shows its photos: they become public (served through /api/files/<id>). */
export async function publishReviewPhotos(tx: Tx, mediaIds: string[]): Promise<void> {
  if (!mediaIds.length) return;
  await tx.update(media).set({ isPublic: true }).where(and(inArray(media.id, mediaIds), eq(media.kind, 'review_photo')));
}

/** Kinds whose files exist only for what links to them; an unlinked one is left over from an abandoned form. */
const LINKED_KINDS: MediaKind[] = [
  'request_attachment', 'brief_attachment', 'dispute_evidence', 'message_attachment', 'review_photo', 'partner_avatar', 'user_avatar',
  'partner_cover', 'gallery', 'service_cover', 'bank_proof',
];

/**
 * Housekeeping (cron tick): uploads older than `olderThanHours` that nothing links to — no request,
 * brief, dispute, message, review, gallery, profile, service (or a service change waiting for
 * moderation), payout account or avatar — are deleted, row first (a link made meanwhile keeps the
 * row: the foreign key refuses), then the bytes. Returns how many went.
 */
export async function purgeUnlinkedMedia(a: { olderThanHours?: number; limit?: number } = {}, q: typeof db = db): Promise<number> {
  const hours = a.olderThanHours ?? 24;
  const rows = await q.execute<{ id: string; storage_key: string }>(sql`
    select m.id, m.storage_key from media m
    where m.created_at < now() - make_interval(hours => ${hours}::int)
      and m.kind in (${sql.join(LINKED_KINDS.map(k => sql`${k}`), sql`, `)})
      and left(m.storage_key, 1) <> '/'
      and not exists (select 1 from request_attachment x where x.media_id = m.id)
      and not exists (select 1 from brief_attachment x where x.media_id = m.id)
      and not exists (select 1 from dispute_attachment x where x.media_id = m.id)
      and not exists (select 1 from message_attachment x where x.media_id = m.id)
      and not exists (select 1 from review_photo x where x.media_id = m.id)
      and not exists (select 1 from partner_photo x where x.media_id = m.id)
      and not exists (select 1 from partner p where p.avatar_media_id = m.id or p.cover_media_id = m.id)
      and not exists (select 1 from service s where s.cover_media_id = m.id)
      and not exists (select 1 from service_revision r where position(m.id::text in r.payload::text) > 0)
      and not exists (select 1 from payout_account x where x.proof_media_id = m.id)
      and not exists (select 1 from invoice x where x.pdf_media_id = m.id)
      and not exists (select 1 from legal_document x where x.media_id = m.id)
      and not exists (select 1 from report_job x where x.media_id = m.id)
      and not exists (select 1 from "user" u where u.image is not null and position(m.storage_key in u.image) > 0)
    order by m.created_at
    limit ${a.limit ?? 200}`);
  let n = 0;
  for (const r of rows) {
    try {
      const gone = await q.delete(media).where(eq(media.id, r.id)).returning({ id: media.id });
      if (!gone.length) continue;
    } catch { continue; } // linked meanwhile (foreign key)
    try { await deleteFile(r.storage_key); } catch (e) { console.error('media: could not delete the file of an unlinked upload', r.storage_key, e); }
    n++;
  }
  return n;
}

/** The media row, checked to be of an expected kind and (unless public) uploaded by this user. */
export async function ownMedia(tx: Tx, actor: AnyActor, mediaId: string, kinds: MediaKind[]): Promise<Media> {
  const [m] = await tx.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!m || !kinds.includes(m.kind)) throw new NotFoundError('media');
  if (!isSystem(actor) && m.ownerUserId && m.ownerUserId !== actor.userId) throw new DomainError('media_not_owned');
  return m;
}

/** Pixel size of a PNG or JPEG from its header (no image library needed). */
export function imageSize(b: Buffer): { width: number; height: number } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const marker = b[i + 1];
      const len = b.readUInt16BE(i + 2);
      // SOF0–SOF15 except DHT (C4), JPG (C8) and DAC (CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}

/**
 * May this actor read this file? Public files: everyone. Private files (SPEC §14 visibility):
 * the uploader; the team; request / brief photos for the client and the partner(s) concerned;
 * dispute evidence for the team and both sides; message attachments for the conversation's
 * parties; bank proofs for the partner; invoices for the booking's client and partner;
 * reports for the requester.
 */
export async function canAccess(actor: AnyActor | null, mediaId: string, q: typeof db | Tx = db): Promise<boolean> {
  const [m] = await q.select().from(media).where(eq(media.id, mediaId)).limit(1);
  if (!m) return false;
  if (m.isPublic) return true;
  if (!actor) return false;
  if (isSystem(actor)) return true;
  if (actor.role === 'admin' && actor.teamRole) return true;
  if (m.ownerUserId === actor.userId) return true;
  const uid = actor.userId;
  const pid = actor.role === 'partner' ? actor.partnerId ?? null : null;
  const isMyPartner = (col: unknown) => (pid ? sql`${col} = ${pid}` : sql`false`);
  const exists = async (query: Promise<unknown[]>) => (await query).length > 0;
  switch (m.kind) {
    case 'request_attachment':
      return exists(q.select({ x: sql`1` }).from(requestAttachment).innerJoin(request, eq(request.id, requestAttachment.requestId))
        .where(and(eq(requestAttachment.mediaId, m.id), or(eq(request.clientId, uid), isMyPartner(request.partnerId)))).limit(1));
    case 'brief_attachment':
      return exists(q.select({ x: sql`1` }).from(briefAttachment).innerJoin(brief, eq(brief.id, briefAttachment.briefId))
        .leftJoin(briefInvitation, eq(briefInvitation.briefId, brief.id))
        .where(and(eq(briefAttachment.mediaId, m.id), or(eq(brief.clientId, uid), isMyPartner(briefInvitation.partnerId)))).limit(1));
    case 'dispute_evidence':
      return exists(q.select({ x: sql`1` }).from(disputeAttachment).innerJoin(dispute, eq(dispute.id, disputeAttachment.disputeId))
        .innerJoin(booking, eq(booking.id, dispute.bookingId))
        .where(and(eq(disputeAttachment.mediaId, m.id), or(eq(booking.clientId, uid), isMyPartner(booking.partnerId)))).limit(1));
    case 'message_attachment':
      return exists(q.select({ x: sql`1` }).from(messageAttachment).innerJoin(message, eq(message.id, messageAttachment.messageId))
        .innerJoin(conversation, eq(conversation.id, message.conversationId))
        .where(and(eq(messageAttachment.mediaId, m.id), or(eq(conversation.clientId, uid), isMyPartner(conversation.partnerId)))).limit(1));
    case 'bank_proof':
      return exists(q.select({ x: sql`1` }).from(payoutAccount).innerJoin(partnerMember, eq(partnerMember.partnerId, payoutAccount.partnerId))
        .where(and(eq(payoutAccount.proofMediaId, m.id), eq(partnerMember.userId, uid))).limit(1));
    case 'invoice_pdf':
      return exists(q.select({ x: sql`1` }).from(invoice).leftJoin(booking, eq(booking.id, invoice.bookingId))
        .where(and(eq(invoice.pdfMediaId, m.id), or(eq(booking.clientId, uid), isMyPartner(invoice.partnerId)))).limit(1));
    case 'report_file':
      return exists(q.select({ x: sql`1` }).from(reportJob).where(and(eq(reportJob.mediaId, m.id), eq(reportJob.requestedBy, uid))).limit(1));
    default:
      return false;
  }
}
