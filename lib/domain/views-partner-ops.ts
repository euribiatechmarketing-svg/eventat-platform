import 'server-only';
// Read models for the partner panel's operations screens (SCREENS §7):
// dashboard, requests inbox, request page, bookings ledger, booking page,
// calendar and the topbar search. Everything is scoped to the actor's own
// partner; commission is never exposed (CLAUDE.md rule 9) — only what the
// partner receives. Also the partner exports (‹Експорт›, SPEC §4.17).
import { and, asc, desc, eq, gte, ilike, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, cancellation, city, clientEvent, clientProfile, eventType, media, partnerCancellationRequest, payoutAccount, payoutLine,
  reportJob, request, review, service, user, type BookingStatus, type CancellationPolicy, type RequestStatus,
} from '@/db/schema';
import { policyStrings } from './cancellation';
import { now } from '@/lib/clock';
import { addDays, date, dateNumeric, daysBetween, money, monthName, sofiaDate, type DateStr } from '@/lib/format';
import { initials as initialsOfWords } from '@/lib/initials';
import type { AnyActor } from './actor';
import { audit } from './audit';
import { addMonths, dayRange, type DayInfo } from './availability';
import { mail } from './bookings';
import { mediaUrl, partnerOf, withTx } from './catalogue-kit';
import { split } from './commission';
import { POLICY_FREE_DAYS, POLICY_LABEL, responsiveness } from './partners';
import { partnerEarnings } from './payouts';
import { ratingSummary } from './reviews';

// ── Small formats used by these screens ──────────────────────────────────

const pad = (n: number) => String(n).padStart(2, '0');
const MONTH_SHORT = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
const NUM_WORDS = ['', 'една', 'две', 'три', 'четири', 'пет', 'шест'];

/** 'YYYY-MM' → ‹Юни 2026›. */
export const monthTitle = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const n = monthName(m);
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
};
/** 'YYYY-MM' ± n months. */
export function shiftMonth(ym: string, n: number): string {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}
export const isMonth = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

/** Whole euros with grouped thousands, no sign: 428000 → ‹4 280›. */
export const euros = (cents: number) => String(Math.round(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** ‹HH:MM› from now until `to` (SPEC §0 countdown). */
export function hhmm(from: Date, to: Date): string {
  const mins = Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60000));
  return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
}

/** Relative age (SPEC §0): ‹преди 2 часа› / ‹преди 3 ч› (short) · ‹вчера› · ‹преди 4 дни› · ‹преди 4 месеца›. */
export function ago(at: Date, nowAt: Date, short = false): string {
  const mins = Math.max(0, Math.floor((nowAt.getTime() - at.getTime()) / 60000));
  const days = daysBetween(sofiaDate(at), sofiaDate(nowAt));
  if (days <= 0) {
    if (mins < 60) return `преди ${Math.max(1, mins)} мин`;
    const h = Math.floor(mins / 60);
    return short ? `преди ${h} ч` : h === 1 ? 'преди 1 час' : `преди ${h} часа`;
  }
  if (days === 1) return 'вчера';
  if (days < 30) return `преди ${days} дни`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? 'преди 1 месец' : `преди ${months} месеца`;
  const years = Math.floor(days / 365);
  return years === 1 ? 'преди 1 година' : `преди ${years} години`;
}

/** ‹13 август, 09:24› */
const dayTime = (at: Date) => {
  const d = sofiaDate(at);
  const [, m, day] = d.split('-').map(Number);
  const t = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Sofia', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);
  return `${day} ${monthName(m)}, ${t}`;
};

/** ‹17 – 18 юни 2026› · ‹3 юли – 10 август 2026› · ‹24 декември 2026› (the calendar's block list). */
export function rangeText(from: DateStr, to: DateStr): string {
  if (from === to) return date(from);
  const [y1, m1, d1] = from.split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  if (y1 === y2 && m1 === m2) return `${d1} – ${d2} ${monthName(m2)} ${y2}`;
  if (y1 === y2) return `${d1} ${monthName(m1)} – ${d2} ${monthName(m2)} ${y2}`;
  return `${date(from)} – ${date(to)}`;
}

/** The partner's policy line ‹Умерена — безплатно анулиране до 30 дни преди събитието.› */
export function policyLine(policy: CancellationPolicy): string {
  const days = POLICY_FREE_DAYS[policy];
  if (days != null) return `${POLICY_LABEL[policy]} — безплатно анулиране до ${days} дни преди събитието.`;
  const d = policyStrings(policy).description;
  return `${POLICY_LABEL[policy]} — ${d.charAt(0).toLowerCase()}${d.slice(1)}.`;
}

/** Booking page policy panel text (prototype: ‹Умерена — … След това се задържа депозитът.›). */
export function policyPanelText(policy: CancellationPolicy): string {
  return policy === 'moderate' ? `${policyLine(policy)} След това се задържа депозитът.` : policyLine(policy);
}

/** ‹СУ „Христо Ботев“› → ‹СХ› (quotes and punctuation are not letters). */
const initials = (name: string) => initialsOfWords(name.replace(/[^\p{L}\s]/gu, ' ').trim());

