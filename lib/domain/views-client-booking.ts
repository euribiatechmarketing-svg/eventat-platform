// Read models for the client's requests, bookings and the booking flow
// (SCREENS §4 /akaunt/zayavki, /akaunt/rezervacii and §5). Every function takes
// the signed-in client's Actor and returns only that client's records.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable } from '@/db';
import {
  booking, category, charge, city, clientEvent, dateWatch, eventType, invoice, media, offer, partner, request, review, service, user,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { date as fmtDate, daysBetween, money, moneyShort, sofiaDate, sofiaParts, time, type DateStr } from '@/lib/format';
import { fileUrl } from '@/lib/storage';
import type { AnyActor } from './actor';
import { HOLDING_STATUSES, LifecycleError, assertClientActor, checkPartnerDate, phoneDisplay } from './bookings';
import { isBusy } from './availability';
import { clientCancelEligibility, policiesFor, policyStrings, quoteBooking } from './cancellation';
import { DECLINE_REASON_LABEL } from './requests';
import { getSettings } from './settings';

// ── Formats used only on these screens ───────────────────────────────────

const MONTHS_SHORT = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
const NBSP = ' ';

function parts(d: Date | DateStr) {
  if (typeof d === 'string') { const [y, m, day] = d.split('-').map(Number); return { y, m, d: day }; }
  const p = sofiaParts(d);
  return { y: p.y, m: p.m, d: p.d };
}

/** ‹12 авг› / with the year ‹19 дек 2026› (SPEC §0 short list dates). */
export function shortDate(d: Date | DateStr, withYear = false): string {
  const p = parts(d);
  return `${p.d}${NBSP}${MONTHS_SHORT[p.m - 1]}${withYear ? ` ${p.y}` : ''}`;
}

/** ‹12 авг, 09:24› (the ‹Изпратена› column). */
export const sentLabel = (at: Date) => `${shortDate(at)}, ${time(at)}`;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Relative age (SPEC §0): ‹преди 1 час›, ‹преди 2 часа›, ‹вчера›, ‹преди 4 месеца›. */
export function ago(from: Date, at: Date): string {
  const mins = Math.max(0, Math.floor((at.getTime() - from.getTime()) / 60_000));
  if (mins < 1) return 'току-що';
  if (mins < 60) return `преди ${mins} мин`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `преди ${plural(hours, 'час', 'часа')}`;
  const days = daysBetween(sofiaDate(from), sofiaDate(at));
  if (days <= 1) return 'вчера';
  if (days < 30) return `преди ${days} дни`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `преди ${plural(months, 'месец', 'месеца')}`;
  const years = Math.floor(days / 365.25);
  return `преди ${plural(years, 'година', 'години')}`;
}

/** ‹21:14›: hours and minutes left, never negative. */
export function hoursMinutes(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

// ── Partner card (photo, category, city, rating) ─────────────────────────

const THUMBS = join(process.cwd(), 'public', 'photos', 'thumbs');
/** The small version of a bundled demo photo when one exists (`/photos/x.jpg` → `/photos/thumbs/x.jpg`). */
function thumbOf(url: string | null): string | null {
  if (!url) return null;
  const m = /^\/photos\/([^/]+)$/.exec(url);
  return m && existsSync(join(THUMBS, m[1])) ? `/photos/thumbs/${m[1]}` : url;
}

export type PartnerCard = {
  id: string; slug: string; name: string; category: string; categorySlug: string | null; cityName: string | null;
  /** ‹4,9›, or null without reviews (§12.4). */
  rating: string | null; photo: string | null; thumb: string | null;
};

export async function partnerCards(q: Queryable, ids: string[]): Promise<Map<string, PartnerCard>> {
  const out = new Map<string, PartnerCard>();
  const uniq = [...new Set(ids)];
  if (!uniq.length) return out;
  const rows = await q.select({
    id: partner.id, slug: partner.slug, name: partner.businessName, category: category.name, categorySlug: category.slug, cityName: city.name,
    ratingAvg: partner.ratingAvg, reviewCount: partner.reviewCount,
    photo: sql<string | null>`coalesce(
      (select m.storage_key from partner_photo ph join media m on m.id = ph.media_id where ph.partner_id = ${partner.id} order by ph.position limit 1),
      (select m.storage_key from media m where m.id = ${partner.coverMediaId}),
      (select m.storage_key from media m where m.id = ${partner.avatarMediaId}))`,
  }).from(partner).leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(city, eq(city.id, partner.cityId))
    .where(inArray(partner.id, uniq));
  for (const r of rows) {
    const photo = r.photo ? fileUrl(r.photo) : null;
    out.set(r.id, {
      id: r.id, slug: r.slug, name: r.name, category: r.category ?? '', categorySlug: r.categorySlug ?? null, cityName: r.cityName,
      rating: r.ratingAvg != null && r.reviewCount > 0 ? Number(r.ratingAvg).toFixed(1).replace('.', ',') : null,
      photo, thumb: thumbOf(photo),
    });
  }
  return out;
}

async function partnerCard(q: Queryable, id: string): Promise<PartnerCard> {
  const c = (await partnerCards(q, [id])).get(id);
  if (!c) throw new LifecycleError('not_found', 'No such partner');
  return c;
}

/**
 * ‹DJ и озвучаване · Пакет „Цял ден“›: the service's category, then the service.
 * A title that already names its kind (‹Фотокабина · 4 часа…›, ‹Торта и десерти›) stands alone.
 */
export function subtitleOf(categoryName: string | null | undefined, title: string): string {
  if (!categoryName || title.includes(' · ')) return title;
  const stem = (x: string) => x.toLocaleLowerCase('bg').slice(0, 4);
  return stem(title) === stem(categoryName) ? title : `${categoryName} · ${title}`;
}

// ── Client events (the ‹Всички събития› filter) ──────────────────────────

export type EventOption = { id: string; label: string };

/** ‹Сватба · 14 юни 2026› per event of the client, by date. */
export async function clientEventOptions(q: Queryable, clientId: string): Promise<EventOption[]> {
  const rows = await q.select({ id: clientEvent.id, title: clientEvent.title, date: clientEvent.date }).from(clientEvent)
    .where(eq(clientEvent.clientId, clientId)).orderBy(asc(clientEvent.date), asc(clientEvent.createdAt));
  return rows.map(r => ({ id: r.id, label: `${r.title} · ${fmtDate(r.date)}` }));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validEvent = (events: EventOption[], id: string | null | undefined) => (id && UUID.test(id) && events.some(e => e.id === id) ? id : null);

// ── /akaunt/zayavki ──────────────────────────────────────────────────────

/** ‹Всички статуси› options → `?status=`. */
export const REQUEST_STATUS_FILTERS = [
  { value: '', label: 'Всички статуси' },
  { value: 'chakat-otgovor', label: 'Чакат отговор' },
  { value: 'odobreni', label: 'Одобрени' },
  { value: 'otkazani', label: 'Отказани' },
  { value: 'iztekli', label: 'Изтекли' },
] as const;

type Tone = 'pink' | 'primary' | 'danger' | 'success';
export type RequestListRow = {
  number: string; href: string; partner: PartnerCard; subtitle: string; eventTitle: string; sent: string;
  badge: { tone: Tone; text: string } | { tone: 'pink'; countdownTo: string };
  age: string | null; price: string; off: boolean;
  action: { label: string; href: string; primary: boolean };
};
export type RequestGroupKey = 'pay' | 'offers' | 'wait' | 'closed';

/** Requests that turned into a confirmed booking are listed under ‹Резервации› (SPEC §4.5). */
const BOOKED = ['confirmed', 'cancellation_requested', 'completed', 'cancelled'] as const;
const CONFIRMED_OR_COMPLETED = ['confirmed', 'cancellation_requested', 'completed'] as const;

function similarHref(r: { categorySlug: string | null; eventDate: DateStr; citySlug: string | null; guests: number }): string {
  const u = new URLSearchParams();
  if (r.categorySlug) u.set('kategoriya', r.categorySlug);
  u.set('data', r.eventDate);
  if (r.citySlug) u.set('grad', r.citySlug);
  u.set('gosti', String(r.guests));
  return `/tarsene?${u.toString()}`;
}

export async function clientRequestList(actor: AnyActor, f: { eventId?: string | null; status?: string | null }, q: Queryable = db) {
  assertClientActor(actor);
  const at = await now();
  const events = await clientEventOptions(q, actor.userId);
  const eventId = validEvent(events, f.eventId);
  const status = REQUEST_STATUS_FILTERS.some(s => s.value === f.status) ? f.status! : '';

  const conds = [eq(request.clientId, actor.userId)];
  if (eventId) conds.push(eq(request.clientEventId, eventId));
  const rows = await q.select({
    r: request, bookingStatus: booking.status, bookingNumber: booking.number, paymentDueAt: booking.paymentDueAt, approvedAt: booking.approvedAt,
    bookingAmount: booking.amountCents, eventTitle: clientEvent.title, categorySlug: category.slug, categoryName: category.name, citySlug: city.slug,
    offerAmount: offer.amountCents, offerSentAt: offer.sentAt,
  }).from(request)
    .innerJoin(clientEvent, eq(clientEvent.id, request.clientEventId))
    .leftJoin(booking, eq(booking.requestId, request.id))
    .leftJoin(service, eq(service.id, request.serviceId))
    .leftJoin(category, eq(category.id, service.categoryId))
    .leftJoin(city, eq(city.id, request.cityId))
    .leftJoin(offer, eq(offer.id, request.offerId))
    .where(and(...conds)).orderBy(desc(request.sentAt));

  const [{ n: bookingsCount }] = await q.select({ n: sql<number>`count(*)::int` }).from(booking)
    .where(and(eq(booking.clientId, actor.userId), inArray(booking.status, [...CONFIRMED_OR_COMPLETED]), ...(eventId ? [eq(booking.clientEventId, eventId)] : [])));
  const cards = await partnerCards(q, rows.map(x => x.r.partnerId));

  const groups: Record<RequestGroupKey, RequestListRow[]> = { pay: [], offers: [], wait: [], closed: [] };
  let requestsCount = 0;
  for (const x of rows) {
    const r = x.r;
    if (x.bookingStatus && (BOOKED as readonly string[]).includes(x.bookingStatus)) continue;
    if (r.status === 'withdrawn') continue;
    requestsCount++;
    const href = `/akaunt/zayavki/${encodeURIComponent(r.number)}`;
    const base = {
      number: r.number, href, partner: cards.get(r.partnerId)!,
      subtitle: subtitleOf(x.categoryName ?? cards.get(r.partnerId)?.category, r.serviceTitle),
      eventTitle: x.eventTitle, sent: sentLabel(r.sentAt),
    };
    const amount = x.bookingAmount ?? x.offerAmount ?? r.amountCents;
    const price = amount != null ? moneyShort(amount) : '—';
    const similar = { label: 'Виж подобни', href: similarHref({ ...r, categorySlug: x.categorySlug, citySlug: x.citySlug }), primary: false };

    let key: RequestGroupKey; let row: RequestListRow;
    if (x.bookingStatus === 'awaiting_payment') {
      key = 'pay';
      const payable = !!x.paymentDueAt && at < x.paymentDueAt;
      row = {
        ...base, price, off: false,
        badge: { tone: 'pink', countdownTo: x.paymentDueAt!.toISOString() },
        age: x.approvedAt ? `одобрена ${ago(x.approvedAt, at)}` : null,
        action: payable ? { label: 'Плати', href: `/plashtane/${encodeURIComponent(r.number)}`, primary: true } : { label: 'Виж', href, primary: false },
      };
    } else if (r.status === 'offer_sent') {
      key = 'offers';
      row = {
        ...base, price, off: false, badge: { tone: 'primary', text: 'Нова оферта' },
        age: x.offerSentAt ? ago(x.offerSentAt, at) : null, action: { label: 'Виж офертата', href, primary: true },
      };
    } else if (r.status === 'pending' || r.status === 'awaiting_confirmation') {
      key = 'wait';
      row = {
        ...base, price, off: false, badge: { tone: 'primary', text: r.status === 'pending' ? 'Чака отговор' : 'Избрана оферта' },
        age: ago(r.sentAt, at), action: { label: 'Виж', href, primary: false },
      };
    } else if (r.status === 'declined') {
      key = 'closed';
      row = {
        ...base, price, off: true, badge: { tone: 'danger', text: DECLINE_REASON_LABEL[r.declineReason ?? 'date_taken'] },
        age: r.declinedAt ? `отказана на ${shortDate(r.declinedAt)}` : null, action: similar,
      };
    } else if (r.status === 'expired' || x.bookingStatus === 'payment_expired' || x.bookingStatus === 'approval_withdrawn') {
      key = 'closed';
      const text = x.bookingStatus === 'payment_expired' ? 'Изтекъл срок за плащане' : x.bookingStatus === 'approval_withdrawn' ? 'Оттеглено одобрение' : 'Изтекла';
      row = { ...base, price, off: true, badge: { tone: 'danger', text }, age: null, action: similar };
    } else continue;

    const inFilter = !status
      || (status === 'chakat-otgovor' && (key === 'wait' || key === 'offers'))
      || (status === 'odobreni' && key === 'pay')
      || (status === 'otkazani' && r.status === 'declined')
      || (status === 'iztekli' && key === 'closed' && r.status !== 'declined');
    if (inFilter) groups[key].push(row);
  }
  // Waiting for payment: the nearest deadline first.
  groups.pay.sort((a, b) => ('countdownTo' in a.badge ? a.badge.countdownTo : '').localeCompare('countdownTo' in b.badge ? b.badge.countdownTo : ''));
  const s = await getSettings(at, q);
  return {
    nowIso: at.toISOString(), groups, events, eventId, status,
    counts: { requests: requestsCount, bookings: bookingsCount },
    responseHours: s['request.response_hours'], payHours: s['payment.window_hours'],
  };
}

// ── /akaunt/zayavki/[nomer] ──────────────────────────────────────────────

/** The request page: the request, its booking (if any), the offer and the partner card. */
export async function clientRequestPage(actor: AnyActor, number: string, q: Queryable = db) {
  assertClientActor(actor);
  const [x] = await q.select({ r: request, eventType: eventType, cityName: city.name }).from(request)
    .innerJoin(eventType, eq(eventType.id, request.eventTypeId)).leftJoin(city, eq(city.id, request.cityId))
    .where(eq(request.number, number)).limit(1);
  if (!x || x.r.clientId !== actor.userId) throw new LifecycleError('not_found', `No request ${number}`);
  const r = x.r;
  const at = await now();
  const [b] = await q.select().from(booking).where(eq(booking.requestId, r.id)).limit(1);
  const [o] = r.offerId ? await q.select().from(offer).where(eq(offer.id, r.offerId)).limit(1) : [];
  const [svc] = r.serviceId ? await q.select({ categorySlug: category.slug }).from(service).innerJoin(category, eq(category.id, service.categoryId))
    .where(eq(service.id, r.serviceId)).limit(1) : [];
  const [ct] = r.cityId ? await q.select({ slug: city.slug }).from(city).where(eq(city.id, r.cityId)).limit(1) : [];
  const card = await partnerCard(q, r.partnerId);
  const s = await getSettings(at, q);
  // ‹Уведоми ме, ако се освободи›: a declined request whose date is still taken, not watched yet.
  let canWatch = false;
  if (r.status === 'declined' && r.eventDate >= sofiaDate(at)) {
    const [w] = await q.select({ id: dateWatch.id }).from(dateWatch).where(and(
      eq(dateWatch.clientId, actor.userId), eq(dateWatch.partnerId, r.partnerId), eq(dateWatch.date, r.eventDate), eq(dateWatch.status, 'watching'),
    )).limit(1);
    canWatch = !w && await isBusy(r.partnerId, r.eventDate, q);
  }
  return {
    nowIso: at.toISOString(),
    request: r, booking: b ?? null, offer: o ?? null, partner: card,
    eventType: { slug: x.eventType.slug, name: x.eventType.name, definite: x.eventType.nameDefinite },
    cityName: x.cityName,
    similarHref: similarHref({ ...r, categorySlug: svc?.categorySlug ?? null, citySlug: ct?.slug ?? null }),
    canWatch,
    responseHours: s['request.response_hours'], payHours: s['payment.window_hours'],
  };
}

// ── /akaunt/rezervacii ───────────────────────────────────────────────────

export type BookingListRow = {
  number: string; href: string; partner: PartnerCard; subtitle: string; eventTitle: string;
  eventDate: DateStr; cols: { label: string; value: string }[];
  badge: { tone: Tone; text: string } | null; age: string | null; price: string; off: boolean;
  action: { label: string; href: string; primary: boolean };
};

export async function clientBookingList(actor: AnyActor, f: { eventId?: string | null }, q: Queryable = db) {
  assertClientActor(actor);
  const at = await now();
  const today = sofiaDate(at);
  const events = await clientEventOptions(q, actor.userId);
  const eventId = validEvent(events, f.eventId);
  const conds = [eq(booking.clientId, actor.userId), inArray(booking.status, [...BOOKED])];
  if (eventId) conds.push(eq(booking.clientEventId, eventId));
  const rows = await q.select({ b: booking, eventTitle: clientEvent.title, reviewId: review.id, cityName: city.name, categoryName: category.name }).from(booking)
    .innerJoin(clientEvent, eq(clientEvent.id, booking.clientEventId))
    .leftJoin(service, eq(service.id, booking.serviceId))
    .leftJoin(category, eq(category.id, service.categoryId))
    .leftJoin(review, eq(review.bookingId, booking.id))
    .leftJoin(city, eq(city.id, booking.cityId))
    .where(and(...conds)).orderBy(asc(booking.eventDate), sql`${booking.startTime} asc nulls last`);

  const reqConds = [eq(request.clientId, actor.userId)];
  if (eventId) reqConds.push(eq(request.clientEventId, eventId));
  const reqs = await q.select({ status: request.status, bookingStatus: booking.status }).from(request).leftJoin(booking, eq(booking.requestId, request.id)).where(and(...reqConds));
  const requestsCount = reqs.filter(r => r.status !== 'withdrawn' && !(r.bookingStatus && (BOOKED as readonly string[]).includes(r.bookingStatus))).length;
  const bookingsCount = rows.filter(r => (CONFIRMED_OR_COMPLETED as readonly string[]).includes(r.b.status)).length;

  const cards = await partnerCards(q, rows.map(r => r.b.partnerId));
  const live = (s: string) => s === 'confirmed' || s === 'cancellation_requested';
  const heroRow = rows.find(r => live(r.b.status) && r.b.eventDate >= today) ?? null;

  const upcoming: BookingListRow[] = [];
  const past: BookingListRow[] = [];
  for (const { b, eventTitle, reviewId, categoryName } of rows) {
    if (heroRow && b.id === heroRow.b.id) continue;
    const href = `/akaunt/rezervacii/${encodeURIComponent(b.number)}`;
    const card = cards.get(b.partnerId)!;
    const base = {
      number: b.number, href, partner: card, subtitle: subtitleOf(categoryName ?? card.category, b.serviceTitle),
      eventTitle, eventDate: b.eventDate, price: moneyShort(b.amountCents),
    };
    const details = { label: 'Детайли', href, primary: false };
    if (b.status === 'completed') {
      const canReview = !reviewId;
      past.push({
        ...base, off: false,
        cols: [{ label: 'Събитие', value: eventTitle }, { label: 'Дата', value: shortDate(b.eventDate, true) }, { label: 'Гости', value: String(b.guests) }],
        badge: canReview ? { tone: 'primary', text: 'Чака вашето ревю' } : null,
        age: `приключило ${ago(b.completedAt ?? at, at)}`,
        action: canReview ? { label: 'Остави ревю', href: `${href}/revyu`, primary: true } : details,
      });
      continue;
    }
    const cols = [{ label: 'Събитие', value: eventTitle }, { label: 'Дата', value: shortDate(b.eventDate, true) }, { label: 'Час', value: b.startTime ? b.startTime.slice(0, 5) : '—' }];
    if (b.status === 'cancelled') {
      (b.eventDate >= today ? upcoming : past).push({
        ...base, cols, off: true, badge: { tone: 'danger', text: 'Анулирана' },
        age: b.cancelledAt ? `анулирана на ${shortDate(b.cancelledAt)}` : null, action: details,
      });
      continue;
    }
    // confirmed (cancellation_requested reads ‹Потвърдена› for the client until the team acts)
    (b.eventDate >= today ? upcoming : past).push({
      ...base, cols, off: false, badge: { tone: 'success', text: 'Потвърдена' },
      age: b.paidAt ? `платена на ${numericDate(b.paidAt)}` : null, action: details,
    });
  }

  let hero = null;
  if (heroRow) {
    const b = heroRow.b;
    const card = cards.get(b.partnerId)!;
    const p = parts(b.eventDate);
    hero = {
      number: b.number, href: `/akaunt/rezervacii/${encodeURIComponent(b.number)}`,
      day: p.d, month: MONTHS_LONG[p.m - 1], year: p.y, weekday: WEEKDAYS[new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay()],
      title: `${card.name} · ${b.serviceTitle}`,
      location: [b.venueName, b.locality].filter(Boolean).join(', ') || heroRow.cityName || null,
      time: b.startTime ? (b.endTime ? `${b.startTime.slice(0, 5)} – ${b.endTime.slice(0, 5)}` : b.startTime.slice(0, 5)) : null,
      guests: b.guests, daysTo: daysBetween(today, b.eventDate),
      freeCancel: b.freeCancelUntil && b.freeCancelUntil >= today ? policyStrings(b.cancellationPolicy, b.eventDate) : null,
      // the same guard as the booking page and the cancel page (K7: confirmed, before the event, no open case)
      canCancel: (await clientCancelEligibility(b.id, q)).allowed,
      hasInvoice: (await q.select({ id: invoice.id }).from(invoice).where(eq(invoice.bookingId, b.id)).limit(1)).length > 0,
    };
  }
  return { hero, upcoming, past, events, eventId, counts: { requests: requestsCount, bookings: bookingsCount } };
}

const MONTHS_LONG = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

/** ‹12.08.2025› (paid-on dates) in Sofia. */
export function numericDate(at: Date | DateStr): string {
  const p = parts(at);
  return `${String(p.d).padStart(2, '0')}.${String(p.m).padStart(2, '0')}.${p.y}`;
}

// ── The booking flow: /zayavka/[partnerSlug] ─────────────────────────────

export type ServiceOption = { id: string; label: string; kind: 'package' | 'quote'; priceCents: number | null; perGuest: boolean; minGuests: number | null; name: string };

/** The request form: partner card, the services that take requests, event types, the client's events and phone, the prefill. */
export async function requestFormData(actor: AnyActor, slug: string, pre: { paket?: string | null; sabitieId?: string | null; data?: string | null; gosti?: string | null; sabitie?: string | null }, q: Queryable = db) {
  assertClientActor(actor);
  const [p] = await q.select().from(partner).where(eq(partner.slug, slug)).limit(1);
  if (!p || p.status !== 'approved' || !p.isListed) return null;
  const at = await now();
  const today = sofiaDate(at);
  const card = await partnerCard(q, p.id);
  const svcs = await q.select().from(service)
    .where(and(eq(service.partnerId, p.id), eq(service.status, 'active'), eq(service.acceptingRequests, true), sql`${service.kind} <> 'addon'`))
    .orderBy(asc(service.sortOrder), asc(service.createdAt));
  const quotes = svcs.filter(s => s.kind === 'on_request');
  const services: ServiceOption[] = svcs.map(s => {
    const quote = s.kind === 'on_request';
    const perGuest = s.priceUnit === 'per_guest';
    const label = quote ? (quotes.length > 1 ? `${s.name} · По запитване` : 'По запитване')
      : `${s.name} · ${moneyShort(s.priceCents!)}${perGuest ? ' на гост' : ''}`;
    return { id: s.id, label, kind: quote ? 'quote' : 'package', priceCents: s.priceCents, perGuest, minGuests: s.minGuests, name: s.name };
  });
  const types = await q.select({ id: eventType.id, slug: eventType.slug, name: eventType.name }).from(eventType)
    .where(eq(eventType.isPublic, true)).orderBy(asc(eventType.sortOrder));
  const cities = await q.select({ id: city.id, slug: city.slug, name: city.name }).from(city).where(eq(city.isActive, true)).orderBy(asc(city.sortOrder));
  const [u] = await q.select({ phone: user.phone }).from(user).where(eq(user.id, actor.userId)).limit(1);
  const s = await getSettings(at, q);

  // Prefill: the client's event (‹sabitie-id›), then the explicit params.
  const isoDate = (d: string | null | undefined) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  let ev: typeof clientEvent.$inferSelect | null = null;
  if (pre.sabitieId && UUID.test(pre.sabitieId)) {
    [ev] = await q.select().from(clientEvent).where(and(eq(clientEvent.id, pre.sabitieId), eq(clientEvent.clientId, actor.userId))).limit(1);
    ev ??= null;
  }
  const typeBySlug = pre.sabitie ? types.find(t => t.slug === pre.sabitie) : undefined;
  const prefill = {
    clientEventId: ev?.id ?? null,
    eventTypeId: ev?.eventTypeId && types.some(t => t.id === ev!.eventTypeId) ? ev.eventTypeId : typeBySlug?.id ?? types[0]?.id ?? '',
    date: isoDate(pre.data) ?? ev?.date ?? '',
    startTime: ev?.startTime ? ev.startTime.slice(0, 5) : '',
    endTime: ev?.endTime ? ev.endTime.slice(0, 5) : '',
    guests: pre.gosti && /^\d+$/.test(pre.gosti) ? pre.gosti : ev?.guests ? String(ev.guests) : '',
    venueName: ev?.venueName ?? '',
    locality: ev?.locality ?? (ev?.cityId ? cities.find(c => c.id === ev!.cityId)?.name ?? '' : ''),
    serviceId: services.find(x => x.id === pre.paket)?.id ?? services[0]?.id ?? '',
  };
  let dateCheck: { requestable: boolean } | null = null;
  if (prefill.date) dateCheck = await checkPartnerDate(q, p, prefill.date, { today });
  return {
    partner: card, partnerId: p.id, maxGuests: p.maxGuests, services, types, cities, prefill,
    phone: phoneDisplay(u?.phone ?? null), hasPhone: !!u?.phone,
    dateTaken: dateCheck ? !dateCheck.requestable : false,
    responseHours: s['request.response_hours'], maxPhotos: s['uploads.max_photos'], maxMb: s['uploads.max_mb'],
    acceptingRequests: p.acceptingRequests,
  };
}

// ── /zayavka/otvorena ────────────────────────────────────────────────────

export const BUDGET_OPTIONS = [
  { value: 'lt_1000', label: 'до 1 000 €' },
  { value: 'b1000_2000', label: '1 000 – 2 000 €' },
  { value: 'gt_2000', label: 'над 2 000 €' },
  { value: 'unknown', label: 'Още не знам' },
] as const;

export async function briefFormData(actor: AnyActor, pre: { cat?: string | null; type?: string | null; city?: string | null; date?: string | null; guests?: string | null }, q: Queryable = db) {
  assertClientActor(actor);
  const at = await now();
  const cats = await q.select({ id: category.id, slug: category.slug, name: category.name }).from(category)
    .where(and(eq(category.isVisible, true), eq(category.inDirectory, true))).orderBy(asc(category.sortOrder));
  const types = await q.select({ id: eventType.id, slug: eventType.slug, name: eventType.name }).from(eventType)
    .where(eq(eventType.isPublic, true)).orderBy(asc(eventType.sortOrder));
  const cities = await q.select({ id: city.id, slug: city.slug, name: city.name }).from(city).where(eq(city.isActive, true)).orderBy(asc(city.sortOrder));
  const [u] = await q.select({ phone: user.phone }).from(user).where(eq(user.id, actor.userId)).limit(1);
  const s = await getSettings(at, q);
  const type = types.find(t => t.slug === pre.type) ?? types.find(t => t.slug === 'svatba') ?? types[0];
  return {
    categories: cats, types, cities,
    prefill: {
      categories: cats.filter(c => c.slug === pre.cat).map(c => c.slug),
      type: type?.slug ?? '',
      city: cities.find(c => c.slug === pre.city || c.name === pre.city)?.slug ?? '',
      date: pre.date && /^\d{4}-\d{2}-\d{2}$/.test(pre.date) ? pre.date : '',
      guests: pre.guests && /^\d+$/.test(pre.guests) ? pre.guests : '',
    },
    phone: phoneDisplay(u?.phone ?? null), hasPhone: !!u?.phone,
    offerHours: s['brief.offer_window_hours'], maxPhotos: s['uploads.max_photos'], maxMb: s['uploads.max_mb'],
  };
}

// ── /plashtane/[nomer] ───────────────────────────────────────────────────

/** The partner card, the event and the policy line beside the payment form. */
export async function paymentAside(actor: AnyActor, number: string, q: Queryable = db) {
  assertClientActor(actor);
  const [b] = await q.select().from(booking).where(eq(booking.number, number)).limit(1);
  if (!b || b.clientId !== actor.userId) throw new LifecycleError('not_found', `No booking ${number}`);
  const card = await partnerCard(q, b.partnerId);
  const [et] = await q.select({ name: eventType.name }).from(eventType).where(eq(eventType.id, b.eventTypeId)).limit(1);
  const [ev] = await q.select({ title: clientEvent.title }).from(clientEvent).where(eq(clientEvent.id, b.clientEventId)).limit(1);
  const [u] = await q.select({ email: user.email }).from(user).where(eq(user.id, b.clientId)).limit(1);
  return { booking: b, partner: card, eventType: et?.name ?? '', eventTitle: ev?.title ?? et?.name ?? '', email: u?.email ?? '' };
}

// ── /akaunt/rezervacii/[nomer]/anulirane ─────────────────────────────────

/** The cancel page: the booking, the exact quote (cancellation.quote) and the card the refund goes to. */
export async function cancelPageData(actor: AnyActor, number: string, q: Queryable = db) {
  assertClientActor(actor);
  const [b] = await q.select().from(booking).where(eq(booking.number, number)).limit(1);
  if (!b || b.clientId !== actor.userId) throw new LifecycleError('not_found', `No booking ${number}`);
  const at = await now();
  const quote = await quoteBooking(b.id, { at, initiatedBy: 'client' }, q);
  const eligibility = await clientCancelEligibility(b.id, q);
  const policies = await policiesFor(b, q);
  const card = await partnerCard(q, b.partnerId);
  const [ev] = await q.select({ title: clientEvent.title }).from(clientEvent).where(eq(clientEvent.id, b.clientEventId)).limit(1);
  const [u] = await q.select({ email: user.email }).from(user).where(eq(user.id, b.clientId)).limit(1);
  const paid = await q.select({ last4: charge.cardLast4, method: charge.method, succeededAt: charge.succeededAt }).from(charge)
    .where(and(eq(charge.bookingId, b.id), inArray(charge.status, ['succeeded', 'partially_refunded', 'refunded']), eq(charge.isDuplicate, false)))
    .orderBy(asc(charge.succeededAt));
  const [{ n: others }] = await q.select({ n: sql<number>`count(*)::int` }).from(booking).where(and(
    eq(booking.clientId, b.clientId), eq(booking.eventDate, b.eventDate), inArray(booking.status, [...HOLDING_STATUSES]), sql`${booking.id} <> ${b.id}`,
  ));
  return {
    booking: b, partner: card, eventTitle: ev?.title ?? '', email: u?.email ?? '', quote, eligibility,
    policy: policyStrings(b.cancellationPolicy, b.eventDate, policies),
    paidOn: paid[0]?.succeededAt ?? b.paidAt, cardLast4: paid.find(p => p.method === 'card' && p.last4)?.last4 ?? null,
    otherBookingsSameDay: others,
  };
}

// ── /akaunt/rezervacii/[nomer]/revyu ─────────────────────────────────────

export async function reviewPageData(actor: AnyActor, number: string, q: Queryable = db) {
  assertClientActor(actor);
  const [b] = await q.select().from(booking).where(eq(booking.number, number)).limit(1);
  if (!b || b.clientId !== actor.userId) throw new LifecycleError('not_found', `No booking ${number}`);
  const [rv] = await q.select({ id: review.id }).from(review).where(eq(review.bookingId, b.id)).limit(1);
  const card = await partnerCard(q, b.partnerId);
  const [ev] = await q.select({ title: clientEvent.title }).from(clientEvent).where(eq(clientEvent.id, b.clientEventId)).limit(1);
  const paid = await q.select({ s: sql<number>`coalesce(sum(${charge.amountCents} - ${charge.refundedCents}), 0)::int` }).from(charge)
    .where(and(eq(charge.bookingId, b.id), inArray(charge.status, ['succeeded', 'partially_refunded', 'refunded']), eq(charge.isDuplicate, false)));
  const s = await getSettings(await now(), q);
  return {
    booking: b, partner: card, eventTitle: ev?.title ?? '', reviewable: b.status === 'completed' && !!b.paidAt && !rv,
    paidCents: paid[0]?.s ?? 0, maxPhotos: s['uploads.max_photos'], maxMb: s['uploads.max_mb'],
  };
}

// ── /akaunt/rezervacii/[nomer] and /plashtane/[nomer]/potvardena ─────────

/** The ticket's extras: partner card, the client's email and the event title. */
export async function bookingExtras(actor: AnyActor, number: string, q: Queryable = db) {
  assertClientActor(actor);
  const [b] = await q.select({ partnerId: booking.partnerId, clientId: booking.clientId, clientEventId: booking.clientEventId }).from(booking)
    .where(eq(booking.number, number)).limit(1);
  if (!b || b.clientId !== actor.userId) throw new LifecycleError('not_found', `No booking ${number}`);
  const card = await partnerCard(q, b.partnerId);
  const [u] = await q.select({ email: user.email }).from(user).where(eq(user.id, b.clientId)).limit(1);
  const [ev] = await q.select({ title: clientEvent.title }).from(clientEvent).where(eq(clientEvent.id, b.clientEventId)).limit(1);
  return { partner: card, email: u?.email ?? '', eventTitle: ev?.title ?? '' };
}

/** A media row the client uploaded for a request or a brief, as `{ id }` (the form keeps only ids). */
export async function ownUploads(clientId: string, ids: string[], q: Queryable = db) {
  if (!ids.length) return [];
  return q.select({ id: media.id }).from(media).where(and(inArray(media.id, ids), eq(media.ownerUserId, clientId)));
}

export { money };
