// applyProviderEvent(): the one door through which payment-provider results
// enter the platform — Stripe webhooks (app/api/webhooks/stripe), the
// simulated checkout (/plashtane/test/[chargeId]) and off-session charges.
// Every branch is idempotent: it re-checks the record's state, so a webhook
// delivered twice (or a simulated button pressed twice) changes nothing the second time.
//
// Every event type the providers emit is applied here:
//   charge.succeeded (C3 → K5 / balance / duplicate) · charge.failed (C4 / C5)
//   dispute.created  → chargebacks (frozen payouts, clawback)
//   refund.succeeded / refund.failed → refunds (F2 / F3)
//   payout.paid / payout.failed      → payouts (Y6 / Y8)
//   account.updated (P11)
// An event about a payment, refund, payout, dispute or partner account this platform has not stored
// yet (the provider can be faster than our own write) returns `retry`: the webhook then answers 500
// and the provider delivers it again. Nothing is acknowledged without being applied. The one
// exception is a failed or expired payment of a charge we do not know: no money moved and our
// charges are stored before the provider can report on them, so there is nothing to wait for.
import { db, type Tx } from '@/db';
import { SYSTEM } from '@/lib/domain/actor';
import { audit } from '@/lib/domain/audit';
import { applyChargebackEvent } from '@/lib/domain/chargebacks';
import { onChargeFailed, onChargeSucceeded, providerFor, type ChargeResult } from '@/lib/domain/charges';
import { applyAccountUpdate } from '@/lib/domain/partners';
import { applyPayoutEvent } from '@/lib/domain/payouts';
import { applyRefundEvent } from '@/lib/domain/refunds';
import type { ProviderEvent } from './types';

export { providerFor };
/** `retry`: the event names a record not stored yet; the provider should deliver it again. */
export type ApplyResult = ChargeResult & { retry?: boolean };

const handled = (r: { handled: boolean }): ApplyResult => (r.handled ? { applied: true } : { applied: false, reason: 'unknown_ref', retry: true });

export async function applyProviderEvent(e: ProviderEvent, tx?: Tx): Promise<ApplyResult> {
  switch (e.type) {
    case 'charge.succeeded': {
      // Money taken for a charge not stored (yet) is never acknowledged unseen.
      const r = await onChargeSucceeded({
        chargeId: e.chargeId, providerRef: e.providerRef, customerRef: e.customerRef, paymentMethodRef: e.paymentMethodRef,
        cardBrand: e.cardBrand, cardLast4: e.cardLast4,
      }, tx);
      return r.reason === 'unknown_charge' ? { ...r, retry: true } : r;
    }
    case 'charge.failed':
      return onChargeFailed({ chargeId: e.chargeId, providerRef: e.providerRef, reason: e.reason }, tx);
    case 'account.updated':
      // P11 (partners.applyAccountUpdate); an account not stored yet (P4 still committing) comes again.
      return (await applyAccountUpdate({ accountRef: e.accountRef, status: e.status }, tx)) ? { applied: true } : { applied: false, reason: 'unknown_account', retry: true };
    case 'dispute.created':
      return handled(await applyChargebackEvent(e, tx));
    case 'refund.succeeded':
    case 'refund.failed':
      return handled(await applyRefundEvent(e, tx));
    case 'payout.paid':
    case 'payout.failed':
      return handled(await applyPayoutEvent(e, tx));
    default: {
      // Every ProviderEvent type is handled above; a new one must be added here, not acknowledged unseen.
      const unknown: never = e;
      const type = String((unknown as { type?: unknown }).type);
      const run = async (t: Tx) => {
        await audit(t, { actor: SYSTEM, action: 'provider.event_unhandled', entity: 'provider_event', entityId: type, data: unknown as Record<string, unknown> });
        return { applied: false, reason: 'unhandled', retry: true };
      };
      return tx ? run(tx) : db.transaction(run);
    }
  }
}