const CLIENT_TYPE: Record<string, string> = { private: 'Частен клиент', business: 'Бизнес клиент' };
const SPACE_TYPE: Record<string, string> = { indoor: 'Закрита зала', garden_hall: 'Градина и зала', outdoor: 'На открито', undecided: 'Още не е решено' };

// ── Partner and clock ────────────────────────────────────────────────────

async function ctx(actor: AnyActor, q: Queryable = db) {
  const p = await partnerOf(actor, q);
  const at = await now();
  return { p, at, today: sofiaDate(at) };
}

// ── Request rows (inbox, dashboard, search) ──────────────────────────────

export type RequestGroup = 'new' | 'pay' | 'confirmed' | 'declined' | 'other';

export type RequestRowView = {
  number: string; kind: 'package' | 'quote' | 'brief'; status: RequestStatus; group: RequestGroup;
  clientName: string; initials: string; eventType: string;
  /** ‹Пакет „Цял ден“› / ‹По запитване› */
  serviceLabel: string; serviceSummary: string | null;
  eventDate: DateStr; guests: number; place: string;
  amountCents: number | null; priceNote: string;
  badge: { label: string; cls: string } | null;
  sentAt: Date; responseDueAt: Date;
  booking: { status: BookingStatus; approvedAt: Date; paymentDueAt: Date } | null;
  /** Deadline of the step the row waits on (answer or payment). */
  deadline: Date | null;
  href: string;
};

const BOOKED: BookingStatus[] = ['confirmed', 'cancellation_requested', 'completed'];

/** Requests that closed without a booking (SPEC §4.5 ‹Приключени›: declined, expired, unpaid, approval withdrawn) list under ‹Отказани›. */
const CLOSED_BOOKING: BookingStatus[] = ['payment_expired', 'approval_withdrawn'];

function groupOf(r: { status: RequestStatus }, b: { status: BookingStatus } | null): RequestGroup {
  if (r.status === 'pending' || r.status === 'awaiting_confirmation') return 'new';
  if (r.status === 'declined' || r.status === 'expired') return 'declined';
  if (r.status === 'approved' && b && CLOSED_BOOKING.includes(b.status)) return 'declined';
  if (r.status === 'approved' && b?.status === 'awaiting_payment') return 'pay';
  if (r.status === 'approved' && b && BOOKED.includes(b.status)) return 'confirmed';
  return 'other';
}

function badgeOf(g: RequestGroup, r: { status: RequestStatus; kind: string }, b: { status: BookingStatus } | null): { label: string; cls: string } | null {
  if (g === 'new') return r.status === 'awaiting_confirmation' ? { label: 'Избрана оферта', cls: 'badge--primary' } : { label: 'Нова', cls: 'badge--primary' };
  if (g === 'pay') return { label: 'Чака плащане', cls: 'badge--warning' };
  if (g === 'confirmed') return b?.status === 'completed' ? { label: 'Приключила', cls: '' } : { label: 'Потвърдена', cls: 'badge--success' };
  if (r.status === 'expired') return { label: 'Изтекла', cls: '' };
  if (b?.status === 'payment_expired') return { label: 'Неплатена заявка — датата е освободена', cls: '' };
  if (b?.status === 'approval_withdrawn') return { label: 'Оттеглено одобрение', cls: '' };
  if (g === 'declined') return { label: 'Отказана', cls: 'badge--danger' };
  if (b?.status === 'cancelled') return { label: 'Анулирана', cls: 'badge--danger' };
  return null;
}

async function requestRowsWhere(partnerId: string, where: SQL | undefined, q: Queryable = db): Promise<RequestRowView[]> {
  const rows = await q.select({
    r: request, clientName: user.name, eventType: eventType.name, cityName: city.name,
    bStatus: booking.status, bApprovedAt: booking.approvedAt, bDueAt: booking.paymentDueAt,
  }).from(request)
    .innerJoin(user, eq(user.id, request.clientId))
    .innerJoin(eventType, eq(eventType.id, request.eventTypeId))
    .leftJoin(city, eq(city.id, request.cityId))
    .leftJoin(booking, eq(booking.requestId, request.id))
    .where(and(eq(request.partnerId, partnerId), where))
    .orderBy(desc(request.sentAt));
  return rows.map(x => {
    const r = x.r;
    const b = x.bStatus ? { status: x.bStatus, approvedAt: x.bApprovedAt!, paymentDueAt: x.bDueAt! } : null;
    const g = groupOf(r, b);
    const quote = r.kind === 'quote';
    return {
      number: r.number, kind: r.kind, status: r.status, group: g,
      clientName: x.clientName, initials: initials(x.clientName), eventType: x.eventType,
      serviceLabel: quote ? 'По запитване' : r.serviceTitle, serviceSummary: r.serviceSummary,
      eventDate: r.eventDate, guests: r.guests, place: r.venueName ?? x.cityName ?? '—',
      amountCents: r.amountCents,
      priceNote: r.amountCents == null ? 'чака оферта' : quote ? 'по оферта' : 'по пакет',
      badge: badgeOf(g, r, b),
      sentAt: r.sentAt, responseDueAt: r.responseDueAt, booking: b,
      deadline: g === 'new' ? r.responseDueAt : g === 'pay' ? b!.paymentDueAt : null,
      href: g === 'confirmed' ? `/partner/rezervacii/${encodeURIComponent(r.number)}` : `/partner/zayavki/${encodeURIComponent(r.number)}`,
    };
  });
}

