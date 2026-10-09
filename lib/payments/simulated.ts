// Built-in test provider: no real money, no external calls. Checkout goes to
// /plashtane/test/[chargeId], where the payer chooses success or failure;
// that page reports the result through applyProviderEvent().
import type { PaymentProvider } from './types';

const ref = (p: string, id: string) => `sim_${p}_${id.replace(/-/g, '').slice(0, 20)}`;

export const simulatedProvider: PaymentProvider = {
  id: 'simulated',
  async createPartnerAccount({ partnerId }) { return { accountRef: ref('acct', partnerId) }; },
  async partnerOnboardingLink(_accountRef, returnUrl) { return { url: returnUrl }; },
  async partnerAccountStatus() { return { chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] }; },
  async createCheckout({ chargeId }) {
    return { redirectUrl: `/plashtane/test/${chargeId}`, providerRef: ref('pi', chargeId) };
  },
  async expireCheckout() { /* the test checkout reads the charge's status itself */ },
  async chargeOffSession({ chargeId }) { return { providerRef: ref('pi', chargeId), status: 'succeeded' }; },
  async refund({ refundId }) { return { refundRef: ref('re', refundId), status: 'succeeded' }; },
  async payout({ payoutItemId }) { return { payoutRef: ref('po', payoutItemId), status: 'paid' }; },
  // Simulated calls never throw, so nothing is ever made without an answer.
  async findRefund() { return null; },
  async findPayout() { return null; },
  async parseWebhook() { return []; },
};
