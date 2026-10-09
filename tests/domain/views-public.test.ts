// Read models of the public site (lib/domain/views-public.ts) and the results sentence's full stop.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { blockDate } from '@/lib/domain/availability';
import { parseSearchParams, richText, search } from '@/lib/domain/search';
import {
  becomePartnerView, categoryView, eventTypeView, holdText, howItWorksView, legalView, numberWord, ordinal, partnerView, payoutDaysText,
  publicTitle, respondsWithin24, searchChoices, widgetAvailability, zeroWatchable,
} from '@/lib/domain/views-public';
import { createBookingRow, createClient } from '../helpers/factories';
import { NOW, expectLedgerClean, listedPartner, plain } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

type P = Awaited<ReturnType<typeof listedPartner>>;
const F: Record<string, P> = {};

beforeAll(async () => {
  setTestNow(NOW);
  F.melodia = await listedPartner({ businessName: 'Студио Мелодия', slug: 'studio-melodiya', category: 'dj-i-ozvuchavane', priceCents: 64_000, eventTypes: ['svatba', 'rozhden-den'], radiusKm: 150, photos: 2 });
  F.vkusna = await listedPartner({ businessName: 'Вкусна История', category: 'ketaring', priceCents: 2_800, priceUnit: 'per_guest', eventTypes: ['svatba'], radiusKm: 80 });
  F.trapeza = await listedPartner({ businessName: 'Трапеза & Co', category: 'ketaring', priceCents: 98_000, eventTypes: ['svatba'], radiusKm: 120 });
  F.ana = await listedPartner({ businessName: 'Ана Петрова Photography', category: 'fotografiya', priceCents: 78_000, policy: 'strict', eventTypes: ['svatba'], radiusKm: 200 });
  await blockDate(F.ana.actor, { date: '2026-06-14' });
});

describe('numbers in copy', () => {
  it('writes ordinals, number words, payout days and the hold the way the prototype does', () => {
    expect([1, 2, 3, 7, 8, 11, 15, 21, 22, 30].map(ordinal)).toEqual(['1-во', '2-ро', '3-то', '7-мо', '8-мо', '11-то', '15-то', '21-во', '22-ро', '30-то']);
    expect(payoutDaysText([15, 1])).toBe('1-во и 15-то');
    expect(numberWord(3, 'f')).toBe('три');
    expect(numberWord(5, 'm')).toBe('пет');
    expect(numberWord(2, 'm')).toBe('два');
    expect(numberWord(12)).toBe('12');
    expect(holdText(1)).toBe('до деня след събитието');
  });
});

describe('/tarsene', () => {
  it('ends the results sentence with one full stop after ‹… г.›', async () => {
    const r = await search(parseSearchParams({ grad: 'sofia', data: '2026-06-14' }));
    expect(plain(richText(r.sentence!))).toBe('Търсите в София за 14 юни 2026 г.');
    const g = await search(parseSearchParams({ data: '2026-06-14', gosti: '120' }));
    expect(plain(richText(g.sentence!))).toBe('Търсите за 14 юни 2026 г., събитие за 120 гости.');
  });

  it('offers the cities, the public types, the category names and the client’s upcoming event dates', async () => {
    const { user } = await createClient();
    await createBookingRow({ client: user, partner: F.melodia, eventDate: '2026-06-14', status: 'confirmed' });
    const c = await searchChoices(user.id);
    expect(c.cities.map(x => x.slug)).toEqual(['sofia', 'plovdiv', 'varna', 'burgas']);
    expect(c.types.map(x => x.slug)).not.toContain('drugo');
    expect(c.categories.find(x => x.slug === 'ketaring')?.name).toBe('Кетъринг');
    expect(plain(c.eventDates)).toEqual([{ value: '2026-06-14', label: '14 юни 2026' }]);
    expect(c.today).toBe('2025-08-31');
    expect((await searchChoices(null)).eventDates).toEqual([]);
  });
});

describe('/kategorii/[slug]', () => {
  it('counts with the category’s own noun, leaves out the page’s own chip, 404s hidden categories', async () => {
    const v = await categoryView('ketaring', parseSearchParams({ grad: 'sofia' }), {});
    expect(plain(richText(v!.countLine))).toBe('2 кетъринг фирми в София');
    expect(v!.result.chips.map(c => c.label)).toEqual(['София']);
    expect(v!.heroPhoto).toBe('/photos/thumbs/v1-caterer-warm.jpg');
    const dated = await categoryView('fotografiya', parseSearchParams({ data: '2026-06-14' }), {});
    expect(plain(richText(dated!.countLine))).toBe('1 изпълнител · 0 свободни на 14 юни 2026');
    expect(await categoryView('transport-za-gosti', parseSearchParams({}), {})).toBeNull();
    expect(await categoryView('nyama-takava', parseSearchParams({}), {})).toBeNull();
  });
});