export type RequestTab = 'novi' | 'plashtane' | 'potvardeni' | 'otkazani' | 'vsichki';
export type RequestFilter = 'vsichki' | 'novi' | 'iztichasht';
export const REQUEST_TABS: { key: RequestTab; label: string; groups: RequestGroup[]; count: boolean }[] = [
  { key: 'novi', label: 'Нови', groups: ['new'], count: true },
  { key: 'plashtane', label: 'Чакат плащане', groups: ['pay'], count: true },
  { key: 'potvardeni', label: 'Потвърдени', groups: ['confirmed'], count: true },
  { key: 'otkazani', label: 'Отказани', groups: ['declined'], count: false },
  { key: 'vsichki', label: 'Всички', groups: ['new', 'pay', 'confirmed', 'declined'], count: false },
];
export const REQUEST_FILTERS: { key: RequestFilter; label: string }[] = [
  { key: 'vsichki', label: 'Всички заявки' }, { key: 'novi', label: 'Само нови' }, { key: 'iztichasht', label: 'С изтичащ срок' },
];
/** ‹С изтичащ срок›: the answer or the payment is due within this many hours (the T1/T6 reminder point). */
export const EXPIRING_HOURS = 6;

/** `/partner/zayavki?tab=&filtar=` (SCREENS §7). */
export async function requestsInbox(actor: AnyActor, a: { tab: RequestTab; filter: RequestFilter }, q: Queryable = db) {
  const { p, at } = await ctx(actor, q);
  const all = await requestRowsWhere(p.id, undefined, q);
  const counts = { new: 0, pay: 0, confirmed: 0, declined: 0 } as Record<RequestGroup, number>;
  for (const r of all) counts[r.group] = (counts[r.group] ?? 0) + 1;
  const tab = REQUEST_TABS.find(t => t.key === a.tab) ?? REQUEST_TABS[4];
  let rows = all.filter(r => tab.groups.includes(r.group));
  if (a.filter === 'novi') rows = rows.filter(r => r.group === 'new');
  if (a.filter === 'iztichasht') rows = rows.filter(r => r.deadline && r.deadline > at && r.deadline.getTime() - at.getTime() <= EXPIRING_HOURS * 3_600_000);
  const by = (g: RequestGroup) => rows.filter(r => r.group === g);
  return {
    now: at, counts,
    groups: {
      new: by('new'),
      pay: by('pay').sort((x, y) => x.booking!.paymentDueAt.getTime() - y.booking!.paymentDueAt.getTime()),
      confirmed: by('confirmed'),
      declined: by('declined'),
    },
  };
}

// ── Dashboard (SCREENS §7 `/partner?mesec=`, SPEC §12.5) ──────────────────

export type MiniDay = { date: DateStr; n: number; out: boolean; today: boolean; past: boolean; info: DayInfo | null; href: string | null };

/** The prototype's short event-type names on calendar chips (vendor/calendar.html: ‹Бал · 70 гости›, ‹Фирмено · 250 г.›). */
const CHIP_TYPE: Record<string, string> = { 'Фирмено събитие': 'Фирмено', 'Абитуриентски бал': 'Бал' };

/**
 * A booked day's chip as the prototype writes it: short type, then ‹N гости›, or ‹N г.› when the
 * label would run past 18 characters (‹Сватба · 120 гости›, ‹Рожден ден · 40 г.›, ‹Фирмено · 250 г.›).
 */
export function bookedChip(eventType: string, guests: number): string {
  const type = CHIP_TYPE[eventType] ?? eventType;
  const full = `${type} · ${guests} гости`;
  return full.length <= 18 ? full : `${type} · ${guests} г.`;
}

/** Calendar cells for a month: full weeks from Monday, days of other months marked `out`. */
async function monthCells(partnerId: string, ym: string, today: DateStr, q: Queryable): Promise<MiniDay[]> {
  const first = `${ym}-01`;
  const last = addDays(`${shiftMonth(ym, 1)}-01`, -1);
  const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7;
  const start = addDays(first, -lead);
  const trail = 6 - ((new Date(`${last}T00:00:00Z`).getUTCDay() + 6) % 7);
  const end = addDays(last, trail);
  const infos = await dayRange(partnerId, first, last, q, today);
  const cells: MiniDay[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const out = d < first || d > last;
    const day = out ? null : infos.find(i => i.date === d) ?? null;
    const bk = day?.bookings.find(b => (day.state === 'booked' ? BOOKED.includes(b.status) : b.status === 'awaiting_payment'));
    const info = day && day.state === 'booked' && bk ? { ...day, chip: bookedChip(bk.eventType, bk.guests) } : day;
    const href = info && bk && (info.state === 'booked' || info.state === 'held')
      ? (info.state === 'booked' ? `/partner/rezervacii/${encodeURIComponent(bk.number)}` : `/partner/zayavki/${encodeURIComponent(bk.number)}`)
      : null;
    cells.push({ date: d, n: Number(d.slice(8)), out, today: d === today, past: d < today, info, href });
  }
  return cells;
}

