// Search and public browsing (SPEC §13): stems, filters, facet counts, strings, suggestions, sorting, public blocks.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { blockDate } from '@/lib/domain/availability';
import {
  categoryCards, categoryHero, eventTypePage, facetCounts, haversineKm, knownStems, matchPartners, paramsJson, parseSearchParams, partnerPage, publicNumbers,
  queryStems, recordQuery, richText, search, searchHref, searchPartners, suggest, tipsSubheading, toQuery,
} from '@/lib/domain/search';
import { createAdmin } from '../helpers/factories';
import { createBookingRow, createClient, cityId, eventTypeId, categoryId } from '../helpers/factories';
import { NOW, expectLedgerClean, failure, listedPartner, plain } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

type P = Awaited<ReturnType<typeof listedPartner>>;
const F: Record<string, P> = {};
const P = (q: Record<string, string | string[]>) => parseSearchParams(q);
const names = (cards: { name: string }[]) => cards.map(c => c.name).sort();

async function rate(p: P, avg: number | null, count: number, verified = true) {
  await db.update(s.partner).set({ ratingAvg: avg, reviewCount: count, isVerified: verified }).where(eq(s.partner.id, p.partner.id));
}

beforeAll(async () => {
  setTestNow(NOW);
  F.melodia = await listedPartner({ businessName: 'Студио Мелодия', category: 'dj-i-ozvuchavane', priceCents: 64_000, eventTypes: ['svatba', 'rozhden-den', 'firmeno-sabitie'], radiusKm: 150, photos: 1 });
  F.vkusna = await listedPartner({ businessName: 'Вкусна История', category: 'ketaring', priceCents: 2_800, priceUnit: 'per_guest', eventTypes: ['svatba', 'firmeno-sabitie'], radiusKm: 80, maxGuests: 250 });
  F.flora = await listedPartner({ businessName: 'Флора Студио', category: 'dekoratsiya', priceCents: 45_000, policy: 'flexible', eventTypes: ['svatba', 'rozhden-den'], radiusKm: 120, maxGuests: 100 });
  F.ana = await listedPartner({ businessName: 'Ана Петрова Photography', category: 'fotografiya', priceCents: 78_000, policy: 'strict', eventTypes: ['svatba', 'rozhden-den'], radiusKm: 200 });
  F.adagio = await listedPartner({ businessName: 'Квартет „Адажио“', category: 'muzikanti', priceCents: 74_000, eventTypes: ['svatba'], nationwide: true });
  F.zhivko = await listedPartner({ businessName: 'DJ Живко', category: 'dj-i-ozvuchavane', city: 'varna', priceCents: 52_000, policy: 'flexible', eventTypes: ['rozhden-den'], radiusKm: 50 });
  F.gradina = await listedPartner({ businessName: 'Градина и Маса', category: 'ketaring', city: 'varna', priceCents: 89_000, eventTypes: ['svatba'], radiusKm: 150 });
  F.closed = await listedPartner({ businessName: 'Затворено Студио', category: 'fotografiya', priceCents: 50_000 });
  F.hidden = await listedPartner({ businessName: 'Скрито Студио', category: 'fotografiya', priceCents: 50_000 });
  await db.update(s.partner).set({ acceptingRequests: false }).where(eq(s.partner.id, F.closed.partner.id));
  await db.update(s.partner).set({ isListed: false }).where(eq(s.partner.id, F.hidden.partner.id));
  await rate(F.melodia, 4.9, 38);
  await rate(F.vkusna, 4.9, 41);
  await rate(F.flora, 5.0, 27);
  await rate(F.ana, 4.8, 54, false);
  await rate(F.adagio, 5.0, 19, false);
  await rate(F.zhivko, 4.2, 12, false);
  await rate(F.gradina, null, 0, false);
  await db.update(s.partner).set({ approvedAt: new Date('2024-06-01T10:00:00Z') }).where(eq(s.partner.id, F.gradina.partner.id));
  // Ана is taken on 14 юни 2026; DJ Живко let a request lapse 10 days ago.
  await blockDate(F.ana.actor, { date: '2026-06-14' });
  const { user: c } = await createClient();
  const lapsed = await createBookingRow({ client: c, partner: F.zhivko, eventDate: '2026-03-03', status: 'payment_expired' });
  await db.update(s.request).set({ status: 'expired', expiredAt: new Date(NOW.getTime() - 10 * 86_400_000) }).where(eq(s.request.id, lapsed.request.id));
  // Catering subtype ‹Бюфет› for Вкусна История.
  const [byufet] = await db.select().from(s.categorySubtype).where(eq(s.categorySubtype.slug, 'byufet'));
  await db.insert(s.partnerSubtype).values({ partnerId: F.vkusna.partner.id, subtypeId: byufet.id });
});

