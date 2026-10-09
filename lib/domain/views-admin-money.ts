import 'server-only';
// Read models (and the few small writes the screens need) for the admin money
// area: Резервации, Спорове, Плащания, Имейли (SCREENS §8). Business rules stay
// in their modules (bookings, cancellation, disputes, payouts, payout-accounts);
// this file shapes their records for the screens and adds the queries no
// module had: the bookings register, the case page, the payout queue, the
// email catalogue with outbox counts.
import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, cancellation, category, city, clientEvent, clientProfile, dispute, disputeAttachment, disputeMessage, disputeOption,
  emailOutbox, eventType, media, partner, partnerCancellationRequest, paymentExtension, payoutAccount, payoutBatch, payoutItem, payoutLine,
  refund, reportJob, request, service, serviceRevision, user,
  type BookingStatus, type DisputeDecisionKind, type DisputeStatus, type HoldReason, type ReportKind,
} from '@/db/schema';
import { now } from '@/lib/clock';
import {
  date as fmtDate, dateNumeric, dateShort, daysBetween, money, moneyShort, monthName, plural, remaining, sofiaDate, sofiaInstant, time,
  weekdayName, type DateStr,
} from '@/lib/format';
import { initials as baseInitials, shortName } from '@/lib/initials';
import { CATALOGUE, TEMPLATES } from '@/lib/email/templates';
import { SAMPLES } from '@/lib/email/templates/samples';
import type { Audience, EmailContent } from '@/lib/email/types';
import { ForbiddenError, assertCan, can, type Actor } from './actor';
import { audit } from './audit';
import { getSetting, getSettings } from './settings';
import { commissionRateFor } from './commission';
import { quoteBooking, policyStrings, type CancellationQuote } from './cancellation';
import { getBookingForAdmin } from './bookings';
import { DISPUTE_REASON_LABEL, bpOf, low, paidCents, withTx } from './aftercare-shared';
import { displayPhone } from './catalogue-kit';
import { batchDetail, batchName, listBatches, partnerHoldReason, payoutKpis, prepareBatch, releaseBatch, type ReleaseBatchResult } from './payouts';
import { pendingAccounts } from './payout-accounts';
import { notes as teamNotes } from './team';

// ── Labels ────────────────────────────────────────────────────────────────

export type Badge = { cls: string; label: string };

/** Admin booking labels (SPEC §4.7) with the prototype's badge colours. */
export const BOOKING_BADGE: Record<BookingStatus, Badge> = {
  awaiting_payment: { cls: 'badge--pink badge--dot', label: 'Чака плащане' },
  confirmed: { cls: 'badge--success badge--dot', label: 'Платена' },
  cancellation_requested: { cls: 'badge--warning badge--dot', label: 'Искане за анулиране' },
  completed: { cls: 'badge--success badge--dot', label: 'Приключила' },
  payment_expired: { cls: 'badge--dot', label: 'Изтекъл срок за плащане' },
  approval_withdrawn: { cls: 'badge--dot', label: 'Оттеглено одобрение' },
  cancelled: { cls: 'badge--danger badge--dot', label: 'Анулирана' },
};

/** Dispute labels (SPEC §4.11, D69): the same everywhere. */
export const DISPUTE_BADGE: Record<DisputeStatus, Badge> = {
  collecting: { cls: 'badge--warning badge--dot', label: 'Събираме данни' },
  awaiting_decision: { cls: 'badge--danger badge--dot', label: 'Чака решение' },
  resolved: { cls: 'badge--success badge--dot', label: 'Решен' },
  withdrawn: { cls: 'badge--dot', label: 'Оттеглен' },
};

const OPEN: DisputeStatus[] = ['collecting', 'awaiting_decision'];
const PAID_STATUSES: BookingStatus[] = ['confirmed', 'cancellation_requested', 'completed'];

