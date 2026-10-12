// The Stripe webhook route (app/api/webhooks/stripe) end to end, without stripe-mock: every event
// type it handles is built as Stripe sends it, signed with stripe.webhooks.generateTestHeaderString
// (the platform endpoint's secret, or the Connect endpoint's for events on the partners' accounts),
// posted to the route handler, and checked by its effect on the database through applyProviderEvent.
// The few API calls the platform makes on the way (the checkout, the payment intent behind a paid
// session) are answered by a local fake (tests/helpers/stripe.ts, STRIPE_API_BASE).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { SYSTEM } from '@/lib/domain/actor';
import { startPayment } from '@/lib/domain/charges';
import { prepareBatch, releaseBatch, releaseBookingFunds } from '@/lib/domain/payouts';
import { createRefunds } from '@/lib/domain/refunds';
import { POST as webhook } from '@/app/api/webhooks/stripe/route';
import { createAdmin, createPartner } from '../helpers/factories';
import { clearJobs, confirmPayoutAccount, paidBooking as paidRow, reloadBooking } from '../helpers/aftercare';
import { NOW, approvedBooking, bookingRow, emails, expectLedgerHealthy, forceSetting, jobs, tickAt } from '../helpers/lifecycle';
import { signedWebhook, stripeEvent, stripeRecorder, type StripeRecorder } from '../helpers/stripe';

const PLATFORM = 'whsec_platform_endpoint_test';
const CONNECT = 'whsec_connect_endpoint_test';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000000ff';

let fake: StripeRecorder;
let seq = 0;
beforeAll(async () => { fake = await stripeRecorder(); });
afterAll(async () => { await fake?.close(); });

/** What the platform asks Stripe on the way: a checkout, the payment intent behind a paid session, closing a session. */
function answerApi() {
  fake.override({
    method: 'POST', path: '/v1/checkout/sessions',
    reply: () => { const id = `cs_test_fake${++seq}`; return { status: 200, body: { id, object: 'checkout.session', status: 'open', url: `https://checkout.stripe.com/c/pay/${id}` } }; },
  });
  fake.override({
    method: 'GET', path: /^\/v1\/payment_intents\/[^/]+$/,
    reply: c => ({ status: 200, body: {
      id: c.path.split('/').pop(), object: 'payment_intent', status: 'succeeded', customer: 'cus_maria',
      payment_method: { id: 'pm_card_visa', object: 'payment_method', type: 'card', card: { brand: 'visa', last4: '4242' } },
    } }),
  });
  fake.override({
    method: 'POST', path: /^\/v1\/checkout\/sessions\/[^/]+\/expire$/,
    reply: c => ({ status: 200, body: { id: c.path.split('/')[4], object: 'checkout.session', status: 'expired' } }),
  });
}

