// Search and public browsing (SPEC §13): GET parameters, the base set, the stem matcher
// (a port of the prototype's searchEngine), filters, facet counts, the output strings,
// the suggestions panel, sorting and the computed blocks of the public pages.
//
// Strategy (v1): SQL narrows the base set by the query stems, the category and the subtype;
// everything else is evaluated in memory on that reduced set, which also gives the facet
// counts (D43: each item counts the partners matching every other active group plus itself).
// Busy dates come from one SQL query per date (availability.busySql).
import { and, asc, desc, eq, gte, sql, type SQL } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, category, categorySubtype, categoryTip, city, clientEvent, eventType, eventTypeService, partner, request, searchHistory, service,
  type CancellationPolicy, type PriceUnit,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { date as fmtDate, dateShort, moneyShort, sofiaDate, type DateStr } from '@/lib/format';
import type { AnyActor } from './actor';
import { busyPartnerIds, check, isDate } from './availability';
import { assertClient, count as nCount, maskContacts, mediaUrl, withTx } from './catalogue-kit';
import { POLICY_LABEL, requestLapsedSql, responsiveness } from './partners';
import { partnerReviews, ratingSummary } from './reviews';
import { getSettings } from './settings';

// ── Parameters (§13.1) ───────────────────────────────────────────────────

export const SORTS = ['preporachani', 'reyting', 'tsena', 'novi'] as const;
export type Sort = (typeof SORTS)[number];
export const SORT_LABEL: Record<Sort, string> = {
  preporachani: 'Подреди: Препоръчани', reyting: 'Подреди: Най-висок рейтинг', tsena: 'Подреди: Най-ниска цена', novi: 'Подреди: Най-нови',
};
export const POLICY_SLUG: Record<string, CancellationPolicy> = { gavkava: 'flexible', umerena: 'moderate', stroga: 'strict' };
const SLUG_OF_POLICY: Record<CancellationPolicy, string> = { flexible: 'gavkava', moderate: 'umerena', strict: 'stroga' };
export const GUEST_BANDS = {
  'do-50': { need: 50, label: 'до 50', sentence: 'до 50 гости', band: true },
  '50-100': { need: 100, label: '50 – 100', sentence: '50 – 100 гости', band: false },
  '100-150': { need: 150, label: '100 – 150', sentence: '100 – 150 гости', band: false },
  'nad-150': { need: 151, label: 'над 150', sentence: 'над 150 гости', band: true },
} as const;
export const RATINGS = [4.5, 4.0] as const;

export type SearchParams = {
  q: string;
  kategoriya: string | null;
  vid: string | null;
  sabitie: string[];
  grad: string[];
  data: DateStr | null;
  gosti: string | null;
  reyting: number[];
  politika: string[];
  svobodni: boolean;
  drugaData: boolean;
  otgovor24: boolean;
  cenaOt: number | null;
  cenaDo: number | null;
  podredi: Sort;
  /** The client's event this search adds a service to (‹Добави услуга към събитието›); carried along only. */
  sabitieId: string | null;
  /** Any parameter was given (an empty ‹Търси› still shows results; plain /tarsene shows the default state). */
  submitted: boolean;
};

type RawParams = URLSearchParams | Record<string, unknown>;

const KEYS = ['q', 'kategoriya', 'vid', 'sabitie', 'grad', 'data', 'gosti', 'reyting', 'politika', 'svobodni', 'druga-data', 'otgovor24', 'cena-ot', 'cena-do', 'podredi', 'sabitie-id'];

function getAll(raw: RawParams, k: string): string[] {
  if (raw instanceof URLSearchParams) return raw.getAll(k);
  const v = (raw as Record<string, unknown>)[k];
  // Saved searches keep their params as JSON, where numbers stay numbers ({ gosti: 120, reyting: 4.5 }).
  return v == null ? [] : (Array.isArray(v) ? v : [v]).map(x => String(x));
}

/** The parameter set as JSON (saved_search.params): one value per key, arrays for repeated keys. */
export function paramsJson(p: Partial<SearchParams>): Record<string, string | string[]> {
  const u = new URLSearchParams(toQuery(p));
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(u.keys())) { const all = u.getAll(k); out[k] = all.length > 1 ? all : all[0]; }
  return out;
}

const wholeEuros = (v: string | undefined) => (v && /^\d{1,7}$/.test(v.trim()) ? Number(v) : null);

/** Normalise GET parameters; unknown values are dropped. */
export function parseSearchParams(raw: RawParams): SearchParams {
  const one = (k: string) => getAll(raw, k).map(s => s.trim()).find(Boolean) ?? null;
  const many = (k: string) => [...new Set(getAll(raw, k).flatMap(s => s.split(',')).map(s => s.trim()).filter(Boolean))];
  const gosti = one('gosti');
  const sort = one('podredi');
  return {
    q: (getAll(raw, 'q')[0] ?? '').trim().slice(0, 200),
    kategoriya: one('kategoriya'),
    vid: one('vid'),
    sabitie: many('sabitie'),
    grad: many('grad'),
    data: isDate(one('data')) ? one('data') : null,
    gosti: gosti && (gosti in GUEST_BANDS || /^\d{1,5}$/.test(gosti)) ? gosti : null,
    reyting: many('reyting').map(Number).filter(n => (RATINGS as readonly number[]).includes(n)),
    politika: many('politika').filter(s => s in POLICY_SLUG),
    svobodni: one('svobodni') === '1',
    drugaData: one('druga-data') === '1',
    otgovor24: one('otgovor24') === '1',
    cenaOt: wholeEuros(one('cena-ot') ?? undefined),
    cenaDo: wholeEuros(one('cena-do') ?? undefined),
    podredi: (SORTS as readonly string[]).includes(sort ?? '') ? (sort as Sort) : 'preporachani',
    sabitieId: one('sabitie-id'),
    submitted: KEYS.some(k => getAll(raw, k).length > 0),
  };
}

/** The canonical query string of a parameter set (stable order; neutral values left out). */
export function toQuery(p: Partial<SearchParams>): string {
  const u = new URLSearchParams();
  if (p.q) u.set('q', p.q);
  if (p.kategoriya) u.set('kategoriya', p.kategoriya);
  if (p.vid) u.set('vid', p.vid);
  for (const s of p.sabitie ?? []) u.append('sabitie', s);
  for (const s of p.grad ?? []) u.append('grad', s);
  if (p.data) u.set('data', p.data);
  if (p.gosti) u.set('gosti', p.gosti);
  for (const r of p.reyting ?? []) u.append('reyting', r.toFixed(1));
  for (const s of p.politika ?? []) u.append('politika', s);
  if (p.svobodni) u.set('svobodni', '1');
  if (p.drugaData) u.set('druga-data', '1');
  if (p.otgovor24) u.set('otgovor24', '1');
  if (p.cenaOt != null) u.set('cena-ot', String(p.cenaOt));
  if (p.cenaDo != null) u.set('cena-do', String(p.cenaDo));
  if (p.podredi && p.podredi !== 'preporachani') u.set('podredi', p.podredi);
  if (p.sabitieId) u.set('sabitie-id', p.sabitieId);
  return u.toString();
}

/** A link to the search with these parameters: the category page when the category is the page's own. */
export function searchHref(p: Partial<SearchParams>, basePath = '/tarsene'): string {
  const page = /^\/kategorii\/([^/?]+)$/.exec(basePath);
  if (page && p.kategoriya === decodeURIComponent(page[1])) {
    const qs = toQuery({ ...p, kategoriya: null });
    return qs ? `${basePath}?${qs}` : basePath;
  }
  const qs = toQuery(p);
  return `/tarsene${qs ? `?${qs}` : '?q='}`;
}

export function guestsNeed(gosti: string | null): number {
  if (!gosti) return 0;
  if (gosti in GUEST_BANDS) return GUEST_BANDS[gosti as keyof typeof GUEST_BANDS].need;
  return Number(gosti) || 0;
}
const guestsLabel = (g: string) => (g in GUEST_BANDS ? GUEST_BANDS[g as keyof typeof GUEST_BANDS].label : g);

// ── Stem matching (§13.3, the prototype's searchEngine) ──────────────────

const STOP = new Set(['за', 'в', 'във', 'на', 'и', 'с', 'със', 'от', 'до', 'по', 'при', 'към']);

