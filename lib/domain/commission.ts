// Commission (SPEC §6). EventAT's commission is the application fee on each
// charge and is booked at release (L3). Rates are ⚙ settings read at the
// moment that matters:
//   - the intro rate (5 %) for a partner's first `commission.intro_count` (3)
//     bookings to reach `confirmed`, ordered by paid_at; a later cancellation
//     does not give the slot back (D7);
//   - the business rate for business clients — the intro rate wins (D7);
//   - the standard rate otherwise.
// The rate is snapshotted on the booking at payment (K5) as booking.commission_bp.
// Before payment, partner screens and emails show a projected ‹Получавате›:
// the rate the booking would get if it were paid now.
//
// Commission percentages and amounts are shown only on admin screens
// (CLAUDE.md rule 9); partner-facing code uses `partnerAmount` only.
import { and, count, eq, isNotNull, ne } from 'drizzle-orm';
import type { Queryable } from '@/db';
import { booking, clientProfile, partner } from '@/db/schema';
import { getSettings } from './settings';

export type CommissionReason = 'intro' | 'business' | 'standard';
export type CommissionRate = { bp: number; reason: CommissionReason };
export type Split = { baseCents: number; commissionBp: number; commissionCents: number; partnerAmountCents: number };

/** round_half_up(base × bp / 10 000) for non-negative integers (SPEC §0 rounding, §6 amounts). */
export function commissionCents(baseCents: number, bp: number): number {
  if (!Number.isSafeInteger(baseCents) || !Number.isSafeInteger(bp)) throw new Error('commissionCents: integers only');
  if (baseCents <= 0 || bp <= 0) return 0;
  return Math.floor((baseCents * bp + 5_000) / 10_000);
}

/** base → commission and what the partner keeps (SPEC §6 Amounts: 1 450 → 145 / 1 305 at 10 %). */
export function split(baseCents: number, bp: number): Split {
  const c = commissionCents(baseCents, bp);
  return { baseCents, commissionBp: bp, commissionCents: c, partnerAmountCents: baseCents - c };
}

/** How many of the partner's bookings have reached `confirmed` (paid_at set), optionally not counting one. */
export async function paidBookingCount(q: Queryable, partnerId: string, excludeBookingId?: string): Promise<number> {
  const conds = [eq(booking.partnerId, partnerId), isNotNull(booking.paidAt)];
  if (excludeBookingId) conds.push(ne(booking.id, excludeBookingId));
  const [r] = await q.select({ n: count() }).from(booking).where(and(...conds));
  return Number(r?.n ?? 0);
}

/**
 * The rate a booking between this client and partner gets if it is paid at `at` (SPEC §6, D7).
 * `excludeBookingId`: the booking being confirmed, so it does not count itself.
 */
export async function commissionRateFor(
  q: Queryable, a: { partnerId: string; clientId: string; at: Date; excludeBookingId?: string },
): Promise<CommissionRate> {
  const s = await getSettings(a.at, q);
  const paid = await paidBookingCount(q, a.partnerId, a.excludeBookingId);
  if (paid < s['commission.intro_count']) return { bp: s['commission.intro_bp'], reason: 'intro' };
  const [p] = await q.select({ type: clientProfile.clientType }).from(clientProfile).where(eq(clientProfile.userId, a.clientId)).limit(1);
  if (p?.type === 'business') return { bp: s['commission.business_bp'], reason: 'business' };
  return { bp: s['commission.standard_bp'], reason: 'standard' };
}

/**
 * K5: snapshot the commission rate on a booking at its first successful payment.
 * Locks the partner row first, so two bookings of one partner confirmed at the
 * same moment cannot both take the last intro slot. Returns the stored rate;
 * a booking that already has a rate keeps it.
 */
export async function snapshotCommission(q: Queryable, b: { id: string; partnerId: string; clientId: string; commissionBp: number | null }, at: Date): Promise<number> {
  if (b.commissionBp != null) return b.commissionBp;
  await q.select({ id: partner.id }).from(partner).where(eq(partner.id, b.partnerId)).for('update');
  const rate = await commissionRateFor(q, { partnerId: b.partnerId, clientId: b.clientId, at, excludeBookingId: b.id });
  await q.update(booking).set({ commissionBp: rate.bp, updatedAt: at }).where(eq(booking.id, b.id));
  return rate.bp;
}

/** The projected split for an unpaid amount (SPEC §6 Before payment). */
export async function projectedSplit(q: Queryable, a: { partnerId: string; clientId: string; amountCents: number; at: Date }): Promise<Split> {
  const rate = await commissionRateFor(q, a);
  return split(a.amountCents, rate.bp);
}

/** A booking's split of `baseCents` (default: its amount): actual after payment, projected before. */
export async function bookingSplit(
  q: Queryable, b: { partnerId: string; clientId: string; amountCents: number; commissionBp: number | null }, at: Date, baseCents = b.amountCents,
): Promise<Split> {
  if (b.commissionBp != null) return split(baseCents, b.commissionBp);
  const rate = await commissionRateFor(q, { partnerId: b.partnerId, clientId: b.clientId, at });
  return split(baseCents, rate.bp);
}
