// Bookings (SPEC §4.7): created when a request is approved (K1), they carry
// the money. This module owns the booking side of the lifecycle up to
// `confirmed`, `payment_expired`, `approval_withdrawn` and `completed`:
//   K1 createBookingFromRequest (called by requests.approve)
//   K2 remindClient · K3 extendPaymentDeadline · K4 withdrawApproval
//   T5–T8 payment-window timers · T11/T12 event reminders · T13 completion · T14 review invite
// and the helpers other modules build on (cancellation, disputes, payouts):
//   loadBooking (booking + request + parties + charges), the date hold rules
//   (checkPartnerDate, notifyDateWatchers), releaseToPartner (ledger L3) and
//   the payout-line helpers. K5 (confirmation on payment) lives in charges.ts.
//
// Every state transition runs in one DB transaction that also writes
// audit_log, queues the emails (sendEmail(…, tx)), adds the bell items
// (SPEC §4 bell rule) and schedules or cancels the jobs.
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  auditLog, availabilityBlock, availabilityOpenDate, booking, category, charge, city, clientEvent, conversation, dispute, eventType,
  invoice, partner, partnerMember, paymentExtension, payoutLine, refund, request, review, service, serviceInclusion, teamMember, user,
  type BookingStatus,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { sendEmail } from '@/lib/email/send';
import { TEMPLATES } from '@/lib/email/templates';
import { addDays, date, dateTime, daysBetween, money, sofiaDate, sofiaInstant, weekdayName, type DateStr } from '@/lib/format';
import { cancelJobs, scheduleJob } from '@/lib/jobs';
import { notify } from '@/lib/notify';
import { ForbiddenError, SYSTEM, assertCan, can, isSystem, teamRolesWith, type Actor, type AnyActor } from './actor';
import { audit } from './audit';
import { bookingSplit, split, type Split } from './commission';
import { accountBalance, bookingBalances, postTransaction, type LedgerLine } from './ledger';
import { getSettings, type Settings } from './settings';
import { notifyDateFreed } from './saved';

// ── Types, errors, transactions ──────────────────────────────────────────

export type BookingRow = typeof booking.$inferSelect;
export type RequestRow = typeof request.$inferSelect;
export type PartnerRow = typeof partner.$inferSelect;
export type ChargeRow = typeof charge.$inferSelect;
export type ServiceRow = typeof service.$inferSelect;
export type ClientEventRow = typeof clientEvent.$inferSelect;

export type LifecycleErrorCode =
  | 'not_found' | 'invalid_state' | 'date_unavailable' | 'deadline_passed' | 'validation' | 'duplicate' | 'provider_not_ready' | 'not_allowed';

/** A business-rule refusal. Server actions turn `code` into the screen's message. */
export class LifecycleError extends Error {
  constructor(public code: LifecycleErrorCode, message: string) { super(message); this.name = 'LifecycleError'; }
}

/** Run `fn` in the caller's transaction, or in a new one. */
export function withTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.transaction(fn);
}

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

/** Booking states that occupy the partner's date (SPEC §12.6 Capacity; §4.13 held + booked). */
export const HOLDING_STATUSES = ['awaiting_payment', 'confirmed', 'cancellation_requested'] as const satisfies readonly BookingStatus[];
/** States in which the partner sees the client's phone (SPEC §10 Phone rule). */
export const PHONE_VISIBLE_STATUSES = ['confirmed', 'cancellation_requested', 'completed'] as const satisfies readonly BookingStatus[];
/** Open dispute states (SPEC §4.11). */
export const OPEN_DISPUTE_STATUSES = ['collecting', 'awaiting_decision'] as const;

export function assertPartnerActor(actor: AnyActor): asserts actor is Actor & { partnerId: string } {
  if (isSystem(actor) || actor.role !== 'partner' || !actor.partnerId) throw new ForbiddenError('partner');
}
export function assertClientActor(actor: AnyActor): asserts actor is Actor {
  if (isSystem(actor) || actor.role !== 'client') throw new ForbiddenError('client');
}
export function assertTeamActor(actor: AnyActor): asserts actor is Actor {
  if (isSystem(actor) || actor.role !== 'admin' || !actor.teamRole) throw new ForbiddenError('team');
}

// ── Display helpers (values passed to the email templates, pre-formatted) ─

