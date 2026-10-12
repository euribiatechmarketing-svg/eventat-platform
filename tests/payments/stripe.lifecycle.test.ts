// PAYMENT_PROVIDER=stripe: the booking lifecycle at domain level, every Stripe call through the real
// SDK to stripe-mock (which rejects any parameter the API version does not know) and every Stripe
// result arriving as a signed webhook through the route, the way production receives it:
//   request → approval → Stripe Checkout → checkout.session.completed → confirmed → the event →
//   completed → payout batch released → payout on the connected account → payout.paid,
// with the ledger checked against what Stripe holds at each step. Also the cancellation refund and
// the deposit schedule's off-session balance when Stripe cannot be reached.
//
// Needs stripe-mock: `tools/stripe-mock.sh` (see tests/helpers/stripe.ts). Skipped when it is not running.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { runDueJobs } from '@/lib/jobs';
import { cancelByClient } from '@/lib/domain/cancellation';
import { startPayment } from '@/lib/domain/charges';
import { bookingBalances, checkLedgerInvariants, providerHeldTotal } from '@/lib/domain/ledger';
import { releaseBatch } from '@/lib/domain/payouts';
import { approveRequest } from '@/lib/domain/requests';
import { stripeProvider } from '@/lib/payments/stripe';
import { POST as webhook } from '@/app/api/webhooks/stripe/route';
import { createAdmin, createClient, createPartner } from '../helpers/factories';
import { clearJobs, confirmPayoutAccount, runJobs } from '../helpers/aftercare';
import { NOW, bookingRow, forceSetting, sendFor, tickAt } from '../helpers/lifecycle';
import {
  SDK_API_VERSION, STRIPE_MOCK_HINT, STRIPE_MOCK_URL, signedWebhook, stripeEvent, stripeMockStatus, stripeRecorder, type StripeRecorder,
} from '../helpers/stripe';

const PLATFORM = 'whsec_platform_lifecycle';
const CONNECT = 'whsec_connect_lifecycle';
const mock = await stripeMockStatus();
if (!mock.up) process.stderr.write(`${STRIPE_MOCK_HINT}\n`);

