'use server';
// Плащания (SCREENS §8 /admin/plashtaniya; SPEC Y5, Y9, B2, B3). Permission view_finance; release_payouts to release.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requestAccountingReport, requestBatchReport } from '@/lib/domain/payouts';
import { confirmAccount, rejectAccount } from '@/lib/domain/payout-accounts';
import { releaseNextBatch } from '@/lib/domain/views-admin-money';
import { addDays, sofiaDate } from '@/lib/format';
import { now } from '@/lib/clock';
import { setFlash } from '@/lib/flash';
import { adminActor, backTo, deliverNow, refuse, str } from '../_money/server';

const PAGE = '/admin/plashtaniya';
const uuid = z.string().uuid();

/** ‹Пусни изплащанията› / ‹Пусни партидата› → payouts.releaseBatch() (vendor-payout-sent per line, team-batch-paid). */
export async function releaseAction(fd: FormData) {
  const actor = await adminActor(PAGE, 'release_payouts');
  const d = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).safeParse(str(fd.get('batchDate')));
  if (!d.success) redirect(PAGE);
  const where = str(fd.get('source')) === 'card' ? 'card' : 'head';
  let result;
  try { result = await releaseNextBatch(actor, { batchDate: d.data }); } catch (e) { return refuse(e, PAGE); }
  await deliverNow();
  revalidatePath('/admin', 'layout');
  await setFlash(result.status === 'awaiting_second_approval'
    ? 'Партидата чака потвърждение от втори администратор'
    : where === 'card' ? 'Партидата е пусната' : 'Изплащанията са пуснати');
  redirect(PAGE);
}

/** ‹Счетоводна справка› → reports.request('accounting') for the current month (report_job; D68). */
export async function accountingReportAction() {
  const actor = await adminActor(PAGE, 'view_finance');
  const today = sofiaDate(await now());
  const from = `${today.slice(0, 7)}-01`;
  const [y, m] = from.split('-').map(Number);
  const to = addDays(m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`, -1);
  try { await requestAccountingReport(actor, { from, to }); } catch (e) { return refuse(e, PAGE); }
  await deliverNow();
  await setFlash('Справката се подготвя — ще я получите по имейл');
  redirect(PAGE);
}

/** A history row → reports.request('batch_report') → team-batch-report. */
export async function batchReportAction(fd: FormData) {
  const back = backTo(fd.get('back'), PAGE);
  const actor = await adminActor(back, 'view_finance');
  const id = uuid.safeParse(str(fd.get('batchId')));
  if (!id.success) redirect(back);
  try { await requestBatchReport(actor, { batchId: id.data }); } catch (e) { return refuse(e, back); }
  await deliverNow();
  await setFlash('Отчетът за партидата се подготвя — ще го получите по имейл');
  redirect(back);
}

/** Pending payout account → confirm (B2): vendor-payout-account-confirmed. */
export async function confirmAccountAction(fd: FormData) {
  const actor = await adminActor(PAGE, 'view_finance');
  const id = uuid.safeParse(str(fd.get('accountId')));
  if (!id.success) redirect(PAGE);
  try { await confirmAccount(actor, { accountId: id.data }); } catch (e) { return refuse(e, PAGE); }
  await deliverNow();
  revalidatePath('/admin', 'layout');
  await setFlash('Сметката е потвърдена');
  redirect(PAGE);
}

/** Pending payout account → reject with a reason (B3, D57; no email exists). */
export async function rejectAccountAction(fd: FormData) {
  const actor = await adminActor(PAGE, 'view_finance');
  const id = uuid.safeParse(str(fd.get('accountId')));
  const reason = str(fd.get('reason')).trim().slice(0, 1000);
  if (!id.success || !reason) redirect(PAGE);
  try { await rejectAccount(actor, { accountId: id.data, reason }); } catch (e) { return refuse(e, PAGE); }
  await deliverNow();
  revalidatePath('/admin', 'layout');
  await setFlash('Сметката е отказана');
  redirect(PAGE);
}
