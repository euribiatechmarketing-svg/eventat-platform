// Payouts (SPEC §4.10, §8, ledger §7.5 L3/L4/L4r/L6).
//
// A booking's partner money moves through payout lines:
//   Y1  createPayoutLine()      awaiting_event (K5; projected ‹Получавате›)
//   Y2  releaseBookingFunds()   → ready: ledger L3 moves the base out of client_funds
//                               (K13, a cancellation's retained amount at event_date + 1,
//                               a dispute decision, or T18 as `released_early`)
//   Y3  prepareBatch()          T17 the day before the batch at 09:00: one payout_item per
//                               partner, held items for paused / disputed partners, totals,
//                               `team-batch-ready`
//   Y5  releaseBatch()          ‹Пусни партидата› (release_payouts; optional second admin, D40):
//                               L6 nets any partner_receivable, items → sent, one provider
//                               payout per item (job `payout.submit`)
//   Y6  provider payout.paid    → item paid, ledger L4, `vendor-payout-sent` per line
//   Y7                          all items paid → batch paid, `team-batch-paid`
//   Y8  provider payout.failed  → L4r if L4 was posted, lines back to ready, partner
//                               payouts_paused, `team-transfer-failed`
//   Y9  requestBatchReport()    report_job + `team-batch-report`; CSV via reportCsv()
//
// The amount actually paid to a partner is never more than what the ledger
// owes them: min(Σ line amounts, partner_payable − amounts already sent), so
// refunds after release and netted receivables can never overpay.
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, cancellation, chargeback, dispute, partner, payoutAccount, payoutBatch, payoutItem, payoutLine,
  refund, reportJob, user, type HoldReason, type PayoutLineStatus,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { addDays, date as fmtDate, monthName, money, sofiaDate, sofiaInstant, type DateStr } from '@/lib/format';
import { SYSTEM, assertCan, type Actor } from './actor';
import { audit } from './audit';
import { accountBalance, partnerBalances, postTransaction } from './ledger';
import { getSetting } from './settings';
import {
  AftercareError, bpOf, ctxText, errorText, isFinalAttempt, loadBookingCtx, mail, mailPartner, mailTeam, outstandingRefundCents, owedRefundSql,
  providerFor, routes, scheduleOnce, schedule, withTx, type BookingRow,
} from './aftercare-shared';

type LineRow = typeof payoutLine.$inferSelect;
type ItemRow = typeof payoutItem.$inferSelect;
type BatchRow = typeof payoutBatch.$inferSelect;

/** Lines whose money has not left for the partner yet. */
const UNPAID_LINE: PayoutLineStatus[] = ['awaiting_event', 'ready', 'held', 'released_early', 'in_batch'];

// ── Batch dates and labels (SPEC §8) ──────────────────────────────────────

/** The first payout day (⚙ payout.days, default 1st/15th) on or after `d`. */
export function payoutDayOnOrAfter(d: DateStr, days: number[] = [1, 15]): DateStr {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  let y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
  for (let i = 0; i < 3; i++) {
    for (const day of sorted) {
      const cand = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (cand >= d) return cand;
    }
    m++;
    if (m > 12) { m = 1; y++; }
  }
  throw new AftercareError('bad_payout_days', `No payout day after ${d} in ${days.join(',')}`);
}

/** Batch date for a hold date: event 14.06.2026 → 15.06.2026; 30.06.2026 → 01.07.2026 (SPEC §8). */
export async function batchDateFor(holdUntil: DateStr, q: Queryable = db): Promise<DateStr> {
  return payoutDayOnOrAfter(holdUntil, await getSetting('payout.days', undefined, q));
}

/** ‹август · първа половина› (15th) / ‹юли · втора половина› (1st: the previous month's second half). */
export function batchName(batchDate: DateStr): string {
  const m = Number(batchDate.slice(5, 7)), d = Number(batchDate.slice(8, 10));
  if (d === 1) return `${monthName(m === 1 ? 12 : m - 1)} · втора половина`;
  return `${monthName(m)} · ${d <= 15 ? 'първа' : 'втора'} половина`;
}

/** ‹Партида август · първа половина› */
export const batchLabel = (batchDate: DateStr) => `Партида ${batchName(batchDate)}`;

/**
 * The rail label of a new batch (SPEC §8: ‹Обединена банка · SEPA›, "from the
 * provider"). Stripe pays out over SEPA under its own name; the simulated
 * provider has no rail of its own, so the label on record (the seed's
 * historical batches) carries over. No label is invented: without one the
 * batch has none (new copy would need approval).
 */
async function railLabelFor(tx: Queryable): Promise<string | null> {
  if ((await getSetting('payment.provider', undefined, tx)) === 'stripe') return 'Stripe · SEPA';
  const [last] = await tx.select({ rail: payoutBatch.railLabel }).from(payoutBatch)
    .where(isNotNull(payoutBatch.railLabel)).orderBy(desc(payoutBatch.batchDate)).limit(1);
  return last?.rail ?? null;
}

/** The ‹Банка› of the team emails: the batch's rail without the ‹ · SEPA› the templates add. */
const bankOf = (batch: { railLabel: string | null }) => (batch.railLabel ?? '').replace(/\s*·\s*SEPA$/, '');

// ── Lines (Y1, Y2) ────────────────────────────────────────────────────────

async function mainLine(tx: Queryable, bookingId: string): Promise<LineRow | null> {
  const [l] = await tx.select().from(payoutLine).where(and(eq(payoutLine.bookingId, bookingId), isNull(payoutLine.chargeId)))
    .orderBy(desc(payoutLine.createdAt)).limit(1);
  return l ?? null;
}

/**
 * Make sure the T17 preparation job for a batch date exists (`payouts.prepare` /
 * `batch:<date>`). A date already in the past is never prepared after the fact:
 * its lines (batch_date ≤ the next date) join the next upcoming batch instead.
 */
export async function ensureBatchScheduled(batchDate: DateStr, tx: Tx): Promise<void> {
  const today = sofiaDate(await now());
  const d = batchDate >= today ? batchDate : payoutDayOnOrAfter(today, await getSetting('payout.days', undefined, tx));
  const [hh, mm] = (await getSetting('payout.prepare_time', undefined, tx)).split(':').map(Number);
  await scheduleOnce('payouts.prepare', sofiaInstant(addDays(d, -1), hh, mm), { batchDate: d }, `batch:${d}`, tx);
}

/** Bootstrap the T17 chain: the next payout day's preparation (the handler then schedules the one after). */
export async function ensurePayoutSchedule(tx?: Tx): Promise<DateStr> {
  return withTx(tx, async tx => {
    const days = await getSetting('payout.days', undefined, tx);
    let d = payoutDayOnOrAfter(sofiaDate(await now()), days);
    const [b] = await tx.select({ status: payoutBatch.status }).from(payoutBatch).where(eq(payoutBatch.batchDate, d));
    if (b && b.status !== 'scheduled') d = payoutDayOnOrAfter(addDays(d, 1), days);
    await ensureBatchScheduled(d, tx);
    return d;
  });
}

/**
 * Y1 (K5, lifecycle): the booking's payout line, `awaiting_event`, with the
 * projected ‹Получавате› at the booking's commission snapshot. Idempotent.
 */
export async function createPayoutLine(bookingId: string, tx: Tx): Promise<LineRow> {
  const existing = await mainLine(tx, bookingId);
  if (existing) return existing;
  const [b] = await tx.select().from(booking).where(eq(booking.id, bookingId));
  if (!b) throw new AftercareError('not_found');
  const base = b.amountCents + b.bookingFeeCents;
  const commission = bpOf(base, b.commissionBp ?? 0);
  const [l] = await tx.insert(payoutLine).values({
    bookingId, partnerId: b.partnerId, batchDate: b.batchDate, baseCents: base, commissionCents: commission, amountCents: base - commission,
    status: b.payoutHold ? 'held' : 'awaiting_event', holdReason: b.payoutHold ? 'dispute' : null,
  }).returning();
  await ensureBatchScheduled(b.batchDate, tx);
  return l;
}

/**
 * What the partner is due for a booking before commission: the price, the
 * retained amount after a cancellation, less dispute refunds the client is owed
 * (pending, succeeded, or failed and not yet retried: F3 keeps that money held).
 */
async function partnerDueBase(tx: Queryable, b: BookingRow): Promise<number> {
  if (b.status === 'cancelled') {
    const [c] = await tx.select({ retained: cancellation.retainedCents }).from(cancellation).where(eq(cancellation.bookingId, b.id));
    return c?.retained ?? 0;
  }
  const [r] = await tx.select({ s: sql<number>`coalesce(sum(${refund.amountCents}), 0)::int`.mapWith(Number) }).from(refund)
    .where(and(eq(refund.bookingId, b.id), eq(refund.reason, 'dispute_decision'), owedRefundSql));
  return b.amountCents + b.bookingFeeCents - (r?.s ?? 0);
}

/** Base already released to the partner (Σ released lines, net of clawbacks). */
async function releasedBase(tx: Queryable, bookingId: string): Promise<number> {
  return (await released(tx, bookingId)).base;
}

