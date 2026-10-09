// Read models for the public site (SCREENS §2): the search bar's choices, the category page,
// the event-type planner, the partner profile, the marketing pages and the legal page.
// Business rules stay in search.ts / saved.ts / availability.ts; this module only assembles
// what each screen shows from them, plus the few public facts they do not provide.
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import { category, city, clientEvent, eventType, legalDocument, media, partner, partnerEventType } from '@/db/schema';
import { now } from '@/lib/clock';
import { date as fmtDate, dateLong, monthName, sofiaDate, sofiaParts, type DateStr } from '@/lib/format';
import type { AnyActor } from './actor';
import { check, isDate } from './availability';
import { policyStrings } from './cancellation';
import { mediaUrl } from './catalogue-kit';
import { requestLapsedSql } from './partners';
import { partnerReviews } from './reviews';
import {
  categoryHero, eventTypePage, partnerPage, publicNumbers, search, toQuery, type Rich, type SearchParams,
} from './search';
import { getSetting, getSettings } from './settings';

// ── Small text helpers (Bulgarian numerals and plurals) ───────────────────

const WORDS_F = ['нула', 'една', 'две', 'три', 'четири', 'пет', 'шест', 'седем', 'осем', 'девет', 'десет'];
const WORDS_M = ['нула', 'един', 'два', 'три', 'четири', 'пет', 'шест', 'седем', 'осем', 'девет', 'десет'];

/** ‹три› резервации (feminine) / ‹пет› пакета (masculine); digits above ten. */
export function numberWord(n: number, gender: 'f' | 'm' = 'f'): string {
  return (gender === 'f' ? WORDS_F : WORDS_M)[n] ?? String(n);
}

/** Day-of-month ordinals as the prototype writes them: ‹1-во›, ‹15-то›, ‹2-ро›, ‹7-мо›. */
export function ordinal(n: number): string {
  const t = n % 100, d = n % 10;
  const suf = t >= 11 && t <= 19 ? 'то' : d === 1 ? 'во' : d === 2 ? 'ро' : d === 7 || d === 8 ? 'мо' : 'то';
  return `${n}-${suf}`;
}

/** ‹24 часа› / ‹1 час›. */
export const hoursText = (h: number) => `${h} ${h === 1 ? 'час' : 'часа'}`;

/** ‹1-во и 15-то› from ⚙ payout.days. */
export function payoutDaysText(days: number[]): string {
  const xs = [...days].sort((a, b) => a - b).map(ordinal);
  return xs.length > 1 ? `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}` : xs[0] ?? '';
}

/** ‹до деня след събитието› (⚙ payout.hold_days_after_event = 1, SPEC §13.10). */
export function holdText(days: number): string {
  return days <= 1 ? 'до деня след събитието' : `до ${days} дни след събитието`;
}

/** "Сватба" for "сватби" style plurals: ‹Сватби›, ‹Рождени дни› (partner specialisation chips). */
const capital = (s: string) => (s ? s[0].toLocaleUpperCase('bg') + s.slice(1) : s);

// ── Search bar choices ────────────────────────────────────────────────────

/**
 * The bar's dropdowns: active cities (‹Локация›), public event types (‹Тип събитие›), category
 * names (the query field shows the chosen category by name) and, for a
 * signed-in client, the dates of their upcoming events — the shortcuts the prototype's ‹Дата›
 * menu lists (‹14 юни 2026›, ‹19 декември 2026›).
 */
export async function searchChoices(clientId: string | null, q: Queryable = db) {
  const [cities, types, categories] = await Promise.all([
    q.select({ slug: city.slug, name: city.name }).from(city).where(eq(city.isActive, true)).orderBy(asc(city.sortOrder)),
    q.select({ slug: eventType.slug, name: eventType.name }).from(eventType).where(eq(eventType.isPublic, true)).orderBy(asc(eventType.sortOrder)),
    q.select({ slug: category.slug, name: category.name }).from(category).orderBy(asc(category.sortOrder)),
  ]);
  const today = sofiaDate(await now());
  let eventDates: { value: DateStr; label: string }[] = [];
  if (clientId) {
    const rows = await q.select({ d: clientEvent.date }).from(clientEvent)
      .where(and(eq(clientEvent.clientId, clientId), gte(clientEvent.date, today))).orderBy(asc(clientEvent.date));
    eventDates = [...new Set(rows.map(r => r.d))].map(d => ({ value: d, label: fmtDate(d) }));
  }
  return { cities, types, categories, eventDates, today };
}

