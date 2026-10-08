// applyProviderEvent(): the one door through which payment-provider results
// enter the platform — Stripe webhooks (app/api/webhooks/stripe), the
// simulated checkout (/plashtane/test/[chargeId]) and off-session charges.
// Every branch is idempotent: it re-checks the record's state, so a webhook
// delivered twice (or a simulated button pressed twice) changes nothing the second time.
//
// Handled here: charge.succeeded (C3 → K5 / balance / duplicate), charge.failed
// (C4 / C5) and account.updated (P11). refund.*, payout.* and dispute.created
// belong to the refunds, payouts and chargebacks modules; until they are wired
// in below, those events are recorded in audit_log and acknowledged.
import { eq } from 'drizzle-orm';
import { db, type Tx } from '@/db';
import { partner } from '@/db/schema';
import { SYSTEM } from '@/lib/domain/actor';
import { audit } from '@/lib/domain/audit';
import { onChargeFailed, onChargeSucceeded, providerFor, type ChargeResult } from '@/lib/domain/charges';
import { now } from '@/lib/clock';
import type { ProviderEvent } from './types';

export { providerFor };
export type ApplyResult = ChargeResult;

export async function applyProviderEvent(e: ProviderEvent, tx?: Tx): Promise<ApplyResult> {
  switch (e.type) {
    case 'charge.succeeded':
      return onChargeSucceeded({
        chargeId: e.chargeId, providerRef: e.providerRef, customerRef: e.customerRef, paymentMethodRef: e.paymentMethodRef,
        cardBrand: e.cardBrand, cardLast4: e.cardLast4,
      }, tx);
    case 'charge.failed':
      return onChargeFailed({ chargeId: e.chargeId, providerRef: e.providerRef, reason: e.reason }, tx);
    case 'account.updated':
      return applyAccountUpdated(e, tx);
    default: {
      const run = async (t: Tx) => {
        await audit(t, { actor: SYSTEM, action: 'provider.event_unhandled', entity: 'provider_event', entityId: e.type, data: e as unknown as Record<string, unknown> });
        return { applied: false, reason: 'unhandled' };
      };
      return tx ? run(tx) : db.transaction(run);
    }
  }
}

/** P11: the provider reports the partner's account status (charges and payouts enabled, requirements). */
async function applyAccountUpdated(e: Extract<ProviderEvent, { type: 'account.updated' }>, tx?: Tx): Promise<ApplyResult> {
  const run = async (t: Tx): Promise<ApplyResult> => {
    const [p] = await t.select({ id: partner.id }).from(partner).where(eq(partner.providerAccountRef, e.accountRef)).limit(1);
    if (!p) return { applied: false, reason: 'unknown_account' };
    const s = e.status;
    const providerStatus = s.chargesEnabled && s.payoutsEnabled ? 'enabled' : s.requirementsDue.length ? 'restricted' : 'pending';
    await t.update(partner).set({
      providerChargesEnabled: s.chargesEnabled, providerPayoutsEnabled: s.payoutsEnabled, providerRequirements: s.requirementsDue,
      providerStatus, updatedAt: await now(),
    }).where(eq(partner.id, p.id));
    await audit(t, { actor: SYSTEM, action: 'partner.provider_status', entity: 'partner', entityId: p.id, data: { ...s, providerStatus } });
    return { applied: true };
  };
  return tx ? run(tx) : db.transaction(run);
}