/** Σ base and commission of the booking's released lines (net of clawbacks). */
async function released(tx: Queryable, bookingId: string): Promise<{ base: number; commission: number }> {
  const [r] = await tx.select({
    base: sql<number>`coalesce(sum(${payoutLine.baseCents}), 0)::int`.mapWith(Number),
    commission: sql<number>`coalesce(sum(${payoutLine.commissionCents}), 0)::int`.mapWith(Number),
  }).from(payoutLine).where(and(eq(payoutLine.bookingId, bookingId), isNotNull(payoutLine.readyAt)));
  return { base: r?.base ?? 0, commission: r?.commission ?? 0 };
}

export type ReleaseResult = { releasedCents: number; commissionCents: number; lineId: string | null; held: boolean };

/**
 * Ledger L3 (SPEC §7.5) and Y2: release what the partner is due from the money
 * still held for the booking — Dr client_funds B · Cr partner_payable (B − C) ·
 * Cr commission_revenue C; Dr platform_cash C · Cr provider_held C — with C at
 * the booking's commission snapshot (SPEC §6). Never releases money that a
 * pending refund needs, a duplicate charge, or more than the partner is due.
 * Does nothing while a dispute holds the payout (K13), unless `early`.
 *
 * Lifecycle's T13 (K13 booking completion) must release through this function.
 * `early` = T18 (SPEC §7.4): that charge's share, as a `released_early` line.
 */
export async function releaseBookingFunds(
  a: { bookingId: string; baseCents?: number; early?: { chargeId: string }; description?: string }, tx: Tx,
): Promise<ReleaseResult> {
  const [b] = await tx.select().from(booking).where(eq(booking.id, a.bookingId)).for('update');
  if (!b) throw new AftercareError('not_found');
  if (b.payoutHold && !a.early) return { releasedCents: 0, commissionCents: 0, lineId: null, held: true };
  const held = await accountBalance(tx, 'client_funds', { bookingId: b.id });
  const available = held - (await outstandingRefundCents(tx, b.id));
  const already = await released(tx, b.id);
  const due = (await partnerDueBase(tx, b)) - already.base;
  const B = Math.min(available, due, a.baseCents ?? Number.POSITIVE_INFINITY);
  if (B <= 0) return { releasedCents: 0, commissionCents: 0, lineId: null, held: false };
  // Rounded once per booking (SPEC §0, §6): a release in parts (T18, then K13) adds up to round_half_up(base × rate).
  const C = Math.min(B, Math.max(0, bpOf(already.base + B, b.commissionBp ?? 0) - already.commission));
  await postTransaction(tx, {
    kind: a.early ? 'early_release' : 'release', bookingId: b.id, partnerId: b.partnerId, chargeId: a.early?.chargeId ?? null,
    description: a.description ?? `${a.early ? 'L3 early release' : 'L3 release'} ${b.number}`,
    lines: [
      { account: 'client_funds', debit: B },
      ...(B - C > 0 ? [{ account: 'partner_payable' as const, credit: B - C }] : []),
      ...(C > 0 ? [
        { account: 'commission_revenue' as const, credit: C },
        { account: 'platform_cash' as const, debit: C },
        { account: 'provider_held' as const, credit: C },
      ] : []),
    ],
  });
  const at = await now();
  const today = sofiaDate(at);
  const days = await getSetting('payout.days', undefined, tx);
  let line: LineRow;
  if (a.early) {
    const batchDate = payoutDayOnOrAfter(today, days);
    [line] = await tx.insert(payoutLine).values({
      bookingId: b.id, chargeId: a.early.chargeId, partnerId: b.partnerId, batchDate, baseCents: B, commissionCents: C, amountCents: B - C,
      status: 'released_early', readyAt: at,
    }).returning();
  } else {
    const batchDate = payoutDayOnOrAfter(b.holdUntil > today ? b.holdUntil : today, days);
    const main = await mainLine(tx, b.id);
    if (main && !main.readyAt) {
      [line] = await tx.update(payoutLine).set({
        baseCents: B, commissionCents: C, amountCents: B - C, status: 'ready', holdReason: null, readyAt: at, batchDate,
      }).where(eq(payoutLine.id, main.id)).returning();
    } else if (main && (main.status === 'ready' || main.status === 'held')) {
      [line] = await tx.update(payoutLine).set({
        baseCents: main.baseCents + B, commissionCents: main.commissionCents + C, amountCents: main.amountCents + B - C,
      }).where(eq(payoutLine.id, main.id)).returning();
    } else {
      [line] = await tx.insert(payoutLine).values({
        bookingId: b.id, partnerId: b.partnerId, batchDate, baseCents: B, commissionCents: C, amountCents: B - C, status: 'ready', readyAt: at,
      }).returning();
    }
  }
  await ensureBatchScheduled(line.batchDate, tx);
  // A batch T17 already prepared shows the line now (its events end the night before the batch, Y5).
  await resyncPreparedBatch(tx, b.id);
  await audit(tx, {
    actor: SYSTEM, action: a.early ? 'booking.funds_released_early' : 'booking.funds_released', entity: 'booking', entityId: b.id,
    data: { number: b.number, baseCents: B, commissionCents: C, partnerCents: B - C, lineId: line.id, batchDate: line.batchDate },
  });
  return { releasedCents: B, commissionCents: C, lineId: line.id, held: false };
}

/**
 * After a cancellation (K7/K9/K11/K12/K15): the booking's unreleased line now
 * carries only the retained amount (‹Получавате› = retained − commission), or
 * is cancelled when nothing is retained.
 */
export async function adjustLinesForCancellation(tx: Tx, b: BookingRow, retainedCents: number): Promise<void> {
  const main = await mainLine(tx, b.id);
  const unreleased = main && !main.readyAt && main.status !== 'cancelled' ? main : null;
  const already = await releasedBase(tx, b.id);
  const base = Math.max(0, retainedCents - already);
  const commission = bpOf(base, b.commissionBp ?? 0);
  if (unreleased) {
    await tx.update(payoutLine).set(base > 0
      ? { baseCents: base, commissionCents: commission, amountCents: base - commission }
      : { baseCents: 0, commissionCents: 0, amountCents: 0, status: 'cancelled', holdReason: null, payoutItemId: null })
      .where(eq(payoutLine.id, unreleased.id));
  } else if (base > 0) {
    await tx.insert(payoutLine).values({
      bookingId: b.id, partnerId: b.partnerId, batchDate: b.batchDate, baseCents: base, commissionCents: commission, amountCents: base - commission,
      status: b.payoutHold ? 'held' : 'awaiting_event', holdReason: b.payoutHold ? 'dispute' : null,
    });
    await ensureBatchScheduled(b.batchDate, tx);
  }
}

/**
 * A dispute's partial refund decided before the event (X8): the booking's unreleased line carries the
 * projected ‹Получавате› of what the partner is now due (price − the refund, commission at the booking's
 * snapshot), as K13 will release it — the partner's booking page and earnings, and the batch projections,
 * read this line. Nothing is due any more → the line is cancelled. A released line is left to L2.
 */
export async function reprojectBookingLine(tx: Tx, bookingId: string): Promise<void> {
  const [b] = await tx.select().from(booking).where(eq(booking.id, bookingId));
  const main = await mainLine(tx, bookingId);
  if (!b || !main || main.readyAt || main.status === 'cancelled') return;
  const already = await released(tx, bookingId);
  const base = Math.max(0, (await partnerDueBase(tx, b)) - already.base);
  const commission = Math.min(base, Math.max(0, bpOf(already.base + base, b.commissionBp ?? 0) - already.commission));
  await tx.update(payoutLine).set(base > 0
    ? { baseCents: base, commissionCents: commission, amountCents: base - commission }
    : { baseCents: 0, commissionCents: 0, amountCents: 0, status: 'cancelled', holdReason: null, payoutItemId: null })
    .where(eq(payoutLine.id, main.id));
}

/** A dispute or chargeback holds the payout (K14, Y4): unsent lines → held; prepared items lose them. */
export async function holdBookingLines(tx: Tx, bookingId: string): Promise<void> {
  const lines = await tx.select().from(payoutLine)
    .where(and(eq(payoutLine.bookingId, bookingId), inArray(payoutLine.status, ['awaiting_event', 'ready', 'released_early', 'held'])));
  const items = new Set<string>();
  for (const l of lines) {
    if (l.payoutItemId) items.add(l.payoutItemId);
    await tx.update(payoutLine).set({ status: 'held', holdReason: 'dispute', payoutItemId: null }).where(eq(payoutLine.id, l.id));
  }
  for (const id of items) await refreshItem(tx, id);
}

/** The hold is over: dispute-held lines go back to where they were (ready / released_early / awaiting_event). */
export async function unholdBookingLines(tx: Tx, bookingId: string): Promise<void> {
  const lines = await tx.select().from(payoutLine)
    .where(and(eq(payoutLine.bookingId, bookingId), eq(payoutLine.status, 'held'), eq(payoutLine.holdReason, 'dispute')));
  for (const l of lines) {
    const status: PayoutLineStatus = l.readyAt ? (l.chargeId ? 'released_early' : 'ready') : 'awaiting_event';
    await tx.update(payoutLine).set({ status, holdReason: null }).where(eq(payoutLine.id, l.id));
  }
}