/** E.164 → ‹+359 88 412 7730› (DATA-MODEL user.phone). Other numbers are returned as stored. */
export function phoneDisplay(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+359(\d{2})(\d{3})(\d{4})$/.exec(e164.replace(/\s+/g, ''));
  return m ? `+359 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** A `time` column ('17:00:00') → '17:00'; missing → '—'. */
export const hm = (t: string | null | undefined) => (t ? t.slice(0, 5) : '—');

/** '17:00 – 02:00' (approx: '17:00 – около 02:00', the request form's ‹Край (ориентировъчно)›). */
export function timeRange(start: string | null, end: string | null, approx = false): string {
  if (!start) return '—';
  return end ? `${hm(start)} – ${approx ? 'около ' : ''}${hm(end)}` : hm(start);
}

/** ‹Вила Екатерина, с. Панчарево›, else the city, else ‹—›. */
export function locationOf(r: { venueName?: string | null; locality?: string | null }, cityName?: string | null): string {
  const parts = [r.venueName, r.locality].filter((x): x is string => !!x && !!x.trim());
  return parts.length ? parts.join(', ') : cityName ?? '—';
}

/**
 * The partner templates print ‹Пакет „{packageName}“›, so they take the inner name:
 * ‹Пакет „Цял ден“› → ‹Цял ден›. Other service names are passed as they are.
 */
export function packageNameOf(serviceTitle: string): string {
  const m = /^Пакет\s+„(.+)“$/.exec(serviceTitle.trim());
  return m ? m[1] : serviceTitle;
}

/** 'visa' / '4242' → ‹Visa •••• 4242› (client-booking-confirmed, client-invoice, invoice payment note). */
export function cardLabel(brand: string | null | undefined, last4: string | null | undefined): string {
  if (!last4) return '';
  const b = brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : '';
  return `${b ? `${b} ` : ''}•••• ${last4}`;
}

/** The event start instant (SPEC §3): Sofia wall time on the event date, 00:00 when no start time. */
export function eventStartInstant(eventDate: DateStr, startTime: string | null): Date {
  const [hh, mm] = (startTime ?? '00:00').split(':').map(Number);
  return sofiaInstant(eventDate, hh || 0, mm || 0);
}

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// ── Parties: who an email goes to and what it names ───────────────────────

export type Parties = {
  client: { id: string; name: string; email: string; phone: string | null; banned: boolean; emailVerified: boolean };
  partner: PartnerRow;
  /** The partner's owner user (partner_member), the recipient of partner emails and bell items. */
  partnerUserId: string | null;
  /** The partner's primary category name (‹DJ и озвучаване›). */
  partnerCategory: string;
  eventType: { id: string; slug: string; name: string; nameDefinite: string };
  cityName: string | null;
};

export async function loadParties(q: Queryable, a: { clientId: string; partnerId: string; eventTypeId: string; cityId?: string | null }): Promise<Parties> {
  const [c] = await q.select({ id: user.id, name: user.name, email: user.email, phone: user.phone, banned: user.banned, emailVerified: user.emailVerified })
    .from(user).where(eq(user.id, a.clientId)).limit(1);
  const [p] = await q.select().from(partner).where(eq(partner.id, a.partnerId)).limit(1);
  if (!c || !p) throw new LifecycleError('not_found', 'client or partner missing');
  const [m] = await q.select({ userId: partnerMember.userId }).from(partnerMember)
    .where(eq(partnerMember.partnerId, p.id)).orderBy(asc(partnerMember.createdAt)).limit(1);
  const [cat] = p.primaryCategoryId ? await q.select({ name: category.name }).from(category).where(eq(category.id, p.primaryCategoryId)).limit(1) : [];
  const [et] = await q.select({ id: eventType.id, slug: eventType.slug, name: eventType.name, nameDefinite: eventType.nameDefinite })
    .from(eventType).where(eq(eventType.id, a.eventTypeId)).limit(1);
  const [ct] = a.cityId ? await q.select({ name: city.name }).from(city).where(eq(city.id, a.cityId)).limit(1) : [];
  return {
    client: c, partner: p, partnerUserId: m?.userId ?? null, partnerCategory: cat?.name ?? '',
    eventType: et ?? { id: a.eventTypeId, slug: '', name: '', nameDefinite: '' }, cityName: ct?.name ?? null,
  };
}

/** `hosts` for partner emails: the client event's hosts (‹Мария и Стефан›), else the client's name. */
export async function hostsOf(q: Queryable, clientEventId: string, fallback: string): Promise<string> {
  const [e] = await q.select({ hosts: clientEvent.hosts }).from(clientEvent).where(eq(clientEvent.id, clientEventId)).limit(1);
  return e?.hosts?.trim() || fallback;
}

// ── Email + bell (SPEC §4 bell rule, D54) ─────────────────────────────────

export type MailArgs = {
  key: string;
  to: string;
  toUserId?: string | null;
  vars: Record<string, unknown>;
  dedupeKey?: string;
  /** Bell override (the prototype's notice pattern). Default: the email's heading / preheader / CTA. `false` = no bell. */
  bell?: { title?: string; body?: string; href?: string } | false;
};

/**
 * Queue an email in the caller's transaction and add the bell item for a client
 * or partner recipient. The bell is added even when the recipient switched the
 * optional email off (SPEC §4); a deduplicated (already sent) email adds nothing.
 */
export async function mail(tx: Tx, a: MailArgs): Promise<boolean> {
  const id = await sendEmail({ key: a.key, to: a.to, toUserId: a.toUserId ?? null, vars: a.vars, dedupeKey: a.dedupeKey }, tx);
  if (!id) return false;
  const tpl = TEMPLATES[a.key];
  if (a.bell !== false && a.toUserId && tpl.audience !== 'team') {
    const c = tpl.render(a.vars);
    await notify(a.toUserId, {
      kind: a.key, title: a.bell?.title ?? c.heading, body: a.bell?.body ?? c.preheader, href: a.bell?.href ?? c.cta?.href,
    }, tx);
  }
  return true;
}

/** Active team members holding a permission (SPEC §11.5 team recipients). */
export async function teamRecipients(q: Queryable, permission: Parameters<typeof teamRolesWith>[0]) {
  return q.select({ id: user.id, email: user.email, name: user.name }).from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(eq(teamMember.status, 'active'), inArray(teamMember.role, teamRolesWith(permission))));
}

// ── Jobs (SPEC §3) ────────────────────────────────────────────────────────

/** Job kinds handled in lib/jobs/handlers-lifecycle.ts. */
export const LIFECYCLE_JOBS = {
  requestReminder: 'request.reminder',            // T1
  requestExpire: 'request.expire',                // T2, T4
  clientPayReminder: 'booking.client_pay_reminder', // T5
  partnerPayReminder: 'booking.partner_pay_reminder', // T6
  teamPaymentAlert: 'booking.team_payment_alert', // T7
  paymentExpire: 'booking.payment_expire',        // T8
  balanceCharge: 'booking.balance_charge',        // T9
  balanceDefault: 'booking.balance_default',      // T10
  clientEventReminder: 'event.client_reminder',   // T11
  partnerEventReminder: 'booking.partner_event_reminder', // T12
  complete: 'booking.complete',                   // T13
  reviewInvite: 'booking.review_invite',          // T14
  holdLimit: 'charge.hold_limit',                 // T18
  offerLapse: 'request.offer_lapse',              // R10 (O5: the event date passed)
} as const;

/** Dedupe keys. Re-scheduling a key moves its job, even while that job runs. */
export const jobKey = {
  requestReminder: (id: string) => `request:${id}:reminder`,
  requestExpire: (id: string) => `request:${id}:expire`,
  offerLapse: (id: string) => `request:${id}:offerlapse`,
  payReminder: (id: string, h: number) => `booking:${id}:payrem:${h}`,
  partnerPayReminder: (id: string) => `booking:${id}:vpayrem`,
  teamAlert: (id: string) => `booking:${id}:teamalert`,
  paymentExpire: (id: string) => `booking:${id}:payexpire`,
  balanceCharge: (id: string) => `booking:${id}:balance`,
  balanceRetry: (id: string, n: number) => `booking:${id}:balanceretry:${n}`,
  balanceDefault: (id: string) => `booking:${id}:balancedefault`,
  clientEventReminder: (eventId: string, d: number) => `event:${eventId}:remind:${d}`,
  partnerEventReminder: (id: string, d: number) => `booking:${id}:vremind:${d}`,
  complete: (id: string) => `booking:${id}:complete`,
  reviewInvite: (id: string) => `booking:${id}:reviewinvite`,
  holdLimit: (chargeId: string) => `charge:${chargeId}:holdlimit`,
};

/** Schedule only when the moment is still ahead (a "6 hours left" reminder at 1 hour left would be wrong). */
async function scheduleAhead(tx: Tx, kind: string, at: Date, nowAt: Date, payload: Record<string, unknown>, key: string) {
  if (at.getTime() > nowAt.getTime()) await scheduleJob(kind, at, payload, key, tx);
}

/** T5–T8 for an awaiting-payment booking (K1, and again after K3 moves the deadline). */
export async function schedulePaymentJobs(tx: Tx, b: Pick<BookingRow, 'id' | 'paymentDueAt'>, s: Settings, nowAt: Date) {
  const due = b.paymentDueAt.getTime();
  for (const h of s['payment.client_reminders_before_h']) {
    await scheduleAhead(tx, LIFECYCLE_JOBS.clientPayReminder, new Date(due - h * HOUR), nowAt, { bookingId: b.id, hours: h }, jobKey.payReminder(b.id, h));
  }
  await scheduleAhead(tx, LIFECYCLE_JOBS.partnerPayReminder, new Date(due - s['payment.partner_reminder_before_h'] * HOUR), nowAt,
    { bookingId: b.id, hours: s['payment.partner_reminder_before_h'] }, jobKey.partnerPayReminder(b.id));
  await scheduleAhead(tx, LIFECYCLE_JOBS.teamPaymentAlert, new Date(due - s['payment.team_alert_before_h'] * HOUR), nowAt,
    { bookingId: b.id, hours: s['payment.team_alert_before_h'] }, jobKey.teamAlert(b.id));
  await scheduleJob(LIFECYCLE_JOBS.paymentExpire, b.paymentDueAt, { bookingId: b.id }, jobKey.paymentExpire(b.id), tx);
}

/** Cancel T5–T7 (and T8 unless `keepExpiry`, which the T8 handler itself passes). */
export async function cancelPaymentJobs(tx: Tx, bookingId: string, o: { keepExpiry?: boolean } = {}) {
  await cancelJobs(`booking:${bookingId}:payrem:`, tx);
  await cancelJobs(jobKey.partnerPayReminder(bookingId), tx);
  await cancelJobs(jobKey.teamAlert(bookingId), tx);
  if (!o.keepExpiry) await cancelJobs(jobKey.paymentExpire(bookingId), tx);
}

/** Every pending job of a booking (cancellation, withdrawal). Not for use inside that booking's own job handlers. */
export async function cancelBookingJobs(tx: Tx, bookingId: string) {
  await cancelJobs(`booking:${bookingId}:`, tx);
}

/**
 * Jobs of a confirmed booking (K5): T11 client event reminders, T12 partner
 * reminder, T13 completion, T14 review invite. T9 and T18 are scheduled by charges.ts.
 */
export async function scheduleConfirmedJobs(tx: Tx, b: BookingRow, s: Settings, nowAt: Date) {
  const [ev] = await tx.select({ id: clientEvent.id, date: clientEvent.date }).from(clientEvent).where(eq(clientEvent.id, b.clientEventId)).limit(1);
  const [sendH, sendM] = s['reminders.send_time'].split(':').map(Number);
  const eventDate = ev?.date ?? b.eventDate;
  for (const d of s['reminders.client_event_days']) {
    await scheduleAhead(tx, LIFECYCLE_JOBS.clientEventReminder, sofiaInstant(addDays(eventDate, -d), sendH, sendM), nowAt,
      { clientEventId: b.clientEventId, days: d }, jobKey.clientEventReminder(b.clientEventId, d));
  }
  for (const d of s['reminders.partner_event_days']) {
    await scheduleAhead(tx, LIFECYCLE_JOBS.partnerEventReminder, sofiaInstant(addDays(b.eventDate, -d), sendH, sendM), nowAt,
      { bookingId: b.id, days: d }, jobKey.partnerEventReminder(b.id, d));
  }
  await scheduleJob(LIFECYCLE_JOBS.complete, completionInstant(b.eventDate), { bookingId: b.id }, jobKey.complete(b.id), tx);
  const [ih, im] = s['reviews.invite_time'].split(':').map(Number);
  await scheduleJob(LIFECYCLE_JOBS.reviewInvite, sofiaInstant(addDays(b.eventDate, s['reviews.invite_days_after']), ih, im),
    { bookingId: b.id }, jobKey.reviewInvite(b.id), tx);
}

/** T13 fires at 00:00 Sofia on the day after the event. */
export const completionInstant = (eventDate: DateStr) => sofiaInstant(addDays(eventDate, 1), 0, 0);

// ── Availability (SPEC §12.6, §4.13) ──────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

/** '2025-08-31' + 24 months → '2027-08-31' (day clamped to the month's length). */
export function addMonths(d: DateStr, n: number): DateStr {
  const [y, m, day] = d.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${pad2(nm)}-${pad2(Math.min(day, last))}`;
}

