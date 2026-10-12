// Payment-provider webhooks (SCREENS §9). The provider signs every request;
// parseWebhook() verifies the signature and normalises the event, and
// applyProviderEvent() applies it. Application is idempotent (state-based), so
// a redelivered event changes nothing. A request the provider did not sign answers
// 400; a failure — reading the event from the provider's API, applying it, or an
// event about a record not stored yet (`retry`) — answers 500 and the provider
// delivers it again.
import { NextResponse } from 'next/server';
import { WebhookSignatureError, paymentProvider, type ProviderEvent } from '@/lib/payments';
import { applyProviderEvent, providerFor } from '@/lib/payments/apply';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  let events: ProviderEvent[];
  // Charges keep the provider of ⚙ payment.provider at creation (D5), which can be stripe while the
  // environment default is still simulated: verify with Stripe whenever its webhook secret is configured.
  const provider = process.env.STRIPE_WEBHOOK_SECRET || process.env.STRIPE_CONNECT_WEBHOOK_SECRET ? providerFor('stripe') : paymentProvider();
  try {
    events = await provider.parseWebhook(req);
  } catch (err) {
    if (err instanceof WebhookSignatureError) return NextResponse.json({ error: 'invalid signature' }, { status: 400 });
    console.error('webhook: reading a provider event failed', err);
    return NextResponse.json({ error: 'not read' }, { status: 500 });
  }
  let retry = false;
  try {
    for (const e of events) if ((await applyProviderEvent(e)).retry) retry = true;
  } catch (err) {
    console.error('webhook: applying a provider event failed', err);
    return NextResponse.json({ error: 'not applied' }, { status: 500 });
  }
  if (retry) return NextResponse.json({ error: 'not stored yet' }, { status: 500 });
  return NextResponse.json({ received: events.length });
}
