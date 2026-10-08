// Partner availability (SPEC §4.13 calendar date, §12.6 requestable dates).
//
// A date d is requestable for a partner iff ALL hold (§12.6):
//   lead time   d ≥ today + lead_time_days
//   horizon     d ≤ today + horizon_months
//   working day isoWeekday(d) ∈ working_days
//   blocks      no availability_block covers d
//   selected    only_selected_dates ⇒ d ∈ availability_open_date
//   capacity    count(bookings awaiting_payment / confirmed / cancellation_requested on d) < capacity
// Busy = not requestable. Busy partners are hidden from search on that date,
// not invited to briefs, and their profile shows the busy widget.
//
// The calendar state of a day (§4.13): booked > held > blocked > closed > free.
import { and, asc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  availabilityBlock, availabilityOpenDate, booking, brief, briefInvitation, dateWatch, eventType, offer, partner, request,
  type BookingStatus, type BookingsPerDayMode,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { addDays, daysBetween, sofiaDate, time, type DateStr } from '@/lib/format';
import type { AnyActor } from './actor';
import { audit } from './audit';
import { DomainError, NotFoundError, lockPartnerOf, partnerOf, withTx, type Partner } from './catalogue-kit';
import { notifyDateFreed } from './saved';

export type DayState = 'free' | 'held' | 'booked' | 'blocked' | 'closed';

/** Bookings that take a place on the date (§12.6 capacity). */
export const CAPACITY_STATUSES = ['awaiting_payment', 'confirmed', 'cancellation_requested'] as const satisfies readonly BookingStatus[];
/** Calendar ‹Потвърдено събитие› (§4.13). */
export const BOOKED_STATUSES = ['confirmed', 'cancellation_requested', 'completed'] as const satisfies readonly BookingStatus[];

/** Calendar labels (§4.13) and the day chips. */
export const DAY_LABEL: Record<DayState, string> = {
  free: 'Свободно', held: 'Запазена дата (24ч)', booked: 'Потвърдено събитие', blocked: 'Блокирана ръчно', closed: '',
};

export const LEAD_TIME_OPTIONS = [0, 1, 3, 7, 14, 30] as const;
export const HORIZON_OPTIONS = [3, 6, 12, 24] as const;

type Rules = Pick<Partner, 'id' | 'leadTimeDays' | 'horizonMonths' | 'workingDays' | 'onlySelectedDates' | 'bookingsPerDayMode' | 'maxBookingsPerDate'>;

// ── Date helpers ─────────────────────────────────────────────────────────

/** Today's Sofia date on the platform clock. */
export async function today(): Promise<DateStr> { return sofiaDate(await now()); }

/** ISO weekday 1 (Monday) – 7 (Sunday). */
export function isoWeekday(d: DateStr): number {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, day)).getUTCDay() || 7;
}