describe('§13.1 parameters', () => {
  it('parses GET params and writes them back canonically', () => {
    const p = P({ q: '  Кетъринг ', grad: ['sofia', 'varna'], sabitie: 'svatba', data: '2026-06-14', gosti: 'nad-150', reyting: ['4.5', '4.0'], politika: ['umerena', 'xx'],
      'cena-do': '2000', podredi: 'tsena', 'druga-data': '1', 'sabitie-id': 'e1' });
    expect(p).toMatchObject({ q: 'Кетъринг', grad: ['sofia', 'varna'], sabitie: ['svatba'], data: '2026-06-14', gosti: 'nad-150', reyting: [4.5, 4], politika: ['umerena'],
      cenaDo: 2000, podredi: 'tsena', drugaData: true, sabitieId: 'e1', submitted: true });
    expect(P({ data: '2026-02-30', gosti: 'много' })).toMatchObject({ data: null, gosti: null });
    expect(P({}).submitted).toBe(false);
    expect(parseSearchParams(new URLSearchParams(toQuery(p)))).toEqual(p);
    // Saved searches keep params as JSON with numbers (DATA-MODEL S12).
    expect(parseSearchParams({ sabitie: 'svatba', grad: 'sofia', data: '2026-06-14', gosti: 120, reyting: 4.5 })).toMatchObject({ gosti: '120', reyting: [4.5] });
    expect(paramsJson(P({ grad: ['sofia', 'varna'], q: 'x' }))).toEqual({ q: 'x', grad: ['sofia', 'varna'] });
    expect(searchHref(P({ kategoriya: 'ketaring', grad: 'sofia' }), '/kategorii/ketaring')).toBe('/kategorii/ketaring?grad=sofia');
    expect(searchHref(P({ grad: 'sofia' }), '/kategorii/ketaring')).toBe('/tarsene?grad=sofia');
  });
});

describe('§13.3 stem matching (the prototype searchEngine)', () => {
  it('splits, drops stop words / short / numeric tokens and stems words over 4 letters', () => {
    expect(queryStems('Кетъринг коледно парти')).toEqual(['кетърин', 'коледн', 'парт']);
    expect(queryStems('за сватба в София, 14 юни')).toEqual(['сватб', 'софи', 'юни']);
    expect(queryStems('и с а')).toEqual([]);
  });
  it('ignores unknown stems; matches every known stem; nothing known → zero', async () => {
    expect(await knownStems(['кетърин', 'коледн', 'парт'])).toEqual(['кетърин']);
    expect(names((await search(P({ q: 'кетъринг коледно парти' }))).cards)).toEqual(['Вкусна История', 'Градина и Маса']);
    const none = await search(P({ q: 'xyz абв' }));
    expect(none.total).toBe(0);
    expect(none.zero?.text).toBe('С избраните филтри никой изпълнител не съвпада с търсенето ви.');
    expect(none.cta).toBeNull();
    expect(names((await search(P({ q: 'мелодия' }))).cards)).toEqual(['Студио Мелодия']);
    expect(names((await search(P({ q: 'сватба варна' }))).cards)).toEqual(['Градина и Маса']);
    // Only stop words: nothing is known, so nothing matches.
    expect((await search(P({ q: 'за и' }))).total).toBe(0);
    // Not accepting requests / not listed: outside the base set (§13.2, D72).
    expect((await search(P({ q: 'студио' }))).cards.map(c => c.name)).not.toContain('Затворено Студио');
    expect((await search(P({ q: 'студио' }))).cards.map(c => c.name)).not.toContain('Скрито Студио');
    expect(await knownStems(['затворен'])).toEqual([]);
  });
});

