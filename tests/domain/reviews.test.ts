// Reviews (SPEC §4.12 V1–V3, §12.4 rating).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { scheduleJob } from '@/lib/jobs';
import { opening, partnerReviews, publish, ratingSummary, reply, reviewable } from '@/lib/domain/reviews';
import { createBookingRow, createClient } from '../helpers/factories';
import { NOW, bells, emails, expectLedgerClean, failure, jobsByPrefix, listedPartner, mediaRow } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

const TEXT = 'Всичко мина безупречно. Пристигна навреме, техниката беше на ниво, а плейлистът — точно по вкуса на гостите.';
const stars = (n: number) => ({ ratingOverall: n, ratingCommunication: n, ratingAccuracy: n, ratingQuality: n, ratingValue: n });

async function completed(o: { name?: string; hosts?: string } = {}) {
  const pr = await listedPartner({ businessName: 'Студио Мелодия' });
  const cl = await createClient({ name: o.name ?? 'Стефка Илиева' });
  const b = await createBookingRow({ client: cl.user, partner: pr, eventDate: '2025-05-17', status: 'completed' });
  if (o.hosts) await db.update(s.clientEvent).set({ hosts: o.hosts }).where(eq(s.clientEvent.id, b.clientEvent.id));
  return { pr, cl, b };
}

describe('V2 publish', () => {
  it('only the client of a paid, completed booking; once; ≥ 40 characters; ratings 1–5; ≤ 6 photos', async () => {
    const { pr, cl, b } = await completed();
    const stranger = await createClient();
    expect(await failure(publish(stranger.actor, { bookingId: b.booking.id, ...stars(5), body: TEXT }))).toContain('ForbiddenError');
    expect(await failure(publish(pr.actor, { bookingId: b.booking.id, ...stars(5), body: TEXT }))).toContain('ForbiddenError');
    expect(await failure(publish(cl.actor, { bookingId: b.booking.id, ...stars(5), body: 'Кратко.' }))).toContain('review_too_short');
    expect(await failure(publish(cl.actor, { bookingId: b.booking.id, ...stars(6), body: TEXT }))).toContain('invalid_rating');
    const photos = await Promise.all(Array.from({ length: 7 }, () => mediaRow(cl.user.id, 'review_photo')));
    expect(await failure(publish(cl.actor, { bookingId: b.booking.id, ...stars(5), body: TEXT, photoMediaIds: photos.map(p => p.id) }))).toContain('too_many_photos');
    const confirmed = await createBookingRow({ client: cl.user, partner: pr, eventDate: '2026-06-14', status: 'confirmed' });
    expect(await failure(publish(cl.actor, { bookingId: confirmed.booking.id, ...stars(5), body: TEXT }))).toContain('not_reviewable');
    expect((await reviewable(cl.actor, { number: b.number }))?.canReview).toBe(true);
    expect((await reviewable(cl.actor, { number: confirmed.number }))?.canReview).toBe(false);

    await scheduleJob('noop', new Date('2025-05-18T07:00:00Z'), {}, `booking:${b.booking.id}:reviewinvite`);
    const r = await publish(cl.actor, { number: b.number, ...stars(5), ratingValue: 4, body: TEXT, tags: ['+ Спазиха часа'], photoMediaIds: photos.slice(0, 2).map(p => p.id) });
    expect(r).toMatchObject({ authorDisplayName: 'Стефка Илиева', serviceLabel: 'Пакет „Цял ден“', ratingOverall: 5, ratingValue: 4, tags: ['+ Спазиха часа'], eventDate: '2025-05-17' });
    expect((await db.select().from(s.booking).where(eq(s.booking.id, b.booking.id)))[0].reviewState).toBe('reviewed');
    expect((await jobsByPrefix(`booking:${b.booking.id}:reviewinvite`))[0].status).toBe('cancelled');
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id));
    expect(p).toMatchObject({ ratingAvg: 5, reviewCount: 1 });
    expect(await failure(publish(cl.actor, { bookingId: b.booking.id, ...stars(4), body: TEXT }))).toContain('already_reviewed');

    const [mail] = await emails('vendor-new-review', pr.user.id);
    expect(mail.vars).toEqual({ reviewerName: 'Стефка Илиева', stars: 5, text: TEXT, eventType: 'Сватба', packageName: 'Цял ден', rating: '5,0', reviewCount: 1 });
    expect((await bells(pr.user.id))[0]).toMatchObject({ title: 'Ново ревю с 5 звезди', body: 'Стефка Илиева · „Всичко мина безупречно…“', href: '/partner/revyuta' });
  });

  it('masks contacts in the text (originals kept); the hosts sign a wedding review', async () => {
    const { cl, b } = await completed({ hosts: 'Петя и Николай' });
    const r = await publish(cl.actor, { bookingId: b.booking.id, ...stars(4), body: 'Страхотни сте! Пишете ми на petya@abv.bg или на 0888 123 456 за препоръка.' });
    expect(r.body).toBe('Страхотни сте! Пишете ми на ••• или на ••• за препоръка.');
    expect(r.bodyOriginal).toContain('petya@abv.bg');
    expect(r.authorDisplayName).toBe('Петя и Николай');
  });
});