export async function dashboardView(actor: AnyActor, a: { month?: string }, q: Queryable = db) {
  const { p, at, today } = await ctx(actor, q);
  const ym = isMonth(a.month) ? a.month : today.slice(0, 7);
  const pendingRows = (await requestRowsWhere(p.id, inArray(request.status, ['pending', 'awaiting_confirmation']), q));
  const [{ n: awaiting }] = await q.select({ n: sql<number>`count(*)::int` }).from(booking)
    .where(and(eq(booking.partnerId, p.id), eq(booking.status, 'awaiting_payment')));
  const [{ n: upcoming }] = await q.select({ n: sql<number>`count(*)::int` }).from(booking)
    .where(and(eq(booking.partnerId, p.id), eq(booking.status, 'confirmed'), gte(booking.eventDate, today)));
  const events = await q.select({
    b: booking, eventType: eventType.name, hosts: clientEvent.hosts, clientName: user.name, cityName: city.name,
  }).from(booking)
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(clientEvent, eq(clientEvent.id, booking.clientEventId))
    .innerJoin(user, eq(user.id, booking.clientId))
    .leftJoin(city, eq(city.id, booking.cityId))
    .where(and(eq(booking.partnerId, p.id), inArray(booking.status, ['confirmed', 'awaiting_payment', 'cancellation_requested']), gte(booking.eventDate, today)))
    .orderBy(asc(booking.eventDate), asc(booking.startTime)).limit(4);
  const earnings = await partnerEarnings(p.id, { at }, q);
  const rating = await ratingSummary(p.id, q);
  const resp = rating ? await responsiveness(p.id, q) : null;
  const [latest] = rating ? await q.select({ r: review, eventType: eventType.name }).from(review)
    .innerJoin(eventType, eq(eventType.id, review.eventTypeId))
    .where(eq(review.partnerId, p.id)).orderBy(desc(review.publishedAt)).limit(1) : [];
  const maxBar = Math.max(0, ...earnings.month.bars.map(b => b.cents));
  const prevMonthNum = Number(shiftMonth(today.slice(0, 7), -1).slice(5));
  return {
    partnerName: p.businessName,
    counts: { newRequests: pendingRows.length, awaitingPayment: awaiting, upcomingEvents: upcoming },
    monthRevenueCents: earnings.month.cents,
    latestRequests: pendingRows.slice(0, 3),
    events: events.map(e => ({
      number: e.b.number, status: e.b.status, eventDate: e.b.eventDate, monthShort: MONTH_SHORT[Number(e.b.eventDate.slice(5, 7)) - 1],
      title: `${e.eventType} · ${e.hosts?.trim() || e.clientName}`,
      sub: [e.b.startTime ? e.b.startTime.slice(0, 5) : null, [e.b.venueName, e.b.locality].filter(Boolean).join(', ') || e.cityName, `${e.b.guests} гости`].filter(Boolean).join(' · '),
      href: e.b.status === 'awaiting_payment' ? `/partner/zayavki/${encodeURIComponent(e.b.number)}` : `/partner/rezervacii/${encodeURIComponent(e.b.number)}`,
    })),
    calendar: { month: ym, title: monthTitle(ym), prev: shiftMonth(ym, -1), next: shiftMonth(ym, 1), cells: await monthCells(p.id, ym, today, q) },
    revenue: {
      cents: earnings.month.cents, deltaPct: earnings.month.deltaPct, prevMonthName: monthName(prevMonthNum),
      bars: earnings.month.bars.map((b, i, arr) => ({
        label: MONTH_SHORT[Number(b.month.slice(5)) - 1], pct: maxBar > 0 ? Math.round((b.cents / maxBar) * 100) : 0, now: i === arr.length - 1,
      })),
      toBePaidCents: earnings.toBePaidCents,
    },
    rating: rating ? {
      avg: rating.avg, avgText: rating.avgText, countLabel: rating.countLabel, responsiveness: resp,
      latest: latest ? {
        body: latest.r.body, author: latest.r.authorDisplayName,
        context: `${latest.eventType.charAt(0).toLowerCase()}${latest.eventType.slice(1)}, ${monthName(Number(latest.r.eventDate.slice(5, 7)))} ${latest.r.eventDate.slice(0, 4)}`,
      } : null,
    } : null,
  };
}

// ── Request page (SCREENS §7 `/partner/zayavki/[nomer]`) ─────────────────

/** Extras the request page shows beyond requests.getRequestForPartner(): the client card, the service, the attachments, the policy. */
export async function requestPageExtras(actor: AnyActor, a: { number: string; serviceId: string | null; attachmentMediaIds: string[] }, q: Queryable = db) {
  const { p } = await ctx(actor, q);
  const [r] = await q.select({ clientId: request.clientId, serviceSummary: request.serviceSummary }).from(request)
    .where(and(eq(request.number, a.number), eq(request.partnerId, p.id))).limit(1);
  if (!r) return null;
  const client = await clientCard(p.id, r.clientId, q);
  const [svc] = a.serviceId ? await q.select({ key: media.storageKey, duration: service.durationLabel }).from(service)
    .leftJoin(media, eq(media.id, service.coverMediaId)).where(eq(service.id, a.serviceId)).limit(1) : [];
  const atts = a.attachmentMediaIds.length
    ? await q.select({ id: media.id, key: media.storageKey }).from(media).where(inArray(media.id, a.attachmentMediaIds)) : [];
  return {
    client,
    serviceSummary: r.serviceSummary,
    serviceThumb: mediaUrl(svc?.key ?? null),
    attachments: a.attachmentMediaIds.map(id => mediaUrl(atts.find(x => x.id === id)?.key ?? null)).filter((u): u is string => !!u),
    policy: p.cancellationPolicy ? policyLine(p.cancellationPolicy) : null,
  };
}