/** Lower-case, split on whitespace and punctuation, drop short / numeric / stop words, stem (> 4 chars lose the last). */
export function queryStems(q: string): string[] {
  return [...new Set(q.toLocaleLowerCase('bg').split(/[\s\p{P}\p{S}]+/u)
    .filter(w => w.length > 1 && !/^\d+$/.test(w) && !STOP.has(w))
    .map(w => (w.length > 4 ? w.slice(0, -1) : w)))];
}

const likeEscape = (s: string) => s.replace(/[\\%_]/g, m => `\\${m}`);
const BASE = sql`${partner.status} = 'approved' and ${partner.isListed} and ${partner.acceptingRequests}`;
const VISIBLE = sql`${partner.status} = 'approved' and ${partner.isListed}`;
const hasStem = (stem: string) => sql`${partner.searchText} like ${`%${likeEscape(stem)}%`}`;

/** The stems that occur in at least one base-set haystack (unknown stems are ignored, §13.3 rule 5). */
export async function knownStems(stems: string[], q: Queryable = db): Promise<string[]> {
  if (!stems.length) return [];
  const cols = Object.fromEntries(stems.map((s, i) => [`k${i}`, sql<boolean>`coalesce(bool_or(${hasStem(s)}), false)`]));
  const [row] = await q.select(cols).from(partner).where(BASE);
  return stems.filter((_, i) => !!(row as Record<string, boolean>)[`k${i}`]);
}

// ── Reference data ───────────────────────────────────────────────────────

type CityRef = typeof city.$inferSelect;
type Refs = {
  cities: CityRef[]; citiesBySlug: Map<string, CityRef>; citiesById: Map<string, CityRef>;
  categories: (typeof category.$inferSelect)[]; categoriesBySlug: Map<string, typeof category.$inferSelect>; categoriesById: Map<string, typeof category.$inferSelect>;
  types: (typeof eventType.$inferSelect)[]; typesBySlug: Map<string, typeof eventType.$inferSelect>; typesById: Map<string, typeof eventType.$inferSelect>;
};

async function loadRefs(q: Queryable): Promise<Refs> {
  const [cities, categories, types] = await Promise.all([
    q.select().from(city).orderBy(asc(city.sortOrder)),
    q.select().from(category).orderBy(asc(category.sortOrder)),
    q.select().from(eventType).orderBy(asc(eventType.sortOrder)),
  ]);
  return {
    cities, citiesBySlug: new Map(cities.map(c => [c.slug, c])), citiesById: new Map(cities.map(c => [c.id, c])),
    categories, categoriesBySlug: new Map(categories.map(c => [c.slug, c])), categoriesById: new Map(categories.map(c => [c.id, c])),
    types, typesBySlug: new Map(types.map(t => [t.slug, t])), typesById: new Map(types.map(t => [t.id, t])),
  };
}

/** Great-circle distance in km between two centroids. */
export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** D73: base city selected, OR nationwide, OR within the service radius of a selected city. */
function servesCity(p: Pick<Candidate, 'cityId' | 'servesNationwide' | 'serviceRadiusKm'>, target: CityRef, refs: Refs): boolean {
  if (p.servesNationwide || p.cityId === target.id) return true;
  const base = p.cityId ? refs.citiesById.get(p.cityId) : null;
  return !!base && p.serviceRadiusKm != null && haversineKm(base, target) <= p.serviceRadiusKm;
}

// ── Candidates ───────────────────────────────────────────────────────────

type Candidate = {
  id: string; slug: string; name: string; primaryCategoryId: string | null; cityId: string | null; serviceRadiusKm: number | null;
  servesNationwide: boolean; maxGuests: number | null; ratingAvg: number | null; reviewCount: number; isVerified: boolean;
  approvedAt: Date | null; listedAt: Date | null; policy: CancellationPolicy | null; minPriceCents: number | null; minPriceUnit: PriceUnit | null;
  eventTypeIds: string[]; serviceCategoryIds: string[]; subtypeIds: string[]; lapsed90: boolean; coverKey: string | null;
};

/** In a single-table select drizzle leaves column names unqualified; subqueries need the qualified id. */
const PID = sql.raw('"partner"."id"');

async function loadCandidates(q: Queryable, where: SQL[], todayStr: DateStr): Promise<Candidate[]> {
  const since = new Date(new Date(`${todayStr}T00:00:00Z`).getTime() - 90 * 86_400_000).toISOString();
  const rows = await q.select({
    id: partner.id, slug: partner.slug, name: partner.businessName, primaryCategoryId: partner.primaryCategoryId, cityId: partner.cityId,
    serviceRadiusKm: partner.serviceRadiusKm, servesNationwide: partner.servesNationwide, maxGuests: partner.maxGuests,
    ratingAvg: partner.ratingAvg, reviewCount: partner.reviewCount, isVerified: partner.isVerified, approvedAt: partner.approvedAt,
    listedAt: sql<Date | null>`coalesce("partner"."listed_at", "partner"."approved_at")`.mapWith(partner.listedAt),
    policy: partner.cancellationPolicy, minPriceCents: partner.minPriceCents, minPriceUnit: partner.minPriceUnit,
    eventTypeIds: sql<string[]>`array(select pet.event_type_id::text from partner_event_type pet where pet.partner_id = ${PID})`,
    serviceCategoryIds: sql<string[]>`array(select distinct s.category_id::text from service s where s.partner_id = ${PID} and s.status = 'active')`,
    subtypeIds: sql<string[]>`array(select ps.subtype_id::text from partner_subtype ps where ps.partner_id = ${PID})`,
    // ‹Отговаря до 24 часа› (D44): a request that lapsed unanswered (R8: T2, or T4 on a chosen
    // offer never confirmed) in the last 90 days. An offer that lapsed without being chosen (R10)
    // is not the partner's silence, so those expiries do not count.
    lapsed90: sql<boolean>`exists (select 1 from request r where r.partner_id = ${PID} and r.status = 'expired'
      and r.expired_at >= ${since}::timestamptz and ${requestLapsedSql(sql.raw('r.id'))})`,
    coverKey: sql<string | null>`(select m.storage_key from partner_photo ph join media m on m.id = ph.media_id
      where ph.partner_id = ${PID} order by ph.position limit 1)`,
  }).from(partner).where(and(...where));
  return rows.map(r => ({ ...r, ratingAvg: r.ratingAvg == null ? null : Number(r.ratingAvg) }));
}

// ── Evaluation ───────────────────────────────────────────────────────────

export type SearchContext = {
  /** Signed-in client: their next event drives ‹Свободни на {дата}›; their history feeds suggestions. */
  clientId?: string | null;
  /** `/tarsene` (default) or `/kategorii/[slug]`. */
  basePath?: string;
};

type Group = 'type' | 'city' | 'rating' | 'policy' | 'date' | 'svobodni' | 'otgovor24' | 'guests' | 'price';
const GROUPS: Group[] = ['type', 'city', 'rating', 'policy', 'date', 'svobodni', 'otgovor24', 'guests', 'price'];

type Evaluation = {
  params: SearchParams;
  refs: Refs;
  stems: string[];
  known: string[];
  /** q non-empty and no stem known → zero results (§13.3 rule 7). */
  queryDead: boolean;
  candidates: Candidate[];
  pass: Map<string, Record<Group, boolean>>;
  busyOnDate: Set<string>;
  busyOnEvent: Set<string>;
  /** ‹Свободни на {дата}›: the signed-in client's next event (shown only without a chosen date). */
  eventDate: DateStr | null;
  categoryRow: Refs['categories'][number] | null;
  need: number;
};

function effectivePrice(c: Candidate, need: number): number | null {
  if (c.minPriceCents == null) return null;
  return c.minPriceUnit === 'per_guest' && need ? c.minPriceCents * need : c.minPriceCents;
}

async function nextEventDate(q: Queryable, clientId: string, todayStr: DateStr): Promise<{ id: string; date: DateStr } | null> {
  const [e] = await q.select({ id: clientEvent.id, date: clientEvent.date }).from(clientEvent)
    .where(and(eq(clientEvent.clientId, clientId), gte(clientEvent.date, todayStr))).orderBy(asc(clientEvent.date)).limit(1);
  return e ?? null;
}