beforeEach(async () => {
  fake.reset();
  answerApi();
  vi.stubEnv('PAYMENT_PROVIDER', 'stripe');
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_webhookFake');
  vi.stubEnv('STRIPE_API_BASE', fake.url);
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', PLATFORM);
  vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', CONNECT);
  setTestNow(NOW);
  await clearJobs();
});
afterEach(async () => {
  await expectLedgerHealthy();
  setTestNow(null);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const post = (event: Record<string, unknown>, secret = PLATFORM) => webhook(signedWebhook(event, secret));
async function expectStatus(res: Response | Promise<Response>, status: number) {
  const r = await res;
  expect(r.status, JSON.stringify(await r.clone().json())).toBe(status);
  return (await r.json()) as Record<string, unknown>;
}

const chargeRow = async (id: string) => (await db.select().from(s.charge).where(eq(s.charge.id, id)))[0];
const ledgerOf = (bookingId: string) => db.select().from(s.ledgerTransaction).where(eq(s.ledgerTransaction.bookingId, bookingId));

/** A partner whose account is at Stripe (charges and payouts enabled). */
async function stripePartner() {
  const p = await createPartner();
  const [row] = await db.update(s.partner).set({ provider: 'stripe', providerAccountRef: `acct_test${p.partner.id.replace(/-/g, '').slice(0, 12)}` })
    .where(eq(s.partner.id, p.partner.id)).returning();
  return { ...p, partner: row };
}

/** An approved booking with an open Stripe checkout (C1). */
async function openCheckout(o: { eventDate?: string } = {}) {
  const p = await stripePartner();
  const a = await approvedBooking({ p, request: o.eventDate ? { eventDate: o.eventDate } : {} });
  const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
  const c = await chargeRow(pay.chargeId);
  expect(c).toMatchObject({ provider: 'stripe', status: 'pending' });
  expect(c.providerRef).toMatch(/^cs_test_/);
  return { ...a, p, chargeId: pay.chargeId, sessionId: c.providerRef! };
}

// ── Stripe's objects, as the API version the SDK pins sends them ────────────

const session = (id: string, chargeId: string, o: Record<string, unknown> = {}) => ({
  id, object: 'checkout.session', mode: 'payment', status: 'complete', payment_status: 'paid', payment_intent: `pi_for_${id}`,
  metadata: { chargeId }, ...o,
});
const paymentIntent = (id: string, chargeId: string, o: Record<string, unknown> = {}) => ({
  id, object: 'payment_intent', amount: 145_000, currency: 'eur', metadata: { chargeId }, ...o,
});
const stripeRefund = (id: string, status: string, o: Record<string, unknown> = {}) => ({
  id, object: 'refund', amount: 30_000, currency: 'eur', status, metadata: {}, failure_reason: null, ...o,
});
const stripePayout = (id: string, status: string, o: Record<string, unknown> = {}) => ({
  id, object: 'payout', amount: 130_500, currency: 'eur', status, metadata: {}, failure_message: null, ...o,
});
const stripeAccount = (id: string, charges: boolean, payouts: boolean, due: string[]) => ({
  id, object: 'account', type: 'express', country: 'BG', charges_enabled: charges, payouts_enabled: payouts,
  requirements: { currently_due: due, eventually_due: due, past_due: [], disabled_reason: due.length ? 'requirements.past_due' : null },
});
const stripeDispute = (pi: string, amount: number) => ({
  id: `dp_${pi}`, object: 'dispute', amount, currency: 'eur', reason: 'fraudulent', status: 'needs_response', payment_intent: pi, charge: `ch_${pi}`,
});

describe('signature', () => {
  it('a request Stripe did not sign with either endpoint secret is refused with 400, and nothing is applied', async () => {
    const a = await openCheckout();
    const ev = stripeEvent('checkout.session.completed', session(a.sessionId, a.chargeId));
    await expectStatus(post(ev, 'whsec_someone_else'), 400);
    const tampered = signedWebhook(ev, PLATFORM);
    const forged = new Request(tampered.url, { method: 'POST', headers: tampered.headers, body: JSON.stringify({ ...ev, type: 'checkout.session.expired' }) });
    await expectStatus(webhook(forged), 400);
    await expectStatus(webhook(signedWebhook(ev, PLATFORM, { timestamp: Math.floor(Date.now() / 1000) - 3600 })), 400); // replayed late
    await expectStatus(webhook(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: JSON.stringify(ev) })), 400);
    expect((await chargeRow(a.chargeId)).status).toBe('pending');
    expect(fake.callsTo(/^\/v1\/payment_intents\//)).toHaveLength(0);
  });

  it('either endpoint\'s secret is accepted; an event type the platform does not use is acknowledged', async () => {
    const a = await openCheckout();
    expect(await expectStatus(post(stripeEvent('customer.created', { id: 'cus_1', object: 'customer' })), 200)).toEqual({ received: 0 });
    expect(await expectStatus(post(stripeEvent('checkout.session.completed', session(a.sessionId, a.chargeId)), CONNECT), 200)).toEqual({ received: 1 });
    expect((await bookingRow(a.bookingId)).status).toBe('confirmed');
  });
});

describe('checkout (platform endpoint)', () => {
  it('checkout.session.completed confirms the booking (K5) with the card Stripe charged; a redelivery changes nothing', async () => {
    const a = await openCheckout();
    const ev = stripeEvent('checkout.session.completed', session(a.sessionId, a.chargeId, { payment_intent: 'pi_paid_k5' }));
    expect(await expectStatus(post(ev), 200)).toEqual({ received: 1 });
    expect(fake.callsTo('/v1/payment_intents/pi_paid_k5', 'GET')[0].query).toEqual({ 'expand[0]': 'payment_method' });
    expect(await bookingRow(a.bookingId)).toMatchObject({ status: 'confirmed' });
    expect(await chargeRow(a.chargeId)).toMatchObject({
      status: 'succeeded', providerRef: 'pi_paid_k5', customerRef: 'cus_maria', paymentMethodRef: 'pm_card_visa', cardBrand: 'visa', cardLast4: '4242',
    });
    const after = { ledger: (await ledgerOf(a.bookingId)).length, mails: (await emails('client-booking-confirmed', a.client.user.id)).length };
    expect(after).toEqual({ ledger: 1, mails: 1 });

    await expectStatus(post(ev), 200);
    await expectStatus(post({ ...ev, id: `${ev.id as string}_again` }), 200);
    expect({ ledger: (await ledgerOf(a.bookingId)).length, mails: (await emails('client-booking-confirmed', a.client.user.id)).length }).toEqual(after);
    expect((await chargeRow(a.chargeId)).isDuplicate).toBe(false);
  });

  it('a session completed without payment (an asynchronous method) does not confirm', async () => {
    const a = await openCheckout();
    expect(await expectStatus(post(stripeEvent('checkout.session.completed', session(a.sessionId, a.chargeId, { payment_status: 'unpaid' }))), 200)).toEqual({ received: 0 });
    expect((await chargeRow(a.chargeId)).status).toBe('pending');
  });

  it('checkout.session.expired expires the charge (C5); the booking still awaits payment', async () => {
    const a = await openCheckout();
    const ev = stripeEvent('checkout.session.expired', session(a.sessionId, a.chargeId, { status: 'expired', payment_status: 'unpaid', payment_intent: null }));
    await expectStatus(post(ev), 200);
    expect(await chargeRow(a.chargeId)).toMatchObject({ status: 'expired', failureReason: 'expired' });
    expect((await bookingRow(a.bookingId)).status).toBe('awaiting_payment');
    await expectStatus(post(ev), 200);
    expect((await chargeRow(a.chargeId)).status).toBe('expired');
  });

  it('a declined card in the checkout (payment_intent.payment_failed) fails the charge (C4); the same session can still be paid', async () => {
    const a = await openCheckout();
    await expectStatus(post(stripeEvent('payment_intent.payment_failed', paymentIntent('pi_declined_c4', a.chargeId, {
      status: 'requires_payment_method', last_payment_error: { type: 'card_error', code: 'card_declined', message: 'Your card was declined.' },
      metadata: { chargeId: a.chargeId, viaCheckout: '1' },
    }))), 200);
    // The charge still names its checkout session: that is what closes it if the charge is voided.
    expect(await chargeRow(a.chargeId)).toMatchObject({ status: 'failed', failureReason: 'Your card was declined.', providerRef: a.sessionId });
    await expectStatus(post(stripeEvent('checkout.session.completed', session(a.sessionId, a.chargeId, { payment_intent: 'pi_declined_c4' }))), 200);
    expect((await bookingRow(a.bookingId)).status).toBe('confirmed');
    expect((await chargeRow(a.chargeId)).providerRef).toBe('pi_declined_c4');
  });

  it('when the payment window closes after a decline (T8), the open session is closed at Stripe', async () => {
    const a = await openCheckout();
    await expectStatus(post(stripeEvent('payment_intent.payment_failed', paymentIntent('pi_declined_t8', a.chargeId, {
      last_payment_error: { message: 'Your card was declined.' }, metadata: { chargeId: a.chargeId, viaCheckout: '1' },
    }))), 200);
    await tickAt(a.paymentDueAt);
    expect((await bookingRow(a.bookingId)).status).toBe('payment_expired');
    expect((await chargeRow(a.chargeId)).status).toBe('expired');
    expect(fake.callsTo(`/v1/checkout/sessions/${a.sessionId}/expire`, 'POST')).toHaveLength(1);
    // Money that still arrives on it is a duplicate (refunded by the team), never the booking's payment.
    await expectStatus(post(stripeEvent('checkout.session.completed', session(a.sessionId, a.chargeId, { payment_intent: 'pi_too_late' }))), 200);
    expect(await chargeRow(a.chargeId)).toMatchObject({ status: 'succeeded', isDuplicate: true });
    expect((await bookingRow(a.bookingId)).status).toBe('payment_expired');
  });

  it('payment_intent.succeeded of a checkout payment is left to its session (one confirmation, not two)', async () => {
    const a = await openCheckout();
    expect(await expectStatus(post(stripeEvent('payment_intent.succeeded', paymentIntent('pi_via_checkout', a.chargeId, {
      status: 'succeeded', metadata: { chargeId: a.chargeId, viaCheckout: '1' },
    }))), 200)).toEqual({ received: 0 });
    expect((await chargeRow(a.chargeId)).status).toBe('pending');
  });

  it('a Stripe API failure while reading a verified event answers 500 (Stripe retries), not "invalid signature"', async () => {
    const a = await openCheckout();
    fake.override({
      method: 'GET', path: '/v1/payment_intents/pi_api_down', times: 1,
      reply: () => ({ status: 500, body: { error: { type: 'api_error', message: 'Stripe is down' } }, headers: { 'stripe-should-retry': 'false' } }),
    });
    const ev = stripeEvent('checkout.session.completed', session(a.sessionId, a.chargeId, { payment_intent: 'pi_api_down' }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await expectStatus(post(ev), 500);
    expect((await chargeRow(a.chargeId)).status).toBe('pending');
    await expectStatus(post(ev), 200); // Stripe's retry, with the API back
    expect((await bookingRow(a.bookingId)).status).toBe('confirmed');
  });

  it('money taken for a charge not stored (yet) answers 500, so Stripe delivers it again; a failure of one moved nothing', async () => {
    for (const ev of [
      stripeEvent('checkout.session.completed', session('cs_test_not_ours', UNKNOWN_ID)),
      stripeEvent('payment_intent.succeeded', paymentIntent('pi_not_ours', UNKNOWN_ID, { status: 'succeeded' })),
    ]) {
      await expectStatus(post(ev), 500);
    }
    // Our charges are stored before Stripe can report on them: an unknown one that failed or expired is not ours.
    for (const ev of [
      stripeEvent('checkout.session.expired', session('cs_test_not_ours', UNKNOWN_ID, { status: 'expired', payment_status: 'unpaid' })),
      stripeEvent('payment_intent.payment_failed', paymentIntent('pi_not_ours', UNKNOWN_ID, { last_payment_error: { message: 'declined' } })),
    ]) {
      await expectStatus(post(ev), 200);
    }
    expect(await db.select().from(s.charge).where(eq(s.charge.id, UNKNOWN_ID))).toHaveLength(0);
  });
});

describe('the off-session balance (deposit schedule, T9)', () => {
  it('a balance payment still processing stays pending; payment_intent.succeeded pays it, payment_failed fails it', async () => {
    await forceSetting('payment.schedule', { mode: 'deposit_balance', deposit_percent: null, balance_due_days: 30 });
    try {
      const pay = async (eventDate: string) => {
        const a = await openCheckout({ eventDate });
        await expectStatus(post(stripeEvent('checkout.session.completed', session(a.sessionId, a.chargeId))), 200);
        expect(await bookingRow(a.bookingId)).toMatchObject({ status: 'confirmed', balanceDueDate: expect.any(String) });
        return a;
      };
      const a = await pay('2025-10-20'), b = await pay('2025-10-21');
      fake.override({ method: 'POST', path: '/v1/payment_intents', reply: c => ({ status: 200, body: { id: `pi_balance_${c.form['metadata[chargeId]'].slice(0, 8)}`, object: 'payment_intent', status: 'processing' } }) });
      await tickAt(sofiaInstant('2025-09-21', 10, 0)); // T9 for both
      const balanceOf = async (bookingId: string) =>
        (await db.select().from(s.charge).where(and(eq(s.charge.bookingId, bookingId), eq(s.charge.kind, 'balance'))));
      const [ca] = await balanceOf(a.bookingId), [cb] = await balanceOf(b.bookingId);
      expect(ca).toMatchObject({ status: 'pending', providerRef: `pi_balance_${ca.id.slice(0, 8)}` });
      expect(cb).toMatchObject({ status: 'pending' });
      expect(fake.callsTo('/v1/payment_intents', 'POST').map(c => c.form.customer)).toEqual(['cus_maria', 'cus_maria']);

      await expectStatus(post(stripeEvent('payment_intent.succeeded', paymentIntent(ca.providerRef!, ca.id, { status: 'succeeded', amount: ca.amountCents }))), 200);
      expect(await balanceOf(a.bookingId)).toMatchObject([{ status: 'succeeded', isDuplicate: false }]);
      expect((await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, a.bookingId), eq(s.auditLog.action, 'booking.balance_paid'))))).toHaveLength(1);

      await expectStatus(post(stripeEvent('payment_intent.payment_failed', paymentIntent(cb.providerRef!, cb.id, { last_payment_error: { message: 'Your card has insufficient funds.' } }))), 200);
      expect(await balanceOf(b.bookingId)).toMatchObject([{ status: 'failed', failureReason: 'Your card has insufficient funds.' }]);
      // The retry 24 h later charges once more (a new charge); the processing one is never charged twice.
      fake.override({ method: 'POST', path: '/v1/payment_intents', reply: c => ({ status: 200, body: { id: `pi_retry_${c.form['metadata[chargeId]'].slice(0, 8)}`, object: 'payment_intent', status: 'succeeded' } }) });
      const [retry] = await jobs(`booking:${b.bookingId}:balanceretry:1`);
      await tickAt(retry.runAt);
      expect((await balanceOf(b.bookingId)).map(c => c.status).sort()).toEqual(['failed', 'succeeded']);
      expect((await balanceOf(a.bookingId)).map(c => c.status)).toEqual(['succeeded']);
    } finally {
      await forceSetting('payment.schedule', { mode: 'full', deposit_percent: null, balance_due_days: 30 });
    }
  });
});

describe('refunds (platform endpoint)', () => {
  async function pendingRefund(ref?: string) {
    const b = await paidRow();
    const [r] = await db.transaction(tx => createRefunds(tx, { bookingId: b.booking.id, amountCents: 30_000, reason: 'dispute_decision', actor: SYSTEM }));
    if (ref) await db.update(s.refund).set({ providerRef: ref }).where(eq(s.refund.id, r.id));
    return { b, r };
  }
  const refundRow = async (id: string) => (await db.select().from(s.refund).where(eq(s.refund.id, id)))[0];

  it('refund.created while pending changes nothing; refund.updated succeeded applies it once (F2, ledger L2, credit note)', async () => {
    const { b, r } = await pendingRefund('re_test_f2');
    expect(await expectStatus(post(stripeEvent('refund.created', stripeRefund('re_test_f2', 'pending', { metadata: { refundId: r.id } }))), 200)).toEqual({ received: 0 });
    expect((await refundRow(r.id)).status).toBe('pending');
    const done = stripeEvent('refund.updated', stripeRefund('re_test_f2', 'succeeded', { metadata: { refundId: r.id } }));
    await expectStatus(post(done), 200);
    expect(await refundRow(r.id)).toMatchObject({ status: 'succeeded' });
    expect(await chargeRow(b.charge.id)).toMatchObject({ status: 'partially_refunded', refundedCents: 30_000 });
    const l2 = (await ledgerOf(b.booking.id)).filter(t => t.kind === 'refund');
    expect(l2).toHaveLength(1);
    await expectStatus(post(done), 200);
    await expectStatus(post(stripeEvent('refund.created', stripeRefund('re_test_f2', 'succeeded', { metadata: { refundId: r.id } }))), 200);
    expect((await ledgerOf(b.booking.id)).filter(t => t.kind === 'refund')).toHaveLength(1);
    expect((await chargeRow(b.charge.id)).refundedCents).toBe(30_000);
    expect(await db.select().from(s.invoice).where(and(eq(s.invoice.refundId, r.id), eq(s.invoice.type, 'credit_note')))).toHaveLength(1);
  });

  it('refund.updated failed fails it (F3); a refund whose call never returned is matched by our id in the metadata', async () => {
    const { r } = await pendingRefund('re_test_f3');
    await expectStatus(post(stripeEvent('refund.updated', stripeRefund('re_test_f3', 'failed', { failure_reason: 'expired_or_canceled_card', metadata: { refundId: r.id } }))), 200);
    expect(await refundRow(r.id)).toMatchObject({ status: 'failed' });

    const lost = await pendingRefund();
    await expectStatus(post(stripeEvent('refund.updated', stripeRefund('re_test_lost', 'succeeded', { metadata: { refundId: lost.r.id } }))), 200);
    expect(await refundRow(lost.r.id)).toMatchObject({ status: 'succeeded', providerRef: 're_test_lost' });
  });

  it('a canceled refund returned nothing to the card: it fails (F3), it does not stay pending', async () => {
    const { r } = await pendingRefund('re_test_canceled');
    await expectStatus(post(stripeEvent('refund.updated', stripeRefund('re_test_canceled', 'canceled', { metadata: { refundId: r.id } }))), 200);
    expect((await refundRow(r.id)).status).toBe('failed');
  });

  it('a refund not stored (yet) answers 500', async () => {
    await expectStatus(post(stripeEvent('refund.updated', stripeRefund('re_test_unknown', 'succeeded'))), 500);
    await expectStatus(post(stripeEvent('refund.updated', stripeRefund('re_test_unknown', 'failed', { metadata: { refundId: UNKNOWN_ID } }))), 500);
  });
});

describe('disputes (platform endpoint)', () => {
  it('charge.dispute.created opens one chargeback and freezes the booking\'s payout; an unknown payment answers 500', async () => {
    const b = await paidRow();
    const ev = stripeEvent('charge.dispute.created', stripeDispute(b.charge.providerRef, 145_000));
    await expectStatus(post(ev), 200);
    expect(await db.select().from(s.chargeback).where(eq(s.chargeback.chargeId, b.charge.id))).toMatchObject([{ amountCents: 145_000, reason: 'fraudulent', status: 'open' }]);
    expect((await reloadBooking(b.booking.id)).payoutHold).toBe(true);
    await expectStatus(post(ev), 200);
    expect(await db.select().from(s.chargeback).where(eq(s.chargeback.chargeId, b.charge.id))).toHaveLength(1);
    await expectStatus(post(stripeEvent('charge.dispute.created', stripeDispute('pi_not_ours', 1_000))), 500);
  });
});

describe('payouts (Connect endpoint)', () => {
  /** A partner's item handed to the provider in the batch of `batchDate` (its event a few days before). */
  async function sentItem(batchDate: string, eventDate: string, releaseOn: string) {
    setTestNow(NOW);
    const { actor: admin } = await createAdmin('admin');
    const p = await stripePartner();
    await confirmPayoutAccount(p.partner.id);
    const b = await paidRow({ partner: p, eventDate });
    setTestNow(sofiaInstant(releaseOn, 8, 0));
    await db.transaction(tx => releaseBookingFunds({ bookingId: b.booking.id }, tx));
    const { batchId } = await prepareBatch(batchDate);
    setTestNow(sofiaInstant(batchDate, 8, 0));
    await releaseBatch(admin, { batchId });
    const [item] = await db.select().from(s.payoutItem).where(and(eq(s.payoutItem.batchId, batchId), eq(s.payoutItem.partnerId, p.partner.id)));
    expect(item.status).toBe('sent');
    return { p, b, item, account: p.partner.providerAccountRef! };
  }
  const itemRow = async (id: string) => (await db.select().from(s.payoutItem).where(eq(s.payoutItem.id, id)))[0];
  const l4 = (itemId: string) => db.select().from(s.ledgerTransaction).where(and(eq(s.ledgerTransaction.kind, 'payout'), eq(s.ledgerTransaction.payoutItemId, itemId)));

  it('payout.paid on the partner\'s account marks the item paid once (Y6, ledger L4)', async () => {
    const { item, account, b } = await sentItem('2025-09-15', '2025-09-10', '2025-09-14');
    const ev = stripeEvent('payout.paid', stripePayout('po_test_y6', 'paid', { amount: item.amountCents, metadata: { payoutItemId: item.id } }), { account });
    await expectStatus(post(ev, CONNECT), 200);
    expect(await itemRow(item.id)).toMatchObject({ status: 'paid', providerPayoutRef: 'po_test_y6' });
    expect((await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, b.booking.id)))[0].status).toBe('paid');
    expect(await l4(item.id)).toHaveLength(1);
    await expectStatus(post(ev, CONNECT), 200);
    expect(await l4(item.id)).toHaveLength(1);
  });

  it('payout.failed returns the lines and pauses the partner\'s payouts (Y8)', async () => {
    const { item, account, p, b } = await sentItem('2025-10-01', '2025-09-25', '2025-09-30');
    await db.update(s.payoutItem).set({ providerPayoutRef: 'po_test_y8' }).where(eq(s.payoutItem.id, item.id));
    await expectStatus(post(stripeEvent('payout.failed', stripePayout('po_test_y8', 'failed', { failure_message: 'The bank account has been closed.' }), { account }), CONNECT), 200);
    expect(await itemRow(item.id)).toMatchObject({ status: 'failed', failureReason: 'The bank account has been closed.' });
    expect((await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, b.booking.id)))[0].status).toBe('ready');
    expect((await db.select().from(s.partner).where(eq(s.partner.id, p.partner.id)))[0].payoutsPaused).toBe(true);
  });

  it('payout.canceled paid nothing: a failed transfer (Y8), so the lines can go out again', async () => {
    const { item, account } = await sentItem('2025-10-15', '2025-10-10', '2025-10-14');
    await expectStatus(post(stripeEvent('payout.canceled', stripePayout('po_test_canceled', 'canceled', { metadata: { payoutItemId: item.id } }), { account }), CONNECT), 200);
    expect((await itemRow(item.id)).status).toBe('failed');
  });

  it('a payout not stored (yet) answers 500', async () => {
    await expectStatus(post(stripeEvent('payout.paid', stripePayout('po_test_unknown', 'paid'), { account: 'acct_test_other' }), CONNECT), 500);
    await expectStatus(post(stripeEvent('payout.failed', stripePayout('po_test_unknown', 'failed', { metadata: { payoutItemId: UNKNOWN_ID } }), { account: 'acct_test_other' }), CONNECT), 500);
  });
});

