// Reviews (SPEC §4.12 V1–V3, §12.4 rating, §16 review form). Only clients with a paid and
// completed booking review (⚙ reviews.paid_only is locked on, D53); one review per booking;
// the partner may reply once; nobody edits or deletes. Contacts are always masked (§10 b).
import { and, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import { booking, category, clientEvent, eventType, media, partner, request, review, reviewPhoto, user } from '@/db/schema';
import { now } from '@/lib/clock';
import { cancelJobs } from '@/lib/jobs';
import { type AnyActor } from './actor';
import { audit } from './audit';
import { DomainError, ForbiddenError, NotFoundError, assertClient, mail, maskContacts, partnerOf, partnerRecipient, withTx } from './catalogue-kit';
import { ownMedia } from './media';
import { refreshPartner } from './partners';
import { ratingText } from './search';
import { getSetting } from './settings';

export type Review = typeof review.$inferSelect;

export const REVIEW_MIN_CHARS = 40;
export const REVIEW_TAGS = ['+ Спазиха часа', '+ Точно като по снимките', '+ Лесна комуникация', '+ Добра цена', '+ Бих ги наела пак'] as const;
export const REVIEW_CRITERIA = { ratingCommunication: 'Комуникация', ratingAccuracy: 'Точност', ratingQuality: 'Качество', ratingValue: 'Съотношение цена' } as const;

const stars = (n: number) => (n === 1 ? '1 звезда' : `${n} звезди`);
const packageOf = (title: string) => /^Пакет „(.+)“$/.exec(title)?.[1] ?? title;

/** ‹„Всичко мина безупречно…“›: the first sentence (or the first words) of a review, for the bell. */
export function opening(text: string, max = 40): string {
  const sentences = text.split(/(?<=[.!?])\s/);
  if (text.length <= max && sentences.length === 1) return text;
  const first = sentences[0].replace(/[.!?]+$/, '');
  if (sentences.length > 1 && first.length <= max) return `${first}…`;
  const cut = text.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[\s,;:—–-]+$/, '')}…`;
}

const rating = (v: unknown) => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5;

/**
 * V2 ‹Публикувай ревюто›: the client's own booking, `completed`, not reviewed yet; overall and
 * the four criteria 1–5; comment ≥ 40 characters; ≤ 6 photos. The text is masked (originals
 * kept), the partner's rating cache recomputed, the T14 invite cancelled; `vendor-new-review`
 * (+ bell ‹Ново ревю с {N} звезди›). Toast ‹Ревюто е публикувано›.
 */
export async function publish(actor: AnyActor, a: {
  bookingId?: string; number?: string; ratingOverall: number; ratingCommunication: number; ratingAccuracy: number; ratingQuality: number; ratingValue: number;
  body: string; tags?: string[]; photoMediaIds?: string[];
}, tx?: Tx): Promise<Review> {
  assertClient(actor);
  const body = (a.body ?? '').trim();
  if (body.length < REVIEW_MIN_CHARS) throw new DomainError('review_too_short');
  if (![a.ratingOverall, a.ratingCommunication, a.ratingAccuracy, a.ratingQuality, a.ratingValue].every(rating)) throw new DomainError('invalid_rating');
  const tags = [...new Set((a.tags ?? []).map(t => t.trim()).filter(Boolean))];
  if (tags.length > 10 || tags.some(t => t.length > 60)) throw new DomainError('invalid_tags');
  const photos = [...new Set(a.photoMediaIds ?? [])];
  return withTx(tx, async t => {
    if (photos.length > await getSetting('uploads.max_photos', undefined, t)) throw new DomainError('too_many_photos');
    const [b] = await t.select().from(booking)
      .where(a.bookingId ? eq(booking.id, a.bookingId) : eq(booking.number, a.number ?? '')).for('update');
    if (!b) throw new NotFoundError('booking');
    if (b.clientId !== actor.userId) throw new ForbiddenError('booking');
    // D53: paid bookings only — a completed booking was paid (K5 before K13).
    if (b.status !== 'completed' || !b.paidAt) throw new DomainError('not_reviewable');
    const [existing] = await t.select({ id: review.id }).from(review).where(eq(review.bookingId, b.id));
    if (existing) throw new DomainError('already_reviewed');
    for (const m of photos) await ownMedia(t, actor, m, ['review_photo']);
    const at = await now();
    const [u] = await t.select({ name: user.name }).from(user).where(eq(user.id, actor.userId));
    const [ev] = await t.select({ hosts: clientEvent.hosts }).from(clientEvent).where(eq(clientEvent.id, b.clientEventId));
    const [rq] = await t.select({ kind: request.kind }).from(request).where(eq(request.id, b.requestId));
    const [r] = await t.insert(review).values({
      bookingId: b.id, partnerId: b.partnerId, clientId: actor.userId, authorDisplayName: ev?.hosts || u.name,
      eventTypeId: b.eventTypeId, eventDate: b.eventDate, serviceLabel: rq?.kind === 'quote' ? 'По запитване' : b.serviceTitle,
      ratingOverall: a.ratingOverall, ratingCommunication: a.ratingCommunication, ratingAccuracy: a.ratingAccuracy,
      ratingQuality: a.ratingQuality, ratingValue: a.ratingValue, body: maskContacts(body), bodyOriginal: body, tags, publishedAt: at,
    }).returning();
    if (photos.length) await t.insert(reviewPhoto).values(photos.map((mediaId, position) => ({ reviewId: r.id, mediaId, position })));
    await t.update(booking).set({ reviewState: 'reviewed', updatedAt: at }).where(eq(booking.id, b.id));
    await cancelJobs(`booking:${b.id}:reviewinvite`, t);
    await refreshPartner(t, b.partnerId);
    await audit(t, { actor, action: 'review.published', entity: 'review', entityId: r.id, data: { bookingId: b.id, rating: a.ratingOverall } });

    const [p] = await t.select({ ratingAvg: partner.ratingAvg, reviewCount: partner.reviewCount }).from(partner).where(eq(partner.id, b.partnerId));
    const [type] = await t.select({ name: eventType.name }).from(eventType).where(eq(eventType.id, b.eventTypeId));
    const rec = await partnerRecipient(t, b.partnerId);
    await mail(t, {
      key: 'vendor-new-review', to: rec.email, toUserId: rec.userId, dedupeKey: `review:${r.id}`,
      vars: {
        reviewerName: r.authorDisplayName, stars: r.ratingOverall, text: r.body, eventType: type.name, packageName: packageOf(b.serviceTitle),
        rating: ratingText(p.ratingAvg == null ? null : Number(p.ratingAvg)) ?? '', reviewCount: p.reviewCount,
      },
      // §4 bell rule: ‹Ново ревю с {N} звезди› / ‹{Автор} · „{начало на текста}“›.
      bell: { title: `Ново ревю с ${stars(r.ratingOverall)}`, body: `${r.authorDisplayName} · „${opening(r.body)}“`, href: '/partner/revyuta' },
    });
    return r;
  });
}

/**
 * V3 ‹Отговори› → publish: one public reply (≥ 1 character, masked) per review; `client-review-reply`.
 * Toast ‹Отговорът е публикуван под ревюто›.
 */
export async function reply(actor: AnyActor, a: { reviewId: string; text: string }, tx?: Tx): Promise<Review> {
  const text = (a.text ?? '').trim();
  if (!text) throw new DomainError('reply_empty');
  return withTx(tx, async t => {
    const p = await partnerOf(actor, t);
    const [r] = await t.select().from(review).where(eq(review.id, a.reviewId)).for('update');
    if (!r) throw new NotFoundError('review');
    if (r.partnerId !== p.id) throw new ForbiddenError('review');
    if (r.replyText != null) throw new DomainError('already_replied');
    const at = await now();
    const [row] = await t.update(review).set({ replyText: maskContacts(text), replyOriginal: text, replyPublishedAt: at }).where(eq(review.id, r.id)).returning();
    await audit(t, { actor, action: 'review.replied', entity: 'review', entityId: r.id });
    const [u] = await t.select({ email: user.email, deleted: user.deletedAt }).from(user).where(eq(user.id, r.clientId));
    const [type] = await t.select({ name: eventType.name, definite: eventType.nameDefinite }).from(eventType).where(eq(eventType.id, r.eventTypeId));
    const [cat] = p.primaryCategoryId ? await t.select({ name: category.name }).from(category).where(eq(category.id, p.primaryCategoryId)) : [];
    if (u && !u.deleted) {
      await mail(t, {
        key: 'client-review-reply', to: u.email, toUserId: r.clientId, dedupeKey: `review:${r.id}:reply`,
        vars: {
          partnerSlug: p.slug, partnerName: p.businessName, partnerCategory: cat?.name ?? '', eventType: type.name, eventTypeDefinite: type.definite,
          packageName: packageOf(r.serviceLabel), reply: row.replyText!,
        },
        bell: { href: `/partnyori/${p.slug}#revyuta` },
      });
    }
    return row;
  });
}