async function evaluate(params: SearchParams, ctx: SearchContext, q: Queryable): Promise<Evaluation> {
  const refs = await loadRefs(q);
  const todayStr = sofiaDate(await now());
  const stems = queryStems(params.q);
  const known = await knownStems(stems, q);
  // §13.3 rule 7: a non-empty query none of whose stems is known matches nobody.
  const queryDead = !!params.q && known.length === 0;
  const categoryRow = params.kategoriya ? refs.categoriesBySlug.get(params.kategoriya) ?? null : null;

  const where: SQL[] = [BASE];
  for (const s of known) where.push(hasStem(s));
  if (params.kategoriya) {
    // Exact category (§13.4): an active service in it, or it is the primary category.
    where.push(categoryRow
      ? sql`(${partner.primaryCategoryId} = ${categoryRow.id} or exists (select 1 from service s where s.partner_id = ${partner.id} and s.status = 'active' and s.category_id = ${categoryRow.id}))`
      : sql`false`);
  }
  if (params.vid) {
    const st = categoryRow ? await q.select({ id: categorySubtype.id }).from(categorySubtype)
      .where(and(eq(categorySubtype.categoryId, categoryRow.id), eq(categorySubtype.slug, params.vid))).limit(1) : [];
    where.push(st[0] ? sql`exists (select 1 from partner_subtype ps where ps.partner_id = ${partner.id} and ps.subtype_id = ${st[0].id})` : sql`false`);
  }
  const candidates = queryDead ? [] : await loadCandidates(q, where, todayStr);

  const ids = candidates.map(c => c.id);
  const busyOnDate = params.data ? await busyPartnerIds(ids, params.data, q, todayStr) : new Set<string>();
  const ev = ctx.clientId && !params.data ? await nextEventDate(q, ctx.clientId, todayStr) : null;
  const eventDate = ev?.date ?? null;
  const busyOnEvent = eventDate && params.svobodni ? await busyPartnerIds(ids, eventDate, q, todayStr) : new Set<string>();

  const typeIds = params.sabitie.map(s => refs.typesBySlug.get(s)?.id).filter(Boolean) as string[];
  const cities = params.grad.map(s => refs.citiesBySlug.get(s)).filter(Boolean) as CityRef[];
  const policies = params.politika.map(s => POLICY_SLUG[s]);
  const minRating = params.reyting.length ? Math.min(...params.reyting) : null;
  const need = guestsNeed(params.gosti);
  const priceOn = params.cenaOt != null || params.cenaDo != null;
  const lo = (params.cenaOt ?? 0) * 100, hi = params.cenaDo != null ? params.cenaDo * 100 : Infinity;

  const pass = new Map<string, Record<Group, boolean>>();
  for (const c of candidates) {
    const price = c.minPriceUnit === 'per_guest' && !need ? null : effectivePrice(c, need);
    pass.set(c.id, {
      type: !params.sabitie.length || c.eventTypeIds.some(t => typeIds.includes(t)),
      city: !params.grad.length || cities.some(ct => servesCity(c, ct, refs)),
      rating: minRating == null || (c.ratingAvg != null && c.reviewCount > 0 && c.ratingAvg >= minRating),
      policy: !policies.length || (c.policy != null && policies.includes(c.policy)),
      // With a date: busy partners out, unless ‹Предлагат друга дата›, which shows only them. Without a date it is ignored.
      date: !params.data || (params.drugaData ? busyOnDate.has(c.id) : !busyOnDate.has(c.id)),
      svobodni: !(params.svobodni && eventDate) || !busyOnEvent.has(c.id),
      otgovor24: !params.otgovor24 || !c.lapsed90,
      guests: !need || c.maxGuests == null || c.maxGuests >= need,
      // D29: unpriced partners are never excluded; per-guest prices only with a guest count.
      price: !priceOn || price == null || (price >= lo && price <= hi),
    });
  }
  return { params, refs, stems, known, queryDead, candidates, pass, busyOnDate, busyOnEvent, eventDate, categoryRow, need };
}

const passesAll = (r: Record<Group, boolean>, except: Group[] = []) => GROUPS.every(g => except.includes(g) || r[g]);

function sortCandidates(list: Candidate[], e: Evaluation): Candidate[] {
  const busy = (c: Candidate) => (e.params.data && e.busyOnDate.has(c.id) ? 1 : 0);
  const rating = (c: Candidate) => c.ratingAvg ?? -1;
  const t = (d: Date | null) => d?.getTime() ?? 0;
  const byId = (a: Candidate, b: Candidate) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const out = [...list];
  switch (e.params.podredi) {
    case 'reyting':
      return out.sort((a, b) => rating(b) - rating(a) || b.reviewCount - a.reviewCount || byId(a, b));
    case 'tsena':
      return out.sort((a, b) => {
        const pa = effectivePrice(a, e.need), pb = effectivePrice(b, e.need);
        if (pa == null || pb == null) return pa == null && pb == null ? byId(a, b) : pa == null ? 1 : -1;
        return pa - pb || byId(a, b);
      });
    case 'novi':
      return out.sort((a, b) => t(b.approvedAt) - t(a.approvedAt) || byId(a, b));
    default:
      return out.sort((a, b) => busy(a) - busy(b) || Number(b.isVerified) - Number(a.isVerified) || rating(b) - rating(a)
        || b.reviewCount - a.reviewCount || t(a.approvedAt) - t(b.approvedAt) || byId(a, b));
  }
}

// ── Output (§13.6) ───────────────────────────────────────────────────────

/** A line with bold parts: ['Търсите ', { b: '„кетъринг“' }, '.']. */
export type Rich = (string | { b: string })[];
export const richText = (r: Rich) => r.map(x => (typeof x === 'string' ? x : x.b)).join('');

const inCities = (names: string[]) => (names.length ? `${/^[ВФвф]/.test(names[0]) ? 'във' : 'в'} ${names.join(', ')}` : '');

export type Card = {
  partnerId: string; slug: string; href: string; name: string; categoryName: string; cityName: string;
  /** ‹София · до 150 км› / ‹София · цялата страна›. */
  location: string; verified: boolean; ratingAvg: number | null; ratingText: string | null; reviewCount: number; reviewsLabel: string | null;
  fromPrice: { cents: number; unit: PriceUnit; text: string; unitLabel: string } | null;
  coverUrl: string | null;
  /** Taken on the chosen date: greyed card, red-dot ‹Зает на {14 юни}› and ‹Уведоми ме›. */
  busy: boolean; busyLabel: string | null;
};

export const ratingText = (r: number | null) => (r == null ? null : r.toFixed(1).replace('.', ','));

function toCard(c: Candidate, e: Evaluation): Card {
  const cat = (c.primaryCategoryId && e.refs.categoriesById.get(c.primaryCategoryId)) || null;
  const ct = (c.cityId && e.refs.citiesById.get(c.cityId)) || null;
  const busy = !!e.params.data && e.busyOnDate.has(c.id);
  const reach = c.servesNationwide ? 'цялата страна' : c.serviceRadiusKm ? `до ${c.serviceRadiusKm} км` : '';
  return {
    partnerId: c.id, slug: c.slug, href: `/partnyori/${c.slug}`, name: c.name, categoryName: cat?.name ?? '', cityName: ct?.name ?? '',
    location: [ct?.name, reach].filter(Boolean).join(' · '), verified: c.isVerified,
    ratingAvg: c.reviewCount ? c.ratingAvg : null, ratingText: c.reviewCount ? ratingText(c.ratingAvg) : null, reviewCount: c.reviewCount,
    reviewsLabel: c.reviewCount ? nCount(c.reviewCount, 'ревю', 'ревюта') : null,
    fromPrice: c.minPriceCents != null && c.minPriceUnit
      ? { cents: c.minPriceCents, unit: c.minPriceUnit, text: `от ${moneyShort(c.minPriceCents)}`, unitLabel: c.minPriceUnit === 'per_guest' ? 'на гост' : 'за събитие' }
      : null,
    coverUrl: mediaUrl(c.coverKey), busy, busyLabel: busy && e.params.data ? `Зает на ${dateShort(e.params.data)}` : null,
  };
}

export type FacetItem = { value: string; label: string; count: number; active: boolean; href: string };