/** ISO weekday 1 (Monday) – 7 (Sunday) of a calendar date. */
export function isoWeekday(d: DateStr): number {
  const [y, m, day] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

export type DateProblem = 'past' | 'lead_time' | 'horizon' | 'non_working_day' | 'blocked' | 'not_open' | 'full';
export type PartnerDateCheck = { requestable: boolean; problems: DateProblem[]; occupied: number; capacity: number };
type PartnerAvailability = Pick<PartnerRow,
  'id' | 'leadTimeDays' | 'horizonMonths' | 'workingDays' | 'onlySelectedDates' | 'bookingsPerDayMode' | 'maxBookingsPerDate'>;

/** Capacity per date: ‹Една на ден› 1, ‹Лимит на ден› N, ‹Без лимит› ∞. */
export function dateCapacity(p: Pick<PartnerRow, 'bookingsPerDayMode' | 'maxBookingsPerDate'>): number {
  return p.bookingsPerDayMode === 'one' ? 1 : p.bookingsPerDayMode === 'limit' ? p.maxBookingsPerDate : Number.POSITIVE_INFINITY;
}

/**
 * Is date `d` requestable for the partner (SPEC §12.6)? `window: false` skips
 * the lead-time and horizon checks (used at approval, where only the date's
 * occupancy matters: blocks, working days, selected dates and capacity).
 */
export async function checkPartnerDate(
  q: Queryable, p: PartnerAvailability, d: DateStr, o: { today: DateStr; window?: boolean; excludeBookingId?: string },
): Promise<PartnerDateCheck> {
  const problems: DateProblem[] = [];
  if (d < o.today) problems.push('past');
  if (o.window !== false) {
    if (daysBetween(o.today, d) < p.leadTimeDays) problems.push('lead_time');
    if (d > addMonths(o.today, p.horizonMonths)) problems.push('horizon');
  }
  if (!p.workingDays.includes(isoWeekday(d))) problems.push('non_working_day');
  const [blk] = await q.select({ id: availabilityBlock.id }).from(availabilityBlock)
    .where(and(eq(availabilityBlock.partnerId, p.id), lte(availabilityBlock.startDate, d), gte(availabilityBlock.endDate, d))).limit(1);
  if (blk) problems.push('blocked');
  if (p.onlySelectedDates) {
    const [open] = await q.select({ d: availabilityOpenDate.date }).from(availabilityOpenDate)
      .where(and(eq(availabilityOpenDate.partnerId, p.id), eq(availabilityOpenDate.date, d))).limit(1);
    if (!open) problems.push('not_open');
  }
  const conds = [eq(booking.partnerId, p.id), eq(booking.eventDate, d), inArray(booking.status, [...HOLDING_STATUSES])];
  if (o.excludeBookingId) conds.push(ne(booking.id, o.excludeBookingId));
  const [{ n }] = await q.select({ n: count() }).from(booking).where(and(...conds));
  const capacity = dateCapacity(p);
  if (Number(n) >= capacity) problems.push('full');
  return { requestable: problems.length === 0, problems, occupied: Number(n), capacity };
}

/**
 * The partner's date stopped being held or booked (K4, K6, K7, K9, K11, a
 * block removed): when it is requestable again, every `watching` date watch
 * for it → `notified` and `client-date-freed` goes out at once (SPEC §4.14, D21).
 */
export async function notifyDateWatchers(tx: Tx, a: { partnerId: string; date: DateStr }): Promise<number> {
  return notifyDateFreed(a.partnerId, a.date, tx);
}

// ── Plans and dates derived from settings ────────────────────────────────

export type PaymentPlan = {
  mode: 'full' | 'deposit_balance'; dueNowCents: number; depositPayCents: number | null; balanceCents: number; balanceDueDate: DateStr | null;
};

/**
 * SPEC §7.2. `full`: the whole amount now. `deposit_balance`: the whole amount
 * when the event is within `balance_due_days` of the approval date; otherwise a
 * deposit now (⚙ deposit_percent, else the booking's policy deposit %) and the
 * balance charged `balance_due_days` before the event.
 */
export function paymentPlan(
  totalCents: number, eventDate: DateStr, approvalDate: DateStr, schedule: Settings['payment.schedule'], bookingDepositPercent: number,
): PaymentPlan {
  if (schedule.mode === 'full') return { mode: 'full', dueNowCents: totalCents, depositPayCents: null, balanceCents: 0, balanceDueDate: null };
  if (daysBetween(approvalDate, eventDate) <= schedule.balance_due_days) {
    return { mode: 'deposit_balance', dueNowCents: totalCents, depositPayCents: null, balanceCents: 0, balanceDueDate: null };
  }
  const p = schedule.deposit_percent ?? bookingDepositPercent;
  const deposit = Math.floor((totalCents * p + 50) / 100);
  return {
    mode: 'deposit_balance', dueNowCents: deposit, depositPayCents: deposit, balanceCents: totalCents - deposit,
    balanceDueDate: addDays(eventDate, -schedule.balance_due_days),
  };
}

/** The last free-cancellation date (SPEC §5.5): the first tier that retains nothing; null for Строга. */
export function freeCancelUntil(policyName: PartnerRow['cancellationPolicy'], policies: Settings['cancellation.policies'], eventDate: DateStr): DateStr | null {
  if (!policyName) return null;
  const tier = policies[policyName].tiers.find(t => t.retained === 'none');
  return tier ? addDays(eventDate, -tier.minDaysBefore) : null;
}

/** First payout day d ∈ ⚙ payout.days with d ≥ `from` (SPEC §8 Batch date). */
export function firstPayoutDay(from: DateStr, days: number[]): DateStr {
  let d = from;
  for (let i = 0; i < 400; i++) {
    if (days.includes(Number(d.slice(8, 10)))) return d;
    d = addDays(d, 1);
  }
  throw new Error(`No payout day after ${from} in ${days.join(',')}`);
}

// ── K1: booking on approval ──────────────────────────────────────────────

/**
 * K1 (from R3 / R6): the booking for an approved request, with every snapshot
 * of SPEC §4.7 (policy, deposit %, payment plan §7.2, payment_due_at §3 clamp,
 * hold_until / batch_date §8). The commission is snapshotted later, at payment (§6).
 */
export async function createBookingFromRequest(
  tx: Tx, a: { request: RequestRow; partner: PartnerRow; amountCents: number; at: Date; settings: Settings },
): Promise<BookingRow> {
  const { request: r, partner: p, settings: s, at } = a;
  if (!p.cancellationPolicy) throw new LifecycleError('invalid_state', 'The partner has no cancellation policy');
  const windowEnd = at.getTime() + s['payment.window_hours'] * HOUR;
  const paymentDueAt = new Date(Math.min(windowEnd, eventStartInstant(r.eventDate, r.startTime).getTime())); // §3 clamp
  if (paymentDueAt.getTime() <= at.getTime()) throw new LifecycleError('deadline_passed', 'The event has already started');
  const plan = paymentPlan(a.amountCents, r.eventDate, sofiaDate(at), s['payment.schedule'], p.depositPercent);
  const holdUntil = addDays(r.eventDate, s['payout.hold_days_after_event']);
  const inclusions = r.serviceId
    ? (await tx.select({ text: serviceInclusion.text }).from(serviceInclusion).where(eq(serviceInclusion.serviceId, r.serviceId))
      .orderBy(asc(serviceInclusion.position))).map(i => i.text)
    : [];
  const [b] = await tx.insert(booking).values({
    number: r.number, requestId: r.id, clientId: r.clientId, partnerId: r.partnerId, serviceId: r.serviceId, clientEventId: r.clientEventId,
    eventTypeId: r.eventTypeId, eventDate: r.eventDate, startTime: r.startTime, endTime: r.endTime, guests: r.guests,
    venueName: r.venueName, locality: r.locality, cityId: r.cityId, serviceTitle: r.serviceTitle, serviceSummary: r.serviceSummary,
    inclusions, status: 'awaiting_payment', amountCents: a.amountCents, bookingFeeCents: 0,
    paymentMode: plan.mode, dueNowCents: plan.dueNowCents, depositPayCents: plan.depositPayCents, balanceCents: plan.balanceCents,
    balanceDueDate: plan.balanceDueDate, approvedAt: at, paymentDueAt,
    cancellationPolicy: p.cancellationPolicy, depositPercent: p.depositPercent,
    freeCancelUntil: freeCancelUntil(p.cancellationPolicy, s['cancellation.policies'], r.eventDate),
    contactPhone: r.contactPhone, holdUntil, batchDate: firstPayoutDay(holdUntil, s['payout.days']),
    createdAt: at, updatedAt: at,
  }).returning();
  return b;
}

// ── Loading ──────────────────────────────────────────────────────────────

export type BookingWithSnapshots = {
  booking: BookingRow;
  request: RequestRow;
  parties: Parties;
  service: ServiceRow | null;
  clientEvent: ClientEventRow;
  charges: ChargeRow[];
};

/**
 * A booking with its request, both parties, the service, the client event and
 * its charges (newest first). `forUpdate` locks the booking row for the
 * transaction. For the cancellation, dispute and payout modules.
 */
export async function loadBooking(q: Queryable, ref: { id?: string; number?: string }, o: { forUpdate?: boolean } = {}): Promise<BookingWithSnapshots | null> {
  if (!ref.id && !ref.number) return null;
  const where = ref.id ? eq(booking.id, ref.id) : eq(booking.number, ref.number!);
  const base = q.select().from(booking).where(where).limit(1);
  const [b] = o.forUpdate ? await base.for('update') : await base;
  if (!b) return null;
  const [r] = await q.select().from(request).where(eq(request.id, b.requestId)).limit(1);
  const parties = await loadParties(q, { clientId: b.clientId, partnerId: b.partnerId, eventTypeId: b.eventTypeId, cityId: b.cityId });
  const [svc] = b.serviceId ? await q.select().from(service).where(eq(service.id, b.serviceId)).limit(1) : [];
  const [ev] = await q.select().from(clientEvent).where(eq(clientEvent.id, b.clientEventId)).limit(1);
  const charges = await q.select().from(charge).where(eq(charge.bookingId, b.id)).orderBy(desc(charge.createdAt));
  return { booking: b, request: r, parties, service: svc ?? null, clientEvent: ev, charges };
}

/** Load by number for an actor: a client or partner only reaches their own (otherwise not_found). */
async function bookingFor(tx: Tx, actor: AnyActor, number: string, side: 'client' | 'partner' | 'team', forUpdate = true): Promise<BookingWithSnapshots> {
  if (side === 'client') assertClientActor(actor);
  else if (side === 'partner') assertPartnerActor(actor);
  else assertTeamActor(actor);
  const bw = await loadBooking(tx, { number }, { forUpdate });
  if (!bw) throw new LifecycleError('not_found', `No booking ${number}`);
  if (side === 'client' && bw.booking.clientId !== (actor as Actor).userId) throw new LifecycleError('not_found', `No booking ${number}`);
  if (side === 'partner' && bw.booking.partnerId !== (actor as Actor).partnerId) throw new LifecycleError('not_found', `No booking ${number}`);
  return bw;
}

export async function openDisputeOf(q: Queryable, bookingId: string) {
  const [d] = await q.select().from(dispute)
    .where(and(eq(dispute.bookingId, bookingId), inArray(dispute.status, [...OPEN_DISPUTE_STATUSES]))).limit(1);
  return d ?? null;
}

// ── Money read-outs ──────────────────────────────────────────────────────

/** Σ succeeded charges (duplicates excluded), before refunds. */
export async function chargedCents(q: Queryable, bookingId: string): Promise<number> {
  const [r] = await q.select({ s: sql<string>`coalesce(sum(${charge.amountCents}), 0)` }).from(charge)
    .where(and(eq(charge.bookingId, bookingId), inArray(charge.status, ['succeeded', 'partially_refunded', 'refunded']), eq(charge.isDuplicate, false)));
  return Number(r?.s ?? 0);
}

/** Σ succeeded refunds of a booking. */
export async function refundedCents(q: Queryable, bookingId: string): Promise<number> {
  const [r] = await q.select({ s: sql<string>`coalesce(sum(${refund.amountCents}), 0)` }).from(refund)
    .where(and(eq(refund.bookingId, bookingId), eq(refund.status, 'succeeded')));
  return Number(r?.s ?? 0);
}

/** SPEC §5.1 `paid` = Σ succeeded charges − Σ succeeded refunds (duplicate charges and their refunds excluded). */
export async function paidCents(q: Queryable, bookingId: string): Promise<number> {
  const [r] = await q.select({ s: sql<string>`coalesce(sum(${refund.amountCents}), 0)` }).from(refund)
    .innerJoin(charge, eq(charge.id, refund.chargeId))
    .where(and(eq(refund.bookingId, bookingId), eq(refund.status, 'succeeded'), eq(charge.isDuplicate, false)));
  return (await chargedCents(q, bookingId)) - Number(r?.s ?? 0);
}

/** What duplicate charges still hold (charged − refunded): never released to the partner (SPEC §4.8). */
export async function duplicateHeldCents(q: Queryable, bookingId: string): Promise<number> {
  const [r] = await q.select({ s: sql<string>`coalesce(sum(${charge.amountCents} - ${charge.refundedCents}), 0)` }).from(charge)
    .where(and(eq(charge.bookingId, bookingId), eq(charge.isDuplicate, true), inArray(charge.status, ['succeeded', 'partially_refunded'])));
  return Number(r?.s ?? 0);
}

/** client_funds still held for the booking that may go to the partner (duplicates excluded). */
export async function releasableCents(q: Queryable, bookingId: string): Promise<number> {
  const held = await accountBalance(q, 'client_funds', { bookingId });
  return Math.max(0, held - (await duplicateHeldCents(q, bookingId)));
}

// ── Ledger L3 and payout lines ───────────────────────────────────────────

/**
 * Ledger L3 (SPEC §7.5): release `amountCents` (default: everything releasable)
 * of a booking's client funds to the partner at the booking's commission rate:
 *   Dr client_funds B · Cr partner_payable (B − C) · Cr commission_revenue C
 *   Dr platform_cash C · Cr provider_held C
 * Used by K13 completion, T18 early release (`kind: 'early_release'`, with the
 * charge), and by the cancellation and dispute modules (retained amounts,
 * decisions). Returns the split; nothing is posted when B = 0.
 */
export async function releaseToPartner(
  tx: Tx, a: { bookingId: string; actor: AnyActor; amountCents?: number; kind?: 'release' | 'early_release'; chargeId?: string; description?: string },
): Promise<Split & { transactionId: string | null }> {
  const [b] = await tx.select().from(booking).where(eq(booking.id, a.bookingId)).limit(1);
  if (!b) throw new LifecycleError('not_found', 'No booking');
  if (b.commissionBp == null) throw new LifecycleError('invalid_state', 'The booking has no commission snapshot (never paid)');
  const releasable = await releasableCents(tx, b.id);
  const base = a.amountCents ?? releasable;
  if (base > releasable) throw new LifecycleError('invalid_state', `Cannot release ${base}: only ${releasable} held`);
  const s = split(base, b.commissionBp);
  if (base <= 0) return { ...s, transactionId: null };
  const lines: LedgerLine[] = [{ account: 'client_funds', debit: base }];
  if (s.partnerAmountCents > 0) lines.push({ account: 'partner_payable', credit: s.partnerAmountCents });
  if (s.commissionCents > 0) {
    lines.push({ account: 'commission_revenue', credit: s.commissionCents });
    lines.push({ account: 'platform_cash', debit: s.commissionCents }, { account: 'provider_held', credit: s.commissionCents });
  }
  const t = await postTransaction(tx, {
    kind: a.kind ?? 'release', bookingId: b.id, partnerId: b.partnerId, chargeId: a.chargeId ?? null,
    description: a.description ?? `Release ${b.number}`, createdBy: isSystem(a.actor) ? null : a.actor.userId, lines,
  });
  await audit(tx, {
    actor: a.actor, action: a.kind === 'early_release' ? 'booking.funds_released_early' : 'booking.funds_released', entity: 'booking', entityId: b.id,
    data: { number: b.number, baseCents: s.baseCents, commissionCents: s.commissionCents, partnerAmountCents: s.partnerAmountCents, chargeId: a.chargeId ?? null },
  });
  return { ...s, transactionId: t.id };
}

/** Y1 (K5): the booking's payout line, `awaiting_event`, with the projected split of the whole amount. */
export async function createPayoutLine(tx: Tx, b: BookingRow, bp: number, at: Date) {
  const [existing] = await tx.select({ id: payoutLine.id }).from(payoutLine)
    .where(and(eq(payoutLine.bookingId, b.id), isNull(payoutLine.chargeId))).limit(1);
  if (existing) return existing.id;
  const s = split(b.amountCents, bp);
  const [l] = await tx.insert(payoutLine).values({
    bookingId: b.id, partnerId: b.partnerId, batchDate: b.batchDate, baseCents: s.baseCents, commissionCents: s.commissionCents,
    amountCents: s.partnerAmountCents, status: 'awaiting_event', createdAt: at,
  }).returning({ id: payoutLine.id });
  return l.id;
}

/**
 * Y2: the booking's payout line becomes `ready` with the released split, for
 * the first batch on or after max(hold_until, today). A zero release closes the
 * line as `cancelled`. Lines that are `ready` (or `released_early`), have no
 * payout_item_id and a batch_date ≤ the batch date are what the payout module
 * groups into items (SPEC Y3).
 */
export async function markPayoutLineReady(tx: Tx, a: { bookingId: string; split: Split; at: Date }) {
  const [b] = await tx.select().from(booking).where(eq(booking.id, a.bookingId)).limit(1);
  if (!b) throw new LifecycleError('not_found', 'No booking');
  const s = await getSettings(a.at, tx);
  const today = sofiaDate(a.at);
  const batchDate = firstPayoutDay(b.holdUntil > today ? b.holdUntil : today, s['payout.days']);
  const values = {
    baseCents: a.split.baseCents, commissionCents: a.split.commissionCents, amountCents: a.split.partnerAmountCents,
    status: (a.split.baseCents > 0 ? 'ready' : 'cancelled') as 'ready' | 'cancelled', holdReason: null, readyAt: a.at, batchDate,
  };
  const [line] = await tx.select({ id: payoutLine.id }).from(payoutLine)
    .where(and(eq(payoutLine.bookingId, b.id), isNull(payoutLine.chargeId), inArray(payoutLine.status, ['awaiting_event', 'held']))).limit(1);
  if (line) await tx.update(payoutLine).set(values).where(eq(payoutLine.id, line.id));
  else if (a.split.baseCents > 0) await tx.insert(payoutLine).values({ bookingId: b.id, partnerId: b.partnerId, createdAt: a.at, ...values });
}

/** Y4 at line level: an open dispute (or another hold reason) keeps the booking's line out of batches. */
export async function holdPayoutLine(tx: Tx, bookingId: string, reason: 'dispute' | 'account_check' | 'provider_disabled' | 'returned') {
  await tx.update(payoutLine).set({ status: 'held', holdReason: reason })
    .where(and(eq(payoutLine.bookingId, bookingId), isNull(payoutLine.chargeId), inArray(payoutLine.status, ['awaiting_event', 'ready'])));
}

// ── K2: ‹Напомни на клиента› ─────────────────────────────────────────────

export async function remindClient(actor: AnyActor, input: { number: string }, tx?: Tx): Promise<void> {
  return withTx(tx, async t => {
    const bw = await bookingFor(t, actor, input.number, 'partner');
    const b = bw.booking;
    if (b.status !== 'awaiting_payment') throw new LifecycleError('invalid_state', 'The booking is not awaiting payment');
    const at = await now();
    if (at >= b.paymentDueAt) throw new LifecycleError('deadline_passed', 'The payment deadline has passed');
    const hoursLeft = Math.max(1, Math.floor((b.paymentDueAt.getTime() - at.getTime()) / HOUR));
    await mail(t, {
      key: 'client-payment-reminder', to: bw.parties.client.email, toUserId: b.clientId, dedupeKey: `booking:${b.id}:payrem:manual:${at.getTime()}`,
      vars: clientPaymentReminderVars(bw, hoursLeft),
    });
    await audit(t, { actor, action: 'booking.client_reminded', entity: 'booking', entityId: b.id, data: { number: b.number, hoursLeft } });
  });
}

function clientPaymentReminderVars(bw: BookingWithSnapshots, hoursLeft: number) {
  const b = bw.booking;
  return {
    bookingId: b.number, requestNo: b.number, hoursLeft, partnerName: bw.parties.partner.businessName,
    packageName: packageNameOf(b.serviceTitle), eventDate: date(b.eventDate), amount: money(b.dueNowCents), payBy: dateTime(b.paymentDueAt),
  };
}

// ── K3: ‹Удължи срока› ───────────────────────────────────────────────────

/** K3 / X10: the team moves payment_due_at by ⚙ payment.extension_hours; T5–T8 move with it. */
export async function extendPaymentDeadline(actor: AnyActor, input: { number: string }, tx?: Tx): Promise<{ newDueAt: Date }> {
  return withTx(tx, async t => {
    const bw = await bookingFor(t, actor, input.number, 'team');
    const b = bw.booking;
    const open = await openDisputeOf(t, b.id);
    assertCan(actor, 'extend_payment_deadline', { disputeOpen: !!open }); // D39
    if (b.status !== 'awaiting_payment') throw new LifecycleError('invalid_state', 'Only a booking awaiting payment can be extended');
    const at = await now();
    const s = await getSettings(at, t);
    const hours = s['payment.extension_hours'];
    const previous = b.paymentDueAt;
    const newDueAt = new Date(previous.getTime() + hours * HOUR);
    const [updated] = await t.update(booking).set({ paymentDueAt: newDueAt, paymentExtensions: b.paymentExtensions + 1, updatedAt: at })
      .where(eq(booking.id, b.id)).returning();
    await t.insert(paymentExtension).values({
      bookingId: b.id, previousDueAt: previous, newDueAt, hours, disputeId: open?.id ?? null, extendedBy: (actor as Actor).userId, createdAt: at,
    });
    await t.update(charge).set({ dueAt: newDueAt, updatedAt: at })
      .where(and(eq(charge.bookingId, b.id), eq(charge.status, 'awaiting_transfer')));
    await schedulePaymentJobs(t, updated, s, at);
    const p = bw.parties;
    const n = updated.paymentExtensions;
    await mail(t, {
      key: 'client-payment-extended', to: p.client.email, toUserId: b.clientId, dedupeKey: `booking:${b.id}:extended:${n}:client`,
      vars: {
        bookingId: b.number, requestNo: b.number, extraHours: hours, partnerName: p.partner.businessName, partnerCategory: p.partnerCategory,
        eventType: p.eventType.name, eventDate: date(b.eventDate), location: locationOf(b, p.cityName), newDeadline: dateTime(newDueAt),
      },
    });
    if (p.partnerUserId) {
      await mail(t, {
        key: 'vendor-payment-deadline-extended', to: p.partner.notificationEmail, toUserId: p.partnerUserId, dedupeKey: `booking:${b.id}:extended:${n}:partner`,
        vars: {
          requestId: b.number, requestNo: b.number, extraHours: hours, clientName: p.client.name, eventType: p.eventType.name,
          eventDate: date(b.eventDate), previousDeadline: dateTime(previous), newDeadline: dateTime(newDueAt),
        },
      });
    }
    await audit(t, {
      actor, action: 'booking.payment_extended', entity: 'booking', entityId: b.id,
      data: { number: b.number, previousDueAt: previous.toISOString(), newDueAt: newDueAt.toISOString(), hours, disputeId: open?.id ?? null },
    });
    return { newDueAt };
  });
}

// ── K4: ‹Отмени одобрението› ─────────────────────────────────────────────

export async function withdrawApproval(actor: AnyActor, input: { number: string }, tx?: Tx): Promise<void> {
  return withTx(tx, async t => {
    const bw = await bookingFor(t, actor, input.number, 'partner');
    const b = bw.booking;
    if (b.status !== 'awaiting_payment') throw new LifecycleError('invalid_state', 'Only an unpaid approval can be withdrawn');
    // K4 guard: no charge succeeded or pending. An awaiting bank transfer counts as pending (the money may be on its way).
    if (bw.charges.some(c => ['succeeded', 'pending', 'awaiting_transfer', 'partially_refunded', 'refunded'].includes(c.status))) {
      throw new LifecycleError('not_allowed', 'The client has started paying');
    }
    const at = await now();
    await t.update(booking).set({ status: 'approval_withdrawn', updatedAt: at }).where(eq(booking.id, b.id));
    await cancelBookingJobs(t, b.id);
    const p = bw.parties;
    await mail(t, {
      key: 'client-approval-withdrawn', to: p.client.email, toUserId: b.clientId, dedupeKey: `booking:${b.id}:withdrawn`,
      vars: {
        requestNo: b.number, partnerName: p.partner.businessName, partnerCategory: p.partnerCategory, packageName: packageNameOf(b.serviceTitle),
        eventType: p.eventType.name, eventDate: date(b.eventDate),
      },
    });
    await audit(t, { actor, action: 'booking.approval_withdrawn', entity: 'booking', entityId: b.id, data: { number: b.number } });
    await notifyDateWatchers(t, { partnerId: b.partnerId, date: b.eventDate });
  });
}

// ── T5–T8: payment window timers ─────────────────────────────────────────

/** T5: `client-payment-reminder` 6 h and 2 h before payment_due_at. */
export async function clientPayReminderJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const bw = await loadBooking(t, { id: String(p.bookingId) });
    if (!bw || bw.booking.status !== 'awaiting_payment') return;
    const at = await now();
    if (at >= bw.booking.paymentDueAt) return;
    const hours = Number(p.hours);
    await mail(t, {
      key: 'client-payment-reminder', to: bw.parties.client.email, toUserId: bw.booking.clientId,
      dedupeKey: `${jobKey.payReminder(bw.booking.id, hours)}:${bw.booking.paymentDueAt.getTime()}`,
      vars: clientPaymentReminderVars(bw, hours),
    });
  });
}