describe('partner accounts (Connect endpoint)', () => {
  it('account.updated keeps the partner\'s charges, payouts and requirements in step (P11)', async () => {
    const p = await stripePartner();
    await db.update(s.partner).set({ providerStatus: 'pending', providerChargesEnabled: false, providerPayoutsEnabled: false }).where(eq(s.partner.id, p.partner.id));
    const acct = p.partner.providerAccountRef!;
    const row = async () => (await db.select().from(s.partner).where(eq(s.partner.id, p.partner.id)))[0];

    // A new account before onboarding: still pending (as when it was created), not restricted.
    await expectStatus(post(stripeEvent('account.updated', stripeAccount(acct, false, false, ['external_account', 'tos_acceptance.date']), { account: acct }), CONNECT), 200);
    expect(await row()).toMatchObject({ providerStatus: 'pending', providerChargesEnabled: false, providerRequirements: ['external_account', 'tos_acceptance.date'] });

    const enabled = stripeEvent('account.updated', stripeAccount(acct, true, true, []), { account: acct });
    await expectStatus(post(enabled, CONNECT), 200);
    expect(await row()).toMatchObject({ providerStatus: 'enabled', providerChargesEnabled: true, providerPayoutsEnabled: true, providerRequirements: [] });
    await expectStatus(post(enabled, CONNECT), 200);
    expect((await row()).providerStatus).toBe('enabled');

    await expectStatus(post(stripeEvent('account.updated', stripeAccount(acct, true, false, ['external_account']), { account: acct }), CONNECT), 200);
    expect(await row()).toMatchObject({ providerStatus: 'restricted', providerPayoutsEnabled: false, providerRequirements: ['external_account'] });
  });

  it('an account not stored (yet) answers 500', async () => {
    await expectStatus(post(stripeEvent('account.updated', stripeAccount('acct_test_not_ours', true, true, []), { account: 'acct_test_not_ours' }), CONNECT), 500);
  });
});