// ── Page titles ───────────────────────────────────────────────────────────

/**
 * The `<title>` of a public detail page without loading the page itself: ‹Кетъринг за сватби›,
 * ‹Сватба · всичко необходимо›, ‹Студио Мелодия›. Null when the page is not public (it 404s).
 */
export async function publicTitle(kind: 'category' | 'eventType' | 'partner', slug: string, q: Queryable = db): Promise<string | null> {
  if (kind === 'category') {
    const [c] = await q.select({ name: category.name }).from(category)
      .where(and(eq(category.slug, slug), eq(category.isVisible, true), eq(category.inDirectory, true))).limit(1);
    const [t] = await q.select({ plural: eventType.namePluralLower }).from(eventType).where(eq(eventType.slug, 'svatba')).limit(1);
    return c ? (t?.plural ? `${c.name} за ${t.plural}` : c.name) : null;
  }
  if (kind === 'eventType') {
    const [t] = await q.select({ name: eventType.name }).from(eventType).where(and(eq(eventType.slug, slug), eq(eventType.isPublic, true))).limit(1);
    return t ? `${t.name} · всичко необходимо` : null;
  }
  const [p] = await q.select({ name: partner.businessName }).from(partner)
    .where(and(eq(partner.slug, slug), eq(partner.status, 'approved'), eq(partner.isListed, true))).limit(1);
  return p?.name ?? null;
}

// ── /kategorii/[slug] ─────────────────────────────────────────────────────

const inCitiesText = (names: string[]) => (names.length ? ` ${/^[ВФвф]/.test(names[0]) ? 'във' : 'в'} ${names.join(', ')}` : '');

/**
 * The category page: the hero (SPEC §13.10), the sub-type pills and the results with the
 * category's own count noun (‹52 кетъринг фирми›). The category's own chip is left out: the
 * page is the category.
 */
export async function categoryView(slug: string, params: SearchParams, ctx: { clientId?: string | null }, q: Queryable = db) {
  const hero = await categoryHero({ slug, sabitie: params.sabitie.length === 1 ? params.sabitie[0] : null }, q);
  if (!hero || !hero.category.inDirectory) return null;
  const p: SearchParams = { ...params, kategoriya: slug };
  const result = await search(p, { clientId: ctx.clientId ?? null, basePath: `/kategorii/${slug}` }, q);
  const cat = hero.category;
  const noun = (n: number) => (n !== 1 && cat.pluralNoun ? cat.pluralNoun : n === 1 ? 'изпълнител' : 'изпълнители');
  const cityNames = (await (p.grad.length ? q.select({ slug: city.slug, name: city.name }).from(city).where(inArray(city.slug, p.grad)) : Promise.resolve([])))
    .sort((a, b) => p.grad.indexOf(a.slug) - p.grad.indexOf(b.slug)).map(c => c.name);
  const bold = result.countLine.filter((x): x is { b: string } => typeof x !== 'string').map(x => Number(x.b));
  let countLine: Rich;
  if (bold.length === 2 && p.data) {
    countLine = [{ b: String(bold[0]) }, ` ${noun(bold[0])}${inCitiesText(cityNames)} · `, { b: String(bold[1]) }, ` свободни на ${fmtDate(p.data)}`];
  } else {
    countLine = [{ b: String(result.total) }, ` ${noun(result.total)}${inCitiesText(cityNames)}`];
  }
  return {
    hero, result: { ...result, chips: result.chips.filter(c => c.label !== cat.name) },
    countLine, heroPhoto: cat.heroPhotoUrl ? `/${cat.heroPhotoUrl.replace(/^\//, '')}` : null,
  };
}

// ── /sabitiya/[slug] ──────────────────────────────────────────────────────

