// Upload metadata (SPEC §14, DATA-MODEL §2.5). The bytes live in lib/storage
// (local disk in dev, R2/S3 in production); this module validates what may be
// uploaded by whom, records the `media` row and answers who may read a
// private file (/api/files/[id] calls canAccess()).
import { and, eq, or, sql } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import {
  booking, brief, briefAttachment, briefInvitation, conversation, dispute, disputeAttachment, invoice, media, message, messageAttachment,
  partnerMember, payoutAccount, reportJob, request, requestAttachment, type MediaKind,
} from '@/db/schema';
import { putFile, type Visibility } from '@/lib/storage';
import { isSystem, type AnyActor } from './actor';
import { getSetting } from './settings';
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
  review_photo: { mimes: JPG_PNG, by: ['client'], visibility: 'public' },
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
  const owner = isSystem(actor) ? 'system' : actor.userId;
  const stored = await putFile(a.file, `${a.kind}/${owner}`, MEDIA_RULES[a.kind].visibility);
  return recordUpload(actor, { ...meta, storageKey: stored.key });
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