/** ‹Мария прикачи три референции към заявката — показват стила и атмосферата, които търси.› */
export function attachmentsText(clientName: string, n: number): string {
  const first = clientName.split(/\s+/)[0];
  const count = n === 1 ? 'една референция' : `${NUM_WORDS[n] ?? n} референции`;
  return `${first} прикачи ${count} към заявката — ${n === 1 ? 'показва' : 'показват'} стила и атмосферата, които търси.`;
}

export const spaceTypeLabel = (s: string | null) => (s ? SPACE_TYPE[s] ?? null : null);
export const responseDueText = (at: Date) => dayTime(at);

/** The client card (D95: bookings with this partner and ‹Клиент от {година}›; no rating). */
export async function clientCard(partnerId: string, clientId: string, q: Queryable = db) {
  const [c] = await q.select({ name: user.name, createdAt: user.createdAt, type: clientProfile.clientType, cityName: city.name }).from(user)
    .leftJoin(clientProfile, eq(clientProfile.userId, user.id)).leftJoin(city, eq(city.id, clientProfile.cityId))
    .where(eq(user.id, clientId)).limit(1);
  const [{ n }] = await q.select({ n: sql<number>`count(*)::int` }).from(booking)
    .where(and(eq(booking.clientId, clientId), eq(booking.partnerId, partnerId), inArray(booking.status, ['confirmed', 'completed'])));
  return {
    name: c?.name ?? '', initials: initials(c?.name ?? ''),
    meta: [CLIENT_TYPE[c?.type ?? 'private'], c?.cityName].filter(Boolean).join(' · '),
    bookings: n, since: c ? Number(sofiaDate(c.createdAt).slice(0, 4)) : null,
  };
}

// ── Booking rows (ledger, search) ────────────────────────────────────────

export type BookingTab = 'predstoyashti' | 'priklyuchili' | 'anulirani';
export type BookingPeriod = 'mesec' | '3meseca' | 'godina';
export const BOOKING_TABS: { key: BookingTab; label: string }[] = [
  { key: 'predstoyashti', label: 'Предстоящи' }, { key: 'priklyuchili', label: 'Приключили' }, { key: 'anulirani', label: 'Анулирани' },
];
export const BOOKING_PERIODS: { key: BookingPeriod; label: string }[] = [
  { key: 'mesec', label: 'Този месец' }, { key: '3meseca', label: 'Следващите 3 месеца' }, { key: 'godina', label: 'Тази година' },
];

export const BOOKING_BADGE: Record<BookingStatus, { label: string; cls: string }> = {
  awaiting_payment: { label: 'Чака плащане', cls: 'badge--pink' },
  confirmed: { label: 'Потвърдена', cls: 'badge--success' },
  cancellation_requested: { label: 'Искане за анулиране', cls: 'badge--warning' },
  completed: { label: 'Приключила', cls: '' },
  payment_expired: { label: 'Неплатена заявка — датата е освободена', cls: '' },
  approval_withdrawn: { label: 'Оттеглено одобрение', cls: '' },
  cancelled: { label: 'Анулирана', cls: 'badge--danger' },
};

export type BookingRowView = {
  number: string; status: BookingStatus; eventDate: DateStr; weekday: string; title: string; sub: string; guests: number;
  amountCents: number; partnerCents: number | null; href: string;
};

const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

async function bookingRowsWhere(partnerId: string, where: SQL | undefined, order: 'asc' | 'desc', q: Queryable = db): Promise<BookingRowView[]> {
  const rows = await q.select({
    b: booking, eventType: eventType.name, hosts: clientEvent.hosts, clientName: user.name, cityName: city.name,
    kind: request.kind, cancelPartner: cancellation.partnerAmountCents,
    line: sql<number | null>`(select sum(l.amount_cents)::int from payout_line l where l.booking_id = ${booking.id} and l.status <> 'cancelled')`,
  }).from(booking)
    .innerJoin(request, eq(request.id, booking.requestId))
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .innerJoin(clientEvent, eq(clientEvent.id, booking.clientEventId))
    .innerJoin(user, eq(user.id, booking.clientId))
    .leftJoin(city, eq(city.id, booking.cityId))
    .leftJoin(cancellation, eq(cancellation.bookingId, booking.id))
    .where(and(eq(booking.partnerId, partnerId), where))
    .orderBy(order === 'asc' ? asc(booking.eventDate) : desc(booking.eventDate), asc(booking.startTime));
  return rows.map(x => {
    const b = x.b;
    const partnerCents = b.status === 'awaiting_payment' || b.status === 'payment_expired' || b.status === 'approval_withdrawn' ? null
      : b.status === 'cancelled' ? (x.cancelPartner ?? 0)
      : x.line ?? split(b.amountCents + b.bookingFeeCents, b.commissionBp ?? 0).partnerAmountCents;
    const [y, m, d] = b.eventDate.split('-').map(Number);
    return {
      number: b.number, status: b.status, eventDate: b.eventDate, weekday: WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()],
      title: `${x.eventType} · ${x.hosts?.trim() || x.clientName}`,
      sub: `${x.kind === 'quote' ? 'По запитване' : b.serviceTitle} · ${b.venueName ?? x.cityName ?? '—'}`,
      guests: b.guests, amountCents: b.amountCents, partnerCents,
      href: b.status === 'awaiting_payment' ? `/partner/zayavki/${encodeURIComponent(b.number)}` : `/partner/rezervacii/${encodeURIComponent(b.number)}`,
    };
  });
}