/** Release what is due once the event is over and nothing holds the payout (after a dispute or chargeback ends). */
export async function releaseIfDue(tx: Tx, bookingId: string): Promise<ReleaseResult | null> {
  const [b] = await tx.select().from(booking).where(eq(booking.id, bookingId));
  if (!b || b.payoutHold) return null;
  if (!['confirmed', 'cancellation_requested', 'completed', 'cancelled'].includes(b.status)) return null;
  if (sofiaDate(await now()) < b.holdUntil) return null;
  return releaseBookingFunds({ bookingId }, tx);
}

/**
 * booking.payout_hold = an open dispute with holds_payout, or an open
 * chargeback, on the booking (K14, D13). Holds or frees its lines; when freed
 * and the event is over, releases what is due (the release waited, K13).
 */
export async function syncBookingHold(tx: Tx, bookingId: string): Promise<boolean> {
  const [d] = await tx.select({ id: dispute.id }).from(dispute)
    .where(and(eq(dispute.bookingId, bookingId), inArray(dispute.status, ['collecting', 'awaiting_decision']), eq(dispute.holdsPayout, true))).limit(1);
  const [cb] = await tx.select({ id: chargeback.id }).from(chargeback)
    .where(and(eq(chargeback.bookingId, bookingId), eq(chargeback.status, 'open'))).limit(1);
  const hold = !!d || !!cb;
  await tx.update(booking).set({ payoutHold: hold, updatedAt: await now() }).where(eq(booking.id, bookingId));
  if (hold) await holdBookingLines(tx, bookingId);
  else {
    await unholdBookingLines(tx, bookingId);
    await releaseIfDue(tx, bookingId);
  }
  await resyncPreparedBatch(tx, bookingId);
  return hold;
}

/**
 * A batch prepared by T17 but not released yet follows what happened to one of its bookings since: a hold
 * that ended (a dispute decided or withdrawn, a chargeback closed) or began, or a refund that settled,
 * changes which lines are payable and for how much. Its items and totals are drawn from the lines again,
 * as ‹Пусни партидата› does (Y4: cleared lines join with the decided amount), so the payments page and the
 * release dialog show what will be paid. Only the first prepared batch the booking's lines belong to.
 * Restating touches every line of the batch, after the caller has already changed this booking's lines: two
 * such transactions (a decision while ‹Пусни партидата› or another restatement runs, e.g. from an overlapping tick) would each wait
 * for the other's line rows while one holds the batch row — a deadlock. So a batch row someone else holds is
 * skipped: that holder is restating or releasing it (Y5 groups the lines again), and the next change restates it.
 */
export async function resyncPreparedBatch(tx: Tx, bookingId: string): Promise<void> {
  const lines = await tx.select({ batchDate: payoutLine.batchDate, itemId: payoutLine.payoutItemId }).from(payoutLine)
    .where(and(eq(payoutLine.bookingId, bookingId), inArray(payoutLine.status, ['awaiting_event', 'ready', 'held', 'released_early'])));
  if (!lines.length) return;
  const itemIds = lines.map(l => l.itemId).filter((x): x is string => !!x);
  const inItems = itemIds.length ? await tx.select({ batchId: payoutItem.batchId }).from(payoutItem).where(inArray(payoutItem.id, itemIds)) : [];
  const from = lines.map(l => l.batchDate).sort()[0];
  const [first] = await tx.select({ id: payoutBatch.id }).from(payoutBatch)
    .where(and(eq(payoutBatch.status, 'ready'), inItems.length ? or(gte(payoutBatch.batchDate, from), inArray(payoutBatch.id, inItems.map(i => i.batchId))) : gte(payoutBatch.batchDate, from)))
    .orderBy(asc(payoutBatch.batchDate)).limit(1);
  if (!first) return;
  const [batch] = await tx.select().from(payoutBatch).where(and(eq(payoutBatch.id, first.id), eq(payoutBatch.status, 'ready')))
    .for('update', { skipLocked: true });
  if (batch) await restateBatch(tx, batch);
}

/** Y3 grouping of a prepared batch: items from the due lines, each payable item at what the ledger owes, totals. */
async function restateBatch(tx: Tx, batch: BatchRow) {
  const synced = await syncBatch(tx, batch);
  for (const s of synced.ready) {
    const { amount } = await payoutAmount(tx, s.item.partnerId, s.lines.reduce((x, l) => x + l.amountCents, 0));
    await tx.update(payoutItem).set({ amountCents: amount }).where(eq(payoutItem.id, s.item.id));
  }
  await recomputeTotals(tx, batch.id);
  return synced;
}

/** Σ amounts of the partner's items handed to the provider and not confirmed yet. */
async function sentUnpaid(tx: Queryable, partnerId: string): Promise<number> {
  const [r] = await tx.select({ s: sql<number>`coalesce(sum(${payoutItem.amountCents}), 0)::int`.mapWith(Number) }).from(payoutItem)
    .where(and(eq(payoutItem.partnerId, partnerId), eq(payoutItem.status, 'sent')));
  return r?.s ?? 0;
}

export type Clawback = {
  /** Dr partner_payable: the booking's released-but-unpaid share. */
  payableCents: number;
  /** Dr partner_receivable: what was already paid out (netted from the next payouts, L6). */
  receivableCents: number;
  /** Dr commission_revenue · Cr platform_cash: the commission on what the partner no longer keeps. */
  commissionCents: number;
  /** The lines changed, as they were before (to undo a won chargeback). */
  adjustments: { lineId: string; base: number; commission: number; amount: number; status: PayoutLineStatus }[];
};

/**
 * Money leaving after it was released to the partner (ledger L2 tail, SPEC §7.5;
 * chargebacks): split X into the partner's share and the commission at the
 * booking's rate, take the partner's share from the booking's unpaid lines
 * first (Dr partner_payable), then from paid ones (Dr partner_receivable), and
 * shrink those unpaid lines so ‹Получавате› stays true.
 */
export async function clawBackReleased(tx: Tx, b: BookingRow, x: number): Promise<Clawback> {
  const bp = b.commissionBp ?? 0;
  const out: Clawback = { payableCents: 0, receivableCents: 0, commissionCents: 0, adjustments: [] };
  if (x <= 0) return out;
  const lines = await tx.select().from(payoutLine)
    .where(and(eq(payoutLine.bookingId, b.id), isNotNull(payoutLine.readyAt), ne(payoutLine.status, 'cancelled')))
    .orderBy(desc(payoutLine.createdAt)).for('update');
  let rem = x;
  const touched = new Set<string>();
  for (const l of lines.filter(l => l.status === 'ready' || l.status === 'held' || l.status === 'released_early')) {
    if (rem <= 0) break;
    const d = Math.min(rem, l.baseCents);
    if (d <= 0) continue;
    const base = l.baseCents - d;
    const commission = bpOf(base, bp);
    const dC = Math.min(d, Math.max(0, l.commissionCents - commission));
    out.payableCents += d - dC;
    out.commissionCents += dC;
    out.adjustments.push({ lineId: l.id, base: l.baseCents, commission: l.commissionCents, amount: l.amountCents, status: l.status });
    if (l.payoutItemId) touched.add(l.payoutItemId);
    await tx.update(payoutLine).set(base > 0
      ? { baseCents: base, commissionCents: commission, amountCents: base - commission }
      : { baseCents: 0, commissionCents: 0, amountCents: 0, status: 'cancelled', holdReason: null, payoutItemId: null })
      .where(eq(payoutLine.id, l.id));
    rem -= d;
  }
  if (rem > 0) {
    const paid = lines.filter(l => l.status === 'paid' || l.status === 'in_batch');
    const bPaid = paid.reduce((s, l) => s + l.baseCents, 0), cPaid = paid.reduce((s, l) => s + l.commissionCents, 0);
    const commission = paid.length ? Math.min(rem, Math.max(0, cPaid - bpOf(Math.max(0, bPaid - rem), bp))) : bpOf(rem, bp);
    out.commissionCents += commission;
    out.receivableCents += rem - commission;
  }
  // Never debit more partner_payable than is owed and not already on its way.
  const avail = Math.max(0, (await accountBalance(tx, 'partner_payable', { partnerId: b.partnerId })) - (await sentUnpaid(tx, b.partnerId)));
  if (out.payableCents > avail) {
    out.receivableCents += out.payableCents - avail;
    out.payableCents = avail;
  }
  for (const id of touched) await refreshItem(tx, id);
  return out;
}

// ── Batches (Y3–Y8) ───────────────────────────────────────────────────────

