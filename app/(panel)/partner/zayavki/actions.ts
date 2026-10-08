'use server';
// ‹Експорт› on the requests inbox (SCREENS §7; SPEC §4.17).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requestPartnerReport } from '@/lib/domain/views-partner-ops';
import { setFlash } from '@/lib/flash';
import { backTo, partnerActor, refuse } from '../_ops/server';

export async function exportRequestsAction(fd: FormData) {
  const actor = await partnerActor('/partner/zayavki');
  const back = backTo(fd.get('back'), '/partner/zayavki');
  const tab = String(fd.get('tab') ?? '') || null, filtar = String(fd.get('filtar') ?? '') || null;
  try {
    await requestPartnerReport(actor, { kind: 'partner_requests', params: { tab, filtar } });
  } catch (e) { return refuse(e, back); }
  revalidatePath('/partner', 'layout');
  await setFlash('Справката се подготвя — ще я получите по имейл');
  redirect(back);
}