export type SearchResult = {
  params: SearchParams;
  /** Plain `/tarsene` with no parameters: the default state instead of results. */
  blank: boolean;
  defaultState: { eventPills: { label: string; href: string }[]; typePills: { label: string; href: string }[] } | null;
  h1: string;
  cards: Card[];
  total: number;
  countLine: Rich;
  /** `.results-say`; null when there is nothing to say. */
  sentence: Rich | null;
  /** `.h-sub--ctx`: ‹София · 14 юни 2026 · 120 гости›. */
  contextLine: string;
  sortLabel: string;
  sorts: { value: Sort; label: string; active: boolean; href: string }[];
  facets: {
    types: FacetItem[]; cities: FacetItem[]; ratings: FacetItem[]; policies: FacetItem[]; others: FacetItem[];
    price: { from: number; to: number; active: boolean; clearHref: string };
    subtypes: FacetItem[];
  };
  chips: { label: string; href: string }[];
  clearHref: string;
  cta: { title: string; text: string; briefHref: string; eventType: { label: string; href: string } | null } | null;
  zero: { title: string; text: string; dateCaused: boolean; buttons: { kind: 'widen_date' | 'other_city' | 'brief' | 'watch'; label: string; href?: string; toast?: string }[] } | null;
  stems: { all: string[]; known: string[] };
};

/** `/zayavka/otvorena?cat=&type=&city=&date=&guests=` (slugs) carrying what the client chose. */
function briefHref(e: Evaluation): string {
  const p = e.params;
  let cat = p.kategoriya;
  if (!cat && e.known.length) {
    // ‹кетъринг за сватби› names a service too: one directory category containing a known stem.
    const named = e.refs.categories.filter(c => c.isVisible && e.known.some(s => c.name.toLocaleLowerCase('bg').includes(s)));
    if (named.length === 1) cat = named[0].slug;
  }
  const u = new URLSearchParams();
  if (cat) u.set('cat', cat);
  if (p.sabitie.length === 1) u.set('type', p.sabitie[0]);
  if (p.grad.length === 1) u.set('city', p.grad[0]);
  if (p.data) u.set('date', p.data);
  if (p.gosti) u.set('guests', p.gosti);
  const qs = u.toString();
  return `/zayavka/otvorena${qs ? `?${qs}` : ''}`;
}

const toggle = <T>(xs: T[], x: T) => (xs.includes(x) ? xs.filter(y => y !== x) : [...xs, x]);

/**
 * `search.search(params)`: the whole `/tarsene` (and `/kategorii/[slug]`) result — cards, total,
 * facet counts, the count line, the results sentence, the context line, chips, the CTA block
 * and the zero state with its recovery options.
 */
export async function search(params: SearchParams, ctx: SearchContext = {}, q: Queryable = db): Promise<SearchResult> {
  const basePath = ctx.basePath ?? '/tarsene';
  const e = await evaluate(params, ctx, q);
  const p = params;
  const href = (over: Partial<SearchParams>) => searchHref({ ...p, ...over }, basePath);
  const passing = e.candidates.filter(c => passesAll(e.pass.get(c.id)!));
  const sorted = sortCandidates(passing, e);
  const cards = sorted.map(c => toCard(c, e));
  const total = cards.length;

  const types = p.sabitie.map(s => e.refs.typesBySlug.get(s)).filter(Boolean) as Refs['types'];
  const cities = p.grad.map(s => e.refs.citiesBySlug.get(s)).filter(Boolean) as CityRef[];
  const cityNames = cities.map(c => c.name);
  const qShown = p.q.toLocaleLowerCase('bg');

  // Facet counts (D43).
  const countWhere = (except: Group[], extra: (c: Candidate) => boolean) =>
    e.candidates.filter(c => passesAll(e.pass.get(c.id)!, except) && extra(c)).length;
  const facetTypes: FacetItem[] = e.refs.types.filter(t => t.isPublic).map(t => ({
    value: t.slug, label: t.name, active: p.sabitie.includes(t.slug), href: href({ sabitie: toggle(p.sabitie, t.slug) }),
    count: countWhere(['type'], c => c.eventTypeIds.includes(t.id)),
  }));
  const facetCities: FacetItem[] = e.refs.cities.filter(c => c.isActive).map(ct => ({
    value: ct.slug, label: ct.name, active: p.grad.includes(ct.slug), href: href({ grad: toggle(p.grad, ct.slug) }),
    count: countWhere(['city'], c => servesCity(c, ct, e.refs)),
  }));
  const facetRatings: FacetItem[] = RATINGS.map(r => ({
    value: r.toFixed(1), label: `${ratingText(r)} и нагоре`, active: p.reyting.includes(r), href: href({ reyting: toggle(p.reyting, r) }),
    count: countWhere(['rating'], c => c.ratingAvg != null && c.reviewCount > 0 && c.ratingAvg >= r),
  }));
  const facetPolicies: FacetItem[] = (['flexible', 'moderate', 'strict'] as const).map(pol => ({
    value: SLUG_OF_POLICY[pol], label: POLICY_LABEL[pol], active: p.politika.includes(SLUG_OF_POLICY[pol]),
    href: href({ politika: toggle(p.politika, SLUG_OF_POLICY[pol]) }), count: countWhere(['policy'], c => c.policy === pol),
  }));
  const others: FacetItem[] = [];
  if (!p.data && e.eventDate) {
    // ‹Свободни на {дата}› (D27): only without a chosen date, for a client with an upcoming event.
    const busyEv = p.svobodni ? e.busyOnEvent : await busyPartnerIds(e.candidates.map(c => c.id), e.eventDate, q);
    others.push({
      value: 'svobodni', label: `Свободни на ${dateShort(e.eventDate)}`, active: p.svobodni, href: href({ svobodni: !p.svobodni }),
      count: countWhere(['svobodni'], c => !busyEv.has(c.id)),
    });
  }
  others.push({
    value: 'druga-data', label: 'Предлагат друга дата', active: p.drugaData && !!p.data, href: href({ drugaData: !p.drugaData }),
    count: p.data ? countWhere(['date'], c => e.busyOnDate.has(c.id)) : 0,
  });
  others.push({
    value: 'otgovor24', label: 'Отговаря до 24 часа', active: p.otgovor24, href: href({ otgovor24: !p.otgovor24 }),
    count: countWhere(['otgovor24'], c => !c.lapsed90),
  });
  const subtypes: FacetItem[] = [];
  if (e.categoryRow) {
    const sts = await q.select().from(categorySubtype).where(eq(categorySubtype.categoryId, e.categoryRow.id)).orderBy(asc(categorySubtype.sortOrder));
    for (const st of sts) subtypes.push({ value: st.slug, label: st.label, active: p.vid === st.slug, href: href({ vid: p.vid === st.slug ? null : st.slug }), count: 0 });
  }

  // Count line (§13.6).
  const noun = (n: number) => (n === 1 ? 'изпълнител' : 'изпълнители');
  const suffix = p.q ? ` за „${qShown}“` : e.categoryRow ? ` · ${e.categoryRow.name}` : types.length ? ` за ${types.map(t => t.name).join(', ').toLocaleLowerCase('bg')}` : '';
  const cityPart = cities.length ? ` ${inCities(cityNames)}` : '';
  let countLine: Rich;
  if (p.data && !p.drugaData) {
    const n = countWhere(['date'], () => true);
    countLine = [{ b: String(n) }, ` ${noun(n)}${suffix}${cityPart} · `, { b: String(total) }, ` свободни на ${fmtDate(p.data)}`];
  } else {
    countLine = [{ b: String(total) }, ` ${noun(total)}${suffix}${cityPart}`];
  }

  // Results sentence `.results-say`: ‹Търсите **{какво}** в **{град}** за **{дата} г.**, събитие за **{N} гости**.›
  const what = p.q ? `„${qShown}“` : e.categoryRow ? e.categoryRow.name.toLocaleLowerCase('bg')
    : types.length ? `изпълнители за ${types.map(t => t.name).join(', ').toLocaleLowerCase('bg')}` : '';
  const say: Rich = [];
  if (what) say.push({ b: what });
  if (cities.length) say.push(`${say.length ? ' ' : ''}${/^[ВФвф]/.test(cityNames[0]) ? 'във' : 'в'} `, { b: cityNames.join(', ') });
  if (p.data) say.push(`${say.length ? ' ' : ''}за `, { b: `${fmtDate(p.data)} г.` });
  if (p.gosti) {
    const band = p.gosti in GUEST_BANDS ? GUEST_BANDS[p.gosti as keyof typeof GUEST_BANDS] : null;
    say.push(say.length ? ', събитие ' : 'събитие ');
    if (band?.band) say.push({ b: band.sentence }); else say.push('за ', { b: `${guestsLabel(p.gosti)} гости` });
  }
  // The closing full stop is not doubled after ‹… 2026 г.› (the prototype's say() checks the same).
  const last = say.length ? richText([say[say.length - 1]]) : '';
  const sentence: Rich | null = say.length ? ['Търсите ', ...say, ...(last.endsWith('.') ? [] : ['.'])] : null;

  const contextLine = [cityNames.length ? cityNames.join(', ') : 'цялата страна', p.data ? fmtDate(p.data) : null, p.gosti ? `${guestsLabel(p.gosti)} гости` : null]
    .filter(Boolean).join(' · ');

  // Chips: one per active filter, each removing only its own.
  const chips: { label: string; href: string }[] = [];
  if (p.q) chips.push({ label: `„${qShown}“`, href: href({ q: '' }) });
  for (const t of types) chips.push({ label: t.name, href: href({ sabitie: p.sabitie.filter(s => s !== t.slug) }) });
  for (const c of cities) chips.push({ label: c.name, href: href({ grad: p.grad.filter(s => s !== c.slug) }) });
  for (const r of p.reyting) chips.push({ label: `рейтинг ${ratingText(r)} и нагоре`, href: href({ reyting: p.reyting.filter(x => x !== r) }) });
  for (const s of p.politika) chips.push({ label: `${POLICY_LABEL[POLICY_SLUG[s]]} политика`, href: href({ politika: p.politika.filter(x => x !== s) }) });
  if (p.svobodni && e.eventDate) chips.push({ label: `Свободни на ${dateShort(e.eventDate)}`, href: href({ svobodni: false }) });
  if (p.drugaData && p.data) chips.push({ label: 'Предлагат друга дата', href: href({ drugaData: false }) });
  if (p.otgovor24) chips.push({ label: 'Отговаря до 24 часа', href: href({ otgovor24: false }) });
  if (e.categoryRow) chips.push({ label: e.categoryRow.name, href: searchHref({ ...p, kategoriya: null, vid: null }) });
  if (p.vid) { const st = subtypes.find(s => s.value === p.vid); if (st) chips.push({ label: st.label, href: href({ vid: null }) }); }
  if (p.data) chips.push({ label: fmtDate(p.data), href: href({ data: null, drugaData: false }) });
  if (p.gosti) chips.push({ label: `${guestsLabel(p.gosti)} гости`, href: href({ gosti: null }) });
  if (p.cenaOt != null || p.cenaDo != null) chips.push({ label: 'цена', href: href({ cenaOt: null, cenaDo: null }) });
  const clearHref = basePath.startsWith('/kategorii/') ? basePath : '/tarsene?q=';

  // CTA block and zero state never show together.
  const brief = briefHref(e);
  let cta: SearchResult['cta'] = null;
  let zero: SearchResult['zero'] = null;
  if (total > 0) {
    cta = {
      title: 'Не намирате точно това, което търсите?',
      text: p.data
        ? `Опишете събитието си веднъж и изпълнителите, които са свободни на ${dateShort(p.data)}, ще ви отговорят с оферта.`
        : 'Опишете събитието си веднъж и изпълнителите ще ви отговорят с оферта.',
      briefHref: brief,
      eventType: types.length === 1 ? { label: `Виж какво още ви трябва за ${types[0].name.toLocaleLowerCase('bg')}`, href: `/sabitiya/${types[0].slug}` } : null,
    };
  } else {
    const dateCaused = !!p.data && e.candidates.some(c => passesAll(e.pass.get(c.id)!, ['date']));
    const where = cities.length ? ` ${inCities(cityNames)}` : '';
    zero = {
      title: 'Няма изпълнител за това търсене',
      text: dateCaused
        ? `С избраните филтри никой изпълнител${where} не е свободен на ${fmtDate(p.data!)} г.`
        : 'С избраните филтри никой изпълнител не съвпада с търсенето ви.',
      dateCaused,
      buttons: [
        ...(dateCaused ? [{ kind: 'widen_date' as const, label: 'Разшири датата', href: href({ data: null, drugaData: false }), toast: 'Показваме изпълнители за всяка дата' }] : []),
        ...(cities.length ? [{ kind: 'other_city' as const, label: 'Търси в друг град', href: href({ grad: [] }), toast: 'Показваме изпълнители от цялата страна' }] : []),
        { kind: 'brief' as const, label: 'Опиши заявката', href: brief },
        ...(dateCaused ? [{ kind: 'watch' as const, label: 'Уведоми ме при свободна дата' }] : []),
      ],
    };
  }

  const blank = !p.submitted && basePath === '/tarsene';
  return {
    params: p, blank,
    defaultState: blank ? await defaultState(ctx, q) : null,
    h1: types.length === 1 ? `Изпълнители за ${types[0].name.toLocaleLowerCase('bg')}` : 'Търсене',
    cards, total, countLine, sentence, contextLine,
    sortLabel: SORT_LABEL[p.podredi],
    sorts: SORTS.map(s => ({ value: s, label: SORT_LABEL[s], active: s === p.podredi, href: href({ podredi: s }) })),
    facets: {
      types: facetTypes, cities: facetCities, ratings: facetRatings, policies: facetPolicies, others,
      price: { from: p.cenaOt ?? 400, to: p.cenaDo ?? 2000, active: p.cenaOt != null || p.cenaDo != null, clearHref: href({ cenaOt: null, cenaDo: null }) },
      subtypes,
    },
    chips, clearHref, cta, zero,
    stems: { all: e.stems, known: e.known },
  };
}

