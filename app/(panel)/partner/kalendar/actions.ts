'use server';
// Calendar actions (SCREENS §7 `/partner/kalendar`, dashboard mini calendar; SPEC §4.13, §12.6).
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { blockDate, blockRange, setRules, toggleBlock, toggleOpenDate, unblock } from '@/lib/domain/availability';
import { setFlash } from '@/lib/flash';
import { backTo, partnerActor, refuse } from '../_ops/server';

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const reason = z.string().trim().max(80).optional().transform(v => v || null);

/**
 * A day in a calendar: a free day is blocked (‹Датата е блокирана›), a blocked one freed (‹Датата е освободена›).
 * With ‹Приемам заявки само за избрани дати› a closed day (`open:YYYY-MM-DD`) is opened for requests instead.
 */
export async function toggleDayAction(fd: FormData) {
  const actor = await partnerActor('/partner/kalendar');
  const back = backTo(fd.get('back'), '/partner/kalendar');
  const m = /^(open:)?(\d{4}-\d{2}-\d{2})$/.exec(String(fd.get('date') ?? ''));
  if (!m || !day.safeParse(m[2]).success) return refuse({ name: 'DomainError', code: 'invalid_date' }, back);
  let flash: string | null = null;
  try {
    if (m[1]) await toggleOpenDate(actor, { date: m[2] });
    else flash = (await toggleBlock(actor, { date: m[2] })).blocked ? 'Датата е блокирана' : 'Датата е освободена';
  } catch (e) { return refuse(e, back); }
  revalidatePath('/partner', 'layout');
  if (flash) await setFlash(flash);
  redirect(back);
}

/** ‹Блокирай период› → availability.blockRange(), toast ‹Периодът е блокиран в календара›. */
export async function blockRangeAction(fd: FormData) {
  const actor = await partnerActor('/partner/kalendar');
  const back = backTo(fd.get('back'), '/partner/kalendar');
  const p = z.object({ from: day, to: day, reason }).safeParse({ from: fd.get('from'), to: fd.get('to'), reason: fd.get('reason') ?? undefined });
  if (!p.success) return refuse({ name: 'DomainError', code: 'invalid_range' }, back);
  try {
    await blockRange(actor, { from: p.data.from, to: p.data.to, reason: p.data.reason });
  } catch (e) { return refuse(e, back); }
  revalidatePath('/partner', 'layout');
  await setFlash('Периодът е блокиран в календара');
  redirect(back);
}

/** ‹Блокирай дата› → availability.blockDate(), toast ‹Датата е блокирана в календара›. */
export async function blockDateAction(fd: FormData) {
  const actor = await partnerActor('/partner/kalendar');
  const back = backTo(fd.get('back'), '/partner/kalendar');
  const p = z.object({ date: day, reason }).safeParse({ date: fd.get('date'), reason: fd.get('reason') ?? undefined });
  if (!p.success) return refuse({ name: 'DomainError', code: 'invalid_date' }, back);
  try {
    await blockDate(actor, { date: p.data.date, reason: p.data.reason });
  } catch (e) { return refuse(e, back); }
  revalidatePath('/partner', 'layout');
  await setFlash('Датата е блокирана в календара');
  redirect(back);
}

/** × on a block in ‹Блокирани дати› → availability.unblock(), toast ‹Датата е освободена›. */
export async function unblockAction(fd: FormData) {
  const actor = await partnerActor('/partner/kalendar');
  const back = backTo(fd.get('back'), '/partner/kalendar');
  const p = z.object({ blockId: z.string().uuid() }).safeParse({ blockId: fd.get('blockId') });
  if (!p.success) return refuse({ name: 'DomainError', code: 'not_found' }, back);
  try {
    await unblock(actor, { blockId: p.data.blockId });
  } catch (e) { return refuse(e, back); }
  revalidatePath('/partner', 'layout');
  await setFlash('Датата е освободена');
  redirect(back);
}

/**
 * ‹Правила за наличност›: ‹Само едно събитие на ден›, stepper ‹Максимум резервации за дата› (1–9),
 * ‹Приемам заявки само за избрани дати› → availability.setRules().
 */
export async function setRulesAction(fd: FormData) {
  const actor = await partnerActor('/partner/kalendar');
  const back = backTo(fd.get('back'), '/partner/kalendar');
  const p = z.object({
    onePerDay: z.enum(['on', 'off']).optional(),
    max: z.coerce.number().int().min(1).max(9).optional(),
    onlySelected: z.enum(['on', 'off']).optional(),
  }).safeParse({ onePerDay: fd.get('onePerDay') ?? undefined, max: fd.get('max') ?? undefined, onlySelected: fd.get('onlySelected') ?? undefined });
  if (!p.success) return refuse({ name: 'DomainError', code: 'invalid_max_bookings' }, back);
  const r = p.data;
  try {
    await setRules(actor, {
      ...(r.onePerDay ? { bookingsPerDayMode: r.onePerDay === 'on' ? 'one' as const : 'limit' as const } : {}),
      // the stepper: 2–9 allows that many (the switch turns off); back to 1 is ‹Само едно събитие на ден› again
      ...(r.max !== undefined ? { bookingsPerDayMode: r.max === 1 ? 'one' as const : 'limit' as const, maxBookingsPerDate: r.max } : {}),
      ...(r.onlySelected ? { onlySelectedDates: r.onlySelected === 'on' } : {}),
    });
  } catch (e) { return refuse(e, back); }
  revalidatePath('/partner', 'layout');
  redirect(back);
}