describe.skipIf(!mock.up)(`PAYMENT_PROVIDER=stripe against stripe-mock (${STRIPE_MOCK_URL})`, () => {
  let rec: StripeRecorder;
  beforeAll(async () => { rec = await stripeRecorder(STRIPE_MOCK_URL); });
  afterAll(async () => { await rec?.close(); });
  beforeEach(async () => {
    rec.reset();
    vi.stubEnv('PAYMENT_PROVIDER', 'stripe');
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_eventatLifecycle');
    vi.stubEnv('STRIPE_API_BASE', rec.url);
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', PLATFORM);
    vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', CONNECT);
    setTestNow(NOW);
    await clearJobs();
  });
  afterEach(() => {
    // stripe-mock accepted every call the platform made (a refused parameter would be a 400), in the SDK's API version.
    for (const c of rec.calls.filter(x => x.status !== -1)) {
      expect(c.status, `${c.method} ${c.path}: ${JSON.stringify(c.response)}`).toBe(200);
      expect(c.headers['stripe-version']).toBe(SDK_API_VERSION);
    }
    setTestNow(null);
    vi.unstubAllEnvs();
  });

  const post = async (event: Record<string, unknown>, secret: string) => {
    const r = await webhook(signedWebhook(event, secret));
    expect(r.status, JSON.stringify(await r.clone().json())).toBe(200);
  };
  /** The invariants of SPEC §7.5, with Σ provider_held against what Stripe holds of the clients' money (platform + connected accounts). */
  const ledgerMatches = async (stripeHolds: number) => {
    expect(await checkLedgerInvariants(db, { providerReportedCents: stripeHolds })).toEqual([]);
    expect(await providerHeldTotal(db)).toBe(stripeHolds);
  };

  /** P4: the partner's account is opened at Stripe; Stripe reports it enabled after onboarding (account.updated, P11). */
  async function stripePartner() {
    const p = await createPartner();
    const { accountRef } = await stripeProvider.createPartnerAccount({ partnerId: p.partner.id, email: p.partner.notificationEmail, businessName: p.partner.businessName });
    const status = await stripeProvider.partnerAccountStatus(accountRef);
    await db.update(s.partner).set({
      provider: 'stripe', providerAccountRef: accountRef, providerStatus: 'pending', providerChargesEnabled: status.chargesEnabled,
      providerPayoutsEnabled: status.payoutsEnabled, providerRequirements: status.requirementsDue,
    }).where(eq(s.partner.id, p.partner.id));
    // The partner completes Stripe's onboarding: the account is enabled (P11 reads it back from Stripe).
    rec.override({
      method: 'GET', path: `/v1/accounts/${accountRef}`,
      patch: b => ({ ...b, id: accountRef, charges_enabled: true, payouts_enabled: true, requirements: { ...(b.requirements as object), currently_due: [] } }),
    });
    await post(stripeEvent('account.updated', {
      id: accountRef, object: 'account', type: 'express', country: 'BG', charges_enabled: true, payouts_enabled: true,
      requirements: { currently_due: [], eventually_due: [], past_due: [], disabled_reason: null },
    }, { account: accountRef }), CONNECT);
    const [row] = await db.select().from(s.partner).where(eq(s.partner.id, p.partner.id));
    expect(row).toMatchObject({ providerStatus: 'enabled', providerChargesEnabled: true, providerPayoutsEnabled: true });
    return { ...p, partner: row, accountRef };
  }

  /** R1 → K1 → C1 → checkout.session.completed → K5, all through Stripe. */
  async function bookThroughStripe(eventDate: string) {
    const p = await stripePartner();
    const client = await createClient();
    const { number } = await sendFor(client, p, { eventDate });
    const { bookingId } = await approveRequest(p.actor, { number });
    const pay = await startPayment(client.actor, { number, method: 'card' });
    const [c] = await db.select().from(s.charge).where(eq(s.charge.id, pay.chargeId));
    const checkout = rec.callsTo('/v1/checkout/sessions', 'POST').at(-1)!;
    expect(c).toMatchObject({ provider: 'stripe', status: 'pending', providerRef: (checkout.response as { id: string }).id, checkoutUrl: (checkout.response as { url: string }).url });
    expect(pay).toMatchObject({ kind: 'redirect', redirectUrl: c.checkoutUrl });
    expect(checkout.form).toMatchObject({
      'line_items[0][price_data][unit_amount]': String(c.amountCents), 'payment_intent_data[application_fee_amount]': String(c.applicationFeeCents),
      'payment_intent_data[on_behalf_of]': p.accountRef, 'payment_intent_data[transfer_data][destination]': p.accountRef,
      'payment_intent_data[metadata][chargeId]': c.id, customer_email: client.user.email,
    });

    // The client pays on Stripe's page; Stripe reports the session (the payment intent is read back for the card).
    const pi = `pi_${c.id.replace(/-/g, '').slice(0, 20)}`;
    rec.override({ method: 'GET', path: `/v1/payment_intents/${pi}`, patch: b => ({ ...b, id: pi, status: 'succeeded', customer: `cus_${client.user.id.slice(-10)}` }) });
    await post(stripeEvent('checkout.session.completed', {
      id: c.providerRef, object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', payment_intent: pi,
      metadata: { chargeId: c.id },
    }), PLATFORM);
    const [paid] = await db.select().from(s.charge).where(eq(s.charge.id, c.id));
    expect(paid).toMatchObject({ status: 'succeeded', providerRef: pi, cardBrand: 'visa', cardLast4: '4242', customerRef: `cus_${client.user.id.slice(-10)}` });
    expect(paid.paymentMethodRef).toMatch(/^pm_/);
    return { p, client, number, bookingId, charge: paid };
  }

  it('request → Stripe Checkout → confirmed → the event → payout batch → payout.paid, the ledger in step with Stripe throughout', async () => {
    const { actor: admin } = await createAdmin('admin');
    const b = await bookThroughStripe('2025-09-20');
    expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'confirmed', commissionBp: 500 });
    expect(b.charge).toMatchObject({ amountCents: 145_000, applicationFeeCents: 7_250 });
    await ledgerMatches(145_000); // the client's money, at Stripe

    // The event; T13 completes it and releases the partner's share (L3); T17 prepares the batch of 1 October.
    await confirmPayoutAccount(b.p.partner.id);
    await tickAt(sofiaInstant('2025-10-01', 8, 0));
    expect((await bookingRow(b.bookingId)).status).toBe('completed');
    expect(await bookingBalances(db, b.bookingId)).toMatchObject({ client_funds: 0, partner_payable: 137_750, commission_revenue: 7_250 });
    await ledgerMatches(137_750);
    const [batch] = await db.select().from(s.payoutBatch).where(eq(s.payoutBatch.batchDate, '2025-10-01'));
    expect(batch.status).toBe('ready');

    // Y5: released; payout.submit pays out from the partner's connected account.
    await releaseBatch(admin, { batchId: batch.id });
    await tickAt(sofiaInstant('2025-10-01', 8, 1));
    const call = rec.callsTo('/v1/payouts', 'POST')[0];
    expect(call.headers['stripe-account']).toBe(b.p.accountRef);
    const [item] = await db.select().from(s.payoutItem).where(and(eq(s.payoutItem.batchId, batch.id), eq(s.payoutItem.partnerId, b.p.partner.id)));
    expect(call.form).toMatchObject({ amount: '137750', currency: 'eur', 'metadata[payoutItemId]': item.id });
    // Stripe answers in_transit: sent, not paid yet.
    expect(item).toMatchObject({ status: 'sent', amountCents: 137_750, providerPayoutRef: (call.response as { id: string }).id });
    await ledgerMatches(137_750); // the partner's share; EventAT's fee became its own money at the release (L3)

    // Y6: Stripe reports the money arrived (Connect endpoint).
    const payoutPaid = stripeEvent('payout.paid', {
      id: item.providerPayoutRef, object: 'payout', amount: 137_750, currency: 'eur', status: 'paid', metadata: { payoutItemId: item.id },
    }, { account: b.p.accountRef });
    await post(payoutPaid, CONNECT);
    await post(payoutPaid, CONNECT); // redelivered: nothing more
    const [paidItem] = await db.select().from(s.payoutItem).where(eq(s.payoutItem.id, item.id));
    expect(paidItem.status).toBe('paid');
    expect((await db.select().from(s.payoutBatch).where(eq(s.payoutBatch.id, batch.id)))[0].status).toBe('paid');
    expect(await bookingBalances(db, b.bookingId)).toMatchObject({ client_funds: 0, partner_payable: 137_750, commission_revenue: 7_250 });
    expect((await db.select().from(s.ledgerTransaction).where(eq(s.ledgerTransaction.payoutItemId, item.id)))).toHaveLength(1);
    await ledgerMatches(0); // nothing of the client's money is left at Stripe
  });

  it('a cancellation in the free period refunds through Stripe (reverse transfer, fee returned); refund.updated changes nothing more', async () => {
    const b = await bookThroughStripe('2025-12-20');
    await ledgerMatches(145_000);
    await cancelByClient(b.client.actor, { bookingId: b.bookingId, reason: 'event_cancelled' });
    const [r] = await db.select().from(s.refund).where(eq(s.refund.bookingId, b.bookingId));
    expect(r).toMatchObject({ status: 'pending', amountCents: 145_000, applicationFeeRefundCents: 7_250 });
    await runJobs(); // refund.submit
    const call = rec.callsTo('/v1/refunds', 'POST')[0];
    expect(call.form).toEqual({
      payment_intent: b.charge.providerRef, amount: '145000', reverse_transfer: 'true', refund_application_fee: 'true', 'metadata[refundId]': r.id,
    });
    const [done] = await db.select().from(s.refund).where(eq(s.refund.id, r.id));
    expect(done).toMatchObject({ status: 'succeeded', providerRef: (call.response as { id: string }).id });
    await ledgerMatches(0);
    await post(stripeEvent('refund.updated', {
      id: done.providerRef, object: 'refund', amount: 145_000, currency: 'eur', status: 'succeeded', payment_intent: b.charge.providerRef,
      metadata: { refundId: r.id }, failure_reason: null,
    }), PLATFORM);
    expect((await db.select().from(s.charge).where(eq(s.charge.id, b.charge.id)))[0]).toMatchObject({ status: 'refunded', refundedCents: 145_000 });
    await ledgerMatches(0);
  });

  it('deposit schedule: the balance charge Stripe could not be reached for is retried with the same charge and key, never charged twice', async () => {
    await forceSetting('payment.schedule', { mode: 'deposit_balance', deposit_percent: null, balance_due_days: 30 });
    try {
      const b = await bookThroughStripe('2025-10-20');
      expect(await bookingRow(b.bookingId)).toMatchObject({ status: 'confirmed', balanceCents: 101_500, balanceDueDate: '2025-09-20' });
      expect(rec.callsTo('/v1/checkout/sessions', 'POST')[0].form['payment_intent_data[setup_future_usage]']).toBe('off_session');
      await ledgerMatches(43_500);

      // T9: every attempt of the call to Stripe is cut off (the SDK's own retries included).
      rec.override({ method: 'POST', path: '/v1/payment_intents', drop: true });
      vi.spyOn(console, 'error').mockImplementation(() => {});
      setTestNow(sofiaInstant('2025-09-20', 10, 0));
      expect((await runDueJobs()).failed).toBe(1);
      const balance = () => db.select().from(s.charge).where(and(eq(s.charge.bookingId, b.bookingId), eq(s.charge.kind, 'balance')));
      const [inDoubt] = await balance();
      expect(inDoubt).toMatchObject({ status: 'pending', providerRef: null, amountCents: 101_500 });

      // The job's next attempt asks again for the same charge, under the same idempotency key.
      rec.override({ method: 'POST', path: '/v1/payment_intents', patch: x => ({ ...x, status: 'succeeded' }) });
      setTestNow(sofiaInstant('2025-09-20', 10, 2));
      expect((await runDueJobs()).failed).toBe(0);
      expect(await balance()).toMatchObject([{ id: inDoubt.id, status: 'succeeded', amountCents: 101_500, isDuplicate: false }]);
      const calls = rec.callsTo('/v1/payment_intents', 'POST');
      expect(calls.map(c => c.status)).toEqual([...calls.slice(0, -1).map(() => -1), 200]); // cut off, cut off…, answered
      expect(new Set(calls.map(c => c.headers['idempotency-key']))).toEqual(new Set([`offsession-${inDoubt.id}`]));
      expect(calls.at(-1)!.form).toMatchObject({ customer: b.charge.customerRef, payment_method: b.charge.paymentMethodRef, off_session: 'true', confirm: 'true', amount: '101500' });
      await ledgerMatches(145_000);
    } finally {
      vi.restoreAllMocks();
      await forceSetting('payment.schedule', { mode: 'full', deposit_percent: null, balance_due_days: 30 });
    }
  });
});