/** SCREENS names: the result list … */
export async function searchPartners(params: SearchParams, ctx: SearchContext = {}, q: Queryable = db) {
  const r = await search(params, ctx, q);
  return { cards: r.cards, total: r.total };
}
/** … and the facet counts. */
export async function facetCounts(params: SearchParams, ctx: SearchContext = {}, q: Queryable = db) {
  return (await search(params, ctx, q)).facets;
}

/**
 * The partners a parameter set matches, for saved searches and date watches.
 * `ignoreDate`: drop the date group (results before the date filter; the zero state's question).
 */
export async function matchPartners(params: SearchParams, ctx: SearchContext = {}, opts: { ignoreDate?: boolean } = {}, q: Queryable = db) {
  const e = await evaluate(params, ctx, q);
  const except: Group[] = opts.ignoreDate ? ['date'] : [];
  const list = e.candidates.filter(c => passesAll(e.pass.get(c.id)!, except));
  return list.map(c => ({ id: c.id, listedAt: c.listedAt, busyOnDate: e.busyOnDate.has(c.id) }));
}

// ── Default state (§13.6) ────────────────────────────────────────────────

async function defaultState(ctx: SearchContext, q: Queryable) {
  const types = await q.select().from(eventType).where(eq(eventType.isPublic, true)).orderBy(asc(eventType.sortOrder));
  const typePills = types.map(t => ({ label: t.name, href: `/sabitiya/${t.slug}` }));
  if (!ctx.clientId) return { eventPills: [], typePills };
  const todayStr = sofiaDate(await now());
  const events = await q.select({ e: clientEvent, typeSlug: eventType.slug, citySlug: city.slug }).from(clientEvent)
    .innerJoin(eventType, eq(eventType.id, clientEvent.eventTypeId)).leftJoin(city, eq(city.id, clientEvent.cityId))
    .where(and(eq(clientEvent.clientId, ctx.clientId), gte(clientEvent.date, todayStr))).orderBy(asc(clientEvent.date));
  // D45: event pills apply type, city, date and guests.
  const eventPills = events.map(r => ({
    label: [r.e.title, fmtDate(r.e.date), r.e.guests ? `${r.e.guests} гости` : null].filter(Boolean).join(' · '),
    href: searchHref({
      sabitie: [r.typeSlug], grad: r.citySlug ? [r.citySlug] : [], data: r.e.date, gosti: r.e.guests ? String(r.e.guests) : null, sabitieId: r.e.id,
    }),
  }));
  return { eventPills, typePills };
}

// ── Suggestions panel (§13.7) ────────────────────────────────────────────

export type SuggestRow = { label: string; meta: string; href: string; kind: 'recent' | 'category' | 'partner' | 'brief'; categorySlug?: string };