/** Rows grouped by event month: ‹Юни 2026› + ‹3 събития · 4 190 € оборот›. */
export function byMonth(rows: BookingRowView[]) {
  const out: { month: string; title: string; summary: string; rows: BookingRowView[] }[] = [];
  for (const r of rows) {
    const ym = r.eventDate.slice(0, 7);
    let g = out.find(x => x.month === ym);
    if (!g) { g = { month: ym, title: monthTitle(ym), summary: '', rows: [] }; out.push(g); }
    g.rows.push(r);
  }
  for (const g of out) {
    const n = g.rows.length;
    const turnover = g.rows.filter(r => r.status !== 'cancelled').reduce((s, r) => s + r.amountCents, 0);
    g.summary = `${n} ${n === 1 ? 'събитие' : 'събития'} · ${euros(turnover)} € оборот`;
  }
  return out;
}

/** `/partner/rezervacii?tab=&period=` (SCREENS §7). */
export async function bookingsLedger(actor: AnyActor, a: { tab: BookingTab; period: BookingPeriod | null }, q: Queryable = db) {
  const { p, today } = await ctx(actor, q);
  const upcomingWhere = and(inArray(booking.status, ['awaiting_payment', 'confirmed', 'cancellation_requested']), gte(booking.eventDate, today));
  const pastWhere = or(eq(booking.status, 'completed'), and(inArray(booking.status, ['confirmed', 'cancellation_requested']), sql`${booking.eventDate} < ${today}`));
  const cancelledWhere = eq(booking.status, 'cancelled');
  const tabWhere = a.tab === 'priklyuchili' ? pastWhere : a.tab === 'anulirani' ? cancelledWhere : upcomingWhere;
  const ym = today.slice(0, 7);
  const periodWhere = a.period === 'mesec' ? and(gte(booking.eventDate, `${ym}-01`), lte(booking.eventDate, addDays(`${shiftMonth(ym, 1)}-01`, -1)))
    : a.period === '3meseca' ? and(gte(booking.eventDate, today), lte(booking.eventDate, addMonths(today, 3)))
    : a.period === 'godina' ? and(gte(booking.eventDate, `${today.slice(0, 4)}-01-01`), lte(booking.eventDate, `${today.slice(0, 4)}-12-31`))
    : undefined;
  const count = async (w: SQL | undefined) => (await q.select({ n: sql<number>`count(*)::int` }).from(booking).where(and(eq(booking.partnerId, p.id), w)))[0].n;
  const year = today.slice(0, 4);
  const rows = await bookingRowsWhere(p.id, and(tabWhere, periodWhere), a.tab === 'predstoyashti' ? 'asc' : 'desc', q);
  return {
    counts: {
      upcoming: await count(upcomingWhere), past: await count(pastWhere), cancelled: await count(cancelledWhere),
      pastThisYear: await count(and(pastWhere, gte(booking.eventDate, `${year}-01-01`), lte(booking.eventDate, `${year}-12-31`))),
    },
    year: Number(year),
    months: byMonth(rows),
  };
}

// ── Booking page (SCREENS §7 `/partner/rezervacii/[nomer]`) ──────────────

/** ‹Състояние› of the partner's money (labels from earnings.html / booking.html / admin payouts). */
const LINE_STATE: Record<string, { label: string; note: string }> = {
  awaiting_event: { label: 'Очаква събитие', note: 'сумата стои в платформата' },
  ready: { label: 'Изплащането предстои', note: 'сумата стои в платформата' },
  in_batch: { label: 'Изплащането предстои', note: 'сумата стои в платформата' },
  released_early: { label: 'Изплащането предстои', note: 'сумата стои в платформата' },
  held: { label: 'Задържано', note: 'сумата стои в платформата' },
  paid: { label: 'Изплатено', note: '' },
};

