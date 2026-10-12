'use server';
// Кейс (SCREENS §8 /admin/sporove/[nomer]; SPEC X4, X5, X8, X10, D13). Permission resolve_disputes.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { decide, remind, requestInfo, setHoldsPayout, type DecideInput } from '@/lib/domain/disputes';
import { extendPaymentDeadline } from '@/lib/domain/bookings';
import { disputeCase, obligationTitle } from '@/lib/domain/views-admin-money';
import { moneyShort, parseMoney, hoursText } from '@/lib/format';
import { setFlash } from '@/lib/flash';
import { NUMBER_RE, adminActor, casePath, deliverNow, refuse, str } from '../../_money/server';

async function target(fd: FormData) {
  const n = z.string().regex(NUMBER_RE).safeParse(str(fd.get('number')));
  if (!n.success) redirect('/admin/sporove');
  const page = casePath(n.data);
  const actor = await adminActor(page, 'resolve_disputes');
  const c = await disputeCase(actor, n.data);
  if (!c) redirect('/admin/sporove');
  return { page, actor, c };
}

const done = async (to: string, toast: string) => {
  revalidatePath('/admin', 'layout');
  await setFlash(toast);
  redirect(to);
};

/** ‹Приложи решението› → disputes.decide() → client-dispute-decision, vendor-ticket-decision (+ client-refund-sent). */
export async function decideAction(fd: FormData) {
  const t = await target(fd);
  const motive = str(fd.get('motive')).trim();
  const optionId = str(fd.get('optionId'));
  const kind = str(fd.get('kind'));
  if (!motive) { await setFlash('Напишете мотива — той отива до клиента и до изпълнителя заедно с решението.', 'error'); redirect(t.page); }
  const opt = t.c.options.find(o => (optionId ? o.id === optionId : !o.id && o.kind === kind));
  if (!opt) redirect(t.page);
  let input: DecideInput = opt.id ? { disputeId: t.c.id, optionId: opt.id, motive } : { disputeId: t.c.id, kind: opt.kind, title: opt.label, motive };
  if (!opt.id && opt.compose === 'obligation') {
    // ‹Задължи {страна} да …›: the team writes what the side has to do.
    const what = str(fd.get('obligation')).trim().slice(0, 300);
    if (!what) redirect(t.page);
    input = { ...input, title: obligationTitle(opt.label, what) };
  } else if (!opt.id && opt.compose === 'refund') {
    // ‹Частично възстановяване — 450 €›: more than nothing, never more than was paid.
    const cents = parseMoney(str(fd.get('refund')));
    if (cents === null || cents <= 0 || cents > t.c.paid) { await setFlash('Проверете сумата за връщане', 'error'); redirect(t.page); }
    input = {
      ...input, refundCents: cents, title: `${opt.label} — ${moneyShort(cents)}`,
      detail: `${moneyShort(cents)} към ${t.c.clientName}, ${moneyShort(t.c.paid - cents)} остават за ${t.c.partnerName}.`,
    };
  }
  try {
    await decide(t.actor, input);
  } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done('/admin/sporove', 'Решението е изпратено до двете страни');
}

/** ‹Поискай още информация› → disputes.requestInfo() to both sides. */
export async function requestInfoAction(fd: FormData) {
  const t = await target(fd);
  const question = str(fd.get('question')).trim().slice(0, 4000);
  if (!question) redirect(t.page);
  try { await requestInfo(t.actor, { disputeId: t.c.id, question, recipients: 'both' }); } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done(t.page, 'Въпросът е изпратен до двете страни');
}

/** ‹Напомни на изпълнителя› / ‹Напомни на клиента› → disputes.remind(). */
export async function remindAction(fd: FormData) {
  const t = await target(fd);
  const side = str(fd.get('side')) === 'client' ? 'client' as const : 'partner' as const;
  const need = str(fd.get('need')).trim().slice(0, 1000);
  if (side === 'client' && !need) redirect(t.page);
  try { await remind(t.actor, { disputeId: t.c.id, side, need }); } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done(t.page, `Напомнянето е изпратено на ${side === 'client' ? t.c.clientName : t.c.partnerName}`);
}

/** ‹Удължи срока с 24 часа› → bookings.extendPaymentDeadline() (X10); fewer hours when the event start clamps it (§17). */
export async function extendAction(fd: FormData) {
  const t = await target(fd);
  let hours: number;
  try { ({ hours } = await extendPaymentDeadline(t.actor, { number: t.c.bookingNumber })); } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done(t.page, `Срокът за плащане е удължен с ${hoursText(hours)}`);
}

/** D13: the payout hold of an open case on or off (control is new copy). */
export async function holdAction(fd: FormData) {
  const t = await target(fd);
  const on = str(fd.get('hold')) === 'on';
  try { await setHoldsPayout(t.actor, { disputeId: t.c.id, holdsPayout: on }); } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done(t.page, on ? `Изплащането към ${t.c.partnerName} е спряно до решението` : 'Изплащането следва обичайния график');
}