/** T6: `vendor-payment-reminder` 6 h before payment_due_at. */
export async function partnerPayReminderJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const bw = await loadBooking(t, { id: String(p.bookingId) });
    if (!bw || bw.booking.status !== 'awaiting_payment' || !bw.parties.partnerUserId) return;
    const at = await now();
    const b = bw.booking;
    if (at >= b.paymentDueAt) return;
    const hoursLeft = Number(p.hours) || Math.max(1, Math.floor((b.paymentDueAt.getTime() - at.getTime()) / HOUR));
    await mail(t, {
      key: 'vendor-payment-reminder', to: bw.parties.partner.notificationEmail, toUserId: bw.parties.partnerUserId,
      dedupeKey: `${jobKey.partnerPayReminder(b.id)}:${b.paymentDueAt.getTime()}`,
      vars: {
        requestId: b.number, requestNo: b.number, hoursLeft, clientName: bw.parties.client.name, eventType: bw.parties.eventType.name,
        eventDate: date(b.eventDate), packageName: packageNameOf(b.serviceTitle), payBy: dateTime(b.paymentDueAt),
      },
    });
  });
}

/** T7: `team-payment-deadline` 4 h before payment_due_at, only with an open dispute on the booking. */
export async function teamPaymentAlertJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const bw = await loadBooking(t, { id: String(p.bookingId) });
    if (!bw || bw.booking.status !== 'awaiting_payment') return;
    const d = await openDisputeOf(t, bw.booking.id);
    if (!d) return;
    const at = await now();
    const b = bw.booking;
    if (at >= b.paymentDueAt) return;
    const s = await getSettings(at, t);
    const hoursLeft = Math.max(1, Math.round((b.paymentDueAt.getTime() - at.getTime()) / HOUR));
    const c = bw.parties.client;
    for (const r of await teamRecipients(t, 'resolve_disputes')) {
      await mail(t, {
        key: 'team-payment-deadline', to: r.email, toUserId: r.id, dedupeKey: `${jobKey.teamAlert(b.id)}:${b.paymentDueAt.getTime()}:${r.id}`,
        vars: {
          caseId: d.number, bookingNo: b.number, hoursLeft, extraHours: s['payment.extension_hours'], clientName: c.name,
          clientShortName: c.name.trim().split(/\s+/)[0], partnerName: bw.parties.partner.businessName,
          // The template's „за цената“-style topic is not stored on a dispute; the case title is the closest record.
          disputeTopic: `„${d.title}“`, disputeSummary: d.summary ?? d.description,
          eventType: bw.parties.eventType.name, eventDate: date(b.eventDate), location: locationOf(b, bw.parties.cityName),
          approvedAmount: money(bw.request.amountCents ?? b.amountCents), payNowAmount: money(b.dueNowCents), payBy: dateTime(b.paymentDueAt),
        },
      });
    }
  });
}