/** Extras for the booking page beyond bookings.getBookingForPartner(). */
export async function bookingPageExtras(actor: AnyActor, a: { number: string }, q: Queryable = db) {
  const { p } = await ctx(actor, q);
  const [b] = await q.select({ b: booking, kind: request.kind, svcKey: media.storageKey, duration: service.durationLabel }).from(booking)
    .innerJoin(request, eq(request.id, booking.requestId))
    .leftJoin(service, eq(service.id, booking.serviceId)).leftJoin(media, eq(media.id, service.coverMediaId))
    .where(and(eq(booking.number, a.number), eq(booking.partnerId, p.id))).limit(1);
  if (!b) return null;
  const client = await clientCard(p.id, b.b.clientId, q);
  const [acc] = await q.select().from(payoutAccount)
    .where(and(eq(payoutAccount.partnerId, p.id), eq(payoutAccount.status, 'confirmed'))).orderBy(desc(payoutAccount.verifiedAt)).limit(1);
  const [line] = await q.select({ status: payoutLine.status, paidAt: payoutLine.paidAt, amountCents: payoutLine.amountCents }).from(payoutLine)
    .where(and(eq(payoutLine.bookingId, b.b.id), sql`${payoutLine.chargeId} is null`)).limit(1);
  const [cx] = await q.select({ partnerCents: cancellation.partnerAmountCents }).from(cancellation)
    .where(eq(cancellation.bookingId, b.b.id)).orderBy(desc(cancellation.createdAt)).limit(1);
  const [pcr] = await q.select().from(partnerCancellationRequest)
    .where(eq(partnerCancellationRequest.bookingId, b.b.id)).orderBy(desc(partnerCancellationRequest.requestedAt)).limit(1);
  return {
    client,
    kind: b.kind,
    serviceThumb: mediaUrl(b.svcKey),
    duration: b.duration,
    account: acc ? { masked: `BG•• •••• •••• ${acc.ibanLast4}`, bank: acc.bankName } : null,
    line: line ? { ...line, state: LINE_STATE[line.status] ?? null } : null,
    cancellationRequestedAt: pcr?.requestedAt ?? null,
    cancelledPartnerCents: cx?.partnerCents ?? null,
    policyText: policyPanelText(b.b.cancellationPolicy),
  };
}

/** The id of the actor's own booking by number (null for anyone else's). */
export async function partnerBookingId(actor: AnyActor, number: string, q: Queryable = db): Promise<string | null> {
  const p = await partnerOf(actor, q);
  const [b] = await q.select({ id: booking.id }).from(booking).where(and(eq(booking.number, number), eq(booking.partnerId, p.id))).limit(1);
  return b?.id ?? null;
}

// ── Calendar (SCREENS §7 `/partner/kalendar?mesec=`) ─────────────────────

export async function calendarCells(actor: AnyActor, a: { month: string }, q: Queryable = db) {
  const { p, today } = await ctx(actor, q);
  return { today, cells: await monthCells(p.id, a.month, today, q) };
}

// ── Topbar search (SCREENS §1 ‹Търси по клиент, услуга или дата› → `/partner/tarsene?q=`) ──

const MONTHS_FULL = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];

/** A date in the query: ‹14.06.2026›, ‹2026-06-14›, ‹14 юни 2026›, ‹14 юни›, ‹юни 2026›, ‹юни›. */
export function parseDateQuery(input: string): { day?: number; month?: number; year?: number } | null {
  const s = input.trim().toLowerCase();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  m = /^(\d{1,2})\.(\d{1,2})(?:\.(\d{4}))?$/.exec(s);
  if (m) return { day: +m[1], month: +m[2], year: m[3] ? +m[3] : undefined };
  m = /^(?:(\d{1,2})\s+)?([а-я]+)\.?(?:\s+(\d{4}))?(?:\s*г\.?)?$/.exec(s);
  if (m) {
    const word = m[2];
    const month = MONTHS_FULL.findIndex(n => n === word || (word.length >= 3 && n.startsWith(word))) + 1;
    if (month > 0) return { day: m[1] ? +m[1] : undefined, month, year: m[3] ? +m[3] : undefined };
  }
  return null;
}

function dateCond(col: typeof request.eventDate | typeof booking.eventDate, d: { day?: number; month?: number; year?: number }): SQL {
  const parts: SQL[] = [];
  if (d.year) parts.push(sql`extract(year from ${col}) = ${d.year}`);
  if (d.month) parts.push(sql`extract(month from ${col}) = ${d.month}`);
  if (d.day) parts.push(sql`extract(day from ${col}) = ${d.day}`);
  return and(...parts)!;
}

export async function partnerSearch(actor: AnyActor, a: { q: string }, q: Queryable = db) {
  const { p, at } = await ctx(actor, q);
  const term = a.q.trim().slice(0, 100);
  if (!term) return { term, now: at, requests: [] as RequestRowView[], bookings: [] as BookingRowView[] };
  const like = `%${term.replace(/[\\%_]/g, m => `\\${m}`)}%`;
  const d = parseDateQuery(term);
  const reqText = or(ilike(user.name, like), ilike(request.serviceTitle, like), ilike(eventType.name, like), ilike(request.venueName, like), ilike(request.number, like),
    ...(d ? [dateCond(request.eventDate, d)] : []));
  // Requests that became bookings are listed once, as bookings.
  const reqs = (await requestRowsWhere(p.id, and(reqText, sql`not exists (select 1 from booking bk where bk.request_id = ${request.id} and bk.status <> 'approval_withdrawn' and bk.status <> 'payment_expired')`), q));
  const bkText = sql`(${or(ilike(user.name, like), ilike(booking.serviceTitle, like), ilike(eventType.name, like), ilike(booking.venueName, like), ilike(booking.number, like),
    ilike(clientEvent.hosts, like), ...(d ? [dateCond(booking.eventDate, d)] : []))})`;
  const bks = await bookingRowsWhere(p.id, and(bkText, inArray(booking.status, ['awaiting_payment', 'confirmed', 'cancellation_requested', 'completed', 'cancelled'])), 'desc', q);
  return { term, now: at, requests: reqs, bookings: bks };
}

