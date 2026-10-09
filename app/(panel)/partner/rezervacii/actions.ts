'use server';
// ‹Експорт› on the bookings ledger (SCREENS §7; SPEC §4.17).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { BOOKING_PERIODS, BOOKING_TABS, requestPartnerReport } from '@/lib/domain/views-partner-ops';
import { setFlash } from '@/lib/flash';
import { backTo, partnerActor, refuse } from '../_ops/server';

const Input = z.object({
  tab: z.enum(BOOKING_TABS.map(t => t.key) as [string, ...string[]]).catch('predstoyashti'),
  period: z.enum(BOOKING_PERIODS.map(p => p.key) as [string, ...string[]]).nullable().catch(null),
});

export async function exportBookingsAction(fd: FormData) {
  const actor = await partnerActor('/partner/rezervacii');
  const back = backTo(fd.get('back'), '/partner/rezervacii');
  const { tab, period } = Input.parse({ tab: fd.get('tab'), period: fd.get('period') || null });
  try {
    await requestPartnerReport(actor, { kind: 'partner_bookings', params: { tab, period } });
  } catch (e) { return refuse(e, back); }
  revalidatePath('/partner', 'layout');
  await setFlash('Справката се подготвя — ще я получите по имейл');
  redirect(back);
}
