// The Stripe provider (lib/payments/stripe.ts) against stripe-mock, Stripe's mock API server: every
// provider method is called through the real SDK, stripe-mock checks the request against the API
// version the SDK pins (unknown or mistyped parameters are a 400, so a passing call proves them
// valid), and a recording proxy in between shows exactly what was sent and can change an answer to
// prove how the provider reads it.
//
// Needs stripe-mock: `tools/stripe-mock.sh` (see tests/helpers/stripe.ts). Skipped when it is not running.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { stripeApiBase, stripeProvider } from '@/lib/payments/stripe';
import {
  SDK_API_VERSION, STRIPE_MOCK_HINT, STRIPE_MOCK_URL, signedWebhook, stripeError, stripeEvent, stripeMockStatus, stripeRecorder,
  type StripeCall, type StripeRecorder,
} from '../helpers/stripe';

const mock = await stripeMockStatus();
if (!mock.up) process.stderr.write(`${STRIPE_MOCK_HINT}\n`);

describe('STRIPE_API_BASE (tests only)', () => {
  it('points the client at another host, and is refused with a live key or in production', () => {
    expect(stripeApiBase({})).toEqual({});
    expect(stripeApiBase({ STRIPE_API_BASE: 'http://127.0.0.1:12111', STRIPE_SECRET_KEY: 'sk_test_x' })).toEqual({ host: '127.0.0.1', port: '12111', protocol: 'http' });
    expect(stripeApiBase({ STRIPE_API_BASE: 'https://localhost', STRIPE_SECRET_KEY: 'sk_test_x' })).toEqual({ host: 'localhost', port: '443', protocol: 'https' });
    expect(() => stripeApiBase({ STRIPE_API_BASE: 'http://127.0.0.1:12111', STRIPE_SECRET_KEY: 'sk_live_x' })).toThrow(/tests only/);
    expect(() => stripeApiBase({ STRIPE_API_BASE: 'http://127.0.0.1:12111', STRIPE_SECRET_KEY: 'rk_live_x' })).toThrow(/tests only/);
    expect(() => stripeApiBase({ STRIPE_API_BASE: 'http://127.0.0.1:12111', STRIPE_SECRET_KEY: 'sk_test_x', VERCEL_ENV: 'production' })).toThrow(/tests only/);
    expect(() => stripeApiBase({ STRIPE_API_BASE: 'ftp://127.0.0.1', STRIPE_SECRET_KEY: 'sk_test_x' })).toThrow(/http/);
  });
});

