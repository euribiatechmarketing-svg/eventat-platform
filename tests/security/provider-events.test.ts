// Security / money: every provider event is applied (provider-events-dropped). Before the fix
// dispute.created, refund.* and payout.* reached only an "unhandled" audit row and were acknowledged:
// a charged-back booking was still released and paid out to the partner, a pending refund stayed
// pending, and a returned payout never reversed.
import Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { chargeback, partner as partnerT, payoutBatch, payoutItem, payoutLine, refund } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { SYSTEM } from '@/lib/domain/actor';
import { prepareBatch, releaseBatch, releaseBookingFunds } from '@/lib/domain/payouts';
import { createRefunds } from '@/lib/domain/refunds';
import { applyProviderEvent } from '@/lib/payments/apply';
import { POST as webhook } from '@/app/api/webhooks/stripe/route';
import { createAdmin, createPartner } from '../helpers/factories';
import { clearJobs, confirmPayoutAccount, paidBooking, reloadBooking } from '../helpers/aftercare';

const t = (d: string, hh = 12) => sofiaInstant(d, hh, 0);
beforeEach(async () => { await clearJobs(); });
afterEach(() => { setTestNow(null); vi.unstubAllEnvs(); });

describe('applyProviderEvent', () => {
  it('dispute.created opens a chargeback and freezes the payout; an unknown charge asks for a retry', async () => {
    setTestNow(t('2025-08-31'));
    const b = await paidBooking();
    expect(await applyProviderEvent({ type: 'dispute.created', providerChargeRef: b.charge.providerRef, amountCents: 145_000, reason: 'fraudulent' }))
      .toEqual({ applied: true });
    expect(await db.select().from(chargeback).where(eq(chargeback.chargeId, b.charge.id))).toHaveLength(1);
    expect((await reloadBooking(b.booking.id)).payoutHold).toBe(true);
    expect(await applyProviderEvent({ type: 'dispute.created', providerChargeRef: 'pi_not_ours', amountCents: 1, reason: 'fraudulent' }))
      .toMatchObject({ applied: false, retry: true });
  });

  it('refund.succeeded / refund.failed settle the refund, by ref or by our id in the metadata', async () => {
    setTestNow(t('2025-08-31'));
    const b = await paidBooking();
    const [r1, r2] = await db.transaction(async tx => [
      ...(await createRefunds(tx, { bookingId: b.booking.id, amountCents: 30_000, reason: 'dispute_decision', actor: SYSTEM })),
      ...(await createRefunds(tx, { bookingId: b.booking.id, amountCents: 10_000, reason: 'dispute_decision', actor: SYSTEM })),
    ]);
    await db.update(refund).set({ providerRef: 're_known_1' }).where(eq(refund.id, r1.id));
    expect(await applyProviderEvent({ type: 'refund.succeeded', refundRef: 're_known_1' })).toEqual({ applied: true });
    expect((await db.select().from(refund).where(eq(refund.id, r1.id)))[0].status).toBe('succeeded');
    // The call that created r2 timed out: no ref stored, matched by metadata.
    expect(await applyProviderEvent({ type: 'refund.failed', refundRef: 're_lost_2', reason: 'expired_card', refundId: r2.id })).toEqual({ applied: true });
    expect((await db.select().from(refund).where(eq(refund.id, r2.id)))[0]).toMatchObject({ status: 'failed', providerRef: 're_lost_2' });
    expect(await applyProviderEvent({ type: 'refund.succeeded', refundRef: 're_unknown' })).toMatchObject({ applied: false, retry: true });
  });

  it('payout.paid / payout.failed settle a sent item, by ref or by our id in the metadata', async () => {
    setTestNow(t('2025-09-08'));
    const { actor: admin } = await createAdmin('admin');
    const p1 = await createPartner(), p2 = await createPartner();
    for (const p of [p1, p2]) await confirmPayoutAccount(p.partner.id);
    const a = await paidBooking({ partner: p1, eventDate: '2025-09-10' });
    const c = await paidBooking({ partner: p2, eventDate: '2025-09-12' });
    setTestNow(t('2025-09-14', 8));
    for (const x of [a, c]) await db.transaction(tx => releaseBookingFunds({ bookingId: x.booking.id }, tx));
    const { batchId } = await prepareBatch('2025-09-15');
    setTestNow(t('2025-09-15', 8));
    await releaseBatch(admin, { batchId });
    const item = async (partnerId: string) => (await db.select().from(payoutItem).where(and(eq(payoutItem.batchId, batchId), eq(payoutItem.partnerId, partnerId))))[0];
    const i1 = await item(p1.partner.id), i2 = await item(p2.partner.id);
    expect([i1.status, i2.status]).toEqual(['sent', 'sent']);

    expect(await applyProviderEvent({ type: 'payout.paid', payoutRef: 'po_lost_1', payoutItemId: i1.id })).toEqual({ applied: true });
    expect(await item(p1.partner.id)).toMatchObject({ status: 'paid', providerPayoutRef: 'po_lost_1' });
    await db.update(payoutItem).set({ providerPayoutRef: 'po_known_2' }).where(eq(payoutItem.id, i2.id));
    expect(await applyProviderEvent({ type: 'payout.failed', payoutRef: 'po_known_2', reason: 'account_closed' })).toEqual({ applied: true });
    expect((await item(p2.partner.id)).status).toBe('failed');
    expect((await db.select().from(payoutLine).where(eq(payoutLine.bookingId, c.booking.id)))[0].status).toBe('ready');
    expect((await db.select().from(partnerT).where(eq(partnerT.id, p2.partner.id)))[0].payoutsPaused).toBe(true);
    expect((await db.select().from(payoutBatch).where(eq(payoutBatch.id, batchId)))[0].status).toBe('partially_failed');
  });
});

describe('Stripe webhook', () => {
  const SECRET = 'whsec_test_security';
  const post = (event: object) => {
    const payload = JSON.stringify(event);
    const header = Stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
    return webhook(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: payload, headers: { 'stripe-signature': header } }));
  };
  const dispute = (pi: string) => ({
    id: `evt_${pi}`, object: 'event', type: 'charge.dispute.created', api_version: '2025-01-27',
    data: { object: { id: `dp_${pi}`, object: 'dispute', amount: 145_000, reason: 'fraudulent', payment_intent: pi } },
  });

  it('applies charge.dispute.created and asks Stripe to retry an event it cannot place yet', async () => {
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', SECRET);
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_security_dummy');
    setTestNow(t('2025-08-31'));
    const b = await paidBooking();
    expect((await post(dispute(b.charge.providerRef))).status).toBe(200);
    expect(await db.select().from(chargeback).where(eq(chargeback.chargeId, b.charge.id))).toHaveLength(1);
    expect((await post(dispute('pi_not_stored_yet'))).status).toBe(500);
  });
});
