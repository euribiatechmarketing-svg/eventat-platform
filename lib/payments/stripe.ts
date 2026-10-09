// Stripe Connect implementation. Charge type: destination charges with
// on_behalf_of (the partner is the business of record and settles the
// funds); EventAT's commission is the application fee. Connected accounts
// use manual payouts, so held funds stay in the partner's Stripe balance
// until EventAT releases them on the 1st/15th. Stripe allows at most 90 days
// of holding outside the US — the payment schedule (deposit + balance due
// N days before the event) must respect that (see platform settings).
import Stripe from 'stripe';
import type { PaymentProvider, ProviderEvent } from './types';

let client: Stripe | null = null;
function stripe(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    client = new Stripe(key);
  }
  return client;
}

export const stripeProvider: PaymentProvider = {
  id: 'stripe',

  async createPartnerAccount({ partnerId, email, businessName }) {
    const acct = await stripe().accounts.create({
      country: 'BG', email, business_profile: { name: businessName },
      controller: { stripe_dashboard: { type: 'express' }, fees: { payer: 'application' }, losses: { payments: 'application' } },
      capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
      settings: { payouts: { schedule: { interval: 'manual' } } },
      metadata: { partnerId },
    }, { idempotencyKey: `acct-${partnerId}` });
    return { accountRef: acct.id };
  },

  async partnerOnboardingLink(accountRef, returnUrl, refreshUrl) {
    const link = await stripe().accountLinks.create({ account: accountRef, return_url: returnUrl, refresh_url: refreshUrl, type: 'account_onboarding' });
    return { url: link.url };
  },

  async partnerAccountStatus(accountRef) {
    const a = await stripe().accounts.retrieve(accountRef);
    return { chargesEnabled: !!a.charges_enabled, payoutsEnabled: !!a.payouts_enabled, requirementsDue: a.requirements?.currently_due ?? [] };
  },

  async createCheckout(a) {
    const s = await stripe().checkout.sessions.create({
      mode: 'payment',
      customer_email: a.customerEmail,
      customer_creation: a.saveCard ? 'always' : 'if_required',
      line_items: [{ quantity: 1, price_data: { currency: 'eur', unit_amount: a.amountCents, product_data: { name: a.description } } }],
      payment_intent_data: {
        application_fee_amount: a.applicationFeeCents,
        on_behalf_of: a.partnerAccountRef,
        transfer_data: { destination: a.partnerAccountRef },
        setup_future_usage: a.saveCard ? 'off_session' : undefined,
        metadata: { chargeId: a.chargeId, viaCheckout: '1' },
      },
      metadata: { chargeId: a.chargeId },
      // Not past the payment window (Stripe accepts 30 minutes to 24 hours from now).
      ...(a.expiresAt ? { expires_at: Math.floor(Math.min(Math.max(a.expiresAt.getTime(), Date.now() + 31 * 60_000), Date.now() + 23.5 * 3600_000) / 1000) } : {}),
      success_url: a.successUrl,
      cancel_url: a.cancelUrl,
      locale: 'bg',
    }, { idempotencyKey: `checkout-${a.chargeId}` });
    return { redirectUrl: s.url!, providerRef: s.id };
  },

  async expireCheckout(providerRef) {
    if (!providerRef.startsWith('cs_')) return; // an off-session or already completed charge has no open session
    try {
      await stripe().checkout.sessions.expire(providerRef);
    } catch (e) {
      // Already complete or expired: nothing to close (a late payment is flagged as a duplicate on arrival).
      if ((e as Stripe.errors.StripeError).type === 'StripeInvalidRequestError') return;
      throw e;
    }
  },

  async chargeOffSession(a) {
    try {
      const pi = await stripe().paymentIntents.create({
        amount: a.amountCents, currency: 'eur', customer: a.customerRef, payment_method: a.paymentMethodRef,
        off_session: true, confirm: true, description: a.description,
        application_fee_amount: a.applicationFeeCents, on_behalf_of: a.partnerAccountRef,
        transfer_data: { destination: a.partnerAccountRef }, metadata: { chargeId: a.chargeId },
      }, { idempotencyKey: `offsession-${a.chargeId}` });
      return { providerRef: pi.id, status: pi.status === 'succeeded' ? 'succeeded' : pi.status === 'requires_action' ? 'requires_action' : 'failed' };
    } catch (e) {
      const err = e as Stripe.errors.StripeError;
      return { providerRef: (err.payment_intent as { id?: string } | undefined)?.id ?? '', status: 'failed', reason: err.message };
    }
  },

  async refund(a) {
    const r = await stripe().refunds.create({
      payment_intent: a.providerChargeRef, amount: a.amountCents,
      reverse_transfer: true, refund_application_fee: a.refundApplicationFee,
      metadata: { refundId: a.refundId },
    }, { idempotencyKey: `refund-${a.refundId}` });
    return { refundRef: r.id, status: r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' ? 'failed' : 'pending', reason: r.failure_reason ?? undefined };
  },

  async findRefund(a) {
    for await (const r of stripe().refunds.list({ payment_intent: a.providerChargeRef, limit: 100 })) {
      if (r.metadata?.refundId === a.refundId) {
        return { refundRef: r.id, status: r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' ? 'failed' : 'pending', reason: r.failure_reason ?? undefined };
      }
    }
    return null;
  },

  async findPayout(a) {
    const since = Math.floor(a.since.getTime() / 1000) - 24 * 3600;
    for await (const p of stripe().payouts.list({ created: { gte: since }, limit: 100 }, { stripeAccount: a.partnerAccountRef })) {
      if (p.metadata?.payoutItemId === a.payoutItemId) {
        return { payoutRef: p.id, status: p.status === 'paid' ? 'paid' : p.status === 'failed' ? 'failed' : 'pending', reason: p.failure_message ?? undefined };
      }
    }
    return null;
  },

  async payout(a) {
    const p = await stripe().payouts.create(
      { amount: a.amountCents, currency: 'eur', description: a.description, metadata: { payoutItemId: a.payoutItemId } },
      { stripeAccount: a.partnerAccountRef, idempotencyKey: `payout-${a.payoutItemId}` },
    );
    return { payoutRef: p.id, status: p.status === 'paid' ? 'paid' : p.status === 'failed' ? 'failed' : 'pending', reason: p.failure_message ?? undefined };
  },

  async parseWebhook(req) {
    const sig = req.headers.get('stripe-signature') ?? '';
    const body = await req.text();
    // Two endpoints may post here: the platform account's (checkout, refunds, disputes) and the
    // Connect one for events on the partners' accounts (payouts, account.updated), each with its secret.
    const secrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter((x): x is string => !!x);
    let ev: Stripe.Event | null = null;
    let lastError: unknown = new Error('STRIPE_WEBHOOK_SECRET is not set');
    for (const secret of secrets) {
      try { ev = stripe().webhooks.constructEvent(body, sig, secret); break; } catch (e) { lastError = e; }
    }
    if (!ev) throw lastError;
    const out: ProviderEvent[] = [];
    switch (ev.type) {
      case 'checkout.session.completed': {
        const s = ev.data.object as Stripe.Checkout.Session;
        const chargeId = s.metadata?.chargeId;
        if (chargeId && s.payment_status === 'paid' && typeof s.payment_intent === 'string') {
          const pi = await stripe().paymentIntents.retrieve(s.payment_intent, { expand: ['payment_method'] });
          const pm = pi.payment_method as Stripe.PaymentMethod | null;
          out.push({ type: 'charge.succeeded', chargeId, providerRef: pi.id, customerRef: typeof pi.customer === 'string' ? pi.customer : pi.customer?.id, paymentMethodRef: pm?.id, cardBrand: pm?.card?.brand, cardLast4: pm?.card?.last4 });
        }
        break;
      }
      case 'checkout.session.expired': {
        const s = ev.data.object as Stripe.Checkout.Session;
        if (s.metadata?.chargeId) out.push({ type: 'charge.failed', chargeId: s.metadata.chargeId, reason: 'expired' });
        break;
      }
      case 'payment_intent.payment_failed': {
        const pi = ev.data.object as Stripe.PaymentIntent;
        if (pi.metadata?.chargeId) out.push({ type: 'charge.failed', chargeId: pi.metadata.chargeId, providerRef: pi.id, reason: pi.last_payment_error?.message ?? 'failed' });
        break;
      }
      case 'payment_intent.succeeded': {
        const pi = ev.data.object as Stripe.PaymentIntent;
        // Off-session balance charges are confirmed here (checkout ones arrive via the session).
        if (pi.metadata?.chargeId && !pi.metadata.viaCheckout)
          out.push({ type: 'charge.succeeded', chargeId: pi.metadata.chargeId, providerRef: pi.id });
        break;
      }
      case 'refund.updated': case 'refund.created': {
        const r = ev.data.object as Stripe.Refund;
        const refundId = r.metadata?.refundId || undefined;
        if (r.status === 'succeeded') out.push({ type: 'refund.succeeded', refundRef: r.id, refundId });
        if (r.status === 'failed') out.push({ type: 'refund.failed', refundRef: r.id, reason: r.failure_reason ?? 'failed', refundId });
        break;
      }
      case 'payout.paid': {
        const p = ev.data.object as Stripe.Payout;
        out.push({ type: 'payout.paid', payoutRef: p.id, payoutItemId: p.metadata?.payoutItemId || undefined });
        break;
      }
      case 'payout.failed': {
        const p = ev.data.object as Stripe.Payout;
        out.push({ type: 'payout.failed', payoutRef: p.id, reason: p.failure_message ?? 'failed', payoutItemId: p.metadata?.payoutItemId || undefined });
        break;
      }
      case 'account.updated': {
        const a = ev.data.object as Stripe.Account;
        out.push({ type: 'account.updated', accountRef: a.id, status: { chargesEnabled: !!a.charges_enabled, payoutsEnabled: !!a.payouts_enabled, requirementsDue: a.requirements?.currently_due ?? [] } });
        break;
      }
      case 'charge.dispute.created': {
        const d = ev.data.object as Stripe.Dispute;
        out.push({ type: 'dispute.created', providerChargeRef: typeof d.payment_intent === 'string' ? d.payment_intent : d.payment_intent?.id ?? '', amountCents: d.amount, reason: d.reason });
        break;
      }
    }
    return out;
  },
};