/**
 * The planner for one event type: the type pills, the hero (with the client's event facts when
 * there is one), the tiers with partner counts, the event panels and the closing call to action.
 * Cards of categories hidden from the directory (‹Не сте се сетили за това›) open the search for
 * that category, since they have no category page.
 */
export async function eventTypeView(slug: string, a: { grad?: string | null; data?: DateStr | null; gosti?: string | null; sabitieId?: string | null },
  ctx: { clientId?: string | null }, q: Queryable = db) {
  const eventId = a.sabitieId && /^[0-9a-f-]{36}$/i.test(a.sabitieId) ? a.sabitieId : null;
  // An empty value (`?grad=`) means "chosen: none", so the client's event does not fill it back in.
  const data = a.data === '' ? '' : isDate(a.data) ? a.data : null;
  const page = await eventTypePage({ slug, grad: a.grad ?? null, data, gosti: a.gosti ?? null, clientEventId: eventId }, { clientId: ctx.clientId ?? null }, q);
  if (!page) return null;
  const types = await q.select({ slug: eventType.slug, name: eventType.name }).from(eventType).where(eq(eventType.isPublic, true)).orderBy(asc(eventType.sortOrder));
  const cats = await q.select({ slug: category.slug, listed: sql<boolean>`${category.isVisible} and ${category.inDirectory}` }).from(category);
  const listed = new Map(cats.map(c => [c.slug, c.listed]));
  const ev = page.panels?.event ?? null;
  const guests = (a.gosti ?? (ev?.guests ? String(ev.guests) : null)) || null;
  const filters = { sabitie: [slug], grad: page.city ? [page.city.slug] : [], data: page.date || null, gosti: guests };
  const hrefFor = (catSlug: string, own: string) => (listed.get(catSlug) ? own : `/tarsene?${toQuery({ ...filters, kategoriya: catSlug })}`);
  const tiers = page.tiers.map(t => ({ ...t, href: hrefFor(t.categorySlug, t.href), photoUrl: t.photoUrl ? `/${t.photoUrl.replace(/^\//, '')}` : null }));
  const brief = new URLSearchParams();
  brief.set('type', slug);
  if (page.city) brief.set('city', page.city.slug);
  if (filters.data) brief.set('date', filters.data);
  if (guests) brief.set('guests', guests);

  // ‹Каталогът отваря с вашите филтри — София, 14 юни 2026 и 120 гости — и показва само свободните на датата.›
  const parts = [page.city?.name, filters.data ? fmtDate(filters.data) : null, guests ? `${guests} гости` : null].filter(Boolean) as string[];
  const joined = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} и ${parts[parts.length - 1]}` : parts[0] ?? '';
  const ctaText = filters.data && joined ? `Каталогът отваря с вашите филтри — ${joined} — и показва само свободните на датата.` : null;

  let event: null | { id: string; title: string; dateLine: string; guestsLine: string | null; venueLine: string | null } = null;
  if (ev) {
    const long = dateLong(ev.date); // ‹неделя, 14 юни 2026› → ‹14 юни 2026 · неделя›
    const [wd, rest] = [long.slice(0, long.indexOf(',')), long.slice(long.indexOf(',') + 2)];
    event = {
      id: ev.id, title: ev.title, dateLine: `${rest} · ${wd}`, guestsLine: ev.guests ? `${ev.guests} гости` : null,
      venueLine: [ev.venueName, ev.locality].filter(Boolean).join(', ') || null,
    };
  }
  return {
    ...page, date: filters.data, tiers, types, event, guests,
    panels: page.panels ? {
      arranged: page.panels.arranged.map(x => ({ ...x, eventHref: `/akaunt/sabitiya/${page.panels!.event.id}` })),
      missing: page.panels.missing.map(m => ({ ...m, href: hrefFor(m.categorySlug, m.href) })),
    } : null,
    catalogHref: `/tarsene?${toQuery(filters)}`,
    briefHref: `/zayavka/otvorena?${brief.toString()}`,
    ctaTitle: `Вижте всички изпълнители за ${page.type.name.toLocaleLowerCase('bg')}`,
    ctaText,
    heroPhoto: page.type.heroPhotoUrl ? `/${page.type.heroPhotoUrl.replace(/^\//, '')}` : null,
  };
}