/**
 * The first bar cell's panel. Empty field: ‹Последни търсения› (the client's 3 latest distinct
 * queries) and ‹Категории› (the first 5). Typing: ‹Категории› (≤ 3 whose name holds a known stem),
 * ‹Изпълнители› (≤ 6 matching every known stem; ‹ · свободен / зает на {д}› with a date), else
 * ‹Няма съвпадение› + ‹Опишете събитието си›.
 */
export async function suggest(a: { q: string; data?: DateStr | null }, ctx: SearchContext = {}, q: Queryable = db) {
  const refs = await loadRefs(q);
  const dirCats = refs.categories.filter(c => c.isVisible && c.inDirectory);
  const groups: { heading: string; rows: SuggestRow[] }[] = [];
  const text = a.q.trim();
  if (!text) {
    if (ctx.clientId) {
      const hist = await q.execute<{ query: string }>(sql`
        select query from (select query, max(created_at) as at from search_history where client_id = ${ctx.clientId} group by query) h
        order by at desc limit 3`);
      if (hist.length) groups.push({ heading: 'Последни търсения', rows: hist.map(h => ({ kind: 'recent', label: h.query, meta: 'предишно търсене', href: searchHref({ q: h.query }) })) });
    }
    groups.push({ heading: 'Категории', rows: dirCats.slice(0, 5).map(c => ({ kind: 'category', label: c.name, meta: 'категория', href: searchHref({ kategoriya: c.slug }), categorySlug: c.slug })) });
    return groups;
  }
  const known = await knownStems(queryStems(text), q);
  const hitCats = known.length ? dirCats.filter(c => known.some(s => c.name.toLocaleLowerCase('bg').includes(s))).slice(0, 3) : [];
  if (hitCats.length) {
    const rows: SuggestRow[] = [];
    for (const c of hitCats) {
      const [{ n }] = await q.select({ n: sql<number>`count(*)::int` }).from(partner).where(and(BASE,
        sql`(${partner.primaryCategoryId} = ${c.id} or exists (select 1 from service s where s.partner_id = ${partner.id} and s.status = 'active' and s.category_id = ${c.id}))`));
      rows.push({ kind: 'category', label: c.name, meta: nCount(n, 'изпълнител', 'изпълнители'), href: searchHref({ kategoriya: c.slug }), categorySlug: c.slug });
    }
    groups.push({ heading: 'Категории', rows });
  }
  if (known.length) {
    // The panel lists vendors by name whether or not they are free; availability goes into the meta line.
    const all = (await search(parseSearchParams({ q: text }), ctx, q)).cards.slice(0, 6);
    const busy = a.data ? await busyPartnerIds(all.map(c => c.partnerId), a.data, q) : new Set<string>();
    const rows = all.map(c => ({
      kind: 'partner' as const, label: c.name, href: c.href,
      meta: `${c.categoryName} · ${c.cityName}${a.data ? (busy.has(c.partnerId) ? ` · зает на ${dateShort(a.data)}` : ` · свободен на ${dateShort(a.data)}`) : ''}`,
    }));
    if (rows.length) groups.push({ heading: 'Изпълнители', rows });
  }
  if (!groups.length) {
    groups.push({ heading: 'Няма съвпадение', rows: [{ kind: 'brief', label: 'Опишете събитието си', meta: 'изпълнителите ви отговарят с оферта', href: '/zayavka/otvorena' }] });
  }
  return groups;
}

/** Every search run by a signed-in client is written to `search_history` (§13.7). */
export async function recordQuery(actor: AnyActor, a: { q: string }, tx?: Tx) {
  assertClient(actor);
  const text = a.q.trim().toLocaleLowerCase('bg').slice(0, 200);
  if (!text) return null;
  return withTx(tx, async t => {
    const [row] = await t.insert(searchHistory).values({ clientId: actor.userId, query: text, createdAt: await now() }).returning();
    return row;
  });
}

// ── Public pages (§13.10) ────────────────────────────────────────────────

const inCategory = (categoryId: string) =>
  sql`(${partner.primaryCategoryId} = ${categoryId} or exists (select 1 from service s where s.partner_id = ${partner.id} and s.status = 'active' and s.category_id = ${categoryId}))`;
const servesType = (eventTypeId: string) => sql`exists (select 1 from partner_event_type pet where pet.partner_id = ${partner.id} and pet.event_type_id = ${eventTypeId})`;

type CountRow = { id: string; cityId: string | null; servesNationwide: boolean; serviceRadiusKm: number | null; minPriceCents: number | null; minPriceUnit: PriceUnit | null };

/** Publicly visible partners (§4.2); `requestable` narrows to those accepting requests (the search base set, D72). */
async function visiblePartners(q: Queryable, conds: SQL[], requestable = false): Promise<CountRow[]> {
  return q.select({
    id: partner.id, cityId: partner.cityId, servesNationwide: partner.servesNationwide, serviceRadiusKm: partner.serviceRadiusKm,
    minPriceCents: partner.minPriceCents, minPriceUnit: partner.minPriceUnit,
  }).from(partner).where(and(requestable ? BASE : VISIBLE, ...conds));
}

/** ‹N партньори› / ‹1 партньор› / ‹Няма партньори› and ‹от X €› / ‹от X € на гост› (the lowest from-price among them). */
function countAndPrice(rows: CountRow[]) {
  const n = rows.length;
  const perEvent = rows.filter(r => r.minPriceUnit === 'per_event' && r.minPriceCents != null).map(r => r.minPriceCents!);
  const perGuest = rows.filter(r => r.minPriceUnit === 'per_guest' && r.minPriceCents != null).map(r => r.minPriceCents!);
  const price = perEvent.length ? `от ${moneyShort(Math.min(...perEvent))}` : perGuest.length ? `от ${moneyShort(Math.min(...perGuest))} на гост` : null;
  return { count: n, countLabel: n === 0 ? 'Няма партньори' : nCount(n, 'партньор', 'партньори'), priceLabel: n ? price : null };
}

/**
 * `/kategorii`: the directory cards with, per selected city (default София; a signed-in client's
 * next event's city), the partners of the category serving weddings in that city (city rule §13.4).
 */
export async function categoryCards(a: { grad?: string | null }, ctx: SearchContext = {}, q: Queryable = db) {
  const refs = await loadRefs(q);
  let citySlug = a.grad ?? null;
  if (!citySlug && ctx.clientId) {
    const [e] = await q.select({ slug: city.slug }).from(clientEvent).innerJoin(city, eq(city.id, clientEvent.cityId))
      .where(and(eq(clientEvent.clientId, ctx.clientId), gte(clientEvent.date, sofiaDate(await now())))).orderBy(asc(clientEvent.date)).limit(1);
    citySlug = e?.slug ?? null;
  }
  const target = refs.citiesBySlug.get(citySlug ?? 'sofia') ?? refs.cities[0];
  const svatba = refs.typesBySlug.get('svatba');
  const cards = [];
  for (const c of refs.categories.filter(x => x.isVisible && x.inDirectory)) {
    const rows = (await visiblePartners(q, [inCategory(c.id), ...(svatba ? [servesType(svatba.id)] : [])])).filter(r => servesCity(r, target, refs));
    cards.push({ slug: c.slug, name: c.name, shortDescription: c.shortDescription, icon: c.icon, href: `/kategorii/${c.slug}`, ...countAndPrice(rows) });
  }
  return {
    city: { slug: target.slug, name: target.name, label: `Град: ${target.name}` },
    cities: refs.cities.filter(c => c.isActive).map(c => ({ slug: c.slug, name: c.name, href: `/kategorii?grad=${c.slug}` })),
    cards,
    eventTypes: refs.types.filter(t => t.isPublic).map(t => ({ slug: t.slug, name: t.name, shortDescription: t.shortDescription, href: `/sabitiya/${t.slug}` })),
  };
}

const NUMBER_WORDS = ['', 'Един', 'Два', 'Три', 'Четири', 'Пет', 'Шест', 'Седем', 'Осем', 'Девет', 'Десет'];

/** The tips sub-heading generated from the tip count (D16): ‹Три въпроса, които спестяват най-честите изненади.› */
export function tipsSubheading(n: number): string | null {
  if (n <= 0) return null;
  if (n === 1) return 'Един въпрос, който спестява най-честите изненади.';
  return `${NUMBER_WORDS[n] ?? n} въпроса, които спестяват най-честите изненади.`;
}