/** Why the partner's payout is held this batch (SPEC §8.3, Y4), or null. */
export async function partnerHoldReason(tx: Queryable, partnerId: string): Promise<HoldReason | null> {
  const [p] = await tx.select().from(partner).where(eq(partner.id, partnerId));
  if (!p.providerPayoutsEnabled) return 'provider_disabled';
  if (p.payoutsPaused) {
    const [last] = await tx.select({ status: payoutItem.status }).from(payoutItem).where(eq(payoutItem.partnerId, partnerId))
      .orderBy(desc(payoutItem.createdAt)).limit(1);
    return last?.status === 'failed' ? 'returned' : 'account_check';
  }
  const [acct] = await tx.select({ id: payoutAccount.id }).from(payoutAccount)
    .where(and(eq(payoutAccount.partnerId, partnerId), eq(payoutAccount.status, 'confirmed'))).limit(1);
  if (!acct) return 'account_check';
  const [cb] = await tx.select({ id: chargeback.id }).from(chargeback)
    .where(and(eq(chargeback.partnerId, partnerId), eq(chargeback.status, 'open'))).limit(1);
  if (cb) return 'dispute';
  return null;
}

async function openDisputeId(tx: Queryable, bookingId: string): Promise<string | null> {
  const [d] = await tx.select({ id: dispute.id }).from(dispute)
    .where(and(eq(dispute.bookingId, bookingId), inArray(dispute.status, ['collecting', 'awaiting_decision']))).limit(1);
  return d?.id ?? null;
}

/** Recompute an unsent item's amount from its lines (after lines left it). Empty unsent items are removed. */
async function refreshItem(tx: Tx, itemId: string): Promise<void> {
  const [item] = await tx.select().from(payoutItem).where(eq(payoutItem.id, itemId));
  if (!item || (item.status !== 'ready' && item.status !== 'held')) return;
  const [s] = await tx.select({ n: sql<number>`count(*)::int`.mapWith(Number), sum: sql<number>`coalesce(sum(${payoutLine.amountCents}), 0)::int`.mapWith(Number) })
    .from(payoutLine).where(eq(payoutLine.payoutItemId, itemId));
  const [batch] = await tx.select().from(payoutBatch).where(eq(payoutBatch.id, item.batchId));
  if (!s.n && batch.status === 'ready' && item.status === 'ready') {
    await tx.delete(payoutItem).where(eq(payoutItem.id, itemId));
  } else {
    await tx.update(payoutItem).set({ amountCents: s.sum }).where(eq(payoutItem.id, itemId));
  }
  if (batch.status === 'ready') await recomputeTotals(tx, batch.id);
}

async function recomputeTotals(tx: Tx, batchId: string): Promise<void> {
  const items = await tx.select().from(payoutItem).where(eq(payoutItem.batchId, batchId));
  const payIds = items.filter(i => i.status !== 'held' && i.status !== 'failed').map(i => i.id);
  const lines = payIds.length ? await tx.select().from(payoutLine).where(inArray(payoutLine.payoutItemId, payIds)) : [];
  const held = items.filter(i => i.status === 'held').reduce((s, i) => s + i.amountCents, 0);
  const [b] = await tx.select().from(payoutBatch).where(eq(payoutBatch.id, batchId));
  const extraHeld = await detachedDisputeHeld(tx, b.batchDate);
  await tx.update(payoutBatch).set({
    partnerCount: payIds.length,
    grossCents: lines.reduce((s, l) => s + l.baseCents, 0),
    commissionCents: lines.reduce((s, l) => s + l.commissionCents, 0),
    netCents: items.filter(i => payIds.includes(i.id)).reduce((s, i) => s + i.amountCents, 0),
    heldCents: held + extraHeld,
  }).where(eq(payoutBatch.id, batchId));
}

/** Dispute-held lines due by this date that are not shown in a held item (their partner has a payable item). */
async function detachedDisputeHeld(tx: Queryable, batchDate: DateStr): Promise<number> {
  const [r] = await tx.select({ s: sql<number>`coalesce(sum(${payoutLine.amountCents}), 0)::int`.mapWith(Number) }).from(payoutLine)
    .where(and(lte(payoutLine.batchDate, batchDate), eq(payoutLine.status, 'held'), eq(payoutLine.holdReason, 'dispute'), isNull(payoutLine.payoutItemId)));
  return r?.s ?? 0;
}

type SyncedItem = { item: ItemRow; lines: LineRow[] };

/**
 * Group the lines due by the batch date into one item per partner (Y3; again
 * at Y5 so lines that became ready since — events of the day before — join).
 * Lines whose booking is under a dispute hold stay out; a partner under a
 * payout hold (§8.3) gets a `held` item. Writes items and line links only.
 */
async function syncBatch(tx: Tx, batch: BatchRow): Promise<{ ready: SyncedItem[]; heldItems: SyncedItem[]; disputeHeld: { partnerId: string; amount: number }[] }> {
  // A booking with a refund still pending at the provider is not paid out until the refund settles (L2 may claw back).
  const pendingRefund = sql<boolean>`exists (select 1 from refund r where r.booking_id = ${payoutLine.bookingId} and r.status = 'pending')`;
  const rows = await tx.select({ line: payoutLine, payoutHold: booking.payoutHold, pendingRefund, itemStatus: payoutItem.status, itemBatch: payoutItem.batchId })
    .from(payoutLine)
    .innerJoin(booking, eq(booking.id, payoutLine.bookingId))
    .leftJoin(payoutItem, eq(payoutItem.id, payoutLine.payoutItemId))
    .where(and(
      lte(payoutLine.batchDate, batch.batchDate),
      inArray(payoutLine.status, ['ready', 'released_early', 'held']),
      or(isNull(payoutLine.payoutItemId), eq(payoutItem.status, 'held'), and(eq(payoutItem.batchId, batch.id), eq(payoutItem.status, 'ready'))),
    ))
    .orderBy(asc(payoutLine.createdAt));
  const byPartner = new Map<string, { line: LineRow; disputeHeld: boolean }[]>();
  for (const r of rows) {
    // booking.payout_hold is the source of truth for a booking-level hold; a line's `dispute` reason may
    // also come from a partner-level freeze (open chargeback), which partnerHoldReason() decides below.
    const disputeHeld = r.payoutHold || r.pendingRefund || !r.line.readyAt;
    const list = byPartner.get(r.line.partnerId) ?? [];
    list.push({ line: r.line, disputeHeld });
    byPartner.set(r.line.partnerId, list);
  }
  const existing = await tx.select().from(payoutItem).where(eq(payoutItem.batchId, batch.id));
  const out = { ready: [] as SyncedItem[], heldItems: [] as SyncedItem[], disputeHeld: [] as { partnerId: string; amount: number }[] };
  const upsertItem = async (partnerId: string, v: { status: 'ready' | 'held'; holdReason: HoldReason | null; disputeId: string | null; amountCents: number }) => {
    const found = existing.find(i => i.partnerId === partnerId);
    if (found) {
      if (found.status !== 'ready' && found.status !== 'held') throw new AftercareError('batch_item_sent');
      const [i] = await tx.update(payoutItem).set(v).where(eq(payoutItem.id, found.id)).returning();
      return i;
    }
    const [i] = await tx.insert(payoutItem).values({ batchId: batch.id, partnerId, ...v }).returning();
    return i;
  };
  const seen = new Set<string>();
  for (const [partnerId, list] of byPartner) {
    const payable = list.filter(x => !x.disputeHeld).map(x => x.line);
    const dHeld = list.filter(x => x.disputeHeld).map(x => x.line);
    const reason = payable.length ? await partnerHoldReason(tx, partnerId) : null;
    const sum = (ls: LineRow[]) => ls.reduce((s, l) => s + l.amountCents, 0);
    if (payable.length) {
      seen.add(partnerId);
      const item = await upsertItem(partnerId, { status: reason ? 'held' : 'ready', holdReason: reason, disputeId: null, amountCents: sum(payable) });
      for (const l of payable) {
        await tx.update(payoutLine).set(reason
          ? { status: 'held', holdReason: reason, payoutItemId: item.id }
          : { status: l.chargeId ? 'released_early' : 'ready', holdReason: null, payoutItemId: item.id }).where(eq(payoutLine.id, l.id));
      }
      for (const l of dHeld) await tx.update(payoutLine).set({ payoutItemId: null }).where(eq(payoutLine.id, l.id));
      if (dHeld.length) out.disputeHeld.push({ partnerId, amount: sum(dHeld) });
      (reason ? out.heldItems : out.ready).push({ item, lines: payable });
    } else if (dHeld.length) {
      seen.add(partnerId);
      const disputeId = await openDisputeId(tx, dHeld[0].bookingId);
      const item = await upsertItem(partnerId, { status: 'held', holdReason: 'dispute', disputeId, amountCents: sum(dHeld) });
      for (const l of dHeld) await tx.update(payoutLine).set({ payoutItemId: item.id }).where(eq(payoutLine.id, l.id));
      out.heldItems.push({ item, lines: dHeld });
      out.disputeHeld.push({ partnerId, amount: sum(dHeld) });
    }
  }
  for (const i of existing) {
    if (!seen.has(i.partnerId) && (i.status === 'ready' || i.status === 'held')) {
      await tx.update(payoutLine).set({ payoutItemId: null }).where(eq(payoutLine.payoutItemId, i.id));
      await tx.delete(payoutItem).where(eq(payoutItem.id, i.id));
    }
  }
  return out;
}