describe('§13.4 filters', () => {
  it('category exact (primary or an active service), subtype', async () => {
    expect(names((await search(P({ kategoriya: 'ketaring' }))).cards)).toEqual(['Вкусна История', 'Градина и Маса']);
    // An active service in another category counts too.
    await db.insert(s.service).values({ partnerId: F.melodia.partner.id, kind: 'package_fixed', name: 'Фотокабина', categoryId: await categoryId('fotokabini'),
      description: 'x', priceCents: 30_000, status: 'active', publishedAt: NOW });
    expect(names((await search(P({ kategoriya: 'fotokabini' }))).cards)).toEqual(['Студио Мелодия']);
    await db.delete(s.service).where(eq(s.service.name, 'Фотокабина'));
    expect(names((await search(P({ kategoriya: 'ketaring', vid: 'byufet' }))).cards)).toEqual(['Вкусна История']);
    expect((await search(P({ kategoriya: 'nyama' }))).total).toBe(0);
  });

  it('city: base city, nationwide, or within the radius (D73)', async () => {
    expect(Math.round(haversineKm({ lat: 43.20467, lng: 27.91054 }, { lat: 42.50606, lng: 27.46781 }))).toBe(86);
    expect(names((await search(P({ grad: 'burgas' }))).cards)).toEqual(['Градина и Маса', 'Квартет „Адажио“']);
    expect(names((await search(P({ grad: 'plovdiv' }))).cards)).toEqual(['Ана Петрова Photography', 'Квартет „Адажио“', 'Студио Мелодия']);
    expect((await search(P({ grad: ['plovdiv', 'varna'] }))).total).toBe(5);
  });

  it('date: busy partners out; ‹Предлагат друга дата› shows only them', async () => {
    const r = await search(P({ data: '2026-06-14' }));
    expect(r.cards.map(c => c.name)).not.toContain('Ана Петрова Photography');
    const other = await search(P({ data: '2026-06-14', 'druga-data': '1' }));
    expect(plain(other.cards.map(c => [c.name, c.busy, c.busyLabel]))).toEqual([['Ана Петрова Photography', true, 'Зает на 14 юни']]);
    expect((await search(P({ 'druga-data': '1' }))).total).toBe(7); // ignored without a date
  });

  it('guests, rating, policy, price, ‹Отговаря до 24 часа›', async () => {
    expect((await search(P({ gosti: 'nad-150' }))).cards.map(c => c.name)).not.toContain('Флора Студио');
    expect((await search(P({ gosti: '100' }))).cards.map(c => c.name)).toContain('Флора Студио');
    expect(names((await search(P({ reyting: ['4.5', '4.0'] }))).cards)).toHaveLength(6);
    expect(names((await search(P({ reyting: '4.5' }))).cards)).not.toContain('DJ Живко');
    expect(names((await search(P({ reyting: '4.5' }))).cards)).not.toContain('Градина и Маса');
    expect(names((await search(P({ politika: 'stroga' }))).cards)).toEqual(['Ана Петрова Photography']);
    expect(names((await search(P({ politika: ['stroga', 'gavkava'] }))).cards)).toEqual(['DJ Живко', 'Ана Петрова Photography', 'Флора Студио']);
    // Per-guest prices count only with a guest number (D29).
    const cheap = await search(P({ 'cena-ot': '400', 'cena-do': '700' }));
    expect(names(cheap.cards)).toEqual(['DJ Живко', 'Вкусна История', 'Студио Мелодия', 'Флора Студио']);
    expect(names((await search(P({ 'cena-ot': '400', 'cena-do': '700', gosti: '50' }))).cards)).not.toContain('Вкусна История');
    expect(names((await search(P({ otgovor24: '1' }))).cards)).not.toContain('DJ Живко');
  });

  it('‹Свободни на {дата}›: only without a chosen date, for a client with an upcoming event (D27)', async () => {
    const { user } = await createClient();
    await db.insert(s.clientEvent).values({ clientId: user.id, eventTypeId: await eventTypeId(), title: 'Сватба', date: '2026-06-14', cityId: await cityId() });
    const r = await search(P({ q: '' , grad: 'sofia' }), { clientId: user.id });
    const svobodni = r.facets.others.find(o => o.value === 'svobodni');
    expect(plain(svobodni)).toMatchObject({ label: 'Свободни на 14 юни', active: false });
    expect(svobodni?.count).toBe(r.total - 1);
    const on = await search(P({ grad: 'sofia', svobodni: '1' }), { clientId: user.id });
    expect(on.cards.map(c => c.name)).not.toContain('Ана Петрова Photography');
    expect(on.chips.map(c => plain(c.label))).toContain('Свободни на 14 юни');
    const withDate = await search(P({ grad: 'sofia', svobodni: '1', data: '2026-07-01' }), { clientId: user.id });
    expect(withDate.facets.others.some(o => o.value === 'svobodni')).toBe(false);
    expect((await search(P({ grad: 'sofia', svobodni: '1' }))).facets.others.some(o => o.value === 'svobodni')).toBe(false);
  });
});

