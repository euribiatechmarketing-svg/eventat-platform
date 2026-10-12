import 'server-only';
import type { PaymentProvider } from './types';
import { simulatedProvider } from './simulated';
import { stripeProvider } from './stripe';

export function paymentProvider(): PaymentProvider {
  return process.env.PAYMENT_PROVIDER === 'stripe' ? stripeProvider : simulatedProvider;
}
export type * from './types';
export { WebhookSignatureError } from './types';