/** Netting (L6) and the amount the provider pays: min(Σ lines, partner_payable − already sent). */
async function payoutAmount(tx: Tx, partnerId: string, linesSum: number, post?: { itemId: string; batchLabel: string }): Promise<{ amount: number; netted: number }> {
  const bal = await partnerBalances(tx, partnerId);
  const payable = bal.partner_payable - (await sentUnpaid(tx, partnerId));
  const netted = Math.max(0, Math.min(bal.partner_receivable, payable, linesSum));
  if (post && netted > 0) {
    await postTransaction(tx, {
      kind: 'receivable_netting', partnerId, payoutItemId: post.itemId, description: `L6 netting · ${post.batchLabel}`,
      lines: [{ account: 'partner_payable', debit: netted }, { account: 'partner_receivable', credit: netted }],
    });
  }
  return { amount: Math.max(0, Math.min(linesSum, payable - netted)), netted };
}

async function getOrCreateBatch(tx: Tx, batchDate: DateStr): Promise<BatchRow> {
  const [exists] = await tx.select({ id: payoutBatch.id }).from(payoutBatch).where(eq(payoutBatch.batchDate, batchDate));
  if (!exists) await tx.insert(payoutBatch).values({ batchDate, label: batchLabel(batchDate), railLabel: await railLabelFor(tx) }).onConflictDoNothing();
  const [b] = await tx.select().from(payoutBatch).where(eq(payoutBatch.batchDate, batchDate)).for('update');
  return b;
}

/**
 * T17 / Y3 (`payouts.prepare`, `batch:<date>`): batch scheduled → ready, items
 * grouped, totals, `team-batch-ready` (view_finance). Schedules the next
 * batch's preparation. Idempotent: a prepared batch is left alone.
 */
export async function prepareBatch(batchDate: DateStr, tx?: Tx): Promise<{ batchId: string; prepared: boolean }> {
  return withTx(tx, async tx => {
    const batch = await getOrCreateBatch(tx, batchDate);
    const days = await getSetting('payout.days', undefined, tx);
    await ensureBatchScheduled(payoutDayOnOrAfter(addDays(batchDate, 1), days), tx);
    if (batch.status !== 'scheduled') return { batchId: batch.id, prepared: false };
    // A batch created without a rail (e.g. seeded as `scheduled`) takes the current one now.
    if (!batch.railLabel) await tx.update(payoutBatch).set({ railLabel: await railLabelFor(tx) }).where(eq(payoutBatch.id, batch.id));
    const synced = await restateBatch(tx, batch);
    await tx.update(payoutBatch).set({ status: 'ready', preparedAt: await now() }).where(eq(payoutBatch.id, batch.id));
    const [b] = await tx.select().from(payoutBatch).where(eq(payoutBatch.id, batch.id));
    const top = [...synced.disputeHeld].sort((x, y) => y.amount - x.amount)[0];
    let heldVar: { partnerName: string; amount: string } | undefined;
    if (top) {
      const [p] = await tx.select({ name: partner.businessName }).from(partner).where(eq(partner.id, top.partnerId));
      heldVar = { partnerName: p.name, amount: money(top.amount) };
    }
    if (b.partnerCount > 0 || b.heldCents > 0) {
      await mailTeam(tx, 'view_finance', 'team-batch-ready', {
        batchDate: fmtDate(batchDate), partnerCount: b.partnerCount, total: money(b.netCents), bank: bankOf(b), ...(heldVar ? { held: heldVar } : {}),
      }, `batch:${batchDate}:ready`);
    }
    await audit(tx, {
      actor: SYSTEM, action: 'payout.batch_prepared', entity: 'payout_batch', entityId: batch.id,
      data: { batchDate, partners: b.partnerCount, grossCents: b.grossCents, netCents: b.netCents, heldCents: b.heldCents },
    });
    return { batchId: batch.id, prepared: true };
  });
}

export type ReleaseBatchResult = { status: 'awaiting_second_approval' | 'released'; sentItems: number; paidItems: number };

/**
 * Y5 ‹Пусни партидата› / ‹Пусни изплащанията›: permission release_payouts, not
 * before 00:00 on the batch date. With ⚙ payout.require_second_admin the first
 * call records the approval and a different admin's call releases (D40).
 * Lines that became ready since T17 join; holds are re-checked (Y4); L6 nets
 * receivables; each item is handed to the provider by the `payout.submit` job.
 */
export async function releaseBatch(actor: Actor, input: { batchId: string }, tx?: Tx): Promise<ReleaseBatchResult> {
  assertCan(actor, 'release_payouts');
  return withTx(tx, async tx => {
    const [batch] = await tx.select().from(payoutBatch).where(eq(payoutBatch.id, input.batchId)).for('update');
    if (!batch) throw new AftercareError('not_found');
    if (batch.status !== 'ready') throw new AftercareError('batch_not_ready');
    const at = await now();
    if (at < sofiaInstant(batch.batchDate, 0, 0)) throw new AftercareError('batch_too_early');
    let releasedBy = actor.userId, secondApprover: string | null = null;
    if (await getSetting('payout.require_second_admin', undefined, tx)) {
      if (!batch.releasedBy) {
        await tx.update(payoutBatch).set({ releasedBy: actor.userId }).where(eq(payoutBatch.id, batch.id));
        await audit(tx, { actor, action: 'payout.batch_release_approved', entity: 'payout_batch', entityId: batch.id, data: { batchDate: batch.batchDate } });
        return { status: 'awaiting_second_approval', sentItems: 0, paidItems: 0 };
      }
      if (batch.releasedBy === actor.userId) throw new AftercareError('second_admin_required');
      releasedBy = batch.releasedBy;
      secondApprover = actor.userId;
    }
    const synced = await syncBatch(tx, batch);
    let sent = 0, paidZero = 0;
    for (const s of synced.ready) {
      const sum = s.lines.reduce((x, l) => x + l.amountCents, 0);
      const { amount } = await payoutAmount(tx, s.item.partnerId, sum, { itemId: s.item.id, batchLabel: batch.label });
      const [acct] = await tx.select({ id: payoutAccount.id }).from(payoutAccount)
        .where(and(eq(payoutAccount.partnerId, s.item.partnerId), eq(payoutAccount.status, 'confirmed'))).limit(1);
      if (amount > 0) {
        await tx.update(payoutItem).set({ status: 'sent', amountCents: amount, payoutAccountId: acct?.id ?? null, sentAt: at }).where(eq(payoutItem.id, s.item.id));
        await tx.update(payoutLine).set({ status: 'in_batch' }).where(eq(payoutLine.payoutItemId, s.item.id));
        await schedule('payout.submit', at, { itemId: s.item.id }, `payout_item:${s.item.id}:submit`, tx);
        sent++;
      } else {
        // Fully netted against what the partner owed: nothing to transfer.
        await tx.update(payoutItem).set({ status: 'paid', amountCents: 0, payoutAccountId: acct?.id ?? null, sentAt: at, paidAt: at }).where(eq(payoutItem.id, s.item.id));
        await tx.update(payoutLine).set({ status: 'paid', paidAt: at }).where(eq(payoutLine.payoutItemId, s.item.id));
        paidZero++;
      }
    }
    await tx.update(payoutBatch).set({ status: 'released', releasedAt: at, releasedBy, secondApprover }).where(eq(payoutBatch.id, batch.id));
    await recomputeTotals(tx, batch.id);
    await audit(tx, {
      actor, action: 'payout.batch_released', entity: 'payout_batch', entityId: batch.id,
      data: { batchDate: batch.batchDate, sentItems: sent, nettedItems: paidZero, secondApprover },
    });
    await checkBatchCompletion(tx, batch.id);
    return { status: 'released', sentItems: sent, paidItems: paidZero };
  });
}

/**
 * Job `payout.submit`: hand one sent item to the provider (idempotency key =
 * item id), then apply the result. A provider call that still throws on the
 * job's last attempt is a failed transfer (Y8), not an item left `sent` for good.
 */
export async function submitPayoutItem(itemId: string): Promise<void> {
  const [item] = await db.select().from(payoutItem).where(eq(payoutItem.id, itemId));
  if (!item || item.status !== 'sent' || item.providerPayoutRef) return;
  const [p] = await db.select().from(partner).where(eq(partner.id, item.partnerId));
  const [batch] = await db.select().from(payoutBatch).where(eq(payoutBatch.id, item.batchId));
  const provider = providerFor(p.provider ?? (await getSetting('payment.provider')));
  let r: Awaited<ReturnType<typeof provider.payout>>;
  try {
    r = await provider.payout({
      payoutItemId: item.id, partnerAccountRef: p.providerAccountRef ?? '', amountCents: item.amountCents, description: `EventAT · ${batch.label}`,
    });
  } catch (e) {
    if (!(await isFinalAttempt(`payout_item:${itemId}:submit`))) throw e;
    await db.transaction(tx => markItemFailed(tx, itemId, errorText(e)));
    return;
  }
  await db.transaction(async tx => {
    const [cur] = await tx.select().from(payoutItem).where(eq(payoutItem.id, itemId)).for('update');
    if (!cur || cur.status !== 'sent') return;
    await tx.update(payoutItem).set({ providerPayoutRef: r.payoutRef }).where(eq(payoutItem.id, itemId));
    if (r.status === 'paid') await markItemPaid(tx, itemId);
    else if (r.status === 'failed') await markItemFailed(tx, itemId, r.reason ?? 'failed');
  });
}