describe('§13.5 facet counts (D43)', () => {
  it('count every other active group plus the item', async () => {
    const r = await search(P({ grad: 'sofia', politika: 'umerena' }));
    expect(names(r.cards)).toEqual(['Вкусна История', 'Квартет „Адажио“', 'Студио Мелодия']);
    const types = Object.fromEntries(r.facets.types.map(t => [t.value, t.count]));
    expect(types).toEqual({ 'svatba': 3, 'rozhden-den': 1, 'firmeno-sabitie': 2, 'abiturientski-bal': 0 });
    // The city group's own counts ignore the city filter but keep the policy.
    const cities = Object.fromEntries(r.facets.cities.map(c => [c.value, c.count]));
    expect(cities).toEqual({ sofia: 3, plovdiv: 2, varna: 2, burgas: 2 });
    const pol = Object.fromEntries(r.facets.policies.map(c => [c.value, c.count]));
    expect(pol).toEqual({ gavkava: 1, umerena: 3, stroga: 1 });
    expect(r.facets.policies.find(x => x.value === 'umerena')?.active).toBe(true);
    expect(r.facets.ratings.map(x => [x.label, x.count])).toEqual([['4,5 и нагоре', 3], ['4,0 и нагоре', 3]]);
    expect(Object.keys(await facetCounts(P({})))).toContain('others');
  });
});

