'use server';
// Step 4 ‹Наличност› (SPEC §12.1, §12.6): the rules go with the step form
// (partners.saveDraft / saveStep(4)); a calendar day → availability.toggleBlock().
import { revalidatePath } from 'next/cache';
import { saveDraft, saveStep } from '@/lib/domain/partners';
import { HORIZON_OPTIONS, LEAD_TIME_OPTIONS, isDate, toggleBlock } from '@/lib/domain/availability';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { BASE, CHECK_FORM, REQUIRED, issueFields, proceed, readIntent, readOnlyRedirect, text, wizardActor, type StepState } from '../flow';

export async function availabilityAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const actor = await wizardActor();
  const intent = readIntent(fd);
  const mode = (['one', 'limit', 'unlimited'] as const).find(m => m === text(fd, 'bookingsPerDayMode'));
  const max = Number(text(fd, 'maxBookingsPerDate'));
  const lead = Number(text(fd, 'leadTimeDays'));
  const horizon = Number(text(fd, 'horizonMonths'));
  const days = [...new Set(fd.getAll('workingDays').map(Number).filter(d => Number.isInteger(d) && d >= 1 && d <= 7))];
  const d: Record<string, unknown> = {};
  if (mode) d.bookingsPerDayMode = mode;
  if (mode === 'limit' && Number.isInteger(max) && max >= 2 && max <= 9) d.maxBookingsPerDate = max;
  if ((LEAD_TIME_OPTIONS as readonly number[]).includes(lead)) d.leadTimeDays = lead;
  if ((HORIZON_OPTIONS as readonly number[]).includes(horizon)) d.horizonMonths = horizon;
  if (days.length) d.workingDays = days;
  try {
    await saveDraft(actor, { step: 4, data: d });
  } catch (e) {
    readOnlyRedirect(e);
    if (!(e instanceof DomainError)) throw e;
  }
  if (intent === 'next') {
    const f: Record<string, string> = {};
    if (!mode) f.bookingsPerDayMode = REQUIRED;
    if (mode === 'limit' && !d.maxBookingsPerDate) f.maxBookingsPerDate = REQUIRED;
    if (d.leadTimeDays === undefined) f.leadTimeDays = REQUIRED;
    if (d.horizonMonths === undefined) f.horizonMonths = REQUIRED;
    if (!days.length) f.workingDays = 'Изберете поне един ден.';
    if (Object.keys(f).length) return { error: CHECK_FORM, fields: f, saved: true, at: Date.now() };
    try {
      await saveStep(actor, { step: 4, data: d });
    } catch (e) {
      readOnlyRedirect(e);
      if (!(e instanceof DomainError)) throw e;
      return { error: CHECK_FORM, fields: issueFields(e), saved: true, at: Date.now() };
    }
  }
  return proceed(4, intent);
}

/** A calendar day: a free day is blocked, a blocked one is freed (availability.toggleBlock()). */
export async function toggleBlockAction(date: string): Promise<{ ok: boolean; blocked?: boolean }> {
  const actor = await wizardActor();
  if (!isDate(date)) return { ok: false };
  try {
    const r = await toggleBlock(actor, { date });
    revalidatePath(BASE, 'layout');
    return { ok: true, blocked: r.blocked };
  } catch (e) {
    readOnlyRedirect(e);
    if (e instanceof DomainError) return { ok: false };
    throw e;
  }
}
