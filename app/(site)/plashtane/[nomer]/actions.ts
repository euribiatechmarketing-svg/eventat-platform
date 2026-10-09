'use server';
// ‹Плати› → payments.startCheckout() (card, C1: off to the provider's hosted
// form) or payments.chooseBankTransfer() (C2: the provider's instructions).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorFromUser } from '@/lib/domain/actor';
import { LifecycleError } from '@/lib/domain/bookings';
import { startPayment, type StartPaymentResult } from '@/lib/domain/charges';
import { requireRole } from '@/lib/session';
import type { FormState } from '@/components/client-booking/ActionForm';
import { errorText, isNextSignal } from '@/lib/client-booking/errors';
import { numberSchema } from '@/lib/client-booking/write';

const Input = z.object({ number: numberSchema, method: z.enum(['card', 'bank_transfer']).default('card') });

export async function payAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const u = await requireRole('client');
  const parsed = Input.safeParse({ number: formData.get('number'), method: formData.get('method') ?? undefined });
  if (!parsed.success) return { error: 'Действието не е изпълнено. Опитайте отново.' };
  const { number, method } = parsed.data;
  const n = encodeURIComponent(number);
  let res: StartPaymentResult;
  try {
    res = await startPayment(await actorFromUser(u), { number, method });
  } catch (e) {
    if (isNextSignal(e)) throw e;
    // Nothing is due any more — paid in another tab or on the phone, or the booking moved on: the
    // payment page sends the client to where the booking now is, instead of ‹Презаредете страницата›.
    if (e instanceof LifecycleError && e.code === 'invalid_state') redirect(`/plashtane/${n}`);
    return { error: errorText(e) };
  }
  revalidatePath(`/plashtane/${n}`);
  if (res.kind === 'redirect') redirect(res.redirectUrl);
  redirect(`/plashtane/${n}`);
}
