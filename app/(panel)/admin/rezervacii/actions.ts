'use server';
// Резервации (SCREENS §8 /admin/rezervacii): ‹Удължи срока›, ‹Експорт›.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { extendPaymentDeadline } from '@/lib/domain/bookings';
import { requestReport } from '@/lib/domain/views-admin-money';
import { hoursText } from '@/lib/format';
import { setFlash } from '@/lib/flash';
import { NUMBER_RE, adminActor, backTo, deliverNow, refuse, str } from '../_money/server';

/** ‹Удължи срока› → bookings.extendPaymentDeadline() → client-payment-extended, vendor-payment-deadline-extended. */
export async function extendDeadlineAction(fd: FormData) {
  const back = backTo(fd.get('back'), '/admin/rezervacii');
  const actor = await adminActor(back);
  const p = z.string().regex(NUMBER_RE).safeParse(str(fd.get('number')));
  if (!p.success) redirect(back);
  let hours: number;
  try {
    ({ hours } = await extendPaymentDeadline(actor, { number: p.data }));
  } catch (e) { return refuse(e, back); }
  await deliverNow();
  revalidatePath('/admin', 'layout');
  await setFlash(`Срокът е удължен с ${hoursText(hours)}`);
  redirect(back);
}

/** ‹Експорт› → reports.request('admin_bookings') (D68: recorded; the ready email needs a new key). */
export async function exportBookingsAction(fd: FormData) {
  const back = backTo(fd.get('back'), '/admin/rezervacii');
  const actor = await adminActor(back);
  const params = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), category: z.string().max(80).optional(), tab: z.string().max(40).optional() })
    .safeParse({ month: str(fd.get('month')), category: str(fd.get('category')) || undefined, tab: str(fd.get('tab')) || undefined });
  if (!params.success) redirect(back);
  try {
    await requestReport(actor, { kind: 'admin_bookings', params: params.data });
  } catch (e) { return refuse(e, back); }
  await deliverNow();
  await setFlash('Справката се подготвя — ще я получите по имейл');
  redirect(back);
}