/** How long the client has to pay this booking: approval → deadline, extensions (K3) and the event-start clamp included. */
export const paymentWindowHours = (b: { approvedAt: Date; paymentDueAt: Date }) =>
  Math.max(1, Math.round((b.paymentDueAt.getTime() - b.approvedAt.getTime()) / HOUR));

/**
 * T8 / K6: the payment window closed without a succeeded charge. An awaiting
 * bank transfer does not stop it (D6): open charges → `expired`.
 */
export async function expirePaymentJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const bw = await loadBooking(t, { id: String(p.bookingId) }, { forUpdate: true });
    if (!bw || bw.booking.status !== 'awaiting_payment') return;
    const at = await now();
    const b = bw.booking;
    if (at < b.paymentDueAt) return; // extended (K3): the moved job will come
    if (bw.charges.some(c => c.status === 'succeeded')) return;
    await t.update(booking).set({ status: 'payment_expired', updatedAt: at }).where(eq(booking.id, b.id));
    await t.update(charge).set({ status: 'expired', updatedAt: at })
      .where(and(eq(charge.bookingId, b.id), inArray(charge.status, ['pending', 'awaiting_transfer'])));
    await cancelPaymentJobs(t, b.id, { keepExpiry: true });
    const pt = bw.parties;
    await mail(t, {
      key: 'client-payment-expired', to: pt.client.email, toUserId: b.clientId, dedupeKey: `booking:${b.id}:payment_expired`,
      vars: {
        partnerSlug: pt.partner.slug, requestNo: b.number, partnerName: pt.partner.businessName, partnerCategory: pt.partnerCategory,
        serviceName: b.serviceTitle, eventType: pt.eventType.name, eventDate: date(b.eventDate), amount: money(b.amountCents),
        hours: paymentWindowHours(b),
      },
    });
    if (pt.partnerUserId) {
      await mail(t, {
        key: 'vendor-hold-expired', to: pt.partner.notificationEmail, toUserId: pt.partnerUserId, dedupeKey: `booking:${b.id}:hold_expired`,
        vars: {
          requestNo: b.number, clientName: pt.client.name, eventType: pt.eventType.name, eventDate: date(b.eventDate),
          packageName: packageNameOf(b.serviceTitle), expiredAt: dateTime(b.paymentDueAt),
        },
      });
    }
    await audit(t, { actor: SYSTEM, action: 'booking.payment_expired', entity: 'booking', entityId: b.id, data: { number: b.number } });
    await notifyDateWatchers(t, { partnerId: b.partnerId, date: b.eventDate });
  });
}

