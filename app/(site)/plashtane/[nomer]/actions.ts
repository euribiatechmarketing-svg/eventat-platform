'use server';
// ‹Плати› → payments.startCheckout() (card, C1: off to the provider's hosted
// form) or payments.chooseBankTransfer() (C2: the provider's instructions).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { actorFromUser } from '@/lib/domain/actor';
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
  let res: StartPaymentResult;
  try {
    res = await startPayment(await actorFromUser(u), { number, method });
  } catch (e) {
    if (isNextSignal(e)) throw e;
    return { error: errorText(e) };
  }
  const n = encodeURIComponent(number);
  revalidatePath(`/plashtane/${n}`);
  if (res.kind === 'redirect') redirect(res.redirectUrl);
  redirect(`/plashtane/${n}`);
}