describe('V3 reply and the rating summary', () => {
  it('the partner replies once; the client is told', async () => {
    const { pr, cl, b } = await completed();
    const r = await publish(cl.actor, { bookingId: b.booking.id, ...stars(5), body: TEXT });
    const other = await listedPartner();
    expect(await failure(reply(other.actor, { reviewId: r.id, text: 'Благодаря' }))).toContain('ForbiddenError');
    expect(await failure(reply(cl.actor, { reviewId: r.id, text: 'Благодаря' }))).toContain('ForbiddenError');
    expect(await failure(reply(pr.actor, { reviewId: r.id, text: ' ' }))).toContain('reply_empty');
    const done = await reply(pr.actor, { reviewId: r.id, text: 'Благодаря ви! Беше удоволствие.' });
    expect(done.replyPublishedAt?.getTime()).toBe(NOW.getTime());
    expect(await failure(reply(pr.actor, { reviewId: r.id, text: 'Още веднъж' }))).toContain('already_replied');
    const [mail] = await emails('client-review-reply', cl.user.id);
    expect(mail.vars).toEqual({ partnerSlug: pr.partner.slug, partnerName: 'Студио Мелодия', partnerCategory: 'DJ и озвучаване', eventType: 'Сватба',
      eventTypeDefinite: 'сватбата', packageName: 'Цял ден', reply: 'Благодаря ви! Беше удоволствие.' });
    expect((await bells(cl.user.id))[0].href).toBe(`/partnyori/${pr.partner.slug}#revyuta`);
  });

  it('averages to one decimal with the 5→1 distribution; pages and tabs', async () => {
    const pr = await listedPartner();
    expect(await ratingSummary(pr.partner.id)).toBeNull();
    for (const n of [5, 5, 4]) {
      const cl = await createClient();
      const b = await createBookingRow({ client: cl.user, partner: pr, eventDate: '2025-04-26', status: 'completed' });
      await publish(cl.actor, { bookingId: b.booking.id, ...stars(n), body: TEXT });
    }
    const sum = await ratingSummary(pr.partner.id);
    expect(sum).toMatchObject({ avg: 4.7, avgText: '4,7', count: 3, countLabel: '3 ревюта' });
    expect(sum?.distribution.slice(0, 2)).toEqual([{ stars: 5, count: 2, pct: 67 }, { stars: 4, count: 1, pct: 33 }]);
    expect((await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id)))[0]).toMatchObject({ ratingAvg: 4.7, reviewCount: 3 });
    const page = await partnerReviews(pr.partner.id, { perPage: 2 });
    expect(page).toMatchObject({ hasMore: true, unanswered: 3 });
    expect(page.items).toHaveLength(2);
    expect((await partnerReviews(pr.partner.id, { tab: 'five' })).items).toHaveLength(2);
    expect(opening('Кратко.')).toBe('Кратко.');
    expect(opening('Много дълъг текст без точка, който продължава и продължава още доста дълго')).toBe('Много дълъг текст без точка, който…');
  });
});