/** d + n months, clamped to the month's last day (as PostgreSQL's date + interval). */
export function addMonths(d: DateStr, n: number): DateStr {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(day, last)).padStart(2, '0')}`;
}

export const isDate = (d: unknown): d is DateStr =>
  typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;

function assertDate(d: unknown): asserts d is DateStr {
  if (!isDate(d)) throw new DomainError('invalid_date');
}

/** Places per day: 1 (‹Една на ден›), N (‹Лимит на ден›), ∞ (‹Без лимит›). */
export function capacityOf(p: { bookingsPerDayMode: BookingsPerDayMode; maxBookingsPerDate: number }): number {
  return p.bookingsPerDayMode === 'one' ? 1 : p.bookingsPerDayMode === 'limit' ? p.maxBookingsPerDate : Infinity;
}

/** Why a date is closed for the partner's rules, ignoring blocks and bookings. */
function ruleClosed(p: Rules, d: DateStr, todayStr: DateStr): 'lead_time' | 'horizon' | null {
  if (daysBetween(todayStr, d) < p.leadTimeDays) return 'lead_time';
  if (d > addMonths(todayStr, p.horizonMonths)) return 'horizon';
  return null;
}

// ── Busy (SQL, many partners at once) ────────────────────────────────────

/**
 * SQL condition over the `partner` table: true when the partner is busy on `d` (§12.6).
 * Used by search (§13.4 date filter), briefs matching and the profile widget.
 */
export function busySql(d: DateStr, todayStr: DateStr) {
  return sql`(
    ${d}::date < ${todayStr}::date + ${partner.leadTimeDays}
    or ${d}::date > (${todayStr}::date + make_interval(months => ${partner.horizonMonths}::int))::date
    or not (extract(isodow from ${d}::date)::smallint = any(${partner.workingDays}))
    or exists (select 1 from availability_block ab where ab.partner_id = ${partner.id} and ${d}::date between ab.start_date and ab.end_date)
    or (${partner.onlySelectedDates} and not exists (select 1 from availability_open_date ao where ao.partner_id = ${partner.id} and ao.date = ${d}::date))
    or (${partner.bookingsPerDayMode} <> 'unlimited' and (
      select count(*) from booking bk where bk.partner_id = ${partner.id} and bk.event_date = ${d}::date
        and bk.status in ('awaiting_payment', 'confirmed', 'cancellation_requested')
    ) >= case when ${partner.bookingsPerDayMode} = 'one' then 1 else ${partner.maxBookingsPerDate} end)
  )`;
}

/** The partners among `partnerIds` that are busy on `d`. */
export async function busyPartnerIds(partnerIds: string[], d: DateStr, q: Queryable = db, todayStr?: DateStr): Promise<Set<string>> {
  assertDate(d);
  if (!partnerIds.length) return new Set();
  const t = todayStr ?? await today();
  const out = new Set<string>();
  for (let i = 0; i < partnerIds.length; i += 5000) {
    const rows = await q.select({ id: partner.id }).from(partner)
      .where(and(inArray(partner.id, partnerIds.slice(i, i + 5000)), busySql(d, t)));
    for (const r of rows) out.add(r.id);
  }
  return out;
}

export async function isBusy(partnerId: string, d: DateStr, q: Queryable = db): Promise<boolean> {
  return (await busyPartnerIds([partnerId], d, q)).has(partnerId);
}

// ── One partner, day by day ──────────────────────────────────────────────

export type DayInfo = {
  date: DateStr;
  state: DayState;
  /** Not requestable (§12.6). */
  busy: boolean;
  /** Why it is busy or closed: lead_time, horizon, not_working_day, blocked, not_opened, capacity. */
  reason: string | null;
  label: string;
  /** ‹Запазена до 11:06› / ‹Сватба · 120 гости› / ‹Блокирана›. */
  chip: string | null;
  blockId: string | null;
  bookings: { id: string; number: string; status: BookingStatus; eventType: string; guests: number; paymentDueAt: Date }[];
};

async function loadRules(q: Queryable, partnerId: string): Promise<Rules> {
  const [p] = await q.select({
    id: partner.id, leadTimeDays: partner.leadTimeDays, horizonMonths: partner.horizonMonths, workingDays: partner.workingDays,
    onlySelectedDates: partner.onlySelectedDates, bookingsPerDayMode: partner.bookingsPerDayMode, maxBookingsPerDate: partner.maxBookingsPerDate,
  }).from(partner).where(eq(partner.id, partnerId)).limit(1);
  if (!p) throw new NotFoundError('partner');
  return p;
}

/** The calendar state of every day in [from, to] for one partner. */
export async function dayRange(partnerId: string, from: DateStr, to: DateStr, q: Queryable = db, todayStr?: DateStr): Promise<DayInfo[]> {
  assertDate(from); assertDate(to);
  const t = todayStr ?? await today();
  const p = await loadRules(q, partnerId);
  const blocks = await q.select().from(availabilityBlock)
    .where(and(eq(availabilityBlock.partnerId, partnerId), lte(availabilityBlock.startDate, to), gte(availabilityBlock.endDate, from)));
  const open = new Set((await q.select({ d: availabilityOpenDate.date }).from(availabilityOpenDate)
    .where(and(eq(availabilityOpenDate.partnerId, partnerId), gte(availabilityOpenDate.date, from), lte(availabilityOpenDate.date, to)))).map(r => r.d));
  const bks = await q.select({
    id: booking.id, number: booking.number, status: booking.status, date: booking.eventDate, guests: booking.guests,
    paymentDueAt: booking.paymentDueAt, eventType: eventType.name,
  }).from(booking).innerJoin(eventType, eq(eventType.id, booking.eventTypeId))
    .where(and(eq(booking.partnerId, partnerId), gte(booking.eventDate, from), lte(booking.eventDate, to),
      inArray(booking.status, [...CAPACITY_STATUSES, 'completed'])))
    .orderBy(asc(booking.eventDate), asc(booking.approvedAt));
  const cap = capacityOf(p);
  const out: DayInfo[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const day = bks.filter(b => b.date === d);
    const booked = day.filter(b => (BOOKED_STATUSES as readonly string[]).includes(b.status));
    const held = day.filter(b => b.status === 'awaiting_payment');
    const taken = day.filter(b => (CAPACITY_STATUSES as readonly string[]).includes(b.status)).length;
    const block = blocks.find(b => b.startDate <= d && d <= b.endDate) ?? null;
    const notWorking = !p.workingDays.includes(isoWeekday(d));
    const closedBy = ruleClosed(p, d, t) ?? (p.onlySelectedDates && !open.has(d) ? 'not_opened' : null);
    const reason = closedBy ?? (block ? 'blocked' : notWorking ? 'not_working_day' : taken >= cap ? 'capacity' : null);
    const state: DayState = booked.length ? 'booked' : held.length ? 'held' : block || notWorking ? 'blocked' : closedBy ? 'closed' : 'free';
    const chip = state === 'booked' ? `${booked[0].eventType} · ${booked[0].guests} гости`
      : state === 'held' ? `Запазена до ${time(held[0].paymentDueAt)}`
      : state === 'blocked' ? 'Блокирана' : null;
    out.push({
      date: d, state, busy: reason !== null, reason, label: DAY_LABEL[state], chip, blockId: block?.id ?? null,
      bookings: day.map(b => ({ id: b.id, number: b.number, status: b.status, eventType: b.eventType, guests: b.guests, paymentDueAt: b.paymentDueAt })),
    });
  }
  return out;
}

/** ‹Свободни ли сте на 14 юни?› / the profile widget's date check (`availability.check()`). */
export async function check(partnerId: string, d: DateStr, q: Queryable = db): Promise<DayInfo & { requestable: boolean }> {
  const [info] = await dayRange(partnerId, d, d, q);
  return { ...info, requestable: !info.busy };
}

/**
 * The partner calendar for a month (`/partner/kalendar?mesec=YYYY-MM`, onboarding step 4):
 * every day with its state, the counts ‹N заети дати · N запазена · N блокирани ръчно›,
 * the rules and the list of manual blocks.
 */
export async function monthGrid(actor: AnyActor, a: { month: string }, q: Queryable = db) {
  if (!/^\d{4}-\d{2}$/.test(a.month)) throw new DomainError('invalid_month');
  const p = await partnerOf(actor, q);
  const from = `${a.month}-01`;
  const to = addDays(addMonths(from, 1), -1);
  const days = await dayRange(p.id, from, to, q);
  const blocks = await q.select().from(availabilityBlock)
    .where(and(eq(availabilityBlock.partnerId, p.id), gte(availabilityBlock.endDate, await today())))
    .orderBy(asc(availabilityBlock.startDate));
  return {
    month: a.month,
    days,
    counts: {
      booked: days.filter(d => d.state === 'booked').length,
      held: days.filter(d => d.state === 'held').length,
      blocked: days.filter(d => d.state === 'blocked' && d.blockId).length,
    },
    rules: {
      onePerDay: p.bookingsPerDayMode === 'one', mode: p.bookingsPerDayMode, maxBookingsPerDate: p.maxBookingsPerDate,
      onlySelectedDates: p.onlySelectedDates, leadTimeDays: p.leadTimeDays, horizonMonths: p.horizonMonths, workingDays: p.workingDays,
    },
    blocks,
  };
}

// ── Partner actions ──────────────────────────────────────────────────────

/** Onboarding step 4 (draft / returned; read-only while submitted) and the panel (approved / deactivated, D24). */
const EDITABLE: Partner['status'][] = ['draft', 'returned', 'approved', 'deactivated'];

async function calendarPartner(actor: AnyActor, tx: Tx): Promise<Partner> {
  const p = await lockPartnerOf(actor, tx);
  if (!EDITABLE.includes(p.status)) throw new DomainError('partner_status');
  return p;
}

/**
 * O5: a manual block makes the partner's date unavailable, so their open offers for
 * dates in the block lapse (no email, D60). A quote request whose offer lapses expires (R10).
 */
async function lapseOffers(tx: Tx, partnerId: string, from: DateStr, to: DateStr) {
  const at = await now();
  const briefOffers = await tx.select({ id: offer.id }).from(offer)
    .innerJoin(briefInvitation, eq(briefInvitation.id, offer.invitationId))
    .innerJoin(brief, eq(brief.id, briefInvitation.briefId))
    .where(and(eq(offer.partnerId, partnerId), eq(offer.status, 'sent'), gte(brief.eventDate, from), lte(brief.eventDate, to)));
  const quoteOffers = await tx.select({ id: offer.id, requestId: request.id }).from(offer)
    .innerJoin(request, eq(request.id, offer.requestId))
    .where(and(eq(offer.partnerId, partnerId), eq(offer.status, 'sent'), gte(request.eventDate, from), lte(request.eventDate, to)));
  const ids = [...briefOffers, ...quoteOffers].map(o => o.id);
  if (ids.length) await tx.update(offer).set({ status: 'lapsed', decidedAt: at }).where(inArray(offer.id, ids));
  const reqIds = quoteOffers.map(o => o.requestId);
  if (reqIds.length) {
    await tx.update(request).set({ status: 'expired', expiredAt: at, updatedAt: at })
      .where(and(inArray(request.id, reqIds), eq(request.status, 'offer_sent')));
  }
  return ids.length;
}

/** After dates may have become free: fire the date watches on them (§4.14 Notify). */
async function fireWatches(tx: Tx, partnerId: string, from?: DateStr, to?: DateStr) {
  const conds = [eq(dateWatch.partnerId, partnerId), eq(dateWatch.status, 'watching')];
  if (from) conds.push(gte(dateWatch.date, from));
  if (to) conds.push(lte(dateWatch.date, to));
  const dates = [...new Set((await tx.select({ d: dateWatch.date }).from(dateWatch).where(and(...conds))).map(r => r.d))];
  let n = 0;
  for (const d of dates) n += await notifyDateFreed(partnerId, d, tx);
  return n;
}

/**
 * ‹Блокирай период› / ‹Блокирай дата›: one block over [from, to]. Blocks it overlaps are merged
 * into it (one partner's blocks never overlap). Toasts ‹Периодът е блокиран в календара› / ‹Датата е блокирана в календара›.
 */
export async function blockRange(actor: AnyActor, a: { from: DateStr; to: DateStr; reason?: string | null }, tx?: Tx) {
  assertDate(a.from); assertDate(a.to);
  if (a.to < a.from) throw new DomainError('invalid_range');
  return withTx(tx, async t => {
    const p = await calendarPartner(actor, t);
    if (a.from < await today()) throw new DomainError('date_past');
    const overlapping = await t.select().from(availabilityBlock)
      .where(and(eq(availabilityBlock.partnerId, p.id), lte(availabilityBlock.startDate, a.to), gte(availabilityBlock.endDate, a.from)));
    const start = [a.from, ...overlapping.map(b => b.startDate)].sort()[0];
    const end = [a.to, ...overlapping.map(b => b.endDate)].sort().at(-1)!;
    if (overlapping.length) await t.delete(availabilityBlock).where(inArray(availabilityBlock.id, overlapping.map(b => b.id)));
    const [block] = await t.insert(availabilityBlock).values({
      partnerId: p.id, startDate: start, endDate: end, reason: a.reason?.trim() || overlapping.find(b => b.reason)?.reason || null,
      createdBy: (actor as { userId: string }).userId, createdAt: await now(),
    }).returning();
    const lapsed = await lapseOffers(t, p.id, a.from, a.to);
    await audit(t, { actor, action: 'availability.blocked', entity: 'partner', entityId: p.id, data: { from: start, to: end, lapsedOffers: lapsed } });
    return block;
  });
}

export async function blockDate(actor: AnyActor, a: { date: DateStr; reason?: string | null }, tx?: Tx) {
  return blockRange(actor, { from: a.date, to: a.date, reason: a.reason }, tx);
}

/** Remove one date from the partner's blocks (splitting a period). Returns how many watches fired. */
async function unblockDay(t: Tx, actor: AnyActor, p: Partner, d: DateStr): Promise<{ removed: boolean; watches: number }> {
  const [b] = await t.select().from(availabilityBlock)
    .where(and(eq(availabilityBlock.partnerId, p.id), lte(availabilityBlock.startDate, d), gte(availabilityBlock.endDate, d))).limit(1);
  if (!b) return { removed: false, watches: 0 };
  await t.delete(availabilityBlock).where(eq(availabilityBlock.id, b.id));
  const rest = [
    b.startDate < d ? { startDate: b.startDate, endDate: addDays(d, -1) } : null,
    b.endDate > d ? { startDate: addDays(d, 1), endDate: b.endDate } : null,
  ].filter(Boolean) as { startDate: DateStr; endDate: DateStr }[];
  if (rest.length) {
    await t.insert(availabilityBlock).values(rest.map(r => ({ ...r, partnerId: p.id, reason: b.reason, createdBy: b.createdBy, createdAt: b.createdAt })));
  }
  await audit(t, { actor, action: 'availability.unblocked', entity: 'partner', entityId: p.id, data: { date: d } });
  return { removed: true, watches: await fireWatches(t, p.id, d, d) };
}

/**
 * A click on a calendar day: a free day is blocked (‹Датата е блокирана›), a blocked day is
 * freed (‹Датата е освободена›; date watches fire).
 */
export async function toggleBlock(actor: AnyActor, a: { date: DateStr }, tx?: Tx): Promise<{ blocked: boolean; watchesNotified: number }> {
  assertDate(a.date);
  return withTx(tx, async t => {
    const p = await calendarPartner(actor, t);
    const r = await unblockDay(t, actor, p, a.date);
    if (r.removed) return { blocked: false, watchesNotified: r.watches };
    await blockRange(actor, { from: a.date, to: a.date }, t);
    return { blocked: true, watchesNotified: 0 };
  });
}

/** × on a block in the list (the whole period), or one date. Toast ‹Датата е освободена›; date watches fire. */
export async function unblock(actor: AnyActor, a: { blockId?: string; date?: DateStr }, tx?: Tx): Promise<{ watchesNotified: number }> {
  return withTx(tx, async t => {
    const p = await calendarPartner(actor, t);
    if (a.date) {
      assertDate(a.date);
      const r = await unblockDay(t, actor, p, a.date);
      if (!r.removed) throw new NotFoundError('block');
      return { watchesNotified: r.watches };
    }
    const [b] = await t.select().from(availabilityBlock)
      .where(and(eq(availabilityBlock.id, a.blockId ?? ''), eq(availabilityBlock.partnerId, p.id))).limit(1);
    if (!b) throw new NotFoundError('block');
    await t.delete(availabilityBlock).where(eq(availabilityBlock.id, b.id));
    await audit(t, { actor, action: 'availability.unblocked', entity: 'partner', entityId: p.id, data: { from: b.startDate, to: b.endDate } });
    return { watchesNotified: await fireWatches(t, p.id, b.startDate, b.endDate) };
  });
}

/**
 * Calendar rules: ‹Само едно събитие на ден›, stepper ‹Максимум резервации за дата› (1–9),
 * ‹Приемам заявки само за избрани дати›; also lead time, horizon and working days (onboarding step 4).
 * Dates freed by the change fire their watches.
 */
export async function setRules(actor: AnyActor, a: {
  bookingsPerDayMode?: BookingsPerDayMode; maxBookingsPerDate?: number; onlySelectedDates?: boolean;
  leadTimeDays?: number; horizonMonths?: number; workingDays?: number[];
}, tx?: Tx) {
  if (a.maxBookingsPerDate !== undefined && !(Number.isInteger(a.maxBookingsPerDate) && a.maxBookingsPerDate >= 1 && a.maxBookingsPerDate <= 9)) throw new DomainError('invalid_max_bookings');
  if (a.leadTimeDays !== undefined && !(LEAD_TIME_OPTIONS as readonly number[]).includes(a.leadTimeDays)) throw new DomainError('invalid_lead_time');
  if (a.horizonMonths !== undefined && !(HORIZON_OPTIONS as readonly number[]).includes(a.horizonMonths)) throw new DomainError('invalid_horizon');
  if (a.workingDays !== undefined && (!a.workingDays.length || a.workingDays.some(d => !Number.isInteger(d) || d < 1 || d > 7))) throw new DomainError('invalid_working_days');
  return withTx(tx, async t => {
    const p = await calendarPartner(actor, t);
    const set: Partial<Partner> = { updatedAt: await now() };
    if (a.bookingsPerDayMode) set.bookingsPerDayMode = a.bookingsPerDayMode;
    if (a.maxBookingsPerDate !== undefined) set.maxBookingsPerDate = a.maxBookingsPerDate;
    if (a.onlySelectedDates !== undefined) set.onlySelectedDates = a.onlySelectedDates;
    if (a.leadTimeDays !== undefined) set.leadTimeDays = a.leadTimeDays;
    if (a.horizonMonths !== undefined) set.horizonMonths = a.horizonMonths;
    if (a.workingDays !== undefined) set.workingDays = [...new Set(a.workingDays)].sort();
    const [row] = await t.update(partner).set(set).where(eq(partner.id, p.id)).returning();
    await audit(t, { actor, action: 'availability.rules_changed', entity: 'partner', entityId: p.id, data: { ...a } });
    const watchesNotified = await fireWatches(t, p.id);
    return { partner: row, watchesNotified };
  });
}

/** ‹Приемам заявки само за избрани дати›: open or close one date. Opening may free it (watches fire). */
export async function toggleOpenDate(actor: AnyActor, a: { date: DateStr }, tx?: Tx): Promise<{ open: boolean }> {
  assertDate(a.date);
  return withTx(tx, async t => {
    const p = await calendarPartner(actor, t);
    const del = await t.delete(availabilityOpenDate)
      .where(and(eq(availabilityOpenDate.partnerId, p.id), eq(availabilityOpenDate.date, a.date))).returning();
    if (del.length) {
      await audit(t, { actor, action: 'availability.date_closed', entity: 'partner', entityId: p.id, data: { date: a.date } });
      return { open: false };
    }
    await t.insert(availabilityOpenDate).values({ partnerId: p.id, date: a.date });
    await audit(t, { actor, action: 'availability.date_opened', entity: 'partner', entityId: p.id, data: { date: a.date } });
    await fireWatches(t, p.id, a.date, a.date);
    return { open: true };
  });
}