/**
 * Provider payout events (Y6 `payout.paid`, Y8 `payout.failed`), for
 * lib/payments/apply.ts. Unknown refs return handled: false.
 */
export async function applyPayoutEvent(
  ev: { type: 'payout.paid'; payoutRef: string } | { type: 'payout.failed'; payoutRef: string; reason: string }, tx?: Tx,
): Promise<{ handled: boolean }> {
  return withTx(tx, async tx => {
    const [item] = await tx.select({ id: payoutItem.id }).from(payoutItem).where(eq(payoutItem.providerPayoutRef, ev.payoutRef)).limit(1);
    if (!item) return { handled: false };
    if (ev.type === 'payout.paid') await markItemPaid(tx, item.id);
    else await markItemFailed(tx, item.id, ev.reason);
    return { handled: true };
  });
}

const maskedIban = (last4: string) => `BG•• •••• •••• ${last4}`;

/** Y6: item paid — ledger L4, lines paid, `vendor-payout-sent` per line, batch completion (Y7). Idempotent. */
export async function markItemPaid(tx: Tx, itemId: string): Promise<void> {
  const [item] = await tx.select().from(payoutItem).where(eq(payoutItem.id, itemId)).for('update');
  if (!item || item.status !== 'sent') return;
  const at = await now();
  const [batch] = await tx.select().from(payoutBatch).where(eq(payoutBatch.id, item.batchId));
  if (item.amountCents > 0) {
    await postTransaction(tx, {
      kind: 'payout', partnerId: item.partnerId, payoutItemId: item.id, description: `L4 payout · ${batch.label}`, occurredAt: at,
      lines: [{ account: 'partner_payable', debit: item.amountCents }, { account: 'provider_held', credit: item.amountCents }],
    });
  }
  await tx.update(payoutItem).set({ status: 'paid', paidAt: at }).where(eq(payoutItem.id, item.id));
  const lines = await tx.update(payoutLine).set({ status: 'paid', paidAt: at }).where(eq(payoutLine.payoutItemId, item.id)).returning();
  const [acct] = item.payoutAccountId ? await tx.select().from(payoutAccount).where(eq(payoutAccount.id, item.payoutAccountId)) : [];
  for (const l of lines) {
    const c = await loadBookingCtx(tx, l.bookingId);
    const t = ctxText(c);
    await mailPartner(tx, c, 'vendor-payout-sent', {
      bookingNo: t.bookingNo, amount: money(l.amountCents), payoutDate: fmtDate(sofiaDate(at)),
      eventType: t.eventType, eventTypeDefinite: t.eventTypeDefinite, hosts: t.hosts, eventDate: t.eventDate, packageName: t.packageName,
      account: acct ? maskedIban(acct.ibanLast4) : '', bankName: acct?.bankName ?? '', partnerLegalName: t.partnerLegalName,
    }, `payout_line:${l.id}:sent`, routes.partnerEarnings());
  }
  await audit(tx, {
    actor: SYSTEM, action: 'payout.item_paid', entity: 'payout_item', entityId: item.id,
    data: { amountCents: item.amountCents, lines: lines.length },
  });
  await checkBatchCompletion(tx, item.batchId);
}

/**
 * Y8: the transfer failed or the bank returned it — L4r reverses L4 when it was
 * posted, the lines go back to `ready` for a later batch, the partner's
 * payouts pause until a new account is confirmed, `team-transfer-failed`.
 */
export async function markItemFailed(tx: Tx, itemId: string, reason: string): Promise<void> {
  const [item] = await tx.select().from(payoutItem).where(eq(payoutItem.id, itemId)).for('update');
  if (!item || (item.status !== 'sent' && item.status !== 'paid')) return;
  const [batch] = await tx.select().from(payoutBatch).where(eq(payoutBatch.id, item.batchId));
  if (item.status === 'paid' && item.amountCents > 0) {
    await postTransaction(tx, {
      kind: 'payout_reversal', partnerId: item.partnerId, payoutItemId: item.id, description: `L4r payout failed · ${batch.label}`,
      lines: [{ account: 'provider_held', debit: item.amountCents }, { account: 'partner_payable', credit: item.amountCents }],
    });
  }
  await tx.update(payoutItem).set({ status: 'failed', failureReason: reason }).where(eq(payoutItem.id, item.id));
  const lines = await tx.select().from(payoutLine).where(eq(payoutLine.payoutItemId, item.id));
  for (const l of lines) {
    await tx.update(payoutLine).set({ status: l.chargeId ? 'released_early' : 'ready', payoutItemId: null, paidAt: null }).where(eq(payoutLine.id, l.id));
  }
  await tx.update(partner).set({ payoutsPaused: true, updatedAt: await now() }).where(eq(partner.id, item.partnerId));
  const [p] = await tx.select({ name: partner.businessName }).from(partner).where(eq(partner.id, item.partnerId));
  const [acct] = item.payoutAccountId ? await tx.select().from(payoutAccount).where(eq(payoutAccount.id, item.payoutAccountId)) : [];
  await mailTeam(tx, 'view_finance', 'team-transfer-failed', {
    partnerName: p.name, amount: money(item.amountCents), ibanLast4: acct?.ibanLast4 ?? '', batchDate: fmtDate(batch.batchDate),
    bank: bankOf(batch), reason,
  }, `payout_item:${item.id}:failed`);
  await audit(tx, {
    actor: SYSTEM, action: 'payout.item_failed', entity: 'payout_item', entityId: item.id,
    data: { amountCents: item.amountCents, reason, wasPaid: item.status === 'paid' },
  });
  await checkBatchCompletion(tx, item.batchId);
}

/** Y7: every item that was released is paid → batch paid + `team-batch-paid`; some failed → partially_failed. */
async function checkBatchCompletion(tx: Tx, batchId: string): Promise<void> {
  const [batch] = await tx.select().from(payoutBatch).where(eq(payoutBatch.id, batchId));
  if (!['released', 'paid', 'partially_failed'].includes(batch.status)) return;
  const items = (await tx.select().from(payoutItem).where(eq(payoutItem.batchId, batchId))).filter(i => i.status !== 'held');
  const at = await now();
  if (items.every(i => i.status === 'paid')) {
    if (batch.status === 'paid') return;
    await tx.update(payoutBatch).set({ status: 'paid', paidAt: at }).where(eq(payoutBatch.id, batchId));
    await audit(tx, { actor: SYSTEM, action: 'payout.batch_paid', entity: 'payout_batch', entityId: batchId, data: { batchDate: batch.batchDate, items: items.length } });
    if (items.length) {
      const days = await getSetting('payout.days', undefined, tx);
      await mailTeam(tx, 'view_finance', 'team-batch-paid', {
        batchName: batchName(batch.batchDate), paidOn: fmtDate(sofiaDate(at)), partnerCount: items.length,
        total: money(items.reduce((s, i) => s + i.amountCents, 0)), bank: bankOf(batch),
        nextBatchDate: fmtDate(payoutDayOnOrAfter(addDays(batch.batchDate, 1), days)),
      }, `batch:${batch.batchDate}:paid`);
    }
  } else if (items.every(i => i.status === 'paid' || i.status === 'failed') && batch.status !== 'partially_failed') {
    await tx.update(payoutBatch).set({ status: 'partially_failed' }).where(eq(payoutBatch.id, batchId));
    await audit(tx, { actor: SYSTEM, action: 'payout.batch_partially_failed', entity: 'payout_batch', entityId: batchId, data: { batchDate: batch.batchDate } });
  }
}

// ── Reports (Y9) and CSV for the accountant ───────────────────────────────

const csvMoney = (cents: number) => `${cents < 0 ? '-' : ''}${Math.floor(Math.abs(cents) / 100)},${String(Math.abs(cents) % 100).padStart(2, '0')}`;
const csvCell = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? '' : String(v);
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
/** Semicolon-separated, decimal comma, UTF-8 with BOM: opens as-is in a Bulgarian Excel. */
const toCsv = (rows: (string | number | null | undefined)[][]) => `﻿${rows.map(r => r.map(csvCell).join(';')).join('\r\n')}\r\n`;

