// The payment-provider boundary. EventAT never holds client money in its own
// account: a licensed provider holds it (legal research, Oct 2026). The app
// keeps an internal ledger that mirrors what the provider holds and pays.
//
// Two implementations:
//   simulated — a built-in test checkout with no real money (dev, demo, tests)
//   stripe    — Stripe Connect: destination charges with on_behalf_of (the
//               partner is the merchant of record), application fee = EventAT
//               commission, manual payouts from the partner's connected account.

export type ProviderId = 'simulated' | 'stripe';

export type PartnerAccountStatus = {
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** Human-readable missing items, if the provider reports any. */
  requirementsDue: string[];
};

export type CheckoutArgs = {
  /** Our charge id; also the idempotency key. */
  chargeId: string;
  amountCents: number;
  /** EventAT's commission taken from this charge. */
  applicationFeeCents: number;
  partnerAccountRef: string;
  description: string;
  customerEmail: string;
  /** Keep the card for a later balance charge (deposit + balance schedule). */
  saveCard: boolean;
  successUrl: string;
  cancelUrl: string;
  /** When the payment window closes; the provider's checkout should not outlive it. */
  expiresAt?: Date | null;
};

export type OffSessionChargeArgs = {
  chargeId: string;
  amountCents: number;
  applicationFeeCents: number;
  partnerAccountRef: string;
  description: string;
  customerRef: string;
  paymentMethodRef: string;
};

/** Normalised provider events, produced by webhooks (stripe) or directly (simulated). */
export type ProviderEvent =
  | { type: 'charge.succeeded'; chargeId: string; providerRef: string; customerRef?: string; paymentMethodRef?: string; cardBrand?: string; cardLast4?: string }
  | { type: 'charge.failed'; chargeId: string; providerRef?: string; reason: string }
  // refundId / payoutItemId: our id from the provider object's metadata, so a result is matched even
  // when the call that created it never returned (timeout) and its ref was not stored.
  | { type: 'refund.succeeded'; refundRef: string; refundId?: string }
  | { type: 'refund.failed'; refundRef: string; reason: string; refundId?: string }
  | { type: 'payout.paid'; payoutRef: string; payoutItemId?: string }
  | { type: 'payout.failed'; payoutRef: string; reason: string; payoutItemId?: string }
  | { type: 'account.updated'; accountRef: string; status: PartnerAccountStatus }
  | { type: 'dispute.created'; providerChargeRef: string; amountCents: number; reason: string };

export interface PaymentProvider {
  id: ProviderId;
  /** Create the partner's account at the provider (KYC happens there). */
  createPartnerAccount(a: { partnerId: string; email: string; businessName: string }): Promise<{ accountRef: string }>;
  /** Hosted onboarding/KYC link for the partner. */
  partnerOnboardingLink(accountRef: string, returnUrl: string, refreshUrl: string): Promise<{ url: string }>;
  partnerAccountStatus(accountRef: string): Promise<PartnerAccountStatus>;
  /** Start a hosted card checkout. The result arrives as a ProviderEvent. */
  createCheckout(a: CheckoutArgs): Promise<{ redirectUrl: string; providerRef: string }>;
  /** Close an open checkout so it can no longer be paid (its charge was expired on our side). */
  expireCheckout(providerRef: string): Promise<void>;
  /** Charge a saved card without the client present (balance before the event). */
  chargeOffSession(a: OffSessionChargeArgs): Promise<{ providerRef: string; status: 'succeeded' | 'failed' | 'requires_action'; reason?: string }>;
  /** Refund (part of) a charge back to the original card. */
  refund(a: { refundId: string; providerChargeRef: string; amountCents: number; refundApplicationFee: boolean }): Promise<{ refundRef: string; status: 'succeeded' | 'pending' | 'failed'; reason?: string }>;
  /**
   * The refund made for our refund id (its metadata), if any: after a refund call that threw, the
   * provider may still have made it. Throws when the provider cannot be asked.
   */
  findRefund(a: { refundId: string; providerChargeRef: string }): Promise<{ refundRef: string; status: 'succeeded' | 'pending' | 'failed'; reason?: string } | null>;
  /** Pay a partner out from the funds held for them. */
  payout(a: { payoutItemId: string; partnerAccountRef: string; amountCents: number; description: string }): Promise<{ payoutRef: string; status: 'paid' | 'pending' | 'failed'; reason?: string }>;
  /** The payout made for our payout item (its metadata), if any — as findRefund. */
  findPayout(a: { payoutItemId: string; partnerAccountRef: string; since: Date }): Promise<{ payoutRef: string; status: 'paid' | 'pending' | 'failed'; reason?: string } | null>;
  /** Verify and normalise a webhook request. Simulated provider returns []. */
  parseWebhook(req: Request): Promise<ProviderEvent[]>;
}