describe('§13.6 output strings', () => {
  it('count line, sentence, context, H1 and chips', async () => {
    const r = await search(P({ sabitie: 'svatba', grad: 'sofia', data: '2026-06-14', gosti: '120' }));
    expect(plain(richText(r.countLine))).toBe(`${r.total + 1} изпълнители за сватба в София · ${r.total} свободни на 14 юни 2026`);
    expect(plain(richText(r.sentence!))).toBe('Търсите изпълнители за сватба в София за 14 юни 2026 г., събитие за 120 гости.');
    expect(plain(r.sentence)).toEqual(['Търсите ', { b: 'изпълнители за сватба' }, ' в ', { b: 'София' }, ' за ', { b: '14 юни 2026 г.' }, ', събитие ', 'за ', { b: '120 гости' }, '.']);
    expect(plain(r.contextLine)).toBe('София · 14 юни 2026 · 120 гости');
    expect(r.h1).toBe('Изпълнители за сватба');
    expect(plain(r.chips.map(c => c.label))).toEqual(['Сватба', 'София', '14 юни 2026', '120 гости']);
    expect(r.chips[1].href).toBe('/tarsene?sabitie=svatba&data=2026-06-14&gosti=120');

    const q = await search(P({ q: 'Кетъринг', grad: 'varna', gosti: 'do-50' }));
    expect(plain(richText(q.countLine))).toBe('1 изпълнител за „кетъринг“ във Варна');
    expect(plain(richText(q.sentence!))).toBe('Търсите „кетъринг“ във Варна, събитие до 50 гости.');
    expect(q.h1).toBe('Търсене');
    expect(plain(q.contextLine)).toBe('Варна · до 50 гости');
    const cat = await search(P({ kategoriya: 'ketaring', reyting: '4.5', politika: 'umerena', 'cena-do': '2000' }));
    expect(plain(richText(cat.countLine))).toBe('1 изпълнител · Кетъринг');
    expect(cat.chips.map(c => c.label)).toEqual(['рейтинг 4,5 и нагоре', 'Умерена политика', 'Кетъринг', 'цена']);
    expect(cat.sentence).toEqual(['Търсите ', { b: 'кетъринг' }, '.']);
    expect((await search(P({ podredi: 'reyting' }))).sentence).toBeNull();
    expect((await search(P({}))).contextLine).toBe('цялата страна');
  });

  it('CTA block with a date, and the zero state with its recovery options', async () => {
    const r = await search(P({ sabitie: 'svatba', data: '2026-06-14', grad: 'sofia' }));
    expect(plain(r.cta)).toMatchObject({
      title: 'Не намирате точно това, което търсите?',
      text: 'Опишете събитието си веднъж и изпълнителите, които са свободни на 14 юни, ще ви отговорят с оферта.',
      briefHref: '/zayavka/otvorena?type=svatba&city=sofia&date=2026-06-14',
      eventType: { label: 'Виж какво още ви трябва за сватба', href: '/sabitiya/svatba' },
    });
    expect((await search(P({ q: 'кетъринг за сватби' }))).cta?.briefHref).toBe('/zayavka/otvorena?cat=ketaring');
    expect((await search(P({ q: 'мелодия' }))).cta?.text).toBe('Опишете събитието си веднъж и изпълнителите ще ви отговорят с оферта.');

    const z = await search(P({ kategoriya: 'fotografiya', grad: 'sofia', data: '2026-06-14' }));
    expect(z.total).toBe(0);
    expect(z.cta).toBeNull();
    expect(plain(z.zero)).toMatchObject({
      title: 'Няма изпълнител за това търсене', dateCaused: true,
      text: 'С избраните филтри никой изпълнител в София не е свободен на 14 юни 2026 г.',
    });
    expect(z.zero!.buttons.map(b => b.label)).toEqual(['Разшири датата', 'Търси в друг град', 'Опиши заявката', 'Уведоми ме при свободна дата']);
    expect(z.zero!.buttons[0]).toMatchObject({ href: '/tarsene?kategoriya=fotografiya&grad=sofia', toast: 'Показваме изпълнители за всяка дата' });
    expect(z.zero!.buttons[1]).toMatchObject({ href: '/tarsene?kategoriya=fotografiya&data=2026-06-14', toast: 'Показваме изпълнители от цялата страна' });
    const z2 = await search(P({ kategoriya: 'muzikanti', politika: 'gavkava' }));
    expect(z2.zero?.buttons.map(b => b.label)).toEqual(['Опиши заявката']);
  });

  it('the default state for plain /tarsene: type pills, and event pills for a client (D45)', async () => {
    const { user } = await createClient();
    const [ev] = await db.insert(s.clientEvent).values({ clientId: user.id, eventTypeId: await eventTypeId(), title: 'Сватба', date: '2026-06-14', guests: 120, cityId: await cityId() }).returning();
    const r = await search(P({}), { clientId: user.id });
    expect(r.blank).toBe(true);
    expect(r.defaultState?.typePills.map(t => t.label)).toEqual(['Сватба', 'Рожден ден', 'Фирмено събитие', 'Абитуриентски бал']);
    expect(plain(r.defaultState?.eventPills)).toEqual([{ label: 'Сватба · 14 юни 2026 · 120 гости', href: `/tarsene?sabitie=svatba&grad=sofia&data=2026-06-14&gosti=120&sabitie-id=${ev.id}` }]);
    expect((await search(P({ q: '' }))).blank).toBe(false);
    expect((await search(P({}), { basePath: '/kategorii/ketaring' })).blank).toBe(false);
  });
});