// ── K13 / T13: completion ────────────────────────────────────────────────

/** Does an open dispute hold this booking's payout (SPEC K13, D13)? */
export async function payoutHeldByDispute(q: Queryable, b: Pick<BookingRow, 'id' | 'payoutHold'>): Promise<boolean> {
  if (b.payoutHold) return true;
  const d = await openDisputeOf(q, b.id);
  return !!d?.holdsPayout;
}

/**
 * K13: `confirmed` → `completed` at 00:00 the day after the event. The funds
 * are released to the partner (L3) and the payout line becomes `ready`, unless
 * an open dispute holds the payout: then the line is `held` and the release
 * waits for the decision (the dispute module calls releaseToPartner + markPayoutLineReady).
 */
export async function completeBooking(bookingId: string, tx?: Tx): Promise<'completed' | 'held' | 'skipped'> {
  return withTx(tx, async t => {
    const [b] = await t.select().from(booking).where(eq(booking.id, bookingId)).for('update');
    if (!b || b.status !== 'confirmed') return 'skipped';
    const at = await now();
    if (at < completionInstant(b.eventDate)) return 'skipped';
    await t.update(booking).set({ status: 'completed', completedAt: at, updatedAt: at }).where(eq(booking.id, b.id));
    if (await payoutHeldByDispute(t, b)) {
      await holdPayoutLine(t, b.id, 'dispute');
      await audit(t, { actor: SYSTEM, action: 'booking.completed', entity: 'booking', entityId: b.id, data: { number: b.number, payoutHeld: true } });
      return 'held';
    }
    const s = await releaseToPartner(t, { bookingId: b.id, actor: SYSTEM, description: `K13 completion ${b.number}` });
    await markPayoutLineReady(t, { bookingId: b.id, split: s, at });
    await audit(t, { actor: SYSTEM, action: 'booking.completed', entity: 'booking', entityId: b.id, data: { number: b.number, releasedCents: s.baseCents } });
    return 'completed';
  });
}

export async function completeBookingJob(p: Record<string, unknown>): Promise<void> {
  await completeBooking(String(p.bookingId));
}

// ── T11, T12, T14: reminders and the review invite ───────────────────────

