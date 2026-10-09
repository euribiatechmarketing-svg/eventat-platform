'use server';
// ‹Експорт› on the requests inbox (SCREENS §7; SPEC §4.17).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { REQUEST_FILTERS, REQUEST_TABS, requestPartnerReport } from '@/lib/domain/views-partner-ops';
import { setFlash } from '@/lib/flash';
import { backTo, partnerActor, refuse } from '../_ops/server';

const Input = z.object({
  tab: z.enum(REQUEST_TABS.map(t => t.key) as [string, ...string[]]).catch('vsichki'),
  filtar: z.enum(REQUEST_FILTERS.map(f => f.key) as [string, ...string[]]).catch('vsichki'),
});

export async function exportRequestsAction(fd: FormData) {
  const actor = await partnerActor('/partner/zayavki');
  const back = backTo(fd.get('back'), '/partner/zayavki');
  const { tab, filtar } = Input.parse({ tab: fd.get('tab'), filtar: fd.get('filtar') });
  try {
    await requestPartnerReport(actor, { kind: 'partner_requests', params: { tab, filtar } });
  } catch (e) { return refuse(e, back); }
  revalidatePath('/partner', 'layout');
  await setFlash('Справката се подготвя — ще я получите по имейл');
  redirect(back);
}