/** ‹Юни 2026› */
export const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const n = monthName(m);
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} ${y}`;
};
const ymOf = (d: DateStr) => d.slice(0, 7);
const nextYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const prevYm = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
/** Two or more people (‹Петя и Николай›) take plural verbs: ‹подадоха›, ‹клиентите›. */
const isPlural = (name: string) => /\sи\s/.test(unquoted(name));
/** The name without its quoted part: ‹Сладкарница „Мед и мляко“› → ‹Сладкарница›. */
const unquoted = (name: string) => name.replace(/[„"«][^“"»]*[“"»]/g, ' ').trim();
/** Avatar letters: ‹Петя и Николай› → ПН, ‹Snap360› → SN, ‹СУ „Христо Ботев“› → СУ (an abbreviation stays whole). */
function initials(name: string): string {
  const words = name.replace(/[„“"'«»()]/g, ' ').split(/\s+/).filter(w => w && w !== 'и');
  if (words.length === 1) return words[0].replace(/[^\p{L}]/gu, '').slice(0, 2).toUpperCase();
  if (/^\p{Lu}{2,4}$/u.test(words[0])) return words[0].slice(0, 2);
  return baseInitials(words.join(' '));
}
/**
 * Feminine names take feminine participles (‹Вкусна История още не е отговорила›, ‹Мария Димитрова … е платила›):
 * both the first and the last word end in -а/-я (‹Вкусна История›, ‹Мария Димитрова›, ‹Стефка Илиева›).
 * Anything else keeps the masculine form the prototype uses (‹Snap360›, ‹СУ „Христо Ботев“›, ‹Технолинк ЕООД›).
 */
const isFeminine = (name: string) => {
  const w = unquoted(name).split(/\s+/).filter(Boolean);
  return w.length > 0 && !isPlural(name) && /[ая]$/.test(w[0]) && /[ая]$/.test(w[w.length - 1]) && /^[А-Я]/.test(w[0]);
};
/** ‹отговорил› / ‹отговорила› / ‹отговорили› for the name. */
const pastPart = (name: string, stem: string) => `${stem}${isPlural(name) ? 'ли' : isFeminine(name) ? 'ла' : 'л'}`;

/** ‹14 юни› this year, ‹14 юни 2026› otherwise. */
function dayText(d: Date | DateStr, today: DateStr): string {
  const s = typeof d === 'string' ? d : sofiaDate(d);
  return s.slice(0, 4) === today.slice(0, 4) ? dateShort(s) : fmtDate(s);
}
/** ‹28 август, 09:12› */
const stamp = (at: Date, today: DateStr) => `${dayText(at, today)}, ${time(at)}`;
/** ‹днес› / ‹вчера› / ‹преди 3 дни› */
function ago(at: Date, today: DateStr): string {
  const n = daysBetween(sofiaDate(at), today);
  if (n <= 0) return 'днес';
  if (n === 1) return 'вчера';
  return `преди ${n} дни`;
}
/** ‹днес› / ‹вчера› / ‹на 29 август› */
function onDay(at: Date, today: DateStr): string {
  const n = daysBetween(sofiaDate(at), today);
  if (n === 0) return 'днес';
  if (n === 1) return 'вчера';
  return `на ${dayText(at, today)}`;
}
/** ‹днес› / ‹на 30 август› (the prototype's position-request lines never say ‹вчера›). */
function dayOf(at: Date, today: DateStr): string {
  return daysBetween(sofiaDate(at), today) === 0 ? 'днес' : `на ${dayText(at, today)}`;
}
/** A decision in running text: ‹частично възстановяване 30%› (‹Решение: …›, the queue rows). */
const decisionShort = (title: string | null | undefined) => low(title ?? '').replace(/\s+—\s+/g, ' ');

/** Keep a number with its thousands and with the word or unit after it (‹3 200 €›, ‹4 часа›), as the prototype's pages do. */
export const tie = (s: string) => s.replace(/(\d) (?=\d{3}(?!\d))/g, '$1\u00a0').replace(/(\d) (?=[€%а-яА-Я])/g, '$1\u00a0');
const tieOpt = (s: string | null | undefined) => (s == null ? null : tie(s));

/** The euro part of a KPI tile: ‹46 210› (cents only when not whole). */
export const kpiAmount = (cents: number) => moneyShort(cents).replace(/\s€$/, '');

// ── Errors from the domain → screen copy ──────────────────────────────────

/** Copy for a refused action; codes come from LifecycleError / AftercareError / DomainError / ForbiddenError. */
export function refusalText(e: unknown): string {
  const name = (e as { name?: string } | null)?.name;
  if (name === 'ForbiddenError') return 'Нямате права за това действие';
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case 'motive_required': return 'Напишете мотива — той отива до клиента и до изпълнителя заедно с решението.';
    case 'dispute_open': return 'По резервацията има отворен спор';
    case 'dispute_exists': return 'По резервацията вече има спор';
    case 'batch_too_early': return 'Партидите тръгват на 1-во и 15-то число.';
    case 'second_admin_required': return 'Партидата се пуска от втори администратор';
    case 'deadline_passed': return 'Срокът е изтекъл';
    case 'bad_refund_amount': return 'Проверете сумата за връщане';
    case 'reason_required': return 'Напишете причината за анулирането';
    default: return 'Действието вече не е възможно';
  }
}

export function isRefusal(e: unknown): boolean {
  const n = (e as { name?: string } | null)?.name;
  return n === 'LifecycleError' || n === 'DomainError' || n === 'NotFoundError' || n === 'AftercareError' || n === 'ForbiddenError';
}

// ── Reports (‹Експорт›; D68: recorded, no email exists yet) ────────────────

/** `reports.request(kind)`: a report_job row and the audit entry; the ready email needs a new key (D68). */
export async function requestReport(actor: Actor, input: { kind: ReportKind; params?: Record<string, unknown> }, tx?: Tx): Promise<{ reportId: string }> {
  if (!actor.teamRole) throw new ForbiddenError('team');
  return withTx(tx, async t => {
    const [r] = await t.insert(reportJob).values({ kind: input.kind, requestedBy: actor.userId, params: input.params ?? {}, status: 'requested' }).returning({ id: reportJob.id });
    await audit(t, { actor, action: 'report.requested', entity: 'report_job', entityId: r.id, data: { kind: input.kind, ...(input.params ?? {}) } });
    return { reportId: r.id };
  });
}

// ── Резервации: the register ──────────────────────────────────────────────

export type BookingTab = 'vsichki' | 'chakat-plashtane' | 'namesa' | 'anulirani';
export const BOOKING_TABS: { key: BookingTab; label: string }[] = [
  { key: 'vsichki', label: 'Всички' },
  { key: 'chakat-plashtane', label: 'Чакат плащане' },
  { key: 'namesa', label: 'Изискват намеса' },
  { key: 'anulirani', label: 'Анулирани' },
];

type RegisterRow = {
  id: string; number: string; status: BookingStatus; eventDate: DateStr; eventWeekday: string;
  eventTypeName: string; clientName: string; venue: string | null; partnerName: string; partnerCategory: string | null;
  amountCents: number; commissionCents: number | null; paymentDueAt: Date; disputeNumber: string | null; attention: boolean;
};

export type AttentionRow = {
  number: string; eventDate: DateStr; eventTypeName: string; clientName: string; partnerName: string; amountCents: number;
  problem: 'deadline' | 'dispute'; badge: Badge; disputeNumber: string | null; canExtend: boolean;
};

/** D93: payment deadlines ≤ 4 h and open disputes. */
const ATTENTION_HOURS = 4;

async function bookingRows(q: Queryable, where: SQL | undefined) {
  return q.select({
    b: booking, clientName: user.name, partnerName: partner.businessName, categoryName: category.name, categorySlug: category.slug,
    eventTypeName: eventType.name, retained: cancellation.retainedCents, cancelBp: cancellation.commissionBp,
    disputeNumber: sql<string | null>`(select d.number from dispute d where d.booking_id = ${booking.id} and d.status in ('collecting', 'awaiting_decision') limit 1)`,
  }).from(booking)
    .innerJoin(user, eq(user.id, booking.clientId))
    .innerJoin(partner, eq(partner.id, booking.partnerId))
    .innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .leftJoin(category, eq(category.id, partner.primaryCategoryId))
    .leftJoin(cancellation, eq(cancellation.bookingId, booking.id))
    .where(where)
    .orderBy(asc(booking.eventDate), asc(booking.number));
}

/** /admin/rezervacii: the month register (by event date), tab counts, the attention rows (all months). */
export async function bookingsRegister(actor: Actor, p: { month?: string; category?: string; city?: string; tab?: string; q?: string; eventId?: string }) {
  const at = await now();
  const today = sofiaDate(at);
  const finance = can(actor, 'view_finance');

  // Months that have bookings, for the dropdown; the default is this month, or the next one with events.
  const monthsRaw = await db.execute<{ ym: string; n: string }>(sql`select to_char(event_date, 'YYYY-MM') as ym, count(*) as n from booking group by 1 order by 1`);
  const months = monthsRaw.map(r => r.ym);
  let eventMonth: string | null = null;
  if (p.eventId && /^[0-9a-f-]{36}$/.test(p.eventId)) {
    const [ev] = await db.select({ date: clientEvent.date }).from(clientEvent).where(eq(clientEvent.id, p.eventId));
    eventMonth = ev ? ymOf(ev.date) : null;
  }
  const thisMonth = ymOf(today);
  const month = p.month && /^\d{4}-\d{2}$/.test(p.month) ? p.month
    : eventMonth ?? (months.includes(thisMonth) ? thisMonth : months.find(m => m > thisMonth) ?? thisMonth);
  const monthOptions = [...new Set([...months, month])].sort().map(m => ({ value: m, label: monthLabel(m) }));

  const cats = await db.select({ slug: category.slug, name: category.name }).from(category).orderBy(asc(category.sortOrder), asc(category.name));
  const cat = cats.find(c => c.slug === p.category) ?? null;
  const [ct] = p.city ? await db.select({ id: city.id, name: city.name, slug: city.slug }).from(city).where(eq(city.slug, p.city)) : [];

  const conds: SQL[] = [gte(booking.eventDate, `${month}-01`), lt(booking.eventDate, `${nextYm(month)}-01`)];
  if (cat) conds.push(eq(category.slug, cat.slug));
  if (ct) conds.push(eq(booking.cityId, ct.id));
  if (p.eventId && eventMonth) conds.push(eq(booking.clientEventId, p.eventId));
  const query = p.q?.trim();
  if (query) {
    const like = `%${query}%`;
    conds.push(or(ilike(booking.number, like), ilike(user.name, like), ilike(partner.businessName, like), ilike(user.email, like))!);
  }
  const raw = await bookingRows(db, and(...conds));

  const rateCache = new Map<string, number>();
  const rows: RegisterRow[] = [];
  for (const r of raw) {
    const b = r.b;
    let commission: number | null = null;
    if (finance) {
      if (b.status === 'cancelled') commission = r.retained ? bpOf(r.retained, r.cancelBp ?? b.commissionBp ?? 0) : 0;
      else if (b.status === 'payment_expired' || b.status === 'approval_withdrawn') commission = 0;
      else {
        let bp = b.commissionBp;
        if (bp == null) {
          const key = `${b.partnerId}:${b.clientId}`;
          if (!rateCache.has(key)) rateCache.set(key, (await commissionRateFor(db, { partnerId: b.partnerId, clientId: b.clientId, at, excludeBookingId: b.id })).bp);
          bp = rateCache.get(key)!;
        }
        commission = bpOf(b.amountCents + b.bookingFeeCents, bp);
      }
    }
    const due = b.status === 'awaiting_payment' && b.paymentDueAt.getTime() - at.getTime() <= ATTENTION_HOURS * 3_600_000 && b.paymentDueAt > at;
    rows.push({
      id: b.id, number: b.number, status: b.status, eventDate: b.eventDate, eventWeekday: weekdayName(new Date(`${b.eventDate}T12:00:00Z`).getUTCDay()),
      eventTypeName: r.eventTypeName, clientName: r.clientName, venue: b.venueName ?? b.locality, partnerName: r.partnerName, partnerCategory: r.categoryName,
      amountCents: b.amountCents + b.bookingFeeCents, commissionCents: commission, paymentDueAt: b.paymentDueAt, disputeNumber: r.disputeNumber,
      attention: due || !!r.disputeNumber,
    });
  }
  const inTab: Record<BookingTab, (r: RegisterRow) => boolean> = {
    vsichki: () => true,
    'chakat-plashtane': r => r.status === 'awaiting_payment',
    namesa: r => r.attention,
    anulirani: r => r.status === 'cancelled',
  };
  const tab = (BOOKING_TABS.find(t => t.key === p.tab)?.key ?? 'vsichki') as BookingTab;
  const counts = Object.fromEntries(BOOKING_TABS.map(t => [t.key, rows.filter(inTab[t.key]).length])) as Record<BookingTab, number>;

  // Turnover: the price of paid bookings, the retained part of cancelled ones.
  let turnover = 0, commission = 0;
  for (const r of raw) {
    const b = r.b;
    if (PAID_STATUSES.includes(b.status)) {
      turnover += b.amountCents + b.bookingFeeCents;
      commission += bpOf(b.amountCents + b.bookingFeeCents, b.commissionBp ?? 0);
    } else if (b.status === 'cancelled' && r.retained) {
      turnover += r.retained;
      commission += bpOf(r.retained, r.cancelBp ?? b.commissionBp ?? 0);
    }
  }

  return {
    month, monthLabel: monthLabel(month), monthOptions, categories: cats, category: cat, city: ct ?? null, tab, counts,
    rows: rows.filter(inTab[tab]), total: rows.length, turnoverCents: turnover, commissionCents: finance ? commission : null, finance,
    attention: await attentionRows(actor, at), q: query ?? '',
  };
}

/** The ‹Изискват намеса› card: every month. */
export async function attentionRows(actor: Actor, at?: Date): Promise<AttentionRow[]> {
  const t = at ?? (await now());
  const soon = new Date(t.getTime() + ATTENTION_HOURS * 3_600_000);
  const raw = await bookingRows(db, or(
    and(eq(booking.status, 'awaiting_payment'), gte(booking.paymentDueAt, t), lte(booking.paymentDueAt, soon)),
    sql`exists (select 1 from dispute d where d.booking_id = ${booking.id} and d.status in ('collecting', 'awaiting_decision'))`,
  ));
  return raw.map(r => {
    const b = r.b;
    const deadline = b.status === 'awaiting_payment' && b.paymentDueAt >= t && b.paymentDueAt <= soon;
    const hours = Math.max(1, Math.ceil((b.paymentDueAt.getTime() - t.getTime()) / 3_600_000));
    return {
      number: b.number, eventDate: b.eventDate, eventTypeName: r.eventTypeName, clientName: r.clientName, partnerName: r.partnerName,
      amountCents: b.amountCents + b.bookingFeeCents, problem: deadline ? 'deadline' as const : 'dispute' as const,
      badge: deadline ? { cls: 'badge--pink badge--dot', label: `Срокът изтича след ${hours} ч` } : { cls: 'badge--danger badge--dot', label: 'Отворен спор' },
      disputeNumber: r.disputeNumber, canExtend: deadline && can(actor, 'extend_payment_deadline', { disputeOpen: !!r.disputeNumber }),
    };
  });
}

// ── Резервация: the record ────────────────────────────────────────────────

export type TimelineItem = { state: 'done' | 'current' | ''; title: string; time: string };

const REQUEST_ORIGIN: Record<string, string> = { package: 'по заявка от каталога', quote: 'по запитване', brief: 'по отворена заявка' };

/** /admin/rezervacii/[nomer]: both parties, event, money, history, state, notes, and what the team may do now. */
export async function bookingRecord(actor: Actor, number: string) {
  const v = await getBookingForAdmin(actor, number).catch(e => { if ((e as { code?: string }).code === 'not_found') return null; throw e; });
  if (!v) return null;
  const at = await now();
  const today = sofiaDate(at);
  const [b] = await db.select().from(booking).where(eq(booking.id, v.id));
  const [req] = await db.select().from(request).where(eq(request.id, b.requestId));
  const [ev] = await db.select().from(clientEvent).where(eq(clientEvent.id, b.clientEventId));
  const [cp] = await db.select({ type: clientProfile.clientType, cityName: city.name }).from(clientProfile)
    .leftJoin(city, eq(city.id, clientProfile.cityId)).where(eq(clientProfile.userId, b.clientId));
  const [p] = await db.select().from(partner).where(eq(partner.id, b.partnerId));
  const [pc] = p.cityId ? await db.select({ name: city.name }).from(city).where(eq(city.id, p.cityId)) : [];
  const [acct] = await db.select().from(payoutAccount).where(and(eq(payoutAccount.partnerId, p.id), eq(payoutAccount.status, 'confirmed'))).limit(1);

  // ‹В платформата›: the client's paid bookings and what they spent; the partner's paid bookings and turnover.
  const paidBy = (col: typeof booking.clientId | typeof booking.partnerId, id: string) => db.select({
    n: count(), s: sql<number>`coalesce(sum(${booking.amountCents} + ${booking.bookingFeeCents}), 0)::bigint`.mapWith(Number),
  }).from(booking).where(and(eq(col, id), inArray(booking.status, PAID_STATUSES)));
  const [[cs], [ps]] = await Promise.all([paidBy(booking.clientId, b.clientId), paidBy(booking.partnerId, b.partnerId)]);

  const paidCharge = v.charges.find(c => !c.isDuplicate && ['succeeded', 'partially_refunded', 'refunded'].includes(c.status));
  const card = paidCharge ? (paidCharge.method === 'bank_transfer' ? 'Банков превод' : `Карта ${paidCharge.card}`.trim()) : null;
  const cardLower = card ? card.charAt(0).toLowerCase() + card.slice(1) : null;
  const [disp] = await db.select().from(dispute).where(eq(dispute.bookingId, b.id)).limit(1);
  const disputeOpen = !!disp && OPEN.includes(disp.status);
  const [canc] = await db.select().from(cancellation).where(eq(cancellation.bookingId, b.id));
  const [pcr] = await db.select().from(partnerCancellationRequest)
    .where(and(eq(partnerCancellationRequest.bookingId, b.id), eq(partnerCancellationRequest.status, 'pending'))).limit(1);
  const notesRows = await teamNotes(actor, { subjectType: 'booking', subjectId: b.id });
  const policies = await getSetting('cancellation.policies', b.approvedAt);
  const ps2 = policyStrings(b.cancellationPolicy, b.eventDate, policies);

  const finance = v.money.commission;
  const amountTotal = v.money.totalCents;
  const pct = finance ? `${(finance.bp / 100).toLocaleString('bg-BG', { maximumFractionDigits: 1 })}%` : '';
  const lines = await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id)).orderBy(asc(payoutLine.createdAt));
  const line = lines.find(l => !l.chargeId) ?? lines[0] ?? null;

  // Cancel preview (D66): K9 completes a partner's request with a full refund; K11 defaults to the §5 quote.
  let cancelQuote: CancellationQuote | null = null;
  const canCancel = can(actor, 'cancel_booking') && !disputeOpen && (b.status === 'confirmed' || b.status === 'cancellation_requested');
  if (canCancel) cancelQuote = await quoteBooking(b.id, { at, initiatedBy: b.status === 'cancellation_requested' ? 'partner' : 'team' });

  // ‹Какво се случи›
  const tl: TimelineItem[] = [];
  const evLower = v.eventType.name.toLowerCase();
  tl.push({ state: 'done', title: 'Клиентът изпрати заявка', time: `${fmtDate(sofiaDate(req.sentAt))}, ${time(req.sentAt)} · ${[evLower, plural(b.guests, 'гост', 'гости'), b.venueName].filter(Boolean).join(', ')}` });
  tl.push({ state: 'done', title: `${p.businessName} одобри заявката`, time: `${fmtDate(sofiaDate(b.approvedAt))}, ${time(b.approvedAt)} · датата е блокирана в календара` });
  const exts = await db.select().from(paymentExtension).where(eq(paymentExtension.bookingId, b.id)).orderBy(asc(paymentExtension.createdAt));
  for (const x of exts) tl.push({ state: 'done', title: `Срокът е удължен с ${x.hours} часа`, time: `${fmtDate(sofiaDate(x.createdAt))}, ${time(x.createdAt)} · до ${fmtDate(sofiaDate(x.newDueAt))}, ${time(x.newDueAt)}` });
  if (b.paidAt) {
    const inTime = b.paidAt <= b.paymentDueAt;
    tl.push({ state: 'done', title: 'Плащането постъпи в платформата', time: `${fmtDate(sofiaDate(b.paidAt))} · ${money(v.money.paidCents + v.money.refundedCents)}${inTime ? ` · в срока от ${await getSetting('payment.window_hours', b.approvedAt)} часа` : ''}` });
  }
  if (disp) {
    tl.push({ state: 'done', title: disp.openedBy === 'team' ? 'Екипът отвори спор' : `${disp.openedBy === 'client' ? v.client.name : p.businessName} ${isPlural(disp.openedBy === 'client' ? v.client.name : p.businessName) ? 'отвориха' : 'отвори'} сигнал`, time: `${fmtDate(sofiaDate(disp.openedAt))}, ${time(disp.openedAt)} · ${disp.title}` });
    if (disp.decidedAt) tl.push({ state: 'done', title: `Решение: ${decisionShort(disp.decisionTitle)}`, time: `${fmtDate(sofiaDate(disp.decidedAt))}, ${time(disp.decidedAt)}` });
  }
  if (pcr) tl.push({ state: 'done', title: `${p.businessName} поиска анулиране`, time: `${fmtDate(sofiaDate(pcr.requestedAt))}, ${time(pcr.requestedAt)}` });
  if (canc) tl.push({ state: 'done', title: 'Резервацията е анулирана', time: `${fmtDate(sofiaDate(canc.createdAt))}, ${time(canc.createdAt)} · ${moneyShort(canc.refundCents)} се връщат на клиента` });
  const refunds = await db.select().from(refund).where(and(eq(refund.bookingId, b.id), eq(refund.status, 'succeeded'))).orderBy(asc(refund.succeededAt));
  for (const r of refunds) if (r.succeededAt) tl.push({ state: 'done', title: `${moneyShort(r.amountCents)} върнати на клиента`, time: fmtDate(sofiaDate(r.succeededAt)) });
  const days = daysBetween(today, b.eventDate);
  const startText = v.startTime ? `, ${v.startTime}` : '';
  if (b.status === 'awaiting_payment') {
    tl.push({ state: 'current', title: 'Чака плащане', time: `Срокът изтича ${fmtDate(sofiaDate(b.paymentDueAt))}, ${time(b.paymentDueAt)}` });
  } else if ((b.status === 'confirmed' || b.status === 'cancellation_requested') && days >= 0) {
    tl.push({ state: 'current', title: 'Предстоящо събитие', time: `${fmtDate(b.eventDate)}${startText} · ${days === 0 ? 'днес' : `след ${plural(days, 'ден', 'дни')}`}` });
  } else if (b.status === 'completed' || (b.status === 'confirmed' && days < 0)) {
    tl.push({ state: 'done', title: 'Събитието се проведе', time: `${fmtDate(b.eventDate)}${startText}` });
  }
  if (line?.status === 'paid' && line.paidAt) tl.push({ state: 'done', title: 'Изплатено на изпълнителя', time: `${fmtDate(sofiaDate(line.paidAt))}${finance ? ` · ${money(line.amountCents)}` : ''}` });

  return {
    view: v, booking: b, today, days,
    client: {
      id: v.client.id, name: v.client.name, initials: initials(v.client.name), email: v.client.email,
      phone: displayPhone(v.client.phone ?? v.client.contactPhone) || null, role: ['Клиент', cp?.type === 'business' ? 'бизнес' : 'частно лице', cp?.cityName].filter(Boolean).join(' · '),
      card, stats: `${plural(cs.n, 'резервация', 'резервации')} · ${moneyShort(cs.s)} похарчени`,
    },
    partner: {
      id: p.id, name: p.businessName, initials: initials(p.businessName), contactName: p.contactName, email: p.notificationEmail, eik: p.eik,
      role: ['Изпълнител', v.partner.category, pc?.name].filter(Boolean).join(' · '),
      stats: `${plural(ps.n, 'резервация', 'резервации')} · ${moneyShort(ps.s)} оборот`,
    },
    event: {
      name: v.eventType.name, guests: plural(b.guests, 'гост', 'гости'), date: fmtDate(b.eventDate),
      when: [v.eventWeekday, v.startTime && v.endTime ? `${v.startTime} – ${v.endTime}` : v.startTime].filter(Boolean).join(', '),
      venue: b.venueName ?? v.location, locality: b.venueName ? b.locality ?? v.cityName : null,
      service: b.serviceTitle, serviceSummary: b.serviceSummary, policy: ps2.title,
      policyNote: b.freeCancelUntil ? `безплатно до ${fmtDate(b.freeCancelUntil)}` : null,
      origin: REQUEST_ORIGIN[req.kind] ?? null, hosts: ev?.hosts ?? null,
    },
    money: {
      serviceTitle: b.serviceTitle, amountCents: b.amountCents, feeCents: b.bookingFeeCents, totalCents: amountTotal,
      paidCents: v.money.paidCents, refundedCents: v.money.refundedCents,
      commission: finance ? { pct, cents: finance.commissionCents, partnerCents: finance.partnerAmountCents } : null,
      paidOn: b.paidAt ? dateNumeric(b.paidAt) : null, paidAtLong: b.paidAt ? fmtDate(sofiaDate(b.paidAt)) : null, card: cardLower,
      holdUntil: fmtDate(b.holdUntil), batchDate: dateNumeric(b.batchDate),
      account: acct ? { last4: acct.ibanLast4, bank: acct.bankName } : null, line,
      dueAt: b.paymentDueAt,
    },
    timeline: tl,
    dispute: disp ? { number: disp.number, status: disp.status, badge: DISPUTE_BADGE[disp.status], open: disputeOpen } : null,
    cancellation: canc ?? null,
    partnerRequest: pcr ? { requestedAt: pcr.requestedAt } : null,
    notes: notesRows.map(n => ({ id: n.n.id, author: shortName(n.authorName), initials: initials(n.authorName), at: `${fmtDate(sofiaDate(n.n.createdAt))}, ${time(n.n.createdAt)}`, body: n.n.body })),
    can: {
      extend: b.status === 'awaiting_payment' && b.paymentDueAt > at && can(actor, 'extend_payment_deadline', { disputeOpen }),
      openDispute: !disp && can(actor, 'resolve_disputes') && ['awaiting_payment', 'confirmed', 'cancellation_requested', 'completed'].includes(b.status),
      viewDispute: !!disp && can(actor, 'resolve_disputes'),
      cancel: canCancel, finance: !!finance,
    },
    cancelQuote,
    clientReasons: (['no_show', 'not_as_described', 'payment_problem', 'other'] as const).map(r => ({ value: r, label: DISPUTE_REASON_LABEL[r] })),
  };
}


/** Number → booking id for actions. */
export async function bookingIdByNumber(number: string): Promise<string | null> {
  const [b] = await db.select({ id: booking.id }).from(booking).where(eq(booking.number, number)).limit(1);
  return b?.id ?? null;
}

// ── Спорове: the queue ────────────────────────────────────────────────────

export type DisputeFilter = 'otvoreni' | 'resheni' | 'vsichki';
export const DISPUTE_FILTERS: { key: DisputeFilter; label: string }[] = [
  { key: 'otvoreni', label: 'Отворени' }, { key: 'resheni', label: 'Решени' }, { key: 'vsichki', label: 'Всички' },
];

async function disputeRows(q: Queryable, where: SQL | undefined) {
  return q.select({
    d: dispute, b: booking, clientName: user.name, clientEmail: user.email, partnerName: partner.businessName,
  }).from(dispute)
    .innerJoin(booking, eq(booking.id, dispute.bookingId))
    .innerJoin(user, eq(user.id, booking.clientId))
    .innerJoin(partner, eq(partner.id, booking.partnerId))
    .where(where)
    .orderBy(desc(dispute.urgent), desc(dispute.openedAt));
}

const OPENER: Record<string, (plural: boolean) => string> = {
  client: pl => (pl ? 'подаден от клиентите' : 'подаден от клиента'),
  partner: () => 'подаден от изпълнителя',
  team: () => 'отворен от екипа',
};

/** /admin/sporove: open cases (urgent first), then the decided ones; the head figures and the most urgent case. */
export async function disputeQueue(actor: Actor, p: { filter?: string; q?: string }) {
  assertCan(actor, 'resolve_disputes');
  const at = await now();
  const today = sofiaDate(at);
  const filter = (DISPUTE_FILTERS.find(f => f.key === p.filter)?.key ?? 'vsichki') as DisputeFilter;
  const query = p.q?.trim();
  const search = query ? or(ilike(dispute.number, `%${query}%`), ilike(user.name, `%${query}%`), ilike(partner.businessName, `%${query}%`), ilike(dispute.title, `%${query}%`)) : undefined;
  const all = await disputeRows(db, search);
  const shape = (r: (typeof all)[number]) => {
    const d = r.d;
    const open = OPEN.includes(d.status);
    const sub = open
      ? `${d.number} · ${r.clientName} · ${OPENER[d.openedBy](isPlural(r.clientName))} · отворен ${ago(d.openedAt, today)}`
      : d.status === 'resolved'
        ? `${d.number} · ${decisionShort(d.decisionTitle)} · решен на ${fmtDate(sofiaDate(d.decidedAt ?? d.updatedAt))}`
        : `${d.number} · ${r.clientName} · оттеглен на ${fmtDate(sofiaDate(d.withdrawnAt ?? d.updatedAt))}`;
    const amount = open ? moneyShort(d.heldCents) : d.refundCents ? `върнати ${moneyShort(d.refundCents)}` : moneyShort(0);
    return {
      number: d.number, title: `${d.title} · ${r.partnerName}`, sub, badge: DISPUTE_BADGE[d.status], amount, open,
      cls: open ? (d.urgent ? 'is-urgent' : 'is-open') : 'is-done',
    };
  };
  const openRows = all.filter(r => OPEN.includes(r.d.status));
  const doneRows = all.filter(r => !OPEN.includes(r.d.status)).sort((a, b) => (b.d.decidedAt ?? b.d.updatedAt).getTime() - (a.d.decidedAt ?? a.d.updatedAt).getTime());

  // Head figures (always over every case, not the search).
  const everything = query ? await disputeRows(db, undefined) : all;
  const openAll = everything.filter(r => OPEN.includes(r.d.status));
  const held = openAll.reduce((s, r) => s + r.d.heldCents, 0);   // = the rows' amounts and the bell's ‹X € задържани›
  const decided = everything.filter(r => r.d.decidedAt);
  const avgDays = decided.length ? decided.reduce((s, r) => s + (r.d.decidedAt!.getTime() - r.d.openedAt.getTime()), 0) / decided.length / 86_400_000 : null;

  // ‹Най-спешно›: urgent first, waiting for a decision before collecting, the oldest.
  const peekRow = [...openAll].sort((a, b) => Number(b.d.urgent) - Number(a.d.urgent)
    || Number(b.d.status === 'awaiting_decision') - Number(a.d.status === 'awaiting_decision') || a.d.openedAt.getTime() - b.d.openedAt.getTime())[0];
  let peek = null;
  if (peekRow) {
    const msgs = await db.select().from(disputeMessage).where(and(eq(disputeMessage.disputeId, peekRow.d.id), eq(disputeMessage.kind, 'statement'))).orderBy(asc(disputeMessage.createdAt));
    const first = (party: 'client' | 'partner') => msgs.find(m => m.party === party)?.body ?? null;
    peek = {
      number: peekRow.d.number, title: peekRow.d.title, badge: DISPUTE_BADGE[peekRow.d.status],
      parties: `${peekRow.clientName} ↔ ${peekRow.partnerName}`, held: `${peekRow.d.number} · ${moneyShort(peekRow.d.heldCents)} задържани`,
      clientLabel: isPlural(peekRow.clientName) ? 'Клиентите' : 'Клиентът', clientQuote: excerpt(first('client')), partnerQuote: excerpt(first('partner')),
    };
  }
  return {
    filter, q: query ?? '',
    open: filter === 'resheni' ? [] : openRows.map(shape),
    done: filter === 'otvoreni' ? [] : doneRows.map(shape),
    openCount: openAll.length, heldCents: held,
    avgDays: avgDays === null ? null : avgDays.toLocaleString('bg-BG', { minimumFractionDigits: 1, maximumFractionDigits: 1 }),
    peek,
  };
}

/** The peek's quotes: the first sentence and the last one, joined by „…“ when the statement is long. */
function excerpt(s: string | null): string | null {
  if (!s) return null;
  const t = s.trim();
  if (t.length <= 180) return t;
  const parts = t.match(/[^.!?]+[.!?]+/g) ?? [t];
  if (parts.length < 3) return `${t.slice(0, 177).replace(/\s+\S*$/, '')} …`;
  return `${parts[0].trim()} … ${parts[parts.length - 1].trim()}`;
}

// ── Кейс: the case page ───────────────────────────────────────────────────

export type CaseParty = {
  initials: string; name: string; role: string; vendor: boolean; filer: boolean; plural: boolean;
  statements: { body: string; meta: string; docs: string[]; pics: string[] }[];
  wait: [string, string] | null;
};

export type CaseOption = { id: string | null; kind: DisputeDecisionKind; label: string; description: string | null };

/** Options for a case the team opened without composing any (§4.11 kinds). */
function defaultOptions(b: { status: BookingStatus }, paid: number, clientName: string): CaseOption[] {
  if (b.status === 'awaiting_payment' && paid === 0) {
    return [
      { id: null, kind: 'cancel_unpaid', label: 'Анулирай заявката без такси', description: 'Нищо не е платено — датата се освобождава и за двете страни.' },
      { id: null, kind: 'close', label: 'Затвори сигнала', description: null },
    ];
  }
  return [
    { id: null, kind: 'cancel_full_refund', label: 'Анулирай с пълно възстановяване', description: `${moneyShort(paid)} към ${clientName}.` },
    { id: null, kind: 'no_refund', label: 'Затвори без промяна', description: null },
    { id: null, kind: 'close', label: 'Затвори сигнала', description: null },
  ];
}

/** /admin/sporove/[nomer]: summary, both statements with evidence, the agreed terms, history, money, the decision. */
export async function disputeCase(actor: Actor, number: string) {
  assertCan(actor, 'resolve_disputes');
  const at = await now();
  const today = sofiaDate(at);
  const [r] = await disputeRows(db, eq(dispute.number, number));
  if (!r) return null;
  const d = r.d, b = r.b;
  const [et] = await db.select({ name: eventType.name }).from(eventType).where(eq(eventType.id, b.eventTypeId));
  const [cp] = await db.select({ type: clientProfile.clientType }).from(clientProfile).where(eq(clientProfile.userId, b.clientId));
  const [cat] = await db.select({ name: category.name }).from(partner).leftJoin(category, eq(category.id, partner.primaryCategoryId)).where(eq(partner.id, b.partnerId));
  const msgs = await db.select().from(disputeMessage).where(eq(disputeMessage.disputeId, d.id)).orderBy(asc(disputeMessage.createdAt));
  const atts = await db.select({ messageId: disputeAttachment.messageId, label: disputeAttachment.label, key: media.storageKey, mime: media.mime, name: media.originalName })
    .from(disputeAttachment).innerJoin(media, eq(media.id, disputeAttachment.mediaId)).where(eq(disputeAttachment.disputeId, d.id));
  const paid = await paidCents(db, b.id);
  const clientPl = isPlural(r.clientName);
  const partnerName = r.partnerName;
  const sideName = (party: string) => (party === 'client' ? r.clientName : party === 'partner' ? partnerName : 'EventAT');
  const open = OPEN.includes(d.status);
  const answered = (party: 'client' | 'partner') => msgs.some(m => m.party === party && m.kind === 'statement');

  const dueText = (due: Date) => {
    if (due <= at) return `срокът изтече на ${dayText(due, today)}, ${time(due)}`;
    if (sofiaDate(due) === today) return `срокът изтича днес в ${time(due)}`;
    return `срок до ${dayText(due, today)}, ${time(due)}`;
  };
  const party = (side: 'client' | 'partner'): CaseParty => {
    const name = sideName(side);
    const statements = msgs.filter(m => m.party === side && m.kind === 'statement').map(m => {
      const files = atts.filter(a => a.messageId === m.id);
      return {
        body: tie(m.body), meta: [stamp(m.createdAt, today), m.context].filter(Boolean).join(' · '),
        pics: files.filter(f => f.mime.startsWith('image/') && !f.label).map(f => f.key),
        docs: files.filter(f => f.mime === 'application/pdf' || f.label).map(f => f.label ?? f.name ?? 'Файл'),
      };
    });
    let wait: [string, string] | null = null;
    const asked = d.openedBy !== 'team' && d.positionFrom === side;
    if (!statements.length) {
      const when = `${dayOf(d.positionRequestedAt, today)} в ${time(d.positionRequestedAt)} — ${dueText(d.positionDueAt)}.`;
      wait = [`Още не ${isPlural(name) ? 'са' : 'е'} ${pastPart(name, 'отговори')}.`,
        !asked ? '' : side === 'client' && r.clientEmail ? `Писахме на ${r.clientEmail} ${when}` : `Поискахме позиция ${when}`];
    }
    const role = side === 'client' ? (cp?.type === 'business' ? 'Бизнес клиент' : `${clientPl ? 'Клиенти' : 'Клиент'} · частно лице`) : ['Изпълнител', cat?.name].filter(Boolean).join(' · ');
    return {
      initials: initials(name), name, vendor: side === 'partner', filer: d.openedBy === side, plural: side === 'client' ? clientPl : false,
      // The team writes to a client who has not answered: their address sits under the name (prototype case 0630).
      role: side === 'client' && wait && asked && open && r.clientEmail ? `${role} · ${r.clientEmail}` : role,
      statements, wait,
    };
  };

  const [req] = await db.select({ amount: request.amountCents }).from(request).where(eq(request.id, b.requestId));
  // A price change of the booked service still waiting in Модерация (‹Виж редакцията →›).
  const [rev] = b.serviceId && b.status === 'awaiting_payment'
    ? await db.select({ id: serviceRevision.id, payload: serviceRevision.payload, submittedAt: serviceRevision.submittedAt, unit: service.priceUnit })
      .from(serviceRevision).innerJoin(service, eq(service.id, serviceRevision.serviceId))
      .where(and(eq(serviceRevision.serviceId, b.serviceId), eq(serviceRevision.status, 'pending'))).limit(1)
    : [];

  // ‹Хронология›
  const tl: TimelineItem[] = [];
  // The price moved after the partner approved: how the booking got here comes first.
  const total = b.amountCents + b.bookingFeeCents;
  if (b.status === 'awaiting_payment' && req?.amount && req.amount !== b.amountCents) {
    tl.push({ state: 'done', title: `${partnerName} одобри заявката`, time: `${stamp(b.approvedAt, today)} · ${moneyShort(req.amount)}` });
    const price = rev && Array.isArray((rev.payload as Record<string, unknown>).priceCents) ? (rev.payload as { priceCents: [number, number] }).priceCents : null;
    if (rev && price) {
      tl.push({ state: 'done', title: `${partnerName} подаде нова цена${rev.unit === 'per_guest' ? ' на гост' : ''}`, time: `${stamp(rev.submittedAt, today)} · ${moneyShort(price[0])} → ${moneyShort(price[1])} · чака модерация` });
      if (b.updatedAt > rev.submittedAt && b.updatedAt < d.openedAt) tl.push({ state: 'done', title: `Офертата за плащане стана ${moneyShort(total)}`, time: stamp(b.updatedAt, today) });
    }
  }
  const opener = d.openedBy === 'team' ? null : sideName(d.openedBy);
  tl.push({ state: 'done', title: opener ? `${opener} ${isPlural(opener) ? 'отвориха' : 'отвори'} сигнал` : 'Екипът отвори спор', time: stamp(d.openedAt, today) });
  if (d.openedBy !== 'team' && open) {
    const hrs = Math.round((d.positionDueAt.getTime() - d.positionRequestedAt.getTime()) / 3_600_000);
    tl.push(d.positionFrom === 'client' && r.clientEmail
      ? { state: 'done', title: `Писахме на ${r.clientName}`, time: `${stamp(d.positionRequestedAt, today)} · ${r.clientEmail}` }
      : { state: 'done', title: `Поискахме позиция от ${sideName(d.positionFrom)}`, time: `${stamp(d.positionRequestedAt, today)} · срок ${plural(hrs, 'час', 'часа')}` });
  }
  const exts = await db.select().from(paymentExtension).where(eq(paymentExtension.disputeId, d.id));
  const events: { at: Date; item: TimelineItem }[] = [];
  for (const m of msgs) {
    if (m.kind === 'statement' && m.createdAt.getTime() === d.openedAt.getTime() && m.party === d.openedBy) continue;
    const who = sideName(m.party);
    const files = atts.filter(a => a.messageId === m.id).length;
    const pics = atts.filter(a => a.messageId === m.id && a.mime.startsWith('image/') && !a.label).length;
    if (m.kind === 'statement') events.push({ at: m.createdAt, item: { state: 'done', title: `${who} ${isPlural(who) ? 'отговориха' : 'отговори'}`, time: `${stamp(m.createdAt, today)}${files ? ` · прилага ${pics === files ? plural(files, 'снимка', 'снимки') : plural(files, 'файл', 'файла')}` : ''}` } });
    else if (m.kind === 'question') events.push({ at: m.createdAt, item: { state: 'done', title: 'Поискахме още информация', time: `${stamp(m.createdAt, today)} · ${m.recipients === 'client' ? r.clientName : m.recipients === 'partner' ? partnerName : 'до двете страни'}` } });
    else if (m.kind === 'reminder') events.push({ at: m.createdAt, item: { state: 'done', title: `Писахме на ${m.recipients === 'client' ? r.clientName : partnerName}`, time: stamp(m.createdAt, today) } });
  }
  for (const x of exts) events.push({ at: x.createdAt, item: { state: 'done', title: `Срокът за плащане е удължен с ${x.hours} часа`, time: `${stamp(x.createdAt, today)} · до ${dayText(x.newDueAt, today)}, ${time(x.newDueAt)}` } });
  events.sort((a, b2) => a.at.getTime() - b2.at.getTime()).forEach(e => tl.push(e.item));
  const waitingFor = open && d.status === 'collecting' && !answered(d.positionFrom === 'team' ? 'partner' : d.positionFrom) && d.openedBy !== 'team' ? d.positionFrom : null;
  if (d.status === 'resolved' && d.decidedAt) {
    const [admin] = d.decidedBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, d.decidedBy)) : [];
    tl.push({ state: 'done', title: `Решение: ${decisionShort(d.decisionTitle)}`, time: [stamp(d.decidedAt, today), admin?.name].filter(Boolean).join(' · ') });
    const refunds = await db.select().from(refund).where(and(eq(refund.disputeId, d.id), eq(refund.status, 'succeeded')));
    for (const x of refunds) if (x.succeededAt) tl.push({ state: 'done', title: `${moneyShort(x.amountCents)} върнати на ${clientPl ? 'клиентите' : 'клиента'}`, time: dayText(x.succeededAt, today) });
  } else if (d.status === 'withdrawn') {
    tl.push({ state: 'done', title: 'Сигналът е оттеглен', time: stamp(d.withdrawnAt ?? d.updatedAt, today) });
  } else if (waitingFor) {
    const w = sideName(waitingFor);
    const due = d.positionDueAt;
    tl.push({ state: 'current', title: `Чакаме отговор от ${w}`, time: due <= at ? `Срокът изтече на ${dayText(due, today)}, ${time(due)}` : sofiaDate(due) === today ? `Срокът изтича днес в ${time(due)}` : `Срок до ${dayText(due, today)}, ${time(due)}` });
  } else {
    tl.push({ state: 'current', title: 'Чака вашето решение', time: d.holdsPayout && paid > 0 ? 'Средствата остават задържани' : '' });
  }

  // ‹Пари по случая›
  let moneyCard: { value: string; label: string; note: string };
  if (d.status === 'resolved') {
    moneyCard = {
      value: moneyShort(d.refundCents ?? 0), label: `върнати на ${clientPl ? 'клиентите' : 'клиента'}`,
      note: (d.partnerKeepsCents ?? 0) > 0 ? `${moneyShort(d.partnerKeepsCents ?? 0)} остават за ${partnerName}.` : `По тази резервация няма изплащане към ${partnerName}.`,
    };
  } else if (paid === 0) {
    const approved = req?.amount && req.amount !== b.amountCents ? ` вместо одобрените ${moneyShort(req.amount)}` : '';
    moneyCard = { value: moneyShort(0), label: `задържани · ${r.clientName} още не ${clientPl ? 'са' : 'е'} ${pastPart(r.clientName, 'плати')}`, note: `За плащане: ${moneyShort(b.amountCents + b.bookingFeeCents)}${approved}.` };
  } else if (d.holdsPayout && open) {
    moneyCard = { value: moneyShort(paid), label: 'платени и задържани от платформата', note: `Изплащането към ${partnerName} е спряно до решението.` };
  } else {
    moneyCard = { value: moneyShort(paid), label: 'платени и задържани до събитието', note: 'Сигналът не засяга сумата — изплащането следва обичайния график.' };
  }

  // The decision (open cases) or what was decided.
  let decision = null;
  if (d.status === 'resolved') {
    const [admin] = d.decidedBy ? await db.select({ name: user.name }).from(user).where(eq(user.id, d.decidedBy)) : [];
    decision = { title: d.decisionTitle ?? '', detail: d.decisionDetail, motive: d.motive ?? '', by: [admin?.name, d.decidedAt ? `${fmtDate(sofiaDate(d.decidedAt))}, ${time(d.decidedAt)}` : null].filter(Boolean).join(' · ') };
  }
  const opts = await db.select().from(disputeOption).where(eq(disputeOption.disputeId, d.id)).orderBy(asc(disputeOption.position));
  const options: CaseOption[] = opts.length ? opts.map(o => ({ id: o.id, kind: o.kind, label: o.label, description: o.description })) : defaultOptions(b, paid, r.clientName);

  const canExtend = open && b.status === 'awaiting_payment' && b.paymentDueAt > at && can(actor, 'extend_payment_deadline', { disputeOpen: true });
  let warn: { text: string; extend: boolean } | null = null;
  if (open && b.status === 'awaiting_payment' && b.paymentDueAt > at) {
    warn = { text: `Срокът за плащане изтича след ${remaining(at, b.paymentDueAt)}. Удължете го, за да не ${clientPl ? 'изгубят' : 'изгуби'} ${r.clientName} датата, докато решите.`, extend: canExtend };
  } else if (waitingFor === 'partner' && d.positionDueAt > at) {
    // Waiting for the partner's position: the decision usually waits for it (prototype cases 0614; not 0630, where the client is silent).
    const w = sideName(waitingFor);
    warn = { text: `${w} още не ${isPlural(w) ? 'са' : 'е'} ${pastPart(w, 'отговори')}. Може да решите и сега, но обикновено изчакваме срока.`, extend: false };
    tl.push({ state: '', title: 'Вашето решение', time: 'След отговора или след срока' });
  }

  const evLower = (et?.name ?? '').toLowerCase();
  const sub = d.status === 'resolved' && d.decidedAt
    ? `Кейс № ${d.number} · ${evLower} на ${fmtDate(b.eventDate)} · решен на ${fmtDate(sofiaDate(d.decidedAt))}`
    : `Кейс № ${d.number} · ${evLower} на ${fmtDate(b.eventDate)} · ${d.openedBy === 'team' ? 'отворен от екипа' : `отворен от ${d.openedBy === 'client' ? (clientPl ? 'клиентите' : 'клиента') : 'изпълнителя'}`} ${onDay(d.openedAt, today)}`;

  return {
    id: d.id, number: d.number, bookingNumber: b.number, title: d.title, sub, status: d.status, badge: DISPUTE_BADGE[d.status], urgent: d.urgent && open, open,
    summary: tie(d.summary ?? d.description),
    facts: (d.facts as unknown[] as [string, string, string?][]).filter(f => Array.isArray(f) && f.length >= 2).map(f => [f[0], tie(f[1]), f[2]] as [string, string, string?]),
    client: party('client'), partner: party('partner'),
    agreed: (d.agreedTerms as unknown[] as [string, string, string?, string?][]).filter(a => Array.isArray(a) && a.length >= 2)
      .map(a => [a[0], tie(a[1]), a[2] ? tie(a[2]) : a[2], a[3]] as [string, string, string?, string?]),
    comparison: Array.isArray(d.comparison) ? (d.comparison as [string, string, boolean?][]).map(x => [x[0], tie(x[1]), x[2]] as [string, string, boolean?]) : null,
    note: tieOpt(d.note), revisionHref: rev && b.serviceId ? `/admin/moderatsiya?usluga=${b.serviceId}` : null,
    timeline: tl, money: { value: moneyCard.value, label: moneyCard.label, note: tie(moneyCard.note) }, holdsPayout: d.holdsPayout, paid,
    decision: decision && { ...decision, title: tie(decision.title), detail: tieOpt(decision.detail), motive: tie(decision.motive) },
    options: options.map(o => ({ ...o, label: tie(o.label), description: tieOpt(o.description) })),
    warn: warn && { ...warn, text: tie(warn.text) },
    remind: waitingFor && open ? { side: waitingFor as 'client' | 'partner', name: sideName(waitingFor) } : null,
    clientName: r.clientName, partnerName,
  };
}

export async function disputeIdByNumber(number: string): Promise<string | null> {
  const [d] = await db.select({ id: dispute.id }).from(dispute).where(eq(dispute.number, number)).limit(1);
  return d?.id ?? null;
}

// ── Плащания ──────────────────────────────────────────────────────────────

const HOLD_TEXT: Record<HoldReason, string> = {
  dispute: 'спор по резервацията',
  account_check: 'сметката чака проверка',
  provider_disabled: 'изплащанията са спрени от доставчика',
  returned: 'върнат превод',
};

export type QueueItem = {
  partnerId: string; partnerName: string; bookings: number; lastEvent: DateStr | null; ibanLast4: string | null;
  amountCents: number; held: boolean; holdText: string | null; disputeNumber: string | null;
};

/** The next batch's items: stored once prepared (T17), projected from the due lines before that. */
async function batchItems(batchDate: DateStr, batchId: string | null, status: string, q: Queryable = db): Promise<QueueItem[]> {
  type L = { partnerId: string; amount: number; eventDate: DateStr; payoutHold: boolean; number: string; disputeNumber: string | null };
  let lines: L[] = [];
  const disputeNo = sql<string | null>`(select d.number from dispute d where d.booking_id = ${booking.id} and d.status in ('collecting', 'awaiting_decision') limit 1)`;
  const stored = new Map<string, { status: string; holdReason: HoldReason | null }>();
  if (batchId && status !== 'scheduled') {
    const items = await q.select().from(payoutItem).where(eq(payoutItem.batchId, batchId));
    for (const it of items) stored.set(it.partnerId, { status: it.status, holdReason: it.holdReason });
    lines = (await q.select({ partnerId: payoutLine.partnerId, amount: payoutLine.amountCents, eventDate: booking.eventDate, payoutHold: booking.payoutHold, number: booking.number, disputeNumber: disputeNo })
      .from(payoutLine).innerJoin(payoutItem, eq(payoutItem.id, payoutLine.payoutItemId)).innerJoin(booking, eq(booking.id, payoutLine.bookingId))
      .where(eq(payoutItem.batchId, batchId)));
  } else {
    lines = await q.select({ partnerId: payoutLine.partnerId, amount: payoutLine.amountCents, eventDate: booking.eventDate, payoutHold: booking.payoutHold, number: booking.number, disputeNumber: disputeNo })
      .from(payoutLine).innerJoin(booking, eq(booking.id, payoutLine.bookingId))
      .leftJoin(payoutItem, eq(payoutItem.id, payoutLine.payoutItemId))
      .where(and(
        lte(payoutLine.batchDate, batchDate),
        or(inArray(payoutLine.status, ['ready', 'released_early', 'held']), and(eq(payoutLine.status, 'awaiting_event'), lt(booking.eventDate, batchDate))),
        or(isNull(payoutLine.payoutItemId), inArray(payoutItem.status, ['ready', 'held'])),
      ));
  }
  const byPartner = new Map<string, L[]>();
  for (const l of lines) byPartner.set(l.partnerId, [...(byPartner.get(l.partnerId) ?? []), l]);
  const out: QueueItem[] = [];
  for (const [pid, ls] of byPartner) {
    const [p] = await q.select({ name: partner.businessName }).from(partner).where(eq(partner.id, pid));
    const [acct] = await q.select({ last4: payoutAccount.ibanLast4 }).from(payoutAccount).where(and(eq(payoutAccount.partnerId, pid), eq(payoutAccount.status, 'confirmed'))).limit(1);
    const st = stored.get(pid);
    const disputed = ls.find(l => l.payoutHold);
    const reason: HoldReason | null = st ? (st.status === 'held' ? st.holdReason ?? 'dispute' : null) : disputed ? 'dispute' : await partnerHoldReason(q, pid);
    out.push({
      partnerId: pid, partnerName: p.name, bookings: ls.length, lastEvent: ls.map(l => l.eventDate).sort().at(-1) ?? null, ibanLast4: acct?.last4 ?? null,
      amountCents: ls.reduce((s, l) => s + l.amount, 0), held: !!reason, holdText: reason ? (reason === 'dispute' ? (ls.length > 1 ? 'спор по едната' : 'спор по резервацията') : HOLD_TEXT[reason]) : null,
      disputeNumber: reason === 'dispute' ? disputed?.disputeNumber ?? ls.find(l => l.disputeNumber)?.disputeNumber ?? null : null,
    });
  }
  return out.sort((a, b) => Number(a.held) - Number(b.held) || b.amountCents - a.amountCents);
}

const BATCH_BADGE: Record<string, Badge> = {
  scheduled: { cls: 'badge--primary badge--dot', label: 'Предстои' },
  ready: { cls: 'badge--success badge--dot', label: 'Готово' },
  released: { cls: 'badge--primary badge--dot', label: 'Пусната' },
  paid: { cls: 'badge--success badge--dot', label: 'Изплатена' },
  partially_failed: { cls: 'badge--danger badge--dot', label: 'Неуспешен превод' },
};
export const ITEM_BADGE: Record<string, Badge> = {
  ready: { cls: 'badge--success badge--dot', label: 'Готово' },
  held: { cls: 'badge--warning badge--dot', label: 'Задържано' },
  sent: { cls: 'badge--primary badge--dot', label: 'Пусната' },
  paid: { cls: 'badge--success badge--dot', label: 'Изплатено' },
  failed: { cls: 'badge--danger badge--dot', label: 'Неуспешен превод' },
};

/** /admin/plashtaniya: SPEC §8.1 KPIs, the next batch and its items, history, accounts waiting for the check. */
export async function payoutsOverview(actor: Actor) {
  assertCan(actor, 'view_finance');
  const at = await now();
  const today = sofiaDate(at);
  const s = await getSettings(at);
  const k = await payoutKpis({ at });
  const nb = k.nextBatch;
  const [batchRow] = await db.select().from(payoutBatch).where(eq(payoutBatch.batchDate, nb.batchDate));
  const items = await batchItems(nb.batchDate, batchRow?.id ?? null, batchRow?.status ?? 'scheduled');
  const [unpaid] = await db.select({ s: sql<number>`coalesce(sum(${payoutLine.amountCents}), 0)::bigint`.mapWith(Number) }).from(payoutLine)
    .where(inArray(payoutLine.status, ['awaiting_event', 'ready', 'held', 'released_early', 'in_batch']));
  const [approver] = batchRow?.releasedBy && batchRow.status === 'ready' ? await db.select({ name: user.name }).from(user).where(eq(user.id, batchRow.releasedBy)) : [];
  const history = await listBatches({ limit: 12 });
  const ym = today.slice(0, 7);
  const releasable = !!batchRow && (batchRow.status === 'ready' || batchRow.status === 'scheduled') && at >= sofiaInstant(nb.batchDate, 0, 0);
  return {
    monthTitle: monthLabel(ym), commissionMonth: monthName(Number(ym.slice(5))), prevMonth: monthName(Number(prevYm(ym).slice(5))),
    kpis: k, toPayCents: unpaid?.s ?? 0,
    next: { ...nb, id: batchRow?.id ?? null, status: batchRow?.status ?? 'scheduled', date: fmtDate(nb.batchDate), approvedBy: approver?.name ?? null },
    items, history: history.map(h => ({
      id: h.id, date: dateNumeric(h.batchDate), weekday: weekdayName(new Date(`${h.batchDate}T12:00:00Z`).getUTCDay()), label: h.label, rail: h.railLabel,
      partners: h.partnerCount, netCents: h.netCents, badge: BATCH_BADGE[h.status] ?? BATCH_BADGE.ready, reportable: h.status === 'paid' || h.status === 'partially_failed',
    })),
    accounts: (await pendingAccounts(actor)).map(a => ({ ...a, submitted: fmtDate(sofiaDate(a.submittedAt)) })),
    commissionPct: `${(s['commission.standard_bp'] / 100).toLocaleString('bg-BG', { maximumFractionDigits: 1 })}%`,
    payoutDays: s['payout.days'],
    canRelease: can(actor, 'release_payouts'), releasable, secondAdmin: s['payout.require_second_admin'],
    today,
  };
}

/**
 * Y5 from the payments page: ‹Пусни партидата› / ‹Пусни изплащанията› release the next batch.
 * A batch whose day has come but which T17 has not prepared yet is prepared first (idempotent).
 */
export async function releaseNextBatch(actor: Actor, input: { batchDate: DateStr }): Promise<ReleaseBatchResult> {
  assertCan(actor, 'release_payouts');
  const [b0] = await db.select().from(payoutBatch).where(eq(payoutBatch.batchDate, input.batchDate));
  if (!b0 || b0.status === 'scheduled') await prepareBatch(input.batchDate);
  const [b] = await db.select().from(payoutBatch).where(eq(payoutBatch.batchDate, input.batchDate));
  return releaseBatch(actor, { batchId: b.id });
}

/** /admin/plashtaniya/partidi/[id]: the batch, its items (stored or projected) and each item's lines. */
export async function batchPage(actor: Actor, batchId: string, partnerId?: string | null) {
  assertCan(actor, 'view_finance');
  if (!/^[0-9a-f-]{36}$/.test(batchId)) return null;
  const [batch] = await db.select().from(payoutBatch).where(eq(payoutBatch.id, batchId));
  if (!batch) return null;
  type Line = { number: string; eventDate: DateStr; baseCents: number; commissionCents: number; amountCents: number; status: string; held: boolean };
  let groups: { partnerId: string; partnerName: string; status: string; badge: Badge; amountCents: number; lines: Line[]; holdText: string | null }[] = [];
  const lineBadge = (status: string, held: boolean): string => held ? 'held' : status;
  if (batch.status !== 'scheduled') {
    const det = await batchDetail(batchId);
    groups = det.items.map(it => ({
      partnerId: it.partnerId, partnerName: it.partnerName, status: it.status, badge: ITEM_BADGE[it.status] ?? ITEM_BADGE.ready, amountCents: it.amountCents,
      holdText: it.status === 'held' && it.holdReason ? HOLD_TEXT[it.holdReason] : it.status === 'failed' ? it.failureReason : null,
      lines: it.lines.map(l => ({ number: l.number, eventDate: l.eventDate, baseCents: l.baseCents, commissionCents: l.commissionCents, amountCents: l.amountCents, status: l.status, held: l.status === 'held' })),
    }));
  } else {
    const items = await batchItems(batch.batchDate, null, 'scheduled');
    for (const it of items) {
      const ls = await db.select({ l: payoutLine, number: booking.number, eventDate: booking.eventDate, payoutHold: booking.payoutHold }).from(payoutLine)
        .innerJoin(booking, eq(booking.id, payoutLine.bookingId))
        .where(and(eq(payoutLine.partnerId, it.partnerId), lte(payoutLine.batchDate, batch.batchDate),
          or(inArray(payoutLine.status, ['ready', 'released_early', 'held']), and(eq(payoutLine.status, 'awaiting_event'), lt(booking.eventDate, batch.batchDate))),
          isNull(payoutLine.payoutItemId)));
      groups.push({
        partnerId: it.partnerId, partnerName: it.partnerName, status: it.held ? 'held' : 'ready', badge: it.held ? ITEM_BADGE.held : ITEM_BADGE.ready,
        amountCents: it.amountCents, holdText: it.holdText,
        lines: ls.map(x => ({ number: x.number, eventDate: x.eventDate, baseCents: x.l.baseCents, commissionCents: x.l.commissionCents, amountCents: x.l.amountCents, status: lineBadge(x.l.status, x.payoutHold), held: x.payoutHold })),
      });
    }
  }
  const all = groups;
  const shown = partnerId ? groups.filter(g => g.partnerId === partnerId) : groups;
  const pay = all.filter(g => g.status !== 'held' && g.status !== 'failed');
  const gross = pay.flatMap(g => g.lines).reduce((s, l) => s + l.baseCents, 0);
  const commission = pay.flatMap(g => g.lines).reduce((s, l) => s + l.commissionCents, 0);
  return {
    batch, name: batchName(batch.batchDate), date: fmtDate(batch.batchDate), badge: BATCH_BADGE[batch.status] ?? BATCH_BADGE.ready,
    groups: shown, filtered: !!partnerId && shown.length < all.length, partnerName: partnerId ? shown[0]?.partnerName ?? null : null,
    totals: batch.status === 'scheduled'
      ? { partners: pay.length, grossCents: gross, commissionCents: commission, netCents: pay.reduce((s, g) => s + g.amountCents, 0) }
      : { partners: batch.partnerCount, grossCents: batch.grossCents, commissionCents: batch.commissionCents, netCents: batch.netCents },
  };
}

export const LINE_LABEL: Record<string, string> = {
  awaiting_event: 'Очаква събитие', ready: 'Готово', held: 'Задържано', released_early: 'Готово', in_batch: 'Пусната', paid: 'Изплатено', cancelled: 'Анулирана',
};

// ── Имейли ────────────────────────────────────────────────────────────────

export const AUDIENCE_GROUP: Record<Audience, string> = { client: 'Към клиентите', partner: 'Към партньорите', team: 'Към екипа' };
export const AUDIENCE_WHO: Record<Audience, string> = { client: 'Клиенти', partner: 'Партньори', team: 'Екип' };
export const AUDIENCE_FILTERS: { key: Audience | null; label: string }[] = [
  { key: null, label: 'Всички' }, { key: 'client', label: 'Клиенти' }, { key: 'partner', label: 'Партньори' }, { key: 'team', label: 'Екип' },
];

/** The screen each email is triggered from (prototype emails.js `source`), as a production route; only team screens are linked. */
const SOURCE_ROUTE: Record<string, string> = {
  'admin/bookings.html': '/admin/rezervacii', 'admin/dispute.html': '/admin/sporove', 'admin/disputes.html': '/admin/sporove',
  'admin/client.html': '/admin/klienti', 'admin/vendor.html': '/admin/partnyori', 'admin/vendors.html': '/admin/partnyori',
  'admin/moderation.html': '/admin/moderatsiya', 'admin/payouts.html': '/admin/plashtaniya', 'admin/team.html': '/admin/nastroyki/ekip',
  'admin/dashboard.html': '/admin',
};
const SOURCE: Record<string, [label: string, page: string]> = {
  'client-verify-code': ['Регистрация', 'client/register.html'], 'client-welcome': ['Потвърждение на имейла', 'client/verify.html'],
  'client-password-link': ['Вход и регистрация', 'client/auth.html'], 'client-password-changed': ['Настройки и известия', 'client/settings.html'],
  'client-2fa-on': ['Настройки и известия', 'client/settings.html'], 'client-signout-all': ['Настройки и известия', 'client/settings.html'],
  'client-delete-confirm': ['Настройки и известия', 'client/settings.html'], 'client-request-sent': ['Запитване', 'client/request.html'],
  'client-brief-sent': ['Опишете събитието си', 'client/brief.html'], 'client-offer-received': ['Опишете събитието си', 'client/brief.html'],
  'client-request-approved': ['Моите заявки', 'client/requests.html'], 'client-payment-reminder': ['Моите заявки', 'client/requests.html'],
  'client-payment-expired': ['Моите заявки', 'client/requests.html'], 'client-request-declined': ['Моите заявки', 'client/requests.html'],
  'client-request-expired': ['Моите заявки', 'client/requests.html'], 'client-approval-withdrawn': ['Заявка № 2026-0614-ЕА', 'client/request-status.html'],
  'client-bank-transfer': ['Плащане', 'client/payment.html'], 'client-booking-confirmed': ['Плащане', 'client/payment.html'],
  'client-invoice': ['Фактура', 'client/invoice.html'], 'client-new-message': ['Съобщения', 'client/messages.html'],
  'client-event-reminder': ['Моите резервации', 'client/bookings.html'], 'client-cancel-confirmed': ['Анулиране на резервация', 'client/cancel.html'],
  'client-vendor-cancelled': ['Моите резервации', 'client/bookings.html'], 'client-dispute-opened': ['Сигнал до екипа', 'client/dispute.html'],
  'client-dispute-info-request': ['Кейс', 'admin/dispute.html'], 'client-dispute-decision': ['Кейс', 'admin/dispute.html'],
  'client-review-invite': ['Моите резервации', 'client/bookings.html'], 'client-saved-search-alert': ['Запазени търсения', 'client/saved.html'],
  'client-date-freed': ['Запазени търсения', 'client/saved.html'], 'client-payment-extended': ['Резервации', 'admin/bookings.html'],
  'client-ticket-vendor-opened': ['Сигнал до екипа', 'vendor/dispute.html'], 'client-ticket-reminder': ['Кейс', 'admin/dispute.html'],
  'client-refund-sent': ['Анулиране на резервация', 'client/cancel.html'], 'client-account-blocked': ['Клиент', 'admin/client.html'],
  'client-review-reply': ['Ревюта', 'vendor/reviews.html'],
};

/** The source of an email: the label and, for a team screen, its route. */
export async function emailSource(key: string): Promise<{ label: string; href: string | null } | null> {
  const s = SOURCE[key] ?? PARTNER_TEAM_SOURCE[key];
  if (!s) return null;
  return { label: s[0], href: SOURCE_ROUTE[s[1]] ?? null };
}
const PARTNER_TEAM_SOURCE: Record<string, [string, string]> = {
  'vendor-verify-code': ['Регистрация', 'client/register.html'], 'vendor-welcome': ['Потвърждение на имейла', 'client/verify.html'],
  'vendor-application-received': ['Преглед и подаване', 'onboarding/review.html'], 'vendor-application-approved': ['Профил на изпълнител', 'admin/vendor.html'],
  'vendor-application-returned': ['Профил на изпълнител', 'admin/vendor.html'], 'vendor-application-rejected': ['Профил на изпълнител', 'admin/vendor.html'],
  'vendor-service-submitted': ['Нова услуга', 'vendor/service-new.html'], 'vendor-service-published': ['Модерация', 'admin/moderation.html'],
  'vendor-service-returned': ['Модерация', 'admin/moderation.html'], 'vendor-service-change-submitted': ['Редактиране на услуга', 'vendor/service-edit.html'],
  'vendor-service-change-approved': ['Модерация', 'admin/moderation.html'], 'vendor-new-request': ['Запитване', 'client/request.html'],
  'vendor-new-inquiry': ['Опишете събитието си', 'client/brief.html'], 'vendor-request-reminder': ['Заявки', 'vendor/requests.html'],
  'vendor-request-approved': ['Заявка — нова', 'vendor/request.html'], 'vendor-payment-reminder': ['Заявка — одобрена', 'vendor/request-approved.html'],
  'vendor-payment-deadline-extended': ['Резервации', 'admin/bookings.html'], 'vendor-hold-expired': ['Заявка — одобрена', 'vendor/request-approved.html'],
  'vendor-booking-confirmed': ['Плащане', 'client/payment.html'], 'vendor-event-reminder': ['Резервация', 'vendor/booking.html'],
  'vendor-client-cancelled': ['Анулиране на резервация', 'client/cancel.html'], 'vendor-cancel-requested': ['Резервация', 'vendor/booking.html'],
  'vendor-cancel-completed': ['Резервация', 'vendor/booking.html'], 'vendor-payout-sent': ['Плащания', 'admin/payouts.html'],
  'vendor-payout-account-submitted': ['Сметка за изплащане', 'vendor/payout-account.html'], 'vendor-payout-account-confirmed': ['Плащания', 'admin/payouts.html'],
  'vendor-ticket-received': ['Сигнал до екипа', 'vendor/dispute.html'], 'vendor-ticket-client-opened': ['Сигнал до екипа', 'client/dispute.html'],
  'vendor-ticket-reminder': ['Кейс', 'admin/dispute.html'], 'vendor-ticket-decision': ['Кейс', 'admin/dispute.html'],
  'vendor-new-review': ['Остави ревю', 'client/review.html'], 'vendor-new-message': ['Съобщения', 'client/messages.html'],
  'vendor-report-ready': ['Приходи', 'vendor/earnings.html'], 'vendor-password-reset': ['Настройки', 'vendor/settings.html'],
  'vendor-deactivated': ['Настройки', 'vendor/settings.html'], 'vendor-delete-confirm': ['Настройки', 'vendor/settings.html'],
  'vendor-invite': ['Изпълнители', 'admin/vendors.html'], 'vendor-offer-chosen': ['Моите заявки', 'client/requests.html'],
  'vendor-offer-not-chosen': ['Моите заявки', 'client/requests.html'], 'vendor-request-expired': ['Заявка — нова', 'vendor/request.html'],
  'vendor-ticket-info-request': ['Кейс', 'admin/dispute.html'], 'vendor-service-change-returned': ['Модерация', 'admin/moderation.html'],
  'team-invite': ['Екип', 'admin/team.html'], 'team-vendor-application': ['Преглед и подаване', 'onboarding/review.html'],
  'team-dispute-new': ['Сигнал до екипа', 'client/dispute.html'], 'team-dispute-reply': ['Сигнал до екипа', 'vendor/dispute.html'],
  'team-dispute-deadline': ['Спорове', 'admin/disputes.html'], 'team-payment-deadline': ['Спорове', 'admin/disputes.html'],
  'team-vendor-cancel': ['Резервация', 'vendor/booking.html'], 'team-payout-account': ['Сметка за изплащане', 'vendor/payout-account.html'],
  'team-daily-digest': ['Табло', 'admin/dashboard.html'], 'team-batch-ready': ['Плащания', 'admin/payouts.html'],
  'team-batch-paid': ['Плащания', 'admin/payouts.html'], 'team-batch-report': ['Плащания', 'admin/payouts.html'],
  'team-transfer-failed': ['Плащания', 'admin/payouts.html'],
};

/** Админ → Имейли: the catalogue grouped by audience with each key's sends from email_outbox. */
export async function emailCatalogue(p: { audience?: string | null; q?: string | null }) {
  const audience = (['client', 'partner', 'team'] as const).find(a => a === p.audience) ?? null;
  const q = p.q?.trim().toLocaleLowerCase('bg') ?? '';
  const stats = await db.select({ key: emailOutbox.templateKey, n: count(), last: sql<Date | null>`max(coalesce(${emailOutbox.sentAt}, ${emailOutbox.createdAt}))` })
    .from(emailOutbox).where(inArray(emailOutbox.status, ['sent', 'queued'])).groupBy(emailOutbox.templateKey);
  const byKey = new Map(stats.map(s => [s.key, { n: Number(s.n), last: s.last ? new Date(s.last) : null }]));
  const totals = { client: 0, partner: 0, team: 0 } as Record<Audience, number>;
  for (const e of CATALOGUE) totals[e.audience]++;
  const rows = CATALOGUE
    .filter(e => !audience || e.audience === audience)
    .filter(e => !q || `${e.trigger} ${e.subject} ${e.when} ${e.key}`.toLocaleLowerCase('bg').includes(q))
    .map(e => ({ ...e, sent: byKey.get(e.key)?.n ?? 0, lastSent: byKey.get(e.key)?.last ?? null }));
  const groups = (['client', 'partner', 'team'] as const).map(a => ({ audience: a, title: AUDIENCE_GROUP[a], rows: rows.filter(r => r.audience === a) })).filter(g => g.rows.length);
  return { audience, q: p.q?.trim() ?? '', groups, count: rows.length, total: CATALOGUE.length, totals };
}

export const OUTBOX_STATUS: Record<string, Badge> = {
  sent: { cls: 'badge--success badge--dot', label: 'Изпратен' },
  queued: { cls: 'badge--warning badge--dot', label: 'В опашка' },
  failed: { cls: 'badge--danger badge--dot', label: 'Неуспешен' },
  suppressed: { cls: 'badge--dot', label: 'Изключен' },
};

/** The real outbox, newest first: what went out (filter by audience, template, search). */
export async function outboxList(p: { audience?: string | null; key?: string | null; q?: string | null; limit?: number }) {
  const conds: SQL[] = [];
  const audience = (['client', 'partner', 'team'] as const).find(a => a === p.audience);
  if (audience) conds.push(eq(emailOutbox.audience, audience));
  if (p.key && TEMPLATES[p.key]) conds.push(eq(emailOutbox.templateKey, p.key));
  const q = p.q?.trim();
  if (q) conds.push(or(ilike(emailOutbox.toEmail, `%${q}%`), ilike(emailOutbox.subject, `%${q}%`), ilike(emailOutbox.templateKey, `%${q}%`))!);
  const where = conds.length ? and(...conds) : undefined;
  const [{ n }] = await db.select({ n: count() }).from(emailOutbox).where(where);
  const rows = await db.select({
    id: emailOutbox.id, key: emailOutbox.templateKey, to: emailOutbox.toEmail, subject: emailOutbox.subject, status: emailOutbox.status,
    createdAt: emailOutbox.createdAt, sentAt: emailOutbox.sentAt, audience: emailOutbox.audience,
  }).from(emailOutbox).where(where).orderBy(desc(emailOutbox.createdAt)).limit(p.limit ?? 50);
  const at = await now();
  const today = sofiaDate(at);
  return {
    total: Number(n),
    rows: rows.map(r => ({
      ...r, trigger: CATALOGUE.find(c => c.key === r.key)?.trigger ?? r.key, badge: OUTBOX_STATUS[r.status] ?? OUTBOX_STATUS.queued,
      when: stamp(r.sentAt ?? r.createdAt, today),
    })),
  };
}

/** Sends of one template: count and the last one. */
export async function templateStats(key: string) {
  const [s] = await db.select({ n: count(), last: sql<Date | null>`max(coalesce(${emailOutbox.sentAt}, ${emailOutbox.createdAt}))` })
    .from(emailOutbox).where(and(eq(emailOutbox.templateKey, key), inArray(emailOutbox.status, ['sent', 'queued'])));
  return { sent: Number(s?.n ?? 0), last: s?.last ? new Date(s.last) : null };
}

/** The email preview (/admin/imeyli/[key]/preview): a template with its sample, or a real outbox message. */
export async function emailPreview(key: string, outboxId?: string | null): Promise<
  | { kind: 'sample'; content: EmailContent; audience: Audience; optional: boolean; to: string }
  | { kind: 'sent'; subject: string; to: string; html: string; audience: Audience; status: string; at: Date }
  | null
> {
  const t = TEMPLATES[key];
  if (!t) return null;
  if (outboxId) {
    if (!/^[0-9a-f-]{36}$/.test(outboxId)) return null;
    const [m] = await db.select().from(emailOutbox).where(and(eq(emailOutbox.id, outboxId), eq(emailOutbox.templateKey, key)));
    if (!m) return null;
    return { kind: 'sent', subject: m.subject, to: m.toEmail, html: m.html, audience: m.audience as Audience, status: m.status, at: m.sentAt ?? m.createdAt };
  }
  const SAMPLE_TO: Record<Audience, string> = { client: 'maria.dimitrova@gmail.com', partner: 'studio.melodia@gmail.com', team: 'monika.kovacheva@eventat.bg' };
  return { kind: 'sample', content: t.render(SAMPLES[key]), audience: t.audience, optional: t.optional, to: SAMPLE_TO[t.audience] };
}