/** T11: one `client-event-reminder` per client event, listing every confirmed booking. */
export async function clientEventReminderJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const eventId = String(p.clientEventId);
    const days = Number(p.days);
    const [ev] = await t.select().from(clientEvent).where(eq(clientEvent.id, eventId)).limit(1);
    if (!ev) return;
    const rows = await t.select({ b: booking, partnerName: partner.businessName }).from(booking)
      .innerJoin(partner, eq(partner.id, booking.partnerId))
      .where(and(eq(booking.clientEventId, eventId), eq(booking.status, 'confirmed')))
      .orderBy(sql`${booking.startTime} asc nulls last`, asc(booking.createdAt));
    if (!rows.length) return;
    const [et] = await t.select().from(eventType).where(eq(eventType.id, ev.eventTypeId)).limit(1);
    const [c] = await t.select({ email: user.email }).from(user).where(eq(user.id, ev.clientId)).limit(1);
    const [ct] = ev.cityId ? await t.select({ name: city.name }).from(city).where(eq(city.id, ev.cityId)).limit(1) : [];
    const first = rows[0].b;
    const location = ev.venueName || ev.locality ? locationOf(ev, ct?.name) : locationOf(first, ct?.name);
    await mail(t, {
      key: 'client-event-reminder', to: c.email, toUserId: ev.clientId, dedupeKey: jobKey.clientEventReminder(eventId, days),
      vars: {
        daysLeft: days, eventType: et?.name ?? ev.title, eventTypeDefinite: et?.nameDefinite ?? lowerFirst(ev.title), eventDate: date(ev.date),
        location, bookings: rows.map(r => ({ partnerName: r.partnerName, service: r.b.serviceTitle, time: hm(r.b.startTime) })),
        guests: ev.guests ?? Math.max(...rows.map(r => r.b.guests)),
      },
    });
  });
}

/** T12: `vendor-event-reminder` 7 days before a confirmed booking. */
export async function partnerEventReminderJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const bw = await loadBooking(t, { id: String(p.bookingId) });
    if (!bw || bw.booking.status !== 'confirmed' || !bw.parties.partnerUserId) return;
    const b = bw.booking;
    const days = Number(p.days);
    const at = await now();
    const sp = await bookingSplit(t, b, at);
    await mail(t, {
      key: 'vendor-event-reminder', to: bw.parties.partner.notificationEmail, toUserId: bw.parties.partnerUserId,
      dedupeKey: jobKey.partnerEventReminder(b.id, days),
      vars: {
        bookingNo: b.number, daysLeft: days, eventTypeDefinite: bw.parties.eventType.nameDefinite,
        hosts: await hostsOf(t, b.clientEventId, bw.parties.client.name), eventDate: date(b.eventDate), eventWeekday: weekdayName(isoWeekday(b.eventDate) % 7),
        timeRange: timeRange(b.startTime, b.endTime), venue: b.venueName ?? b.locality ?? bw.parties.cityName ?? '—',
        location: locationOf(b, bw.parties.cityName), guests: b.guests, packageName: packageNameOf(b.serviceTitle),
        clientPhone: phoneDisplay(b.contactPhone), partnerAmount: money(sp.partnerAmountCents), payoutDate: date(b.batchDate),
      },
    });
  });
}

/** T14 / V1: `client-review-invite` the day after the event, when completed and not reviewed. */
export async function reviewInviteJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const bw = await loadBooking(t, { id: String(p.bookingId) }, { forUpdate: true });
    if (!bw || bw.booking.status !== 'completed') return;
    const b = bw.booking;
    const [rv] = await t.select({ id: review.id }).from(review).where(eq(review.bookingId, b.id)).limit(1);
    if (rv) return;
    const at = await now();
    if (b.reviewState === 'not_due') await t.update(booking).set({ reviewState: 'invited', updatedAt: at }).where(eq(booking.id, b.id));
    await mail(t, {
      key: 'client-review-invite', to: bw.parties.client.email, toUserId: b.clientId, dedupeKey: jobKey.reviewInvite(b.id),
      vars: {
        bookingId: b.number, partnerName: bw.parties.partner.businessName, partnerCategory: bw.parties.partnerCategory,
        eventType: bw.parties.eventType.name, eventTypeDefinite: bw.parties.eventType.nameDefinite, eventDate: date(b.eventDate),
        location: locationOf(b, bw.parties.cityName), guests: b.guests, amount: money(await paidCents(t, b.id)),
      },
    });
    await audit(t, { actor: SYSTEM, action: 'booking.review_invited', entity: 'booking', entityId: b.id, data: { number: b.number } });
  });
}

// ── View models ──────────────────────────────────────────────────────────

type Common = {
  id: string; number: string; status: BookingStatus;
  eventType: { slug: string; name: string }; eventDate: DateStr; eventWeekday: string; startTime: string | null; endTime: string | null;
  guests: number; venueName: string | null; locality: string | null; cityName: string | null; location: string;
  clientEventId: string; serviceTitle: string; serviceSummary: string | null; inclusions: string[];
  approvedAt: Date; paymentDueAt: Date; paidAt: Date | null; completedAt: Date | null; cancelledAt: Date | null; cancelledBy: BookingRow['cancelledBy'];
  /** The payment window is open (client: ‹Плати›; countdown ‹Остават HH:MM ч›). */
  payable: boolean;
  /** Whole Sofia days until the event (negative after it). */
  daysToEvent: number;
  policy: { policy: BookingRow['cancellationPolicy']; depositPercent: number; freeCancelUntil: DateStr | null };
  disputeOpen: boolean;
  /** A case was opened on the booking, open or not: one case per booking (SPEC X1/X2, ‹По тази резервация вече има сигнал.›). */
  hasDispute: boolean;
  conversationId: string | null;
  requestNumber: string;
};

export type ClientBookingView = Common & {
  partner: { id: string; slug: string; name: string; category: string; cityName: string | null };
  money: {
    amountCents: number; bookingFeeCents: number; totalCents: number; paymentMode: BookingRow['paymentMode'];
    dueNowCents: number; balanceCents: number; balanceDueDate: DateStr | null; paidCents: number; refundedCents: number;
  };
  card: { brand: string | null; last4: string; label: string } | null;
  invoices: { number: string; type: string; issuedOn: DateStr; totalCents: number }[];
  /** ‹Анулиране› is offered (SPEC K7 guards; the cancellation itself is the aftercare module's). */
  canCancel: boolean;
  /** ‹Остави ревю› (V2). */
  canReview: boolean;
};

export type PartnerBookingView = Common & {
  client: { id: string; name: string; phone: string | null; clientSince: number; bookingsWithPartner: number };
  hosts: string | null;
  /** Partners see ‹Сума› and ‹Получавате› only (rule 9); projected before payment. */
  money: { amountCents: number; partnerAmountCents: number; paidByClientCents: number; payoutDate: DateStr; payoutLineStatus: string | null };
};

export type AdminBookingView = Common & {
  client: { id: string; name: string; email: string; phone: string | null; contactPhone: string };
  partner: { id: string; slug: string; name: string; category: string; email: string; phone: string; cityName: string | null };
  money: {
    amountCents: number; totalCents: number; dueNowCents: number; balanceCents: number; paymentMode: BookingRow['paymentMode'];
    paidCents: number; refundedCents: number;
    /** Only with view_finance (SPEC §1.2). */
    commission: { bp: number; projected: boolean; commissionCents: number; partnerAmountCents: number } | null;
    ledger: Record<string, number> | null;
  };
  charges: { id: string; kind: string; method: string; provider: string; status: string; amountCents: number; isDuplicate: boolean; succeededAt: Date | null; card: string }[];
  refunds: { id: string; amountCents: number; status: string; reason: string; createdAt: Date }[];
  payoutLines: { id: string; status: string; batchDate: DateStr; baseCents: number; amountCents: number; chargeId: string | null }[] | null;
  extensions: { previousDueAt: Date; newDueAt: Date; hours: number; createdAt: Date }[];
  timeline: { action: string; actorRole: string | null; createdAt: Date; data: unknown }[];
};

async function common(q: Queryable, bw: BookingWithSnapshots, at: Date): Promise<Common> {
  const b = bw.booking;
  const [conv] = await q.select({ id: conversation.id }).from(conversation)
    .where(and(eq(conversation.clientId, b.clientId), eq(conversation.partnerId, b.partnerId), eq(conversation.clientEventId, b.clientEventId))).limit(1);
  return {
    id: b.id, number: b.number, status: b.status,
    eventType: { slug: bw.parties.eventType.slug, name: bw.parties.eventType.name }, eventDate: b.eventDate,
    eventWeekday: weekdayName(isoWeekday(b.eventDate) % 7), startTime: b.startTime ? hm(b.startTime) : null, endTime: b.endTime ? hm(b.endTime) : null,
    guests: b.guests, venueName: b.venueName, locality: b.locality, cityName: bw.parties.cityName, location: locationOf(b, bw.parties.cityName),
    clientEventId: b.clientEventId, serviceTitle: b.serviceTitle, serviceSummary: b.serviceSummary, inclusions: b.inclusions,
    approvedAt: b.approvedAt, paymentDueAt: b.paymentDueAt, paidAt: b.paidAt, completedAt: b.completedAt, cancelledAt: b.cancelledAt, cancelledBy: b.cancelledBy,
    payable: b.status === 'awaiting_payment' && at < b.paymentDueAt,
    daysToEvent: daysBetween(sofiaDate(at), b.eventDate),
    policy: { policy: b.cancellationPolicy, depositPercent: b.depositPercent, freeCancelUntil: b.freeCancelUntil },
    disputeOpen: !!(await openDisputeOf(q, b.id)),
    hasDispute: (await q.select({ id: dispute.id }).from(dispute).where(eq(dispute.bookingId, b.id)).limit(1)).length > 0,
    conversationId: conv?.id ?? null,
    requestNumber: bw.request.number,
  };
}

