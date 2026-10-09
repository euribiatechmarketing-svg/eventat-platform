'use server';
// /akaunt/zayavki/[nomer] (SCREENS §4): write to the partner, choose a quote
// offer (R5), watch a taken date (‹Уведоми ме, ако се освободи›, §4.14).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { actorFromUser } from '@/lib/domain/actor';
import { chooseQuoteOffer } from '@/lib/domain/requests';
import { watchDate } from '@/lib/domain/saved';
import { clientRequestPage } from '@/lib/domain/views-client-booking';
import { setFlash } from '@/lib/flash';
import { requireRole } from '@/lib/session';
import { errorText, isNextSignal } from '@/lib/client-booking/errors';
import { numberSchema, openThread } from '@/lib/client-booking/write';

const page = (n: string) => `/akaunt/zayavki/${encodeURIComponent(n)}`;

export async function writeToPartnerAction(formData: FormData) {
  await openThread(formData);
}

export async function chooseOfferAction(formData: FormData) {
  const u = await requireRole('client');
  const number = numberSchema.parse(formData.get('number'));
  try {
    await chooseQuoteOffer(await actorFromUser(u), { number });
  } catch (e) {
    if (isNextSignal(e)) throw e;
    await setFlash(errorText(e), 'error');
  }
  revalidatePath(page(number));
  revalidatePath('/akaunt/zayavki');
  redirect(page(number));
}

export async function watchDateAction(formData: FormData) {
  const u = await requireRole('client');
  const number = numberSchema.parse(formData.get('number'));
  const actor = await actorFromUser(u);
  try {
    const v = await clientRequestPage(actor, number);
    await watchDate(actor, { partnerId: v.request.partnerId, date: v.request.eventDate, clientEventId: v.request.clientEventId });
    await setFlash('Ще ви известим, ако датата се освободи');
  } catch (e) {
    if (isNextSignal(e)) throw e;
    await setFlash(errorText(e), 'error');
  }
  revalidatePath(page(number));
  redirect(page(number));
}
