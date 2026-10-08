'use server';
// The simulated provider's two outcomes (SPEC §7.1 `simulated`). Each action
// re-checks who is asking: a signed-in client who owns the charge, while ⚙
// payment.provider is `simulated` (getTestCheckout returns null otherwise).
import { notFound, redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { actorFromUser } from '@/lib/domain/actor';
import { getTestCheckout } from '@/lib/domain/charges';
import { applyProviderEvent } from '@/lib/payments/apply';
import { requireRole } from '@/lib/session';

async function checkout(formData: FormData) {
  const chargeId = String(formData.get('chargeId') ?? '');
  const u = await requireRole('client', `/plashtane/test/${chargeId}`);
  const view = await getTestCheckout(await actorFromUser(u), chargeId);
  if (!view) notFound();
  return view;
}

const open = (status: string) => status === 'pending' || status === 'awaiting_transfer';

/** ‹Плати›: the provider reports success (card Visa •••• 4242), then the booking page. */
export async function payTestChargeAction(formData: FormData) {
  const view = await checkout(formData);
  if (open(view.status)) {
    await applyProviderEvent({ type: 'charge.succeeded', chargeId: view.chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242' });
  }
  const n = encodeURIComponent(view.number);
  revalidatePath(`/akaunt/rezervacii/${n}`);
  redirect(`/akaunt/rezervacii/${n}`);
}

/** ‹Откажи плащането›: the provider reports a failure, then back to the payment page. */
export async function failTestChargeAction(formData: FormData) {
  const view = await checkout(formData);
  if (open(view.status)) await applyProviderEvent({ type: 'charge.failed', chargeId: view.chargeId, reason: 'declined' });
  const n = encodeURIComponent(view.number);
  revalidatePath(`/plashtane/${n}`);
  redirect(`/plashtane/${n}`);
}