// ── Exports (SPEC §4.17 ‹Експорт› → `vendor-report-ready`) ───────────────

/**
 * ‹Експорт› on /partner/zayavki and /partner/rezervacii: a report_job for the
 * partner's requests or bookings and `vendor-report-ready` to the partner
 * (toast ‹Справката се подготвя — ще я получите по имейл›).
 */
export async function requestPartnerReport(actor: AnyActor, a: { kind: 'partner_requests' | 'partner_bookings'; params?: Record<string, string | null> }, tx?: Tx): Promise<{ reportId: string }> {
  return withTx(tx, async t => {
    const p = await partnerOf(actor, t);
    const at = await now();
    const userId = (actor as { userId: string }).userId;
    const [r] = await t.insert(reportJob).values({
      kind: a.kind, requestedBy: userId, partnerId: p.id, params: a.params ?? {}, status: 'ready', createdAt: at, readyAt: at,
    }).returning({ id: reportJob.id });
    const e = await partnerEarnings(p.id, { at }, t);
    const today = sofiaDate(at);
    await mail(t, {
      key: 'vendor-report-ready', to: p.notificationEmail, toUserId: userId, dedupeKey: `report:${r.id}`,
      vars: {
        partnerName: p.businessName, period: `${monthName(Number(today.slice(5, 7)))} ${today.slice(0, 4)}`,
        revenue: money(e.month.cents), toPay: money(e.toBePaidCents), paidYear: e.paidYear.year, paidInYear: money(e.paidYear.cents),
      },
    });
    await audit(t, { actor, action: 'report.requested', entity: 'report_job', entityId: r.id, data: { kind: a.kind, ...(a.params ?? {}) } });
    return { reportId: r.id };
  });
}

/** CSV cells (`;`-separated, Excel in Bulgarian locale), amounts as ‹1450,00›. */
const csvCell = (v: string | number | null | undefined) => {
  const t = v == null ? '' : String(v);
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const csvMoney = (c: number | null) => (c == null ? '' : (c / 100).toFixed(2).replace('.', ','));
const csvRow = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(';');

/**
 * The file behind a partner ‹Експорт› (own ready reports only): the requests or
 * bookings of the view it was asked from (tab, filter / period kept in `params`).
 */
export async function partnerReportCsv(actor: AnyActor, reportId: string, q: Queryable = db): Promise<{ filename: string; csv: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(reportId)) return null;
  const p = await partnerOf(actor, q);
  const [r] = await q.select().from(reportJob)
    .where(and(eq(reportJob.id, reportId), eq(reportJob.partnerId, p.id), inArray(reportJob.kind, ['partner_requests', 'partner_bookings'])));
  if (!r || r.status !== 'ready') return null;
  const params = (r.params ?? {}) as Record<string, string | null | undefined>;
  const day = sofiaDate(r.createdAt);
  let lines: string[];
  if (r.kind === 'partner_requests') {
    const tab = REQUEST_TABS.find(t => t.key === params.tab)?.key ?? 'vsichki';
    const filter = REQUEST_FILTERS.find(f => f.key === params.filtar)?.key ?? 'vsichki';
    const v = await requestsInbox(actor, { tab, filter }, q);
    const rows = [...v.groups.new, ...v.groups.pay, ...v.groups.confirmed, ...v.groups.declined];
    lines = [
      csvRow(['№', 'Клиент', 'Събитие', 'Услуга', 'Дата', 'Гости', 'Локация', 'Сума', 'Статус', 'Получена']),
      ...rows.map(x => csvRow([
        x.number, x.clientName, x.eventType, x.serviceLabel, dateNumeric(x.eventDate), x.guests, x.place, csvMoney(x.amountCents),
        x.badge?.label ?? '', dateNumeric(x.sentAt),
      ])),
    ];
  } else {
    const tab = BOOKING_TABS.find(t => t.key === params.tab)?.key ?? 'predstoyashti';
    const period = BOOKING_PERIODS.find(x => x.key === params.period)?.key ?? null;
    const v = await bookingsLedger(actor, { tab, period }, q);
    lines = [
      csvRow(['Дата', '№', 'Събитие', 'Услуга', 'Гости', 'Сума', 'Получавате', 'Статус']),
      ...v.months.flatMap(m => m.rows).map(x => csvRow([
        dateNumeric(x.eventDate), x.number, x.title, x.sub, x.guests, csvMoney(x.amountCents), csvMoney(x.partnerCents), BOOKING_BADGE[x.status].label,
      ])),
    ];
  }
  const name = r.kind === 'partner_requests' ? 'zayavki' : 'rezervacii';
  return { filename: `${name}-${day}.csv`, csv: `\ufeff${lines.join('\r\n')}\r\n` };
}