describe('/sabitiya/[slug]', () => {
  it('sends hidden categories to the search, carries the filters, and lets an empty value clear the event’s default', async () => {
    const { user } = await createClient();
    const b = await createBookingRow({ client: user, partner: F.melodia, eventDate: '2026-06-14', status: 'confirmed' });
    const sofia = (await db.select().from(s.city).where(eq(s.city.slug, 'sofia')))[0];
    await db.update(s.clientEvent).set({ cityId: sofia.id, guests: 120, venueName: 'Вила Екатерина', locality: 'с. Панчарево' }).where(eq(s.clientEvent.id, b.clientEvent.id));
    const v = await eventTypeView('svatba', {}, { clientId: user.id });
    expect(plain(v!.event)).toMatchObject({ dateLine: '14 юни 2026 · неделя', guestsLine: '120 гости', venueLine: 'Вила Екатерина, с. Панчарево' });
    expect(v!.catalogHref).toBe('/tarsene?sabitie=svatba&grad=sofia&data=2026-06-14&gosti=120');
    expect(v!.briefHref).toBe('/zayavka/otvorena?type=svatba&city=sofia&date=2026-06-14&guests=120');
    expect(plain(v!.ctaText)).toBe('Каталогът отваря с вашите филтри — София, 14 юни 2026 и 120 гости — и показва само свободните на датата.');
    const transport = v!.tiers.find(t => t.categorySlug === 'transport-za-gosti')!;
    expect(transport.href).toBe('/tarsene?kategoriya=transport-za-gosti&sabitie=svatba&grad=sofia&data=2026-06-14&gosti=120');
    expect(v!.tiers.find(t => t.categorySlug === 'ketaring')!.href).toBe('/kategorii/ketaring?sabitie=svatba&grad=sofia&data=2026-06-14&gosti=120');
    expect(v!.tiers.find(t => t.categorySlug === 'ketaring')!.photoUrl).toBe('/photos/thumbs/catering.jpg');
    expect(v!.panels!.arranged[0].eventHref).toBe(`/akaunt/sabitiya/${b.clientEvent.id}`);

    const cleared = await eventTypeView('svatba', { grad: '', data: '', gosti: '' }, { clientId: user.id });
    expect(cleared!.city).toBeNull();
    expect(cleared!.date).toBeNull();
    expect(cleared!.catalogHref).toBe('/tarsene?sabitie=svatba');
    expect(cleared!.ctaText).toBeNull();
    expect(await eventTypeView('drugo', {}, {})).toBeNull();
  });
});