// ── Read models ──────────────────────────────────────────────────────────

/** ‹4,9› · ‹38 ревюта› and the 5→1 distribution (counts and %); hidden (null) without reviews (§12.4). */
export async function ratingSummary(partnerId: string, q: Queryable = db) {
  const rows = await q.select({ stars: review.ratingOverall, n: count() }).from(review).where(eq(review.partnerId, partnerId)).groupBy(review.ratingOverall);
  const total = rows.reduce((s, r) => s + r.n, 0);
  if (!total) return null;
  const avg = rows.reduce((s, r) => s + r.stars * r.n, 0) / total;
  const rounded = Math.round(avg * 10) / 10;
  return {
    avg: rounded, avgText: ratingText(rounded)!, count: total, countLabel: total === 1 ? '1 ревю' : `${total} ревюта`,
    distribution: [5, 4, 3, 2, 1].map(s => {
      const n = rows.find(r => r.stars === s)?.n ?? 0;
      return { stars: s, count: n, pct: Math.round((n / total) * 100) };
    }),
  };
}

/** A partner's reviews, newest first, 10 per page (public profile ‹Покажи още›; panel tabs ‹Всички› / ‹Без отговор› / ‹5 звезди›). */
export async function partnerReviews(partnerId: string, a: { page?: number; perPage?: number; tab?: 'all' | 'unanswered' | 'five' } = {}, q: Queryable = db) {
  const per = a.perPage ?? 10, page = Math.max(1, a.page ?? 1);
  const conds = [eq(review.partnerId, partnerId)];
  if (a.tab === 'unanswered') conds.push(isNull(review.replyText));
  if (a.tab === 'five') conds.push(eq(review.ratingOverall, 5));
  const rows = await q.select({ r: review, typeName: eventType.name }).from(review).innerJoin(eventType, eq(eventType.id, review.eventTypeId))
    .where(and(...conds)).orderBy(desc(review.publishedAt)).limit(per + 1).offset((page - 1) * per);
  const ids = rows.map(x => x.r.id);
  const photos = ids.length ? await q.select({ reviewId: reviewPhoto.reviewId, m: media, position: reviewPhoto.position }).from(reviewPhoto)
    .innerJoin(media, eq(media.id, reviewPhoto.mediaId)).where(inArray(reviewPhoto.reviewId, ids)) : [];
  const [{ n: unanswered }] = await q.select({ n: count() }).from(review).where(and(eq(review.partnerId, partnerId), isNull(review.replyText)));
  return {
    items: rows.slice(0, per).map(x => ({
      // Public pages show only the masked text; the original is for the team.
      id: x.r.id, author: x.r.authorDisplayName, eventType: x.typeName, eventDate: x.r.eventDate, serviceLabel: x.r.serviceLabel,
      rating: x.r.ratingOverall, criteria: { communication: x.r.ratingCommunication, accuracy: x.r.ratingAccuracy, quality: x.r.ratingQuality, value: x.r.ratingValue },
      body: x.r.body, tags: x.r.tags, publishedAt: x.r.publishedAt, reply: x.r.replyText, replyPublishedAt: x.r.replyPublishedAt,
      photos: photos.filter(p => p.reviewId === x.r.id).sort((m, n) => m.position - n.position).map(p => ({ id: p.m.id, storageKey: p.m.storageKey })),
    })),
    hasMore: rows.length > per,
    unanswered,
  };
}

/** The review form (`/akaunt/rezervacii/[nomer]/revyu`): the booking if the client may review it now. */
export async function reviewable(actor: AnyActor, a: { number: string }, q: Queryable = db) {
  assertClient(actor);
  const [b] = await q.select({ b: booking, partnerName: partner.businessName, partnerSlug: partner.slug }).from(booking)
    .innerJoin(partner, eq(partner.id, booking.partnerId)).where(and(eq(booking.number, a.number), eq(booking.clientId, actor.userId)));
  if (!b) return null;
  const [r] = await q.select({ id: review.id }).from(review).where(eq(review.bookingId, b.b.id));
  return { booking: b.b, partnerName: b.partnerName, partnerSlug: b.partnerSlug, canReview: b.b.status === 'completed' && !!b.b.paidAt && !r };
}