// ── /partnyori/[slug] ─────────────────────────────────────────────────────

/** ‹Отговаря до 24 ч›: no request that lapsed unanswered (R8) in the last 90 days — the D44 rule of the search facet. */
export async function respondsWithin24(partnerId: string, q: Queryable = db): Promise<boolean> {
  const since = new Date((await now()).getTime() - 90 * 86_400_000);
  const rows = await q.execute<{ lapsed: boolean }>(sql`select exists (select 1 from request r where r.partner_id = ${partnerId}
    and r.status = 'expired' and r.expired_at >= ${since.toISOString()}::timestamptz and ${requestLapsedSql(sql.raw('r.id'))}) as lapsed`);
  return !rows[0]?.lapsed;
}

/**
 * The public profile: `search.partnerPage()` plus what the page prints around it — the
 * specialisation chips in the plural (‹Сватби›, ‹Рождени дни›), the ‹Отговаря до 24 ч› badge,
 * the widget's choices (event types, the client's events, packages), the response window and
 * the cancellation line (§5.5).
 */
export async function partnerView(slug: string, a: { preview?: boolean; data?: string | null; sabitieId?: string | null; reviewPages?: number }, actor: AnyActor | null, q: Queryable = db) {
  const data = isDate(a.data) ? a.data : null;
  const page = await partnerPage({ slug, preview: !!a.preview, data, sabitieId: a.sabitieId ?? null }, { actor }, q);
  if (!page) return null;
  const p = page.partner;
  // ‹Покажи още› adds the next 10 reviews under the ones already shown (`?revyuta=2` = the first 20).
  const reviewPages = Math.min(Math.max(1, Math.floor(a.reviewPages ?? 1)), 50);
  const reviews = reviewPages > 1 ? await partnerReviews(p.id, { perPage: 10 * reviewPages }, q) : page.reviews;
  const [types, allTypes, responds, responseHours, policies] = await Promise.all([
    q.select({ slug: eventType.slug, plural: eventType.namePluralLower }).from(partnerEventType)
      .innerJoin(eventType, eq(eventType.id, partnerEventType.eventTypeId))
      .where(and(eq(partnerEventType.partnerId, p.id), eq(eventType.isPublic, true))).orderBy(asc(eventType.sortOrder)),
    q.select({ slug: eventType.slug, name: eventType.name }).from(eventType).where(eq(eventType.isPublic, true)).orderBy(asc(eventType.sortOrder)),
    respondsWithin24(p.id, q),
    getSetting('request.response_hours', undefined, q),
    getSetting('cancellation.policies', undefined, q),
  ]);
  let policyLine: { label: string; text: string } | null = null;
  if (p.policy) {
    const s = policyStrings(p.policy, null, policies);
    const line = s.vendorWidget ?? `Анулиране: ${s.title.toLocaleLowerCase('bg')} — ${s.description[0].toLocaleLowerCase('bg')}${s.description.slice(1)}.`;
    const i = line.indexOf(':');
    policyLine = { label: line.slice(0, i + 1), text: line.slice(i + 1) };
  }
  return {
    ...page,
    reviews,
    reviewPages,
    specialisations: types.map(t => ({ label: capital(t.plural), href: `/sabitiya/${t.slug}` })),
    eventTypeChoices: allTypes,
    respondsWithin24: responds,
    responseHours,
    policyLine,
  };
}

/**
 * The widget's date check (‹Дата на събитието› changed): busy or free, and whether this client
 * already watches it. Only for publicly visible partners (§4.2); null otherwise.
 */
export async function widgetAvailability(partnerId: string, d: DateStr, clientId: string | null, q: Queryable = db) {
  const [p] = await q.select({ id: partner.id }).from(partner)
    .where(and(eq(partner.id, partnerId), eq(partner.status, 'approved'), eq(partner.isListed, true))).limit(1);
  if (!p || !isDate(d)) return null;
  const info = await check(partnerId, d, q);
  let watching = false;
  if (clientId) {
    const rows = await q.execute<{ id: string }>(sql`select id from date_watch where client_id = ${clientId} and partner_id = ${partnerId}
      and date = ${d}::date and status = 'watching' limit 1`);
    watching = rows.length > 0;
  }
  return { date: d, dateText: fmtDate(d), busy: info.busy, requestable: info.requestable, watching };
}

