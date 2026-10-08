// Payment-provider webhooks (SCREENS §9). The provider signs every request;
// parseWebhook() verifies the signature and normalises the event, and
// applyProviderEvent() applies it. Application is idempotent (state-based), so
// a redelivered event changes nothing; a failure answers 500 and the provider retries.
import { NextResponse } from 'next/server';
import { paymentProvider, type ProviderEvent } from '@/lib/payments';
import { applyProviderEvent, providerFor } from '@/lib/payments/apply';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let events: ProviderEvent[];
  // Charges keep the provider of ⚙ payment.provider at creation (D5), which can be stripe while the
  // environment default is still simulated: verify with Stripe whenever its webhook secret is configured.
  const provider = process.env.STRIPE_WEBHOOK_SECRET ? providerFor('stripe') : paymentProvider();
  try {
    events = await provider.parseWebhook(req);
  } catch {
    return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
  }
  try {
    for (const e of events) await applyProviderEvent(e);
  } catch (err) {
    console.error('webhook: applying a provider event failed', err);
    return NextResponse.json({ error: 'not applied' }, { status: 500 });
  }
  return NextResponse.json({ received: events.length });
}