describe('§13.8 sorting', () => {
  it('recommended, rating, price, newest', async () => {
    const rec = (await search(P({}))).cards.map(c => c.name);
    expect(rec.slice(0, 3)).toEqual(['Флора Студио', 'Вкусна История', 'Студио Мелодия']); // verified first, then rating
    expect(rec.at(-1)).toBe('Градина и Маса');
    const byRating = (await search(P({ podredi: 'reyting' }))).cards.map(c => c.name);
    expect(byRating.slice(0, 2)).toEqual(['Флора Студио', 'Квартет „Адажио“']);
    expect(byRating.at(-1)).toBe('Градина и Маса');
    const byPrice = (await search(P({ podredi: 'tsena' }))).cards.map(c => c.name);
    expect(byPrice[0]).toBe('Вкусна История'); // 28 € per guest without a guest count
    expect(byPrice[1]).toBe('Флора Студио');
    const withGuests = (await search(P({ podredi: 'tsena', gosti: '100' }))).cards.map(c => c.name);
    expect(withGuests.at(-1)).toBe('Вкусна История'); // 2 800 € for 100 guests
    expect((await search(P({ podredi: 'novi' }))).cards.at(-1)?.name).toBe('Градина и Маса');
    const card = (await search(P({ q: 'мелодия' }))).cards[0];
    expect(plain(card)).toMatchObject({ location: 'София · до 150 км', ratingText: '4,9', reviewsLabel: '38 ревюта', verified: true,
      fromPrice: { text: 'от 640 €', unitLabel: 'за събитие' }, href: `/partnyori/${F.melodia.partner.slug}`, categoryName: 'DJ и озвучаване' });
    expect(card.coverUrl).toMatch(/^\/uploads\/public\//);
    expect((await search(P({ q: 'адажио' }))).cards[0].location).toBe('София · цялата страна');
  });
});

describe('§13.7 suggestions and history', () => {
  it('recent searches, categories, partners with availability, or ‹Няма съвпадение›', async () => {
    const { user, actor } = await createClient();
    for (const q of ['сватба софия', 'кетъринг', 'фотокабина', 'кетъринг', 'DJ']) { await recordQuery(actor, { q }); setTestNow(new Date(NOW.getTime() + Math.random() * 1000 + 1000)); }
    setTestNow(NOW);
    const empty = await suggest({ q: '' }, { clientId: user.id });
    expect(empty[0]).toMatchObject({ heading: 'Последни търсения' });
    expect(empty[0].rows).toHaveLength(3);
    expect(empty[1].rows.map(r => r.label)).toEqual(['Зали и локации', 'Кетъринг', 'DJ и озвучаване', 'Фотография', 'Видеозаснемане']);
    expect((await suggest({ q: '' })).map(g => g.heading)).toEqual(['Категории']);
    const typed = await suggest({ q: 'кетър', data: '2026-06-14' });
    expect(typed[0]).toMatchObject({ heading: 'Категории', rows: [{ label: 'Кетъринг', meta: '2 изпълнители', href: '/tarsene?kategoriya=ketaring' }] });
    expect(plain(typed[1].rows.map(r => r.meta))).toEqual(['Кетъринг · София · свободен на 14 юни', 'Кетъринг · Варна · свободен на 14 юни']);
    const ana = await suggest({ q: 'петрова', data: '2026-06-14' });
    expect(plain(ana[0].rows[0].meta)).toBe('Фотография · София · зает на 14 юни');
    expect(await suggest({ q: 'xyz' })).toEqual([{ heading: 'Няма съвпадение', rows: [{ kind: 'brief', label: 'Опишете събитието си', meta: 'изпълнителите ви отговарят с оферта', href: '/zayavka/otvorena' }] }]);
    const { actor: partner } = F.melodia;
    expect(await failure(recordQuery(partner, { q: 'x' }))).toContain('ForbiddenError');
    expect(await recordQuery(actor, { q: '   ' })).toBeNull();
  });
});

describe('§13.10 public pages', () => {
  it('/kategorii: partners of each category serving weddings in the city, with the from-price', async () => {
    const r = await categoryCards({});
    expect(r.city.label).toBe('Град: София');
    const by = Object.fromEntries(r.cards.map(c => [c.slug, plain([c.countLabel, c.priceLabel])]));
    expect(by.ketaring).toEqual(['1 партньор', 'от 28 € на гост']);
    expect(by['dj-i-ozvuchavane']).toEqual(['1 партньор', 'от 640 €']);
    expect(by.videozasnemane).toEqual(['Няма партньори', null]);
    // ‹Затворено Студио› does not accept requests but is visible, so the directory counts it.
    expect(by.fotografiya).toEqual(['2 партньори', 'от 500 €']);
    const varna = await categoryCards({ grad: 'varna' });
    expect(Object.fromEntries(varna.cards.map(c => [c.slug, c.count])).ketaring).toBe(1);
  });

  it('/kategorii/[slug] hero: H1, the national count with the plural noun, the tips sub-heading (D16)', async () => {
    const h = await categoryHero({ slug: 'ketaring' });
    expect(h).toMatchObject({ h1: 'Кетъринг за сватби', countText: '2 проверени кетъринг фирми в цялата страна', tipsHeading: 'Какво да питате кетъринга',
      tipsSubheading: 'Три въпроса, които спестяват най-честите изненади.' });
    expect(plain(h?.priceLabel)).toBe('от 890 €');
    expect((await categoryHero({ slug: 'ketaring', sabitie: 'rozhden-den' }))?.h1).toBe('Кетъринг за рождени дни');
    expect(await categoryHero({ slug: 'transport-za-gosti' })).toBeNull();
    expect(tipsSubheading(1)).toBe('Един въпрос, който спестява най-честите изненади.');
    expect(tipsSubheading(4)).toBe('Четири въпроса, които спестяват най-честите изненади.');
  });

  it('/sabitiya/[slug]: tiers counted in the city and free on the date; the client’s event panels', async () => {
    const page = await eventTypePage({ slug: 'svatba', grad: 'sofia', data: '2026-06-14' });
    expect(plain(richText(page!.countLine))).toBe('17 услуги за сватба · показваме само партньорите, свободни на 14 юни 2026 в София');
    const tier = Object.fromEntries(page!.tiers.map(t => [t.categorySlug, t.count]));
    expect(tier).toMatchObject({ 'zali-i-lokatsii': 0, ketaring: 1, 'dj-i-ozvuchavane': 1, fotografiya: 0, muzikanti: 1, dekoratsiya: 1 });
    expect(page!.tiers[0]).toMatchObject({ tier: 'required', label: 'Зала и локация' });

    const { user, actor } = await createClient();
    const b = await createBookingRow({ client: user, partner: F.melodia, eventDate: '2026-06-14', status: 'confirmed' });
    await db.update(s.clientEvent).set({ cityId: await cityId('sofia') }).where(eq(s.clientEvent.id, b.clientEvent.id));
    const declined = await createBookingRow({ client: user, partner: F.ana, eventDate: '2026-06-14', status: 'cancelled' });
    await db.update(s.request).set({ status: 'declined', clientEventId: b.clientEvent.id }).where(eq(s.request.id, declined.request.id));
    await db.delete(s.booking).where(eq(s.booking.id, declined.booking.id));
    const mine = await eventTypePage({ slug: 'svatba', clientEventId: b.clientEvent.id }, { clientId: user.id });
    expect(mine!.panels?.arranged).toEqual([expect.objectContaining({ partnerName: 'Студио Мелодия', badge: 'Потвърдена', categoryName: 'DJ и озвучаване' })]);
    const missing = Object.fromEntries(mine!.panels!.missing.map(m => [m.categorySlug, m.line]));
    expect(missing.fotografiya).toBe('Ана Петрова Photography отказа · 0 партньори са свободни');
    expect(missing.ketaring).toBe('Няма изпратена заявка · 1 партньор е свободен');
    expect(missing['dj-i-ozvuchavane']).toBeUndefined();
    expect(await eventTypePage({ slug: 'drugo' })).toBeNull();
    void actor;
  });
});

describe('/partnyori/[slug] and the marketing numbers', () => {
  it('shows a visible partner (masked text, recommended package, widget for a client); previews only for the owner or the team', async () => {
    await db.update(s.partner).set({ description: 'Звъннете на 0888 123 456 за дата.' }).where(eq(s.partner.id, F.melodia.partner.id));
    const anon = await partnerPage({ slug: F.melodia.partner.slug });
    expect(anon?.partner).toMatchObject({ name: 'Студио Мелодия', description: 'Звъннете на ••• за дата.', location: 'София · до 150 км', acceptingRequests: true, policyLabel: 'Умерена' });
    expect(anon?.services[0]).toMatchObject({ recommended: true, inclusions: ['DJ за цялото събитие', 'Безжичен микрофон'] });
    expect(anon?.photos).toHaveLength(1);
    expect(anon?.eventTypes.map(t => t.href)).toEqual(['/sabitiya/svatba', '/sabitiya/rozhden-den', '/sabitiya/firmeno-sabitie']);
    expect(anon?.widget).toBeNull();
    const { actor, user } = await createClient();
    await db.insert(s.clientEvent).values({ clientId: user.id, eventTypeId: await eventTypeId(), title: 'Сватба', date: '2026-06-14', guests: 120, cityId: await cityId() });
    const forAna = await partnerPage({ slug: F.ana.partner.slug }, { actor });
    expect(forAna?.widget).toMatchObject({ date: '2026-06-14', typeSlug: 'svatba', guests: 120, availability: { requestable: false, state: 'blocked' }, watching: false });
    expect((await partnerPage({ slug: F.closed.partner.slug }, { actor }))?.widget?.availability?.requestable).toBe(false);
    expect(await partnerPage({ slug: F.hidden.partner.slug })).toBeNull();
    expect(await partnerPage({ slug: F.hidden.partner.slug, preview: true }, { actor })).toBeNull();
    expect((await partnerPage({ slug: F.hidden.partner.slug, preview: true }, { actor: F.hidden.actor }))?.partner.preview).toBe(true);
    expect((await partnerPage({ slug: F.hidden.partner.slug, preview: true }, { actor: (await createAdmin('moderator')).actor }))?.partner.name).toBe('Скрито Студио');
  });

  it('reads the public numbers from the settings (D8)', async () => {
    expect(plain(await publicNumbers())).toMatchObject({
      commissionPct: '10%', introPct: '5%', introCount: 3, payoutDays: [1, 15], responseHours: 24, paymentHours: 24, approvalSlaHours: 48, maxPackages: 5,
      payoutExample: { title: 'Пример за пакет от 1 450 €', commissionLine: 'Комисиона (10%) − 145 €', receiveLine: 'Получавате 1 305 €', partnerCents: 130_500 },
    });
  });
});

describe('efficiency', () => {
  it('searches a catalogue of 1 500 partners quickly', async () => {
    const [{ id: catId }] = await db.select({ id: s.category.id }).from(s.category).where(eq(s.category.slug, 'fotografiya'));
    const sofia = await cityId('sofia');
    const rows = Array.from({ length: 1500 }, (_, i) => ({
      slug: `bulk-${i}`, status: 'approved' as const, businessName: `Фото ${i}`, contactName: 'X', notificationEmail: `b${i}@example.invalid`, phone: '+359888000000',
      primaryCategoryId: catId, cityId: sofia, serviceRadiusKm: 100, cancellationPolicy: 'moderate' as const, minPriceCents: 50_000 + i, minPriceUnit: 'per_event' as const,
      searchText: `фото ${i} фотография софия сватба`, approvedAt: NOW,
    }));
    for (let i = 0; i < rows.length; i += 500) await db.insert(s.partner).values(rows.slice(i, i + 500));
    const t0 = performance.now();
    const r = await search(P({ q: 'фотография софия', data: '2026-06-14', grad: 'sofia', reyting: '4.0' }));
    const r2 = await search(P({ q: 'фото', podredi: 'tsena' }));
    const ms = performance.now() - t0;
    expect(r2.total).toBeGreaterThan(1500);
    expect(r.total).toBe(0); // the bulk partners have no reviews
    expect(ms).toBeLessThan(4000);
    expect((await searchPartners(P({ kategoriya: 'fotografiya' }))).total).toBe(1501);
    expect((await matchPartners(P({ kategoriya: 'fotografiya', data: '2026-06-14' }), {}, { ignoreDate: true })).length).toBe(1501);
    await db.execute(sql`delete from partner where slug like 'bulk-%'`);
  });
});