/**
 * `/kategorii/[slug]` hero: H1 ‹{Категория} за {сватби}›, ‹N проверени {plural noun} в цялата страна›,
 * the lowest from-price, the tips with their heading and the count-driven sub-heading.
 */
export async function categoryHero(a: { slug: string; sabitie?: string | null }, q: Queryable = db) {
  const refs = await loadRefs(q);
  const c = refs.categoriesBySlug.get(a.slug);
  if (!c || !c.isVisible) return null;
  const type = refs.typesBySlug.get(a.sabitie ?? 'svatba') ?? refs.typesBySlug.get('svatba');
  const rows = await visiblePartners(q, [inCategory(c.id)]);
  const tips = await q.select().from(categoryTip).where(eq(categoryTip.categoryId, c.id)).orderBy(asc(categoryTip.sortOrder));
  const noun = c.pluralNoun ?? 'изпълнители';
  return {
    category: c,
    h1: type?.namePluralLower ? `${c.name} за ${type.namePluralLower}` : c.name,
    count: rows.length,
    countText: rows.length === 1 && !c.pluralNoun ? '1 проверен изпълнител в цялата страна' : `${rows.length} проверени ${noun} в цялата страна`,
    priceLabel: countAndPrice(rows).priceLabel,
    tipsHeading: c.tipsHeading, tipsSubheading: tipsSubheading(tips.length), tips,
  };
}

/**
 * `/sabitiya/[slug]`: the planning tiers (‹Задължително› / ‹Често добавяно› / ‹Не сте се сетили
 * за това›) with, per card, the visible partners of the category in the city that serve the type
 * and are free on the date; the count line; and, for a client with an event, ‹Вече уредено› and
 * ‹Още липсва›.
 */
export async function eventTypePage(a: { slug: string; grad?: string | null; data?: DateStr | null; gosti?: string | null; clientEventId?: string | null }, ctx: SearchContext = {}, q: Queryable = db) {
  const refs = await loadRefs(q);
  const type = refs.typesBySlug.get(a.slug);
  if (!type || !type.isPublic) return null;
  const todayStr = sofiaDate(await now());

  // The client's event: the one asked for, else their next one of this type.
  let event: (typeof clientEvent.$inferSelect) | null = null;
  if (ctx.clientId) {
    const conds = [eq(clientEvent.clientId, ctx.clientId)];
    if (a.clientEventId) conds.push(eq(clientEvent.id, a.clientEventId));
    else conds.push(eq(clientEvent.eventTypeId, type.id), gte(clientEvent.date, todayStr));
    [event] = await q.select().from(clientEvent).where(and(...conds)).orderBy(asc(clientEvent.date)).limit(1);
    event ??= null;
  }
  const citySlug = a.grad ?? (event?.cityId ? refs.citiesById.get(event.cityId)?.slug : null) ?? null;
  const target = citySlug ? refs.citiesBySlug.get(citySlug) ?? null : null;
  const d = a.data ?? event?.date ?? null;

  const tiers = await q.select({ t: eventTypeService, c: category }).from(eventTypeService)
    .innerJoin(category, eq(category.id, eventTypeService.categoryId))
    .where(eq(eventTypeService.eventTypeId, type.id)).orderBy(asc(eventTypeService.tier), asc(eventTypeService.sortOrder));
  const order = { required: 0, common: 1, extra: 2 } as const;
  tiers.sort((x, y) => order[x.t.tier] - order[y.t.tier] || x.t.sortOrder - y.t.sortOrder);

  const cards = [];
  for (const { t, c } of tiers) {
    // ‹свободни›: a partner who does not accept requests cannot be free for one (D72).
    let rows = (await visiblePartners(q, [inCategory(c.id), servesType(type.id)], true)).filter(r => !target || servesCity(r, target, refs));
    if (d) { const busy = await busyPartnerIds(rows.map(r => r.id), d, q, todayStr); rows = rows.filter(r => !busy.has(r.id)); }
    cards.push({
      tier: t.tier, categoryId: c.id, categorySlug: c.slug, label: t.displayName ?? c.name, description: t.description ?? c.shortDescription,
      photoUrl: t.photoUrl, icon: c.icon, ...countAndPrice(rows),
      href: `/kategorii/${c.slug}?${toQuery({ sabitie: [type.slug], grad: target ? [target.slug] : [], data: d, gosti: a.gosti ?? (event?.guests ? String(event.guests) : null) })}`,
    });
  }
  const tail = d && target ? ` · показваме само партньорите, свободни на ${fmtDate(d)} ${inCities([target.name])}`
    : d ? ` · показваме само партньорите, свободни на ${fmtDate(d)}` : '';
  const countLine: Rich = [{ b: String(tiers.length) }, ` услуги за ${type.name.toLocaleLowerCase('bg')}${tail}`];

  let panels: null | {
    event: typeof clientEvent.$inferSelect;
    arranged: { partnerName: string; partnerSlug: string; categoryName: string; serviceTitle: string; badge: string; href: string }[];
    missing: { categorySlug: string; label: string; line: string; href: string }[];
  } = null;
  if (event) {
    const reqs = await q.select({
      r: request, bStatus: booking.status, partnerName: partner.businessName, partnerSlug: partner.slug,
      categoryId: sql<string>`coalesce(${service.categoryId}, ${partner.primaryCategoryId})`,
    }).from(request).innerJoin(partner, eq(partner.id, request.partnerId)).leftJoin(service, eq(service.id, request.serviceId))
      .leftJoin(booking, eq(booking.requestId, request.id))
      .where(eq(request.clientEventId, event.id)).orderBy(desc(request.sentAt));
    const dead = (x: (typeof reqs)[number]) => ['declined', 'expired'].includes(x.r.status)
      || (!!x.bStatus && ['payment_expired', 'approval_withdrawn', 'cancelled'].includes(x.bStatus));
    const badge = (x: (typeof reqs)[number]) => x.bStatus && ['confirmed', 'cancellation_requested', 'completed'].includes(x.bStatus) ? 'Потвърдена'
      : x.bStatus === 'awaiting_payment' ? 'Чака плащане' : x.r.status === 'offer_sent' ? 'Нова оферта' : 'Чака отговор';
    const arranged = reqs.filter(x => !dead(x)).map(x => ({
      partnerName: x.partnerName, partnerSlug: x.partnerSlug, categoryName: refs.categoriesById.get(x.categoryId)?.name ?? '',
      serviceTitle: x.r.serviceTitle, badge: badge(x),
      href: x.bStatus && x.bStatus !== 'awaiting_payment' ? `/akaunt/rezervacii/${encodeURIComponent(x.r.number)}` : `/akaunt/zayavki/${encodeURIComponent(x.r.number)}`,
    }));
    const activeCats = new Set(reqs.filter(x => !dead(x)).map(x => x.categoryId));
    const missing = cards.filter(cd => !activeCats.has(cd.categoryId)).map(cd => {
      const latest = reqs.find(x => x.categoryId === cd.categoryId);
      const head = latest && latest.r.status === 'declined' ? `${latest.partnerName} отказа` : 'Няма изпратена заявка';
      return { categorySlug: cd.categorySlug, label: cd.label, line: `${head} · ${cd.count === 1 ? '1 партньор е свободен' : `${cd.count} партньори са свободни`}`, href: cd.href };
    });
    panels = { event, arranged, missing };
  }
  return {
    type, city: target, date: d, countLine, tiers: cards,
    tierText: { required: type.tierRequiredText, common: type.tierCommonText, extra: type.tierExtraText },
    panels,
  };
}


// ── /partnyori/[slug] and the marketing numbers ──────────────────────────

const RESCHEDULE_LABEL = { free_if_available: 'Безплатно, ако има свободна дата', one_free: 'Една безплатна промяна', not_allowed: 'Не се допуска' } as const;

/**
 * `/partnyori/[slug]` (`?preview=1` for the owner or the team before approval): the public data
 * (descriptions masked, §10 c), 5 photos, the profile-visible active services (the first fixed
 * package is ‹Препоръчан›), event types and skills, rating and reviews, responsiveness, the
 * from-price and, for a client, the widget defaults with availability and the date-watch state.
 * Null when the page must 404.
 */
