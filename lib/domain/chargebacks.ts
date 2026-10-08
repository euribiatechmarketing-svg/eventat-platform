// Chargebacks: the card network takes a payment back (provider `dispute.created`).
//
// The provider debits the disputed amount at once, so the ledger follows it
// like a refund (L2 shape, kind `adjustment`): from the money still held for
// the booking first, then the partner's released share — unpaid
// (partner_payable) before paid (partner_receivable, netted from the next
// payouts, L6) — and the commission part. The partner's payouts are frozen
// while any chargeback of theirs is open (payout hold `dispute`, SPEC §8.3)
// and the booking's own release waits (payout_hold). The team records the
// outcome: won → the posting and the payout lines are restored; lost → the
// money stays gone and whatever the partner owes is netted later.
// No email template exists for chargebacks; they surface in openChargebacks().
import { and, desc, eq } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import { booking, charge, chargeback, ledgerEntry, payoutLine, type PayoutLineStatus } from '@/db/schema';
import { now } from '@/lib/clock';
import { SYSTEM, assertCan, type Actor } from './actor';
import { audit } from './audit';
import { postTransaction, type LedgerLine } from './ledger';
import { syncBookingHold } from './payouts';
import { postRefundLedger } from './refunds';
import { AftercareError, withTx } from './aftercare-shared';

export type ChargebackRow = typeof chargeback.$inferSelect;
type Adjustment = { lineId: string; base: number; commission: number; amount: number; status: PayoutLineStatus };

/**
 * Provider `dispute.created` (from lib/payments/apply.ts). Idempotent per
 * charge. An unknown charge ref returns handled: false.
 */
export async function applyChargebackEvent(
  ev: { type: 'dispute.created'; providerChargeRef: string; amountCents: number; reason: string }, tx?: Tx,
): Promise<{ handled: boolean; chargebackId?: string }> {
  return withTx(tx, async tx => {
    const [c] = await tx.select().from(charge).where(eq(charge.providerRef, ev.providerChargeRef)).limit(1);
    if (!c) return { handled: false };
    const [existing] = await tx.select({ id: chargeback.id }).from(chargeback).where(eq(chargeback.chargeId, c.id));
    if (existing) return { handled: true, chargebackId: existing.id };
    const [b] = await tx.select().from(booking).where(eq(booking.id, c.bookingId)).for('update');
    const amount = Math.max(1, Math.min(ev.amountCents, c.amountCents));
    // Money already refunded on this charge cannot be taken back a second time from the booking's side.
    const effective = Math.min(amount, c.amountCents - c.refundedCents);
    let ledgerTransactionId: string | null = null;
    let adjustments: Adjustment[] = [];
    if (effective > 0) {
      const posted = await postRefundLedger(tx, { amountCents: effective, chargeId: c.id }, b, 'adjustment', `Chargeback ${b.number} (${ev.reason})`);
      ledgerTransactionId = posted.transactionId;
      adjustments = posted.clawback.adjustments;
    }
    const at = await now();
    const [cb] = await tx.insert(chargeback).values({
      chargeId: c.id, bookingId: b.id, partnerId: b.partnerId, amountCents: amount, reason: ev.reason || 'unknown',
      ledgerTransactionId, lineAdjustments: adjustments, openedAt: at, createdAt: at,
    }).returning();
    await syncBookingHold(tx, b.id);
    await audit(tx, {
      actor: SYSTEM, action: 'chargeback.opened', entity: 'chargeback', entityId: cb.id,
      data: { bookingId: b.id, number: b.number, chargeId: c.id, amountCents: amount, postedCents: effective, reason: ev.reason },
    });
    return { handled: true, chargebackId: cb.id };
  });
}

/**
 * The team records the outcome (view_finance). Won: the provider returned the
 * money — the opening posting is mirrored and the payout lines restored.
 * Lost: nothing moves. Either way the freeze lifts when nothing else holds.
 */
export async function resolveChargeback(actor: Actor, input: { chargebackId: string; outcome: 'won' | 'lost'; note?: string }, tx?: Tx): Promise<ChargebackRow> {
  assertCan(actor, 'view_finance');
  return withTx(tx, async tx => {
    const [cb] = await tx.select().from(chargeback).where(eq(chargeback.id, input.chargebackId)).for('update');
    if (!cb) throw new AftercareError('not_found');
    if (cb.status !== 'open') throw new AftercareError('chargeback_closed');
    const at = await now();
    if (input.outcome === 'won' && cb.ledgerTransactionId) {
      const entries = await tx.select().from(ledgerEntry).where(eq(ledgerEntry.transactionId, cb.ledgerTransactionId));
      const lines: LedgerLine[] = entries.map(e => ({
        account: e.account, partnerId: e.partnerId, bookingId: e.bookingId,
        ...(e.debitCents > 0 ? { credit: e.debitCents } : { debit: e.creditCents }),
      }));
      await postTransaction(tx, {
        kind: 'adjustment', bookingId: cb.bookingId, partnerId: cb.partnerId, chargeId: cb.chargeId, createdBy: actor.userId,
        description: 'Chargeback won: reversal', lines,
      });
      for (const a of cb.lineAdjustments as Adjustment[]) {
        const [l] = await tx.select().from(payoutLine).where(eq(payoutLine.id, a.lineId));
        if (!l) continue;
        await tx.update(payoutLine).set({
          baseCents: a.base, commissionCents: a.commission, amountCents: a.amount,
          ...(l.status === 'cancelled' ? { status: 'held' as const, holdReason: 'dispute' as const } : {}),
        }).where(eq(payoutLine.id, l.id));
      }
    }
    const [done] = await tx.update(chargeback).set({ status: input.outcome, resolvedAt: at, resolvedBy: actor.userId, note: input.note ?? null })
      .where(eq(chargeback.id, cb.id)).returning();
    await syncBookingHold(tx, cb.bookingId);
    await audit(tx, { actor, action: `chargeback.${input.outcome}`, entity: 'chargeback', entityId: cb.id, data: { note: input.note ?? null } });
    return done;
  });
}

/** Open chargebacks (admin attention: the partner's payouts are frozen while one is open). */
export async function openChargebacks(q: Queryable = db): Promise<ChargebackRow[]> {
  return q.select().from(chargeback).where(eq(chargeback.status, 'open')).orderBy(desc(chargeback.openedAt));
}

/** Whether a partner has an open chargeback (their payouts are held). */
export async function partnerHasOpenChargeback(partnerId: string, q: Queryable = db): Promise<boolean> {
  const [r] = await q.select({ id: chargeback.id }).from(chargeback).where(and(eq(chargeback.partnerId, partnerId), eq(chargeback.status, 'open'))).limit(1);
  return !!r;
}