// ── /stani-partnyor ───────────────────────────────────────────────────────

/**
 * Everything /stani-partnyor prints from settings (D8) and the testimonial's partner
 * (Студио Мелодия: name, category, city, ‹партньор от {месец година}› from approved_at, D86).
 */
export async function becomePartnerView(q: Queryable = db) {
  const n = await publicNumbers(q);
  const [t] = await q.select({
    name: partner.businessName, approvedAt: partner.approvedAt, rating: partner.ratingAvg, reviews: partner.reviewCount,
    categoryName: category.name, cityName: city.name, avatarKey: media.storageKey,
  }).from(partner).leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(city, eq(city.id, partner.cityId))
    .leftJoin(media, eq(media.id, partner.avatarMediaId))
    .where(and(eq(partner.slug, 'studio-melodiya'), eq(partner.status, 'approved'), eq(partner.isListed, true))).limit(1);
  let testimonial = null;
  if (t) {
    const since = t.approvedAt ? sofiaParts(t.approvedAt) : null;
    testimonial = {
      name: t.name, avatarUrl: mediaUrl(t.avatarKey),
      meta: [t.categoryName, t.cityName, since ? `партньор от ${monthName(since.m)} ${since.y}` : null].filter(Boolean).join(' · '),
      stars: t.reviews && t.rating != null ? Math.round(Number(t.rating)) : 5,
    };
  }
  return {
    ...n,
    introCountWord: numberWord(n.introCount, 'f'),
    maxPackagesWord: numberWord(n.maxPackages, 'm'),
    payoutDaysText: payoutDaysText(n.payoutDays),
    testimonial,
  };
}

// ── /kak-raboti ──────────────────────────────────────────────────────────

export async function howItWorksView(q: Queryable = db) {
  const n = await publicNumbers(q);
  return { responseText: hoursText(n.responseHours), paymentText: hoursText(n.paymentHours), holdText: holdText(n.holdDaysAfterEvent) };
}

// ── /pravila ──────────────────────────────────────────────────────────────

/**
 * The legal page: the published documents (‹Условия за партньори (PDF)›…), the date of the
 * latest one (‹Последна редакция›), the numbers its FAQ quotes (settings), the three policies
 * generated from the policy table (§5.5) and the support address.
 */
export async function legalView(q: Queryable = db) {
  const [n, st, docs] = await Promise.all([
    publicNumbers(q), getSettings(undefined, q),
    q.select({ id: legalDocument.id, title: legalDocument.title, publishedAt: legalDocument.publishedAt, key: media.storageKey, isPublic: media.isPublic })
      .from(legalDocument).innerJoin(media, eq(media.id, legalDocument.mediaId)).orderBy(asc(legalDocument.sortOrder), desc(legalDocument.publishedAt)),
  ]);
  const policies = st['cancellation.policies'];
  const last = docs.reduce<Date | null>((m, d) => (!m || d.publishedAt > m ? d.publishedAt : m), null);
  return {
    ...n,
    paymentText: hoursText(n.paymentHours),
    payoutDaysText: payoutDaysText(n.payoutDays),
    /** ‹1-во или 15-то› (FAQ: the transfer goes on one of the payout days). */
    payoutDaysOr: [...n.payoutDays].sort((a, b) => a - b).map(ordinal).join(' или '),
    introCountWord: numberWord(n.introCount, 'f'),
    supportEmail: st['support.email'],
    documents: docs.map(d => ({ id: d.id, title: d.title, url: mediaUrl(d.key) ?? '#' })),
    lastEdited: last ? `${fmtDate(last)} г.` : null,
    policies: (['flexible', 'moderate', 'strict'] as const).map(p => ({ key: p, ...policyStrings(p, null, policies) })),
  };
}

export type CategoryView = NonNullable<Awaited<ReturnType<typeof categoryView>>>;
export type EventTypeView = NonNullable<Awaited<ReturnType<typeof eventTypeView>>>;
export type PartnerView = NonNullable<Awaited<ReturnType<typeof partnerView>>>;
