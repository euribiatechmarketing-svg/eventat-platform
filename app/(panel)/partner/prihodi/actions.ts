'use server';
// /partner/prihodi: ‹Изтегли справка› → reports.request('partner_earnings') → vendor-report-ready.
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { requestEarningsReport } from '@/lib/domain/views-partner-catalogue';
import { partnerActor, refusal } from '../_catalogue/server';

export async function requestEarningsReportAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const actor = await partnerActor('/partner/prihodi');
  try {
    await db.transaction(tx => requestEarningsReport(actor, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner/prihodi');
  return { ok: true, message: 'Справката се подготвя — ще я получите по имейл' };
}