/** One row per payout line of the batch (paid, sent, held or failed). */
export async function batchReportCsv(batchId: string, q: Queryable = db): Promise<string> {
  const [batch] = await q.select().from(payoutBatch).where(eq(payoutBatch.id, batchId));
  if (!batch) throw new AftercareError('not_found');
  const rows = await q.select({
    item: payoutItem, line: payoutLine, partnerName: partner.businessName, legalName: partner.legalName, eik: partner.eik,
    number: booking.number, eventDate: booking.eventDate, ibanLast4: payoutAccount.ibanLast4,
  }).from(payoutItem)
    .innerJoin(partner, eq(partner.id, payoutItem.partnerId))
    .leftJoin(payoutAccount, eq(payoutAccount.id, payoutItem.payoutAccountId))
    .innerJoin(payoutLine, eq(payoutLine.payoutItemId, payoutItem.id))
    .innerJoin(booking, eq(booking.id, payoutLine.bookingId))
    .where(eq(payoutItem.batchId, batchId))
    .orderBy(asc(partner.businessName), asc(booking.eventDate));
  return toCsv([
    ['Партида', 'Дата на партидата', 'Изпълнител', 'Фирма', 'ЕИК', 'Сметка', 'Резервация', 'Дата на събитието', 'Бруто', 'Комисиона', 'Нето', 'Статус', 'Изплатено на'],
    ...rows.map(r => [
      batch.label, r.item.paidAt ? sofiaDate(r.item.paidAt) : batch.batchDate, r.partnerName, r.legalName, r.eik,
      r.ibanLast4 ? `•••• ${r.ibanLast4}` : '', r.number, r.eventDate,
      csvMoney(r.line.baseCents), csvMoney(r.line.commissionCents), csvMoney(r.line.amountCents), r.item.status,
      r.line.paidAt ? sofiaDate(r.line.paidAt) : '',
    ]),
  ]);
}

/** ‹Счетоводна справка›: every ledger movement in [from, to] (Sofia dates), one column per account. */
export async function accountingCsv(p: { from: DateStr; to: DateStr }, q: Queryable = db): Promise<string> {
  const rows = await q.execute<{
    id: string; kind: string; occurred_at: Date | string; description: string; number: string | null; partner_name: string | null;
    provider_held: string; client_funds: string; partner_payable: string; partner_receivable: string; commission_revenue: string; platform_cash: string;
  }>(sql`
    select t.id, t.kind, t.occurred_at, t.description, b.number, p.business_name as partner_name,
      ${sql.raw(['provider_held', 'client_funds', 'partner_payable', 'partner_receivable', 'commission_revenue', 'platform_cash'].map(a =>
        `coalesce(sum(case when e.account = '${a}' then ${['provider_held', 'partner_receivable', 'platform_cash'].includes(a) ? 'e.debit_cents - e.credit_cents' : 'e.credit_cents - e.debit_cents'} end), 0) as ${a}`).join(', '))}
    from ledger_transaction t
    join ledger_entry e on e.transaction_id = t.id
    left join booking b on b.id = t.booking_id
    left join partner p on p.id = coalesce(e.partner_id, b.partner_id)
    where t.occurred_at >= ${sofiaInstant(p.from).toISOString()}::timestamptz and t.occurred_at < ${sofiaInstant(addDays(p.to, 1)).toISOString()}::timestamptz
    group by t.id, t.kind, t.occurred_at, t.description, b.number, p.business_name
    order by t.occurred_at, t.id`);
  return toCsv([
    ['Дата', 'Вид', 'Резервация', 'Изпълнител', 'Описание', 'При доставчика', 'Средства на клиенти', 'Дължимо на изпълнители', 'Вземания от изпълнители', 'Комисиона', 'Собствени средства'],
    ...rows.map(r => [
      sofiaDate(new Date(r.occurred_at)), r.kind, r.number, r.partner_name, r.description,
      csvMoney(Number(r.provider_held)), csvMoney(Number(r.client_funds)), csvMoney(Number(r.partner_payable)),
      csvMoney(Number(r.partner_receivable)), csvMoney(Number(r.commission_revenue)), csvMoney(Number(r.platform_cash)),
    ]),
  ]);
}

/**
 * Y9: a batch history row → report_job + `team-batch-report` to the requester
 * (view_finance). The CSV is produced on download by reportCsv(); the
 * email's ‹Свали отчета› leads to the payments page.
 */
export async function requestBatchReport(actor: Actor, input: { batchId: string }, tx?: Tx): Promise<{ reportId: string }> {
  assertCan(actor, 'view_finance');
  return withTx(tx, async tx => {
    const [batch] = await tx.select().from(payoutBatch).where(eq(payoutBatch.id, input.batchId));
    if (!batch) throw new AftercareError('not_found');
    if (batch.status !== 'paid' && batch.status !== 'partially_failed') throw new AftercareError('batch_not_paid');
    const at = await now();
    const [r] = await tx.insert(reportJob).values({ kind: 'batch_report', requestedBy: actor.userId, params: { batchId: batch.id }, status: 'ready', readyAt: at }).returning();
    const [u] = await tx.select({ email: user.email }).from(user).where(eq(user.id, actor.userId));
    await mail(tx, {
      key: 'team-batch-report', to: u.email, toUserId: actor.userId, dedupeKey: `report:${r.id}`,
      vars: { batchName: batchName(batch.batchDate), paidOn: fmtDate(sofiaDate(batch.paidAt ?? at)), partnerCount: batch.partnerCount, total: money(batch.netCents), bank: bankOf(batch) },
    });
    await audit(tx, { actor, action: 'report.requested', entity: 'report_job', entityId: r.id, data: { kind: 'batch_report', batchId: batch.id } });
    return { reportId: r.id };
  });
}

/** ‹Счетоводна справка›: report_job only — its ready email needs a new team key (D68). */
export async function requestAccountingReport(actor: Actor, input: { from: DateStr; to: DateStr }, tx?: Tx): Promise<{ reportId: string }> {
  assertCan(actor, 'view_finance');
  return withTx(tx, async tx => {
    const [r] = await tx.insert(reportJob).values({ kind: 'accounting', requestedBy: actor.userId, params: input, status: 'ready', readyAt: await now() }).returning();
    await audit(tx, { actor, action: 'report.requested', entity: 'report_job', entityId: r.id, data: { kind: 'accounting', ...input } });
    return { reportId: r.id };
  });
}

/** The CSV of a ready batch or accounting report (download route). */
export async function reportCsv(actor: Actor, reportId: string, q: Queryable = db): Promise<{ filename: string; csv: string }> {
  assertCan(actor, 'view_finance');
  const [r] = await q.select().from(reportJob).where(eq(reportJob.id, reportId));
  if (!r) throw new AftercareError('not_found');
  const p = r.params as Record<string, string>;
  if (r.kind === 'batch_report') {
    const [b] = await q.select().from(payoutBatch).where(eq(payoutBatch.id, p.batchId));
    return { filename: `partida-${b.batchDate}.csv`, csv: await batchReportCsv(p.batchId, q) };
  }
  if (r.kind === 'accounting') return { filename: `spravka-${p.from}-${p.to}.csv`, csv: await accountingCsv({ from: p.from, to: p.to }, q) };
  throw new AftercareError('unsupported_report');
}

// ── Queries for the screens (SPEC §8.1, §8.2) ────────────────────────────

