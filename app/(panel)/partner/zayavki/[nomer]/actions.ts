'use server';
// Request page actions (SCREENS §7 `/partner/zayavki/[nomer]`; SPEC §4.5 R2/R3/R6/R7, §4.7 K2/K4).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { askForInfo, approveRequest, declineRequest } from '@/lib/domain/requests';
import { remindClient, withdrawApproval } from '@/lib/domain/bookings';
import { setFlash } from '@/lib/flash';
import { partnerActor, refuse } from '../../_ops/server';

const number = z.string().regex(/^\d{4}-\d{4}-[А-Я]{2}$/);
const pageOf = (n: string) => `/partner/zayavki/${encodeURIComponent(n)}`;

function parseNumber(fd: FormData): string {
  const p = number.safeParse(fd.get('number'));
  if (!p.success) redirect('/partner/zayavki');
  return p.data;
}

/** ‹Одобри заявката› (R3; R6 for a chosen offer) → requests.approve(). */
export async function approveAction(fd: FormData) {
  const n = parseNumber(fd);
  const actor = await partnerActor(pageOf(n));
  try {
    await approveRequest(actor, { number: n });
  } catch (e) { return refuse(e, pageOf(n)); }
  revalidatePath('/partner', 'layout');
  redirect(pageOf(n));
}

/** ‹Поискай още информация› → requests.askForInfo() (messages.send in the request's conversation), toast ‹Въпросът е изпратен на клиента›. */
export async function askAction(fd: FormData) {
  const n = parseNumber(fd);
  const actor = await partnerActor(pageOf(n));
  const p = z.string().trim().min(1).max(4000).safeParse(fd.get('body'));
  if (!p.success) return refuse({ name: 'LifecycleError', code: 'validation' }, pageOf(n));
  try {
    await askForInfo(actor, { number: n, body: p.data });
  } catch (e) { return refuse(e, pageOf(n)); }
  revalidatePath('/partner', 'layout');
  await setFlash('Въпросът е изпратен на клиента');
  redirect(pageOf(n));
}

/** ‹Откажи› + ‹Датата е заета› / ‹Друга причина› (D63) → requests.decline(), toast ‹Заявката е отказана›. */
export async function declineAction(fd: FormData) {
  const n = parseNumber(fd);
  const actor = await partnerActor(pageOf(n));
  const p = z.object({
    reason: z.enum(['date_taken', 'other']),
    text: z.string().trim().max(500).optional(),
  }).refine(v => v.reason !== 'other' || !!v.text, { path: ['text'] })
    .safeParse({ reason: fd.get('reason'), text: fd.get('text') ?? undefined });
  if (!p.success) return refuse({ name: 'LifecycleError', code: 'validation' }, pageOf(n));
  try {
    await declineRequest(actor, { number: n, reason: p.data.reason, text: p.data.text ?? null });
  } catch (e) { return refuse(e, pageOf(n)); }
  revalidatePath('/partner', 'layout');
  await setFlash('Заявката е отказана');
  redirect('/partner/zayavki');
}

/** ‹Напомни на клиента› (K2) → bookings.remindClient(), toast ‹Напомнянето е изпратено›. */
export async function remindAction(fd: FormData) {
  const n = parseNumber(fd);
  const actor = await partnerActor(pageOf(n));
  try {
    await remindClient(actor, { number: n });
  } catch (e) { return refuse(e, pageOf(n)); }
  revalidatePath('/partner', 'layout');
  await setFlash('Напомнянето е изпратено');
  redirect(pageOf(n));
}

/** ‹Отмени одобрението› (K4) → bookings.withdrawApproval(); the date is freed (date watches fire). */
export async function withdrawAction(fd: FormData) {
  const n = parseNumber(fd);
  const actor = await partnerActor(pageOf(n));
  try {
    await withdrawApproval(actor, { number: n });
  } catch (e) { return refuse(e, pageOf(n)); }
  revalidatePath('/partner', 'layout');
  redirect(pageOf(n));
}
