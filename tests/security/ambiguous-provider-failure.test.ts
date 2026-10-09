// Money: a provider call that throws is not taken as "nothing happened" (ambiguous-failure-double-refund-payout).
// Before the fix the last attempt of a payout (or refund) whose call timed out marked it failed: the
// lines went back to `ready` and the next batch paid the partner again under a new idempotency key,
// although the first payout had been made.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { job, partner as partnerT, payoutItem, payoutLine, refund } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { runDueJobs } from '@/lib/jobs';
import { SYSTEM } from '@/lib/domain/actor';
import { prepareBatch, releaseBatch, releaseBookingFunds } from '@/lib/domain/payouts';
import { createRefunds } from '@/lib/domain/refunds';
import { simulatedProvider } from '@/lib/payments/simulated';
import { createAdmin, createPartner } from '../helpers/factories';
import { clearJobs, confirmPayoutAccount, paidBooking } from '../helpers/aftercare';

const t = (d: string, hh = 12) => sofiaInstant(d, hh, 0);
beforeEach(async () => { await clearJobs(); });
afterEach(() => { setTestNow(null); vi.restoreAllMocks(); });

/** Make the next run of a job its last attempt (the runner counts the claim). */
const lastAttempt = (key: string) => db.update(job).set({ attempts: 4 }).where(eq(job.dedupeKey, key));

/** A partner's item handed to the provider in the batch of `batchDate` (event five days before). */
async function sentItem(batchDate: string, eventDate: string, releaseOn: string) {
  setTestNow(t('2025-09-01'));
  const { actor: admin } = await createAdmin('admin');
  const p = await createPartner();
  await confirmPayoutAccount(p.partner.id);
  const b = await paidBooking({ partner: p, eventDate });
  setTestNow(t(releaseOn, 8));
  await db.transaction(tx => releaseBookingFunds({ bookingId: b.booking.id }, tx));
  const { batchId } = await prepareBatch(batchDate);
  setTestNow(t(batchDate, 8));
  await releaseBatch(admin, { batchId });
  const [item] = await db.select().from(payoutItem).where(and(eq(payoutItem.batchId, batchId), eq(payoutItem.partnerId, p.partner.id)));
  return { p, b, item };
}
const itemRow = async (id: string) => (await db.select().from(payoutItem).where(eq(payoutItem.id, id)))[0];
const lineOf = async (bookingId: string) => (await db.select().from(payoutLine).where(eq(payoutLine.bookingId, bookingId)))[0];

describe('payout.submit after a call that threw', () => {
  it('the payout was made after all: applied as paid, the lines are not offered again', async () => {
    const { p, b, item } = await sentItem('2025-09-15', '2025-09-10', '2025-09-14');
    vi.spyOn(simulatedProvider, 'payout').mockRejectedValue(new Error('socket hang up'));
    const find = vi.spyOn(simulatedProvider, 'findPayout').mockResolvedValue({ payoutRef: 'po_made_anyway', status: 'paid' });
    await lastAttempt(`payout_item:${item.id}:submit`);
    await runDueJobs();
    expect(find).toHaveBeenCalledWith(expect.objectContaining({ payoutItemId: item.id }));
    expect(await itemRow(item.id)).toMatchObject({ status: 'paid', providerPayoutRef: 'po_made_anyway' });
    expect((await lineOf(b.booking.id)).status).toBe('paid');
    expect((await db.select().from(partnerT).where(eq(partnerT.id, p.partner.id)))[0].payoutsPaused).toBe(false);
  });

  it('the provider cannot be asked: the item stays sent and its lines stay out of later batches', async () => {
    const { p, b, item } = await sentItem('2025-10-01', '2025-09-25', '2025-09-30');
    vi.spyOn(simulatedProvider, 'payout').mockRejectedValue(new Error('503'));
    vi.spyOn(simulatedProvider, 'findPayout').mockRejectedValue(new Error('503'));
    await lastAttempt(`payout_item:${item.id}:submit`);
    await runDueJobs();
    expect((await itemRow(item.id)).status).toBe('sent');
    expect((await lineOf(b.booking.id)).status).toBe('in_batch');
    const next = await prepareBatch('2025-11-01');
    expect(await db.select().from(payoutItem).where(and(eq(payoutItem.batchId, next.batchId), eq(payoutItem.partnerId, p.partner.id)))).toHaveLength(0);
  });

  it('certainly no payout: a failed transfer (Y8), as before', async () => {
    const { b, item } = await sentItem('2025-11-15', '2025-11-10', '2025-11-14');
    vi.spyOn(simulatedProvider, 'payout').mockRejectedValue(new Error('invalid account'));
    vi.spyOn(simulatedProvider, 'findPayout').mockResolvedValue(null);
    await lastAttempt(`payout_item:${item.id}:submit`);
    await runDueJobs();
    expect((await itemRow(item.id)).status).toBe('failed');
    expect((await lineOf(b.booking.id)).status).toBe('ready');
  });
});

describe('refund.submit after a call that threw', () => {
  it('the refund was made after all: applied as succeeded, not marked failed', async () => {
    setTestNow(t('2025-08-31'));
    const b = await paidBooking();
    const [r] = await db.transaction(tx => createRefunds(tx, { bookingId: b.booking.id, amountCents: 30_000, reason: 'dispute_decision', actor: SYSTEM }));
    vi.spyOn(simulatedProvider, 'refund').mockRejectedValue(new Error('timeout'));
    vi.spyOn(simulatedProvider, 'findRefund').mockResolvedValue({ refundRef: 're_made_anyway', status: 'succeeded' });
    await lastAttempt(`refund:${r.id}:submit`);
    await runDueJobs();
    expect((await db.select().from(refund).where(eq(refund.id, r.id)))[0]).toMatchObject({ status: 'succeeded', providerRef: 're_made_anyway' });
  });
});