describe.skipIf(!mock.up)(`Stripe provider against stripe-mock (${STRIPE_MOCK_URL})`, () => {
  let rec: StripeRecorder;
  beforeAll(async () => { rec = await stripeRecorder(STRIPE_MOCK_URL); });
  afterAll(async () => { await rec?.close(); });
  beforeEach(() => {
    rec.reset();
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_eventatStripeMock');
    vi.stubEnv('STRIPE_API_BASE', rec.url);
  });
  afterEach(() => {
    // Every call carried the SDK's pinned API version (stripe-mock -strict-version-check rejects any other).
    for (const c of rec.calls) expect(c.headers['stripe-version'], `${c.method} ${c.path}`).toBe(SDK_API_VERSION);
    vi.unstubAllEnvs();
  });

  /** The one call to `path`; stripe-mock accepted it (200: every parameter is valid for the API version). */
  function one(path: string | RegExp, method: string): StripeCall {
    const calls = rec.callsTo(path, method);
    expect(calls, `${method} ${path}`).toHaveLength(1);
    expect(calls[0].status, JSON.stringify(calls[0].response)).toBe(200);
    return calls[0];
  }
  const idOf = (c: StripeCall) => (c.response as { id: string }).id;

  it('stripe-mock speaks the API version the SDK pins, and rejects any other', () => {
    expect(mock.sdkVersion, `stripe-mock does not speak ${SDK_API_VERSION}: bump VERSION in tools/stripe-mock.sh to the release for this stripe package`).toBe(true);
    expect(mock.strict, 'start stripe-mock with -strict-version-check (tools/stripe-mock.sh does)').toBe(true);
  });

  describe('partner accounts (Connect)', () => {
    it('createPartnerAccount: an Express-dashboard account in BG, manual payouts, our partner id in the metadata', async () => {
      const r = await stripeProvider.createPartnerAccount({ partnerId: '7d3f0c1e-0000-4000-8000-000000000001', email: 'studio.melodia@gmail.com', businessName: 'Студио Мелодия' });
      const c = one('/v1/accounts', 'POST');
      expect(c.form).toEqual({
        country: 'BG', email: 'studio.melodia@gmail.com', 'business_profile[name]': 'Студио Мелодия',
        'controller[stripe_dashboard][type]': 'express', 'controller[fees][payer]': 'application', 'controller[losses][payments]': 'application',
        'capabilities[card_payments][requested]': 'true', 'capabilities[transfers][requested]': 'true',
        'settings[payouts][schedule][interval]': 'manual', 'metadata[partnerId]': '7d3f0c1e-0000-4000-8000-000000000001',
      });
      expect(c.headers['idempotency-key']).toBe('acct-7d3f0c1e-0000-4000-8000-000000000001');
      expect(r).toEqual({ accountRef: idOf(c) });
      expect(r.accountRef).toMatch(/^acct_/);
    });

    it('partnerOnboardingLink: a hosted onboarding link that returns to the platform', async () => {
      const r = await stripeProvider.partnerOnboardingLink('acct_partner1', 'http://localhost:3601/partner/smetka', 'http://localhost:3601/partner/smetka?onboarding=refresh');
      const c = one('/v1/account_links', 'POST');
      expect(c.form).toEqual({
        account: 'acct_partner1', return_url: 'http://localhost:3601/partner/smetka',
        refresh_url: 'http://localhost:3601/partner/smetka?onboarding=refresh', type: 'account_onboarding',
      });
      expect(r).toEqual({ url: (c.response as { url: string }).url });
      expect(r.url).toMatch(/^https:\/\//);
    });

    it('partnerAccountStatus: charges, payouts and what is still due, as Stripe reports them', async () => {
      const fixture = await stripeProvider.partnerAccountStatus('acct_partner1');
      const c = one('/v1/accounts/acct_partner1', 'GET');
      const a = c.response as { charges_enabled: boolean; payouts_enabled: boolean; requirements: { currently_due: string[] } };
      expect(fixture).toEqual({ chargesEnabled: a.charges_enabled, payoutsEnabled: a.payouts_enabled, requirementsDue: a.requirements.currently_due });

      rec.override({ method: 'GET', path: '/v1/accounts/acct_partner2', patch: b => ({ ...b, charges_enabled: true, payouts_enabled: false, requirements: { ...(b.requirements as object), currently_due: ['external_account'] } }) });
      expect(await stripeProvider.partnerAccountStatus('acct_partner2')).toEqual({ chargesEnabled: true, payoutsEnabled: false, requirementsDue: ['external_account'] });
      rec.override({ method: 'GET', path: '/v1/accounts/acct_partner3', patch: b => ({ ...b, charges_enabled: true, payouts_enabled: true, requirements: { ...(b.requirements as object), currently_due: [] } }) });
      expect(await stripeProvider.partnerAccountStatus('acct_partner3')).toEqual({ chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] });
    });
  });

  describe('checkout (C1)', () => {
    const args = (o: Partial<Parameters<typeof stripeProvider.createCheckout>[0]> = {}) => ({
      chargeId: '0f1e2d3c-0000-4000-8000-00000000c001', amountCents: 145_000, applicationFeeCents: 14_500, partnerAccountRef: 'acct_partner1',
      description: 'Пакет „Цял ден“ · Студио Мелодия · 14 юни 2026', customerEmail: 'maria.dimitrova@gmail.com', saveCard: false,
      successUrl: 'http://localhost:3601/plashtane/2606-0001/potvardena', cancelUrl: 'http://localhost:3601/plashtane/2606-0001',
      expiresAt: null, ...o,
    });

    it('a destination charge on behalf of the partner, EventAT\'s commission as the application fee', async () => {
      const r = await stripeProvider.createCheckout(args());
      const c = one('/v1/checkout/sessions', 'POST');
      expect(c.form).toEqual({
        mode: 'payment', customer_email: 'maria.dimitrova@gmail.com', customer_creation: 'if_required',
        'line_items[0][quantity]': '1', 'line_items[0][price_data][currency]': 'eur', 'line_items[0][price_data][unit_amount]': '145000',
        'line_items[0][price_data][product_data][name]': 'Пакет „Цял ден“ · Студио Мелодия · 14 юни 2026',
        'payment_intent_data[application_fee_amount]': '14500', 'payment_intent_data[on_behalf_of]': 'acct_partner1',
        'payment_intent_data[transfer_data][destination]': 'acct_partner1',
        'payment_intent_data[metadata][chargeId]': '0f1e2d3c-0000-4000-8000-00000000c001', 'payment_intent_data[metadata][viaCheckout]': '1',
        'metadata[chargeId]': '0f1e2d3c-0000-4000-8000-00000000c001',
        success_url: 'http://localhost:3601/plashtane/2606-0001/potvardena', cancel_url: 'http://localhost:3601/plashtane/2606-0001', locale: 'bg',
      });
      expect(c.headers['idempotency-key']).toBe('checkout-0f1e2d3c-0000-4000-8000-00000000c001');
      const s = c.response as { id: string; url: string };
      expect(r).toEqual({ redirectUrl: s.url, providerRef: s.id });
      expect(r.providerRef).toMatch(/^cs_/);
      expect(r.redirectUrl).toMatch(/^https:\/\//);
    });

    it('a deposit keeps the card for the balance (a customer and off-session future usage)', async () => {
      await stripeProvider.createCheckout(args({ saveCard: true }));
      const c = one('/v1/checkout/sessions', 'POST');
      expect(c.form).toMatchObject({ customer_creation: 'always', 'payment_intent_data[setup_future_usage]': 'off_session' });
    });

    it('the checkout closes with the payment window, within the 30 minutes – 24 hours Stripe accepts', async () => {
      const t0 = Math.floor(Date.now() / 1000);
      const expiresOf = async (expiresAt: Date) => {
        rec.reset();
        await stripeProvider.createCheckout(args({ expiresAt }));
        return Number(one('/v1/checkout/sessions', 'POST').form.expires_at);
      };
      const inTwoHours = new Date(Date.now() + 2 * 3600_000);
      expect(await expiresOf(inTwoHours)).toBe(Math.floor(inTwoHours.getTime() / 1000));
      const soon = await expiresOf(new Date(Date.now() + 5 * 60_000));
      expect(soon).toBeGreaterThanOrEqual(t0 + 30 * 60);
      expect(soon).toBeLessThan(t0 + 35 * 60);
      const late = await expiresOf(new Date(Date.now() + 3 * 86_400_000));
      expect(late).toBeGreaterThan(t0 + 23 * 3600);
      expect(late).toBeLessThanOrEqual(t0 + 24 * 3600);
      // The business clock can be far from the real one (the demo's 2025): still a valid window.
      const past = await expiresOf(new Date('2025-08-31T09:00:00Z'));
      expect(past).toBeGreaterThanOrEqual(t0 + 30 * 60);
    });

    it('expireCheckout closes an open session, ignores one already closed, and reports an outage', async () => {
      await stripeProvider.expireCheckout('cs_test_open1');
      expect(one('/v1/checkout/sessions/cs_test_open1/expire', 'POST').form).toEqual({});
      await stripeProvider.expireCheckout('pi_not_a_session');
      expect(rec.calls).toHaveLength(1);

      rec.override({ path: '/v1/checkout/sessions/cs_test_done/expire', reply: () => ({ status: 400, body: stripeError('invalid_request_error', 'This Checkout Session is not open.') }) });
      await expect(stripeProvider.expireCheckout('cs_test_done')).resolves.toBeUndefined();
      rec.override({ path: '/v1/checkout/sessions/cs_test_down/expire', reply: () => ({ status: 500, body: stripeError('api_error', 'Internal error'), headers: { 'stripe-should-retry': 'false' } }) });
      await expect(stripeProvider.expireCheckout('cs_test_down')).rejects.toThrow();
    });
  });

  describe('off-session balance charge (T9)', () => {
    const args = {
      chargeId: '0f1e2d3c-0000-4000-8000-00000000c002', amountCents: 101_500, applicationFeeCents: 10_150, partnerAccountRef: 'acct_partner1',
      description: 'Пакет „Цял ден“ · Студио Мелодия · 14 юни 2026', customerRef: 'cus_maria', paymentMethodRef: 'pm_visa4242',
    };
    const piStatus = (status: string) => rec.override({ method: 'POST', path: '/v1/payment_intents', patch: b => ({ ...b, status }) });

    it('confirms a payment intent with the saved card, on behalf of the partner', async () => {
      piStatus('succeeded');
      const r = await stripeProvider.chargeOffSession(args);
      const c = one('/v1/payment_intents', 'POST');
      expect(c.form).toEqual({
        amount: '101500', currency: 'eur', customer: 'cus_maria', payment_method: 'pm_visa4242', off_session: 'true', confirm: 'true',
        description: 'Пакет „Цял ден“ · Студио Мелодия · 14 юни 2026', application_fee_amount: '10150', on_behalf_of: 'acct_partner1',
        'transfer_data[destination]': 'acct_partner1', 'metadata[chargeId]': '0f1e2d3c-0000-4000-8000-00000000c002',
      });
      expect(c.headers['idempotency-key']).toBe('offsession-0f1e2d3c-0000-4000-8000-00000000c002');
      expect(r).toEqual({ providerRef: idOf(c), status: 'succeeded' });
    });

    it('reads every outcome: authentication needed, still processing, declined', async () => {
      piStatus('requires_action');
      expect((await stripeProvider.chargeOffSession(args)).status).toBe('requires_action');
      // A payment that is still processing has not failed: its result arrives as payment_intent.succeeded / payment_failed.
      rec.reset();
      piStatus('processing');
      const processing = await stripeProvider.chargeOffSession(args);
      expect(processing).toEqual({ providerRef: idOf(one('/v1/payment_intents', 'POST')), status: 'processing' });

      rec.override({
        method: 'POST', path: '/v1/payment_intents',
        reply: () => ({ status: 402, body: stripeError('card_error', 'Your card was declined.', { code: 'card_declined', decline_code: 'insufficient_funds', payment_intent: { id: 'pi_declined1', object: 'payment_intent', status: 'requires_payment_method' } }) }),
      });
      expect(await stripeProvider.chargeOffSession(args)).toEqual({ providerRef: 'pi_declined1', status: 'failed', reason: 'Your card was declined.' });
    });

    it('a timeout or an outage is not a decline: the call throws, so nobody charges the card again under a new key', async () => {
      rec.override({ method: 'POST', path: '/v1/payment_intents', drop: true });
      await expect(stripeProvider.chargeOffSession(args)).rejects.toThrow();
      // The SDK retried with the same idempotency key before giving up.
      const keys = rec.callsTo('/v1/payment_intents', 'POST').map(c => c.headers['idempotency-key']);
      expect(keys.length).toBeGreaterThan(1);
      expect(new Set(keys)).toEqual(new Set(['offsession-0f1e2d3c-0000-4000-8000-00000000c002']));

      rec.reset();
      rec.override({ method: 'POST', path: '/v1/payment_intents', reply: () => ({ status: 500, body: stripeError('api_error', 'Internal error'), headers: { 'stripe-should-retry': 'false' } }) });
      await expect(stripeProvider.chargeOffSession(args)).rejects.toThrow();
    });

    it('a refusal that asking again cannot change (an invalid request: the card or customer is gone) is a failure, not a call in doubt', async () => {
      rec.override({
        method: 'POST', path: '/v1/payment_intents',
        reply: () => ({ status: 400, body: stripeError('invalid_request_error', "No such PaymentMethod: 'pm_visa4242'", { code: 'resource_missing', param: 'payment_method' }) }),
      });
      expect(await stripeProvider.chargeOffSession(args)).toEqual({ providerRef: '', status: 'failed', reason: "No such PaymentMethod: 'pm_visa4242'" });
      // A request conflicting with one still running (409) or a changed request under the same key may still charge: in doubt.
      rec.reset();
      rec.override({ method: 'POST', path: '/v1/payment_intents', reply: () => ({ status: 409, body: stripeError('invalid_request_error', 'There is currently another in-progress request using this Stripe-Idempotency-Key', { code: 'idempotency_key_in_use' }), headers: { 'stripe-should-retry': 'false' } }) });
      await expect(stripeProvider.chargeOffSession(args)).rejects.toThrow();
      rec.reset();
      rec.override({ method: 'POST', path: '/v1/payment_intents', reply: () => ({ status: 400, body: stripeError('idempotency_error', 'Keys for idempotent requests can only be used with the same parameters they were first used with.') }) });
      await expect(stripeProvider.chargeOffSession(args)).rejects.toThrow();
    });
  });

  describe('refunds (F1–F3)', () => {
    const args = { refundId: '0f1e2d3c-0000-4000-8000-0000000000f1', providerChargeRef: 'pi_paid1', amountCents: 30_000, refundApplicationFee: true };
    const refundStatus = (status: string, extra: Record<string, unknown> = {}) =>
      rec.override({ method: 'POST', path: '/v1/refunds', patch: b => ({ ...b, status, ...extra }) });

    it('refunds the payment intent, takes the money back from the partner and returns the fee proportionally', async () => {
      refundStatus('succeeded');
      const r = await stripeProvider.refund(args);
      const c = one('/v1/refunds', 'POST');
      expect(c.form).toEqual({
        payment_intent: 'pi_paid1', amount: '30000', reverse_transfer: 'true', refund_application_fee: 'true',
        'metadata[refundId]': '0f1e2d3c-0000-4000-8000-0000000000f1',
      });
      expect(c.headers['idempotency-key']).toBe('refund-0f1e2d3c-0000-4000-8000-0000000000f1');
      expect(r).toEqual({ refundRef: idOf(c), status: 'succeeded' });
      rec.reset();
      await stripeProvider.refund({ ...args, refundApplicationFee: false });
      expect(one('/v1/refunds', 'POST').form.refund_application_fee).toBe('false');
    });

    it('reads every refund status', async () => {
      const statusOf = async (status: string, extra: Record<string, unknown> = {}) => {
        rec.reset();
        refundStatus(status, extra);
        const r = await stripeProvider.refund(args);
        return { status: r.status, reason: r.reason };
      };
      expect(await statusOf('pending')).toEqual({ status: 'pending', reason: undefined });
      expect(await statusOf('requires_action')).toEqual({ status: 'pending', reason: undefined });
      expect(await statusOf('failed', { failure_reason: 'expired_or_canceled_card' })).toEqual({ status: 'failed', reason: 'expired_or_canceled_card' });
      // A canceled refund returned nothing: it is a failure (F3, on the team's list), never pending forever.
      expect(await statusOf('canceled')).toEqual({ status: 'failed', reason: 'canceled' });
    });

    it('findRefund: the refund made for our id (its metadata), across pages; null when there is none', async () => {
      expect(await stripeProvider.findRefund({ refundId: args.refundId, providerChargeRef: 'pi_paid1' })).toBeNull();
      expect(one('/v1/refunds', 'GET').query).toEqual({ payment_intent: 'pi_paid1', limit: '100' });

      rec.reset();
      const page = (data: Record<string, unknown>[], hasMore: boolean) => (b: Record<string, unknown>) => {
        const base = (b.data as Record<string, unknown>[])[0];
        return { ...b, has_more: hasMore, data: data.map(d => ({ ...base, ...d })) };
      };
      rec.override({ method: 'GET', path: '/v1/refunds', patch: page([{ id: 're_ours', status: 'pending', metadata: { refundId: args.refundId } }], false) });
      rec.override({ method: 'GET', path: '/v1/refunds', times: 1, patch: page([{ id: 're_other', status: 'succeeded', metadata: { refundId: 'someone-else' } }], true) });
      expect(await stripeProvider.findRefund({ refundId: args.refundId, providerChargeRef: 'pi_paid1' })).toEqual({ refundRef: 're_ours', status: 'pending' });
      const pages = rec.callsTo('/v1/refunds', 'GET');
      expect(pages.map(p => p.status)).toEqual([200, 200]);
      expect(pages[1].query).toMatchObject({ payment_intent: 'pi_paid1', starting_after: 're_other' });
    });
  });

  describe('payouts from the partner\'s connected account (Y5–Y8)', () => {
    const args = { payoutItemId: '0f1e2d3c-0000-4000-8000-0000000000a1', partnerAccountRef: 'acct_partner1', amountCents: 137_750, description: 'EventAT · Партида септември · първа половина' };
    const payoutStatus = (status: string, extra: Record<string, unknown> = {}) =>
      rec.override({ method: 'POST', path: '/v1/payouts', patch: b => ({ ...b, status, ...extra }) });

    it('pays out on the connected account (Stripe-Account), our item id in the metadata', async () => {
      const r = await stripeProvider.payout(args);
      const c = one('/v1/payouts', 'POST');
      expect(c.form).toEqual({
        amount: '137750', currency: 'eur', description: 'EventAT · Партида септември · първа половина',
        'metadata[payoutItemId]': '0f1e2d3c-0000-4000-8000-0000000000a1',
      });
      expect(c.headers['stripe-account']).toBe('acct_partner1');
      expect(c.headers['idempotency-key']).toBe('payout-0f1e2d3c-0000-4000-8000-0000000000a1');
      expect((c.response as { status: string }).status).toBe('in_transit');
      expect(r).toEqual({ payoutRef: idOf(c), status: 'pending' });
    });

    it('reads every payout status', async () => {
      const statusOf = async (status: string, extra: Record<string, unknown> = {}) => {
        rec.reset();
        payoutStatus(status, extra);
        const r = await stripeProvider.payout(args);
        return { status: r.status, reason: r.reason };
      };
      expect(await statusOf('paid')).toEqual({ status: 'paid', reason: undefined });
      expect(await statusOf('pending')).toEqual({ status: 'pending', reason: undefined });
      expect(await statusOf('failed', { failure_message: 'The bank account has been closed.' })).toEqual({ status: 'failed', reason: 'The bank account has been closed.' });
      // A canceled payout paid nothing: a failed transfer (Y8), so its lines can go out again.
      expect(await statusOf('canceled')).toEqual({ status: 'failed', reason: 'canceled' });
    });

    it('findPayout: the payout made for our item on that account since it was sent; null when there is none', async () => {
      const since = new Date('2025-09-15T05:00:00Z');
      expect(await stripeProvider.findPayout({ payoutItemId: args.payoutItemId, partnerAccountRef: 'acct_partner1', since })).toBeNull();
      const c = one('/v1/payouts', 'GET');
      expect(c.query).toEqual({ 'created[gte]': String(Math.floor(since.getTime() / 1000) - 86_400), limit: '100' });
      expect(c.headers['stripe-account']).toBe('acct_partner1');

      rec.reset();
      rec.override({ method: 'GET', path: '/v1/payouts', patch: b => ({ ...b, data: (b.data as Record<string, unknown>[]).map(p => ({ ...p, id: 'po_ours', status: 'paid', metadata: { payoutItemId: args.payoutItemId } })) }) });
      expect(await stripeProvider.findPayout({ payoutItemId: args.payoutItemId, partnerAccountRef: 'acct_partner1', since })).toEqual({ payoutRef: 'po_ours', status: 'paid' });
    });
  });

  describe('webhook normalisation that calls the API', () => {
    it('checkout.session.completed reads the payment intent with its card (expand) for the saved card and the receipt', async () => {
      vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_provider_test');
      rec.override({ method: 'GET', path: '/v1/payment_intents/pi_checkout1', patch: b => ({ ...b, customer: 'cus_maria' }) });
      const ev = stripeEvent('checkout.session.completed', {
        id: 'cs_test_paid1', object: 'checkout.session', payment_status: 'paid', status: 'complete', payment_intent: 'pi_checkout1',
        metadata: { chargeId: '0f1e2d3c-0000-4000-8000-00000000c001' },
      });
      const out = await stripeProvider.parseWebhook(signedWebhook(ev, 'whsec_provider_test'));
      const c = one('/v1/payment_intents/pi_checkout1', 'GET');
      expect(c.query).toEqual({ 'expand[0]': 'payment_method' });
      const pm = (c.response as { payment_method: { id: string; card: { brand: string; last4: string } } }).payment_method;
      expect(out).toEqual([{
        type: 'charge.succeeded', chargeId: '0f1e2d3c-0000-4000-8000-00000000c001', providerRef: 'pi_checkout1', customerRef: 'cus_maria',
        paymentMethodRef: pm.id, cardBrand: pm.card.brand, cardLast4: pm.card.last4,
      }]);
      expect(pm.card).toMatchObject({ brand: 'visa', last4: '4242' });
    });

    it('account.updated reads the account as Stripe holds it now (an older event delivered late cannot undo a newer one)', async () => {
      vi.stubEnv('STRIPE_CONNECT_WEBHOOK_SECRET', 'whsec_provider_connect');
      rec.override({
        method: 'GET', path: '/v1/accounts/acct_partner1',
        patch: b => ({ ...b, charges_enabled: true, payouts_enabled: true, requirements: { ...(b.requirements as object), currently_due: [] } }),
      });
      const stale = stripeEvent('account.updated', {
        id: 'acct_partner1', object: 'account', charges_enabled: false, payouts_enabled: false, requirements: { currently_due: ['external_account'] },
      }, { account: 'acct_partner1' });
      const out = await stripeProvider.parseWebhook(signedWebhook(stale, 'whsec_provider_connect'));
      one('/v1/accounts/acct_partner1', 'GET');
      expect(out).toEqual([{ type: 'account.updated', accountRef: 'acct_partner1', status: { chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] } }]);
    });
  });
});