describe('/partnyori/[slug]', () => {
  it('adds the plural specialisations, the 24 h badge, the response window and the policy line', async () => {
    const v = await partnerView(F.melodia.partner.slug, {}, null);
    expect(v!.specialisations).toEqual([{ label: 'Сватби', href: '/sabitiya/svatba' }, { label: 'Рождени дни', href: '/sabitiya/rozhden-den' }]);
    expect(v!.respondsWithin24).toBe(true);
    expect(v!.responseHours).toBe(24);
    expect(v!.policyLine).toEqual({ label: 'Анулиране:', text: ' умерена политика — безплатно до 30 дни преди събитието.' });
    const strict = await partnerView(F.ana.partner.slug, {}, null);
    expect(strict!.policyLine).toEqual({ label: 'Анулиране:', text: ' строга политика — депозитът не се връща; остатъкът се възстановява до 14 дни преди събитието.' });
  });

  it('loses the badge after a request lapsed unanswered in the last 90 days', async () => {
    const { user } = await createClient();
    const lapsed = await createBookingRow({ client: user, partner: F.trapeza, eventDate: '2026-03-03', status: 'payment_expired' });
    await db.update(s.request).set({ status: 'expired', expiredAt: new Date(NOW.getTime() - 5 * 86_400_000) }).where(eq(s.request.id, lapsed.request.id));
    expect(await respondsWithin24(F.trapeza.partner.id)).toBe(false);
  });

  it('shows 10 reviews per ‹Покажи още› step, newest first, with the partner’s public reply', async () => {
    const { user } = await createClient();
    const svatba = (await db.select().from(s.eventType).where(eq(s.eventType.slug, 'svatba')))[0];
    for (let i = 0; i < 12; i++) {
      const b = await createBookingRow({ client: user, partner: F.trapeza, eventDate: `2025-0${(i % 8) + 1}-1${i % 10}`, status: 'completed' });
      const body = `Ревю номер ${i + 1}: всичко беше навреме, вкусно и красиво подредено.`;
      await db.insert(s.review).values({
        bookingId: b.booking.id, partnerId: F.trapeza.partner.id, clientId: user.id, authorDisplayName: 'Мария Димитрова',
        eventTypeId: svatba.id, eventDate: b.booking.eventDate, serviceLabel: 'Меню', ratingOverall: 5, ratingCommunication: 5,
        ratingAccuracy: 5, ratingQuality: 5, ratingValue: 5, body, bodyOriginal: body,
        publishedAt: new Date(NOW.getTime() - (12 - i) * 86_400_000),
        ...(i === 11 ? { replyText: 'Благодарим ви!', replyOriginal: 'Благодарим ви!', replyPublishedAt: NOW } : {}),
      });
    }
    const first = await partnerView(F.trapeza.partner.slug, {}, null);
    expect(first!.reviews.items).toHaveLength(10);
    expect(first!.reviews.hasMore).toBe(true);
    expect(first!.reviewPages).toBe(1);
    expect(first!.reviews.items[0].reply).toBe('Благодарим ви!');
    const more = await partnerView(F.trapeza.partner.slug, { reviewPages: 2 }, null);
    expect(more!.reviews.items).toHaveLength(12);
    expect(more!.reviews.hasMore).toBe(false);
    expect(more!.reviews.items.slice(0, 10).map(r => r.id)).toEqual(first!.reviews.items.map(r => r.id));
  });

  it('checks the widget date for visible partners only, and knows an existing watch', async () => {
    const { user } = await createClient();
    expect(plain(await widgetAvailability(F.ana.partner.id, '2026-06-14', user.id))).toMatchObject({ busy: true, watching: false, dateText: '14 юни 2026' });
    expect(await widgetAvailability(F.ana.partner.id, '2026-06-15', null)).toMatchObject({ busy: false });
    await db.update(s.partner).set({ isListed: false }).where(eq(s.partner.id, F.vkusna.partner.id));
    expect(await widgetAvailability(F.vkusna.partner.id, '2026-06-14', null)).toBeNull();
    await db.update(s.partner).set({ isListed: true }).where(eq(s.partner.id, F.vkusna.partner.id));
  });

  it('ignores a date that has passed', async () => {
    expect(await widgetAvailability(F.ana.partner.id, '2025-08-01', null)).toBeNull();
  });

  it('points the client to their own request or booking on that date instead of a watch or a second request', async () => {
    const { user } = await createClient();
    expect((await widgetAvailability(F.trapeza.partner.id, '2026-07-04', user.id))!.own).toBeNull();
    const b = await createBookingRow({ client: user, partner: F.trapeza, eventDate: '2026-07-04', status: 'confirmed' });
    expect(await widgetAvailability(F.trapeza.partner.id, '2026-07-04', user.id)).toMatchObject({
      busy: true, own: { label: 'Виж резервацията', href: `/akaunt/rezervacii/${encodeURIComponent(b.request.number)}` },
    });
    await db.update(s.booking).set({ status: 'awaiting_payment' }).where(eq(s.booking.id, b.booking.id));
    expect((await widgetAvailability(F.trapeza.partner.id, '2026-07-04', user.id))!.own).toMatchObject({ label: 'Виж заявката' });
    expect((await widgetAvailability(F.trapeza.partner.id, '2026-07-04', null))!.own).toBeNull();
    const { user: other } = await createClient();
    expect((await widgetAvailability(F.trapeza.partner.id, '2026-07-04', other.id))!.own).toBeNull();
    // the zero state's ‹Уведоми ме при свободна дата›: nothing to wait for when only her own booking holds the date
    const zp = parseSearchParams(new URLSearchParams('kategoriya=ketaring&data=2026-07-04'));
    expect(await zeroWatchable(zp, user.id)).toBe(false);
    expect(await zeroWatchable(zp, other.id)).toBe(true);
  });
});

describe('page titles', () => {
  it('names public pages only', async () => {
    expect(await publicTitle('category', 'ketaring')).toBe('Кетъринг за сватби');
    expect(await publicTitle('category', 'transport-za-gosti')).toBeNull();
    expect(await publicTitle('eventType', 'svatba')).toBe('Сватба · всичко необходимо');
    expect(await publicTitle('eventType', 'drugo')).toBeNull();
    expect(await publicTitle('partner', F.melodia.partner.slug)).toBe('Студио Мелодия');
    await db.update(s.partner).set({ isListed: false }).where(eq(s.partner.id, F.vkusna.partner.id));
    expect(await publicTitle('partner', F.vkusna.partner.slug)).toBeNull();
    await db.update(s.partner).set({ isListed: true }).where(eq(s.partner.id, F.vkusna.partner.id));
  });
});

describe('marketing and legal pages', () => {
  it('fills /stani-partnyor, /kak-raboti and /pravila from settings', async () => {
    const b = await becomePartnerView();
    expect(b).toMatchObject({ commissionPct: '10%', introPct: '5%', introCountWord: 'три', maxPackagesWord: 'пет', payoutDaysText: '1-во и 15-то', approvalSlaHours: 48 });
    expect(b.testimonial).toMatchObject({ name: 'Студио Мелодия', meta: 'DJ и озвучаване · София · партньор от февруари 2025' });
    expect(await howItWorksView()).toEqual({ responseText: '24 часа', paymentText: '24 часа', holdText: 'до деня след събитието' });
    const l = await legalView();
    expect(l.payoutDaysOr).toBe('1-во или 15-то');
    expect(l.supportEmail).toBe('help@eventat.bg');
    expect(l.documents).toEqual([]);
    expect(l.lastEdited).toBeNull();
    expect(l.policies.map(p => p.description)).toEqual([
      'Пълно възстановяване до 7 дни преди събитието',
      'Пълно възстановяване до 30 дни; после се задържа депозитът, а в последните 7 дни — цялата сума',
      'Депозитът не се връща; остатъкът се възстановява до 14 дни преди събитието',
    ]);
  });
});
