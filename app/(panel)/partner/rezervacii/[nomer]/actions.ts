'use server';
// Booking page actions (SCREENS §7 `/partner/rezervacii/[nomer]`; SPEC §4.7 K8).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requestPartnerCancellation } from '@/lib/domain/cancellation';
import { partnerBookingId } from '@/lib/domain/views-partner-ops';
import { setFlash } from '@/lib/flash';
import { partnerActor, refuse } from '../../_ops/server';

/** ‹Анулиране› → cancellation.requestPartnerCancellation(), toast ‹Изпратихме искането за анулиране — екипът се свързва с клиента›. */
export async function requestCancellationAction(fd: FormData) {
  const p = z.string().regex(/^\d{4}-\d{4}-[А-Я]{2}$/).safeParse(fd.get('number'));
  if (!p.success) redirect('/partner/rezervacii');
  const page = `/partner/rezervacii/${encodeURIComponent(p.data)}`;
  const actor = await partnerActor(page);
  const bookingId = await partnerBookingId(actor, p.data);
  if (!bookingId) redirect('/partner/rezervacii');
  try {
    await requestPartnerCancellation(actor, { bookingId });
  } catch (e) { return refuse(e, page); }
  revalidatePath('/partner', 'layout');
  await setFlash('Изпратихме искането за анулиране — екипът се свързва с клиента');
  redirect(page);
}