const monthStart = (ym: string) => `${ym}-01`;
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`; };
const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
const deltaPct = (cur: number, prev: number) => (prev > 0 ? Math.round((cur / prev - 1) * 100) : null);

export type BatchPreview = {
  batchId: string | null; batchDate: DateStr; label: string; status: string;
  partners: number; grossCents: number; commissionCents: number; netCents: number; heldCents: number;
};

/**
 * ‹Следваща партида› / ‹За изплащане тази седмица›: the next unreleased batch.
 * Prepared → its stored totals; not yet → a projection from the lines due by
 * then (events that end before the batch date included).
 */
export async function nextBatchPreview(at?: Date, q: Queryable = db): Promise<BatchPreview> {
  const t = at ?? (await now());
  const days = await getSetting('payout.days', t, q);
  let d = payoutDayOnOrAfter(sofiaDate(t), days);
  for (let i = 0; i < 6; i++) {
    const [b] = await q.select().from(payoutBatch).where(eq(payoutBatch.batchDate, d));
    if (b && b.status === 'ready') {
      return { batchId: b.id, batchDate: d, label: b.label, status: b.status, partners: b.partnerCount, grossCents: b.grossCents, commissionCents: b.commissionCents, netCents: b.netCents, heldCents: b.heldCents };
    }
    if (!b || b.status === 'scheduled') break;
    d = payoutDayOnOrAfter(addDays(d, 1), days);
  }
  const rows = await q.select({ line: payoutLine, payoutHold: booking.payoutHold }).from(payoutLine)
    .innerJoin(booking, eq(booking.id, payoutLine.bookingId))
    .leftJoin(payoutItem, eq(payoutItem.id, payoutLine.payoutItemId))
    .where(and(
      lte(payoutLine.batchDate, d),
      or(inArray(payoutLine.status, ['ready', 'released_early', 'held']), and(eq(payoutLine.status, 'awaiting_event'), lt(booking.eventDate, d))),
      or(isNull(payoutLine.payoutItemId), inArray(payoutItem.status, ['ready', 'held'])),
    ));
  const partners = new Map<string, number>();
  let gross = 0, commission = 0, held = 0;
  const holdCache = new Map<string, HoldReason | null>();
  for (const r of rows) {
    const pid = r.line.partnerId;
    if (!holdCache.has(pid)) holdCache.set(pid, await partnerHoldReason(q, pid));
    if (r.payoutHold || holdCache.get(pid)) { held += r.line.amountCents; continue; }
    gross += r.line.baseCents; commission += r.line.commissionCents;
    partners.set(pid, (partners.get(pid) ?? 0) + r.line.amountCents);
  }
  return {
    batchId: null, batchDate: d, label: batchLabel(d), status: 'scheduled', partners: partners.size,
    grossCents: gross, commissionCents: commission, netCents: [...partners.values()].reduce((s, v) => s + v, 0), heldCents: held,
  };
}

export type PayoutKpis = {
  /** ‹Задържани до събитията› · ‹по N предстоящи резервации› */
  heldForEvents: { cents: number; bookings: number };
  /** ‹Следваща партида› and ‹За изплащане тази седмица› */
  nextBatch: BatchPreview;
  /** ‹Комисиона {месец}› · ‹↗ +22% спрямо юли› */
  commission: { month: string; cents: number; prevCents: number; deltaPct: number | null };
  /** ‹Възстановено› · ‹N кейса› */
  refunded: { cents: number; cases: number };
};

/** SPEC §8.1 admin KPIs for a Sofia period (default: the current month). */
export async function payoutKpis(opts: { at?: Date; from?: DateStr; to?: DateStr } = {}, q: Queryable = db): Promise<PayoutKpis> {
  const t = opts.at ?? (await now());
  const today = sofiaDate(t);
  const ym = today.slice(0, 7);
  const from = opts.from ?? monthStart(ym), to = opts.to ?? addDays(monthStart(nextMonth(ym)), -1);
  const [held] = await q.execute<{ cents: string; n: string }>(sql`
    select coalesce(sum(x.bal), 0) as cents, count(*) filter (where x.bal > 0) as n from (
      select b.id, coalesce(sum(e.credit_cents - e.debit_cents), 0) as bal
      from booking b left join ledger_entry e on e.booking_id = b.id and e.account = 'client_funds'
      where b.status = 'confirmed' and b.event_date >= ${today}::date group by b.id) x`);
  const commissionIn = async (m: string) => {
    const [r] = await q.select({ s: sql<number>`coalesce(sum(floor((${booking.amountCents}::bigint * ${booking.commissionBp} + 5000) / 10000)), 0)::bigint`.mapWith(Number) })
      .from(booking).where(and(isNotNull(booking.paidAt), isNotNull(booking.commissionBp),
        gte(booking.paidAt, sofiaInstant(monthStart(m))), lt(booking.paidAt, sofiaInstant(monthStart(nextMonth(m))))));
    return r?.s ?? 0;
  };
  const cur = await commissionIn(ym), prev = await commissionIn(prevMonth(ym));
  const [ref] = await q.select({
    s: sql<number>`coalesce(sum(${refund.amountCents}), 0)::int`.mapWith(Number),
    cases: sql<number>`count(distinct ${refund.disputeId})::int`.mapWith(Number),
  }).from(refund).where(and(eq(refund.status, 'succeeded'), gte(refund.succeededAt, sofiaInstant(from)), lt(refund.succeededAt, sofiaInstant(addDays(to, 1)))));
  return {
    heldForEvents: { cents: Number(held?.cents ?? 0), bookings: Number(held?.n ?? 0) },
    nextBatch: await nextBatchPreview(t, q),
    commission: { month: ym, cents: cur, prevCents: prev, deltaPct: deltaPct(cur, prev) },
    refunded: { cents: ref?.s ?? 0, cases: ref?.cases ?? 0 },
  };
}

export type PartnerEarnings = {
  /** ‹Приходи · {месец}›, delta vs the previous month, bars for the last 5 months (oldest first). */
  month: { month: string; cents: number; prevCents: number; deltaPct: number | null; bars: { month: string; cents: number }[] };
  /** ‹За изплащане› · ‹задържани до събитията› */
  toBePaidCents: number;
  /** ‹Изплатени за {година}› · ‹по N резервации› · ‹Средно на резервация› (whole €) */
  paidYear: { year: number; cents: number; count: number; averageCents: number | null };
};

/** SPEC §8.2 partner earnings (what the partner receives; never the commission). */
export async function partnerEarnings(partnerId: string, opts: { at?: Date } = {}, q: Queryable = db): Promise<PartnerEarnings> {
  const t = opts.at ?? (await now());
  const today = sofiaDate(t);
  const ym = today.slice(0, 7);
  const months: string[] = [ym];
  for (let i = 0; i < 5; i++) months.unshift(prevMonth(months[0]));
  const rows = await q.select({ b: booking, retained: cancellation.retainedCents }).from(booking)
    .leftJoin(cancellation, eq(cancellation.bookingId, booking.id))
    .where(and(eq(booking.partnerId, partnerId), isNotNull(booking.paidAt), gte(booking.paidAt, sofiaInstant(monthStart(months[0]))),
      inArray(booking.status, ['confirmed', 'cancellation_requested', 'completed', 'cancelled'])));
  const disputeRefunds = rows.length ? await q.select({ bookingId: refund.bookingId, s: sql<number>`sum(${refund.amountCents})::int`.mapWith(Number) }).from(refund)
    .where(and(inArray(refund.bookingId, rows.map(r => r.b.id)), eq(refund.reason, 'dispute_decision'), owedRefundSql))
    .groupBy(refund.bookingId) : [];
  const dr = new Map(disputeRefunds.map(r => [r.bookingId, r.s]));
  const perMonth = new Map<string, number>();
  for (const r of rows) {
    const base = r.b.status === 'cancelled' ? r.retained ?? 0 : r.b.amountCents + r.b.bookingFeeCents - (dr.get(r.b.id) ?? 0);
    const amount = base - bpOf(base, r.b.commissionBp ?? 0);
    const m = sofiaDate(r.b.paidAt!).slice(0, 7);
    perMonth.set(m, (perMonth.get(m) ?? 0) + amount);
  }
  const bars = months.slice(1).map(m => ({ month: m, cents: perMonth.get(m) ?? 0 }));
  const cur = perMonth.get(ym) ?? 0, prev = perMonth.get(prevMonth(ym)) ?? 0;

  const [unpaid] = await q.select({ s: sql<number>`coalesce(sum(${payoutLine.amountCents}), 0)::int`.mapWith(Number) }).from(payoutLine)
    .where(and(eq(payoutLine.partnerId, partnerId), inArray(payoutLine.status, UNPAID_LINE)));
  const lineless = await q.select({ b: booking }).from(booking)
    .where(and(eq(booking.partnerId, partnerId), inArray(booking.status, ['confirmed', 'cancellation_requested', 'completed']),
      sql`not exists (select 1 from payout_line l where l.booking_id = ${booking.id})`));
  const projected = lineless.reduce((s, r) => { const base = r.b.amountCents + r.b.bookingFeeCents; return s + base - bpOf(base, r.b.commissionBp ?? 0); }, 0);

  const year = Number(today.slice(0, 4));
  const [py] = await q.select({
    s: sql<number>`coalesce(sum(${payoutLine.amountCents}), 0)::int`.mapWith(Number),
    n: sql<number>`count(distinct ${payoutLine.bookingId})::int`.mapWith(Number),
  }).from(payoutLine).where(and(eq(payoutLine.partnerId, partnerId), eq(payoutLine.status, 'paid'),
    gte(payoutLine.paidAt, sofiaInstant(`${year}-01-01`)), lt(payoutLine.paidAt, sofiaInstant(`${year + 1}-01-01`))));
  return {
    month: { month: ym, cents: cur, prevCents: prev, deltaPct: deltaPct(cur, prev), bars },
    toBePaidCents: (unpaid?.s ?? 0) + projected,
    paidYear: { year, cents: py?.s ?? 0, count: py?.n ?? 0, averageCents: py?.n ? Math.round(py.s / py.n / 100) * 100 : null },
  };
}

/** A batch with its items and lines (/admin/plashtaniya/partidi/[id]). */
export async function batchDetail(batchId: string, q: Queryable = db) {
  const [batch] = await q.select().from(payoutBatch).where(eq(payoutBatch.id, batchId));
  if (!batch) throw new AftercareError('not_found');
  const items = await q.select({ item: payoutItem, partnerName: partner.businessName }).from(payoutItem)
    .innerJoin(partner, eq(partner.id, payoutItem.partnerId)).where(eq(payoutItem.batchId, batchId)).orderBy(asc(partner.businessName));
  const lines = items.length ? await q.select({ line: payoutLine, number: booking.number, eventDate: booking.eventDate }).from(payoutLine)
    .innerJoin(booking, eq(booking.id, payoutLine.bookingId)).where(inArray(payoutLine.payoutItemId, items.map(i => i.item.id))) : [];
  return {
    batch,
    items: items.map(i => ({ ...i.item, partnerName: i.partnerName, lines: lines.filter(l => l.line.payoutItemId === i.item.id).map(l => ({ ...l.line, number: l.number, eventDate: l.eventDate })) })),
  };
}

/** Batch history (newest first). */
export async function listBatches(opts: { limit?: number } = {}, q: Queryable = db): Promise<BatchRow[]> {
  return q.select().from(payoutBatch).where(ne(payoutBatch.status, 'scheduled')).orderBy(desc(payoutBatch.batchDate)).limit(opts.limit ?? 24);
}