/** /akaunt/rezervacii/[nomer], /plashtane/[nomer]/potvardena: the client's own booking (404 otherwise). Never commission. */
export async function getBookingForClient(actor: AnyActor, number: string, q: Queryable = db): Promise<ClientBookingView> {
  assertClientActor(actor);
  const bw = await loadBooking(q, { number });
  if (!bw || bw.booking.clientId !== actor.userId) throw new LifecycleError('not_found', `No booking ${number}`);
  const at = await now();
  const b = bw.booking;
  const c = await common(q, bw, at);
  const paid = bw.charges.find(x => !x.isDuplicate && x.cardLast4 && ['succeeded', 'partially_refunded', 'refunded'].includes(x.status));
  const invoices = await q.select({ number: invoice.number, type: invoice.type, issuedOn: invoice.issuedOn, totalCents: invoice.totalCents })
    .from(invoice).where(eq(invoice.bookingId, b.id)).orderBy(asc(invoice.createdAt));
  const [rv] = await q.select({ id: review.id }).from(review).where(eq(review.bookingId, b.id)).limit(1);
  return {
    ...c,
    partner: { id: b.partnerId, slug: bw.parties.partner.slug, name: bw.parties.partner.businessName, category: bw.parties.partnerCategory, cityName: bw.parties.cityName },
    money: {
      amountCents: b.amountCents, bookingFeeCents: b.bookingFeeCents, totalCents: b.amountCents + b.bookingFeeCents, paymentMode: b.paymentMode,
      dueNowCents: b.dueNowCents, balanceCents: b.balanceCents, balanceDueDate: b.balanceDueDate,
      paidCents: await paidCents(q, b.id), refundedCents: await refundedCents(q, b.id),
    },
    card: paid ? { brand: paid.cardBrand, last4: paid.cardLast4!, label: cardLabel(paid.cardBrand, paid.cardLast4) } : null,
    invoices,
    canCancel: b.status === 'confirmed' && c.daysToEvent >= 0 && !c.disputeOpen,
    canReview: b.status === 'completed' && !rv,
  };
}

/** /partner/rezervacii/[nomer], /partner/zayavki/[nomer] (approved): phone only per SPEC §10; no commission (rule 9). */
export async function getBookingForPartner(actor: AnyActor, number: string, q: Queryable = db): Promise<PartnerBookingView> {
  assertPartnerActor(actor);
  const bw = await loadBooking(q, { number });
  if (!bw || bw.booking.partnerId !== actor.partnerId) throw new LifecycleError('not_found', `No booking ${number}`);
  const at = await now();
  const b = bw.booking;
  const c = await common(q, bw, at);
  const sp = await bookingSplit(q, b, at);
  const [line] = await q.select({ status: payoutLine.status }).from(payoutLine)
    .where(and(eq(payoutLine.bookingId, b.id), isNull(payoutLine.chargeId))).limit(1);
  const [{ n }] = await q.select({ n: count() }).from(booking)
    .where(and(eq(booking.clientId, b.clientId), eq(booking.partnerId, b.partnerId), inArray(booking.status, ['confirmed', 'completed'])));
  const [cu] = await q.select({ createdAt: user.createdAt }).from(user).where(eq(user.id, b.clientId)).limit(1);
  return {
    ...c,
    client: {
      id: b.clientId, name: bw.parties.client.name,
      phone: (PHONE_VISIBLE_STATUSES as readonly string[]).includes(b.status) ? b.contactPhone : null,
      clientSince: Number(sofiaDate(cu?.createdAt ?? at).slice(0, 4)), bookingsWithPartner: Number(n),
    },
    hosts: bw.clientEvent?.hosts ?? null,
    money: {
      amountCents: b.amountCents, partnerAmountCents: sp.partnerAmountCents, paidByClientCents: await paidCents(q, b.id),
      payoutDate: b.batchDate, payoutLineStatus: line?.status ?? null,
    },
  };
}

/** /admin/rezervacii/[nomer]: both parties' contacts always; money splits only with view_finance. */
export async function getBookingForAdmin(actor: AnyActor, number: string, q: Queryable = db): Promise<AdminBookingView> {
  assertTeamActor(actor);
  const bw = await loadBooking(q, { number });
  if (!bw) throw new LifecycleError('not_found', `No booking ${number}`);
  const at = await now();
  const b = bw.booking;
  const c = await common(q, bw, at);
  const finance = can(actor, 'view_finance');
  const sp = finance ? await bookingSplit(q, b, at) : null;
  const refunds = await q.select().from(refund).where(eq(refund.bookingId, b.id)).orderBy(asc(refund.createdAt));
  const lines = finance ? await q.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id)).orderBy(asc(payoutLine.createdAt)) : null;
  const ext = await q.select().from(paymentExtension).where(eq(paymentExtension.bookingId, b.id)).orderBy(asc(paymentExtension.createdAt));
  const timeline = await q.select({ action: auditLog.action, actorRole: auditLog.actorRole, createdAt: auditLog.createdAt, data: auditLog.data })
    .from(auditLog).where(sql`(${auditLog.entity} = 'booking' and ${auditLog.entityId} = ${b.id}) or (${auditLog.entity} = 'request' and ${auditLog.entityId} = ${b.requestId})`)
    .orderBy(asc(auditLog.createdAt));
  return {
    ...c,
    client: { id: b.clientId, name: bw.parties.client.name, email: bw.parties.client.email, phone: bw.parties.client.phone, contactPhone: b.contactPhone },
    partner: {
      id: b.partnerId, slug: bw.parties.partner.slug, name: bw.parties.partner.businessName, category: bw.parties.partnerCategory,
      email: bw.parties.partner.notificationEmail, phone: bw.parties.partner.phone, cityName: bw.parties.cityName,
    },
    money: {
      amountCents: b.amountCents, totalCents: b.amountCents + b.bookingFeeCents, dueNowCents: b.dueNowCents, balanceCents: b.balanceCents,
      paymentMode: b.paymentMode, paidCents: await paidCents(q, b.id), refundedCents: await refundedCents(q, b.id),
      commission: sp ? { bp: sp.commissionBp, projected: b.commissionBp == null, commissionCents: sp.commissionCents, partnerAmountCents: sp.partnerAmountCents } : null,
      ledger: finance ? await bookingBalances(q, b.id) : null,
    },
    charges: bw.charges.map(x => ({
      id: x.id, kind: x.kind, method: x.method, provider: x.provider, status: x.status, amountCents: x.amountCents,
      isDuplicate: x.isDuplicate, succeededAt: x.succeededAt, card: cardLabel(x.cardBrand, x.cardLast4),
    })),
    refunds: refunds.map(r => ({ id: r.id, amountCents: r.amountCents, status: r.status, reason: r.reason, createdAt: r.createdAt })),
    payoutLines: lines?.map(l => ({ id: l.id, status: l.status, batchDate: l.batchDate, baseCents: l.baseCents, amountCents: l.amountCents, chargeId: l.chargeId })) ?? null,
    extensions: ext.map(e => ({ previousDueAt: e.previousDueAt, newDueAt: e.newDueAt, hours: e.hours, createdAt: e.createdAt })),
    timeline: finance ? timeline : timeline.map(e => ({ ...e, data: withoutCommission(e.data) })),
  };
}

/** Audit data keys that carry the commission or the split it implies (shown only with view_finance, SPEC §1.2). */
const COMMISSION_KEY = /commission|partner_?amount|partnerKeeps|applicationFee/i;

/** An audit record's data without its commission figures, at any depth. */
export function withoutCommission(data: unknown): unknown {
  if (Array.isArray(data)) return data.map(withoutCommission);
  if (!data || typeof data !== 'object') return data;
  return Object.fromEntries(Object.entries(data).filter(([k]) => !COMMISSION_KEY.test(k)).map(([k, v]) => [k, withoutCommission(v)]));
}
