'use server';
// Резервация (SCREENS §8 /admin/rezervacii/[nomer]; SPEC K3, K9–K11, X3, D66).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { extendPaymentDeadline } from '@/lib/domain/bookings';
import { cancelByTeam, completePartnerCancellation, declinePartnerCancellation } from '@/lib/domain/cancellation';
import { openByTeam, CLIENT_REASONS, PARTNER_REASONS } from '@/lib/domain/disputes';
import { DISPUTE_REASON_LABEL } from '@/lib/domain/aftercare-shared';
import { getSetting } from '@/lib/domain/settings';
import { addNote } from '@/lib/domain/team';
import { bookingIdByNumber } from '@/lib/domain/views-admin-money';
import { parseMoney } from '@/lib/format';
import { setFlash } from '@/lib/flash';
import { NUMBER_RE, adminActor, bookingPath, casePath, deliverNow, refuse, str } from '../../_money/server';

async function target(fd: FormData) {
  const n = z.string().regex(NUMBER_RE).safeParse(str(fd.get('number')));
  if (!n.success) redirect('/admin/rezervacii');
  const page = bookingPath(n.data);
  const actor = await adminActor(page);
  const bookingId = await bookingIdByNumber(n.data);
  if (!bookingId) redirect('/admin/rezervacii');
  return { number: n.data, page, actor, bookingId };
}

const done = async (page: string, toast: string) => {
  revalidatePath('/admin', 'layout');
  await setFlash(toast);
  redirect(page);
};

/** ‹Удължи срока› (awaiting payment, D66) → bookings.extendPaymentDeadline(). */
export async function extendAction(fd: FormData) {
  const t = await target(fd);
  try { await extendPaymentDeadline(t.actor, { number: t.number }); } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done(t.page, `Срокът е удължен с ${await getSetting('payment.extension_hours')} часа`);
}

/** ‹Отвори спор› → disputes.openByTeam() → toast ‹Спорът е отворен› → the case page (D68: no email). */
export async function openDisputeAction(fd: FormData) {
  const t = await target(fd);
  const reasons = [...new Set([...CLIENT_REASONS, ...PARTNER_REASONS])] as [string, ...string[]];
  const p = z.object({ reason: z.enum(reasons), description: z.string().trim().min(1).max(4000) })
    .safeParse({ reason: str(fd.get('reason')), description: str(fd.get('description')) });
  if (!p.success) { await setFlash('Опишете сигнала накратко', 'error'); redirect(t.page); }
  const reason = p.data.reason as keyof typeof DISPUTE_REASON_LABEL;
  try {
    await openByTeam(t.actor, { bookingId: t.bookingId, reason, title: DISPUTE_REASON_LABEL[reason], description: p.data.description });
  } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done(casePath(t.number), 'Спорът е отворен');
}

/**
 * ‹Анулирай резервацията› (D66): a partner's pending request → K9 (full refund);
 * otherwise K11 with the reason and the refund the team chose (default: the §5 quote).
 */
export async function cancelAction(fd: FormData) {
  const t = await target(fd);
  const partnerMode = str(fd.get('mode')) === 'partner';
  const reason = str(fd.get('reason')).trim().slice(0, 2000);
  const raw = str(fd.get('refund')).trim();
  const refundCents = raw ? parseMoney(raw) : null;
  if (!partnerMode && !reason) { await setFlash('Напишете причината за анулирането', 'error'); redirect(t.page); }
  if (!partnerMode && raw && refundCents === null) { await setFlash('Проверете сумата за връщане', 'error'); redirect(t.page); }
  try {
    if (partnerMode) await completePartnerCancellation(t.actor, { bookingId: t.bookingId });
    else await cancelByTeam(t.actor, { bookingId: t.bookingId, reason, ...(refundCents !== null ? { refundCents } : {}) });
  } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done(t.page, 'Резервацията е анулирана');
}

/** K10: the team keeps the booking — the partner's cancellation request is declined (control new copy, D66). */
export async function declineCancelAction(fd: FormData) {
  const t = await target(fd);
  try { await declinePartnerCancellation(t.actor, { bookingId: t.bookingId }); } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  await done(t.page, 'Искането за анулиране е отказано');
}

/** ‹Вътрешна бележка› → notes.add() (saved on blur). */
export async function addNoteAction(fd: FormData) {
  const t = await target(fd);
  const body = str(fd.get('body')).trim();
  if (!body) redirect(t.page);
  try { await addNote(t.actor, { subjectType: 'booking', subjectId: t.bookingId, body: body.slice(0, 2000) }); } catch (e) { return refuse(e, t.page); }
  await deliverNow();
  revalidatePath(t.page);
  redirect(t.page);
}