export async function partnerPage(a: { slug: string; preview?: boolean; data?: DateStr | null; sabitieId?: string | null; reviewsPage?: number },
  ctx: { actor?: AnyActor | null } = {}, q: Queryable = db) {
  const [p] = await q.select().from(partner).where(eq(partner.slug, a.slug)).limit(1);
  if (!p) return null;
  const visible = p.status === 'approved' && p.isListed;
  const actor = ctx.actor ?? null;
  const isOwner = !!actor && 'partnerId' in actor && actor.role === 'partner' && actor.partnerId === p.id;
  const isTeam = !!actor && actor.role === 'admin' && 'teamRole' in actor && !!actor.teamRole;
  if (!visible && !(a.preview && (isOwner || isTeam) && p.status !== 'deleted')) return null;
  const refs = await loadRefs(q);
  const cat = p.primaryCategoryId ? refs.categoriesById.get(p.primaryCategoryId) ?? null : null;
  const ct = p.cityId ? refs.citiesById.get(p.cityId) ?? null : null;
  const photos = await q.execute<{ id: string; storage_key: string }>(sql`
    select m.id, m.storage_key from partner_photo ph join media m on m.id = ph.media_id where ph.partner_id = ${p.id} order by ph.position limit 5`);
  const media2 = async (id: string | null) => (id ? (await q.execute<{ storage_key: string }>(sql`select storage_key from media where id = ${id}`))[0]?.storage_key ?? null : null);
  const svcs = await q.select().from(service)
    .where(and(eq(service.partnerId, p.id), eq(service.status, 'active'), eq(service.showInProfile, true))).orderBy(asc(service.sortOrder), asc(service.createdAt));
  const inc = svcs.length ? await q.execute<{ service_id: string; text: string }>(sql`
    select service_id, text from service_inclusion where service_id in (${sql.join(svcs.map(x => sql`${x.id}`), sql`, `)}) order by position`) : [];
  const recommended = svcs.find(x => x.kind === 'package_fixed')?.id ?? null;
  const types = await q.execute<{ slug: string; name: string }>(sql`
    select et.slug, et.name from partner_event_type pet join event_type et on et.id = pet.event_type_id where pet.partner_id = ${p.id} and et.is_public order by et.sort_order`);
  const tags = await q.execute<{ label: string }>(sql`select label from partner_tag where partner_id = ${p.id} order by label`);
  const accepting = visible && p.acceptingRequests;

  // The widget: the client's chosen or next event (§13.10).
  let widget: null | {
    events: { id: string; title: string; date: DateStr; guests: number | null; typeSlug: string }[]; eventId: string | null; date: DateStr | null;
    typeSlug: string | null; guests: number | null; serviceId: string | null; availability: { requestable: boolean; state: string; reason: string | null } | null; watching: boolean;
  } = null;
  if (actor && actor.role === 'client') {
    const todayStr = sofiaDate(await now());
    const evs = await q.select({ e: clientEvent, typeSlug: eventType.slug }).from(clientEvent).innerJoin(eventType, eq(eventType.id, clientEvent.eventTypeId))
      .where(and(eq(clientEvent.clientId, actor.userId), gte(clientEvent.date, todayStr))).orderBy(asc(clientEvent.date));
    const chosen = evs.find(x => x.e.id === a.sabitieId) ?? evs[0] ?? null;
    const d = a.data ?? chosen?.e.date ?? null;
    const av = d ? await check(p.id, d, q) : null;
    const [w] = d ? await q.execute<{ id: string }>(sql`select id from date_watch where client_id = ${actor.userId} and partner_id = ${p.id} and date = ${d}::date and status = 'watching' limit 1`) : [];
    widget = {
      events: evs.map(x => ({ id: x.e.id, title: x.e.title, date: x.e.date, guests: x.e.guests, typeSlug: x.typeSlug })),
      eventId: chosen?.e.id ?? null, date: d, typeSlug: chosen?.typeSlug ?? null, guests: chosen?.e.guests ?? null, serviceId: recommended,
      availability: av ? { requestable: av.requestable && accepting, state: av.state, reason: av.reason } : null, watching: !!w,
    };
  }
  return {
    partner: {
      id: p.id, slug: p.slug, name: p.businessName, status: p.status, preview: !visible, categoryName: cat?.name ?? '', categorySlug: cat?.slug ?? null,
      cityName: ct?.name ?? '', location: [ct?.name, p.servesNationwide ? 'цялата страна' : p.serviceRadiusKm ? `до ${p.serviceRadiusKm} км` : null].filter(Boolean).join(' · '),
      shortDescription: p.shortDescription ? maskContacts(p.shortDescription) : null, description: p.description ? maskContacts(p.description) : null,
      socialHandle: p.socialHandle, websiteUrl: p.websiteUrl, videoUrl: p.videoUrl, verified: p.isVerified, maxGuests: p.maxGuests,
      partnerSince: p.approvedAt ? sofiaDate(p.approvedAt) : null, languages: p.languages,
      avatarUrl: mediaUrl(await media2(p.avatarMediaId)), coverUrl: mediaUrl(await media2(p.coverMediaId)),
      policy: p.cancellationPolicy, policyLabel: p.cancellationPolicy ? POLICY_LABEL[p.cancellationPolicy] : null, depositPercent: p.depositPercent,
      reschedule: RESCHEDULE_LABEL[p.reschedulePolicy], acceptingRequests: accepting,
      fromPrice: p.minPriceCents != null && p.minPriceUnit
        ? { cents: p.minPriceCents, unit: p.minPriceUnit, text: `от ${moneyShort(p.minPriceCents)}`, unitLabel: p.minPriceUnit === 'per_guest' ? 'на гост' : 'за събитие' } : null,
    },
    photos: photos.map(x => ({ id: x.id, url: mediaUrl(x.storage_key) })),
    services: svcs.map(x => ({
      id: x.id, kind: x.kind, name: x.name, description: maskContacts(x.description), recommended: x.id === recommended,
      price: x.kind === 'on_request' || x.priceCents == null ? null : { cents: x.priceCents, text: moneyShort(x.priceCents), unitLabel: x.priceUnit === 'per_guest' ? 'на гост' : 'за събитие', minGuests: x.minGuests },
      durationLabel: x.durationLabel, extraHourPriceCents: x.extraHourEnabled ? x.extraHourPriceCents : null, travelFee: x.travelFeeEnabled,
      inclusions: inc.filter(i => i.service_id === x.id).map(i => i.text), acceptingRequests: accepting && x.acceptingRequests,
    })),
    eventTypes: types.map(t => ({ name: t.name, href: `/sabitiya/${t.slug}` })),
    skills: tags.map(t => ({ label: t.label, href: `/tarsene?${toQuery({ q: t.label })}` })),
    rating: await ratingSummary(p.id, q),
    reviews: await partnerReviews(p.id, { page: a.reviewsPage ?? 1 }, q),
    responsivenessPct: await responsiveness(p.id, q),
    widget,
  };
}

/**
 * The settings behind the public marketing pages (D8): `/stani-partnyor` (commission, intro
 * bookings, payout days, approval SLA, packages, the payout example) and `/kak-raboti`, `/pravila`
 * (response and payment windows, ‹до деня след събитието›, 1st / 15th).
 */
export async function publicNumbers(q: Queryable = db) {
  const st = await getSettings(undefined, q);
  const pct = (bp: number) => `${(bp / 100).toLocaleString('bg-BG', { maximumFractionDigits: 2 })}%`;
  const example = 145_000;
  const commission = Math.floor((example * st['commission.standard_bp'] + 5_000) / 10_000);
  return {
    commissionPct: pct(st['commission.standard_bp']), introPct: pct(st['commission.intro_bp']), introCount: st['commission.intro_count'],
    payoutDays: st['payout.days'], holdDaysAfterEvent: st['payout.hold_days_after_event'], responseHours: st['request.response_hours'],
    paymentHours: st['payment.window_hours'], approvalSlaHours: st['partner.approval_sla_hours'], maxPackages: st['partner.max_packages'],
    payoutExample: {
      priceCents: example, commissionCents: commission, partnerCents: example - commission,
      title: `Пример за пакет от ${moneyShort(example)}`, commissionLine: `Комисиона (${pct(st['commission.standard_bp'])}) − ${moneyShort(commission)}`,
      receiveLine: `Получавате ${moneyShort(example - commission)}`,
    },
  };
}
