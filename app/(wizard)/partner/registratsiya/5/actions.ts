'use server';
// Step 5 ‹Политика за анулиране› (SPEC §12.1, §5): partners.saveDraft / saveStep(5).
import { saveDraft, saveStep } from '@/lib/domain/partners';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { CHECK_FORM, REQUIRED, issueFields, proceed, readIntent, readOnlyRedirect, text, wizardActor, type StepState } from '../flow';

export async function policyAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const actor = await wizardActor();
  const intent = readIntent(fd);
  const policy = (['flexible', 'moderate', 'strict'] as const).find(p => p === text(fd, 'cancellationPolicy'));
  const deposit = ([20, 30, 40, 50] as const).find(n => String(n) === text(fd, 'depositPercent'));
  const reschedule = (['free_if_available', 'one_free', 'not_allowed'] as const).find(r => r === text(fd, 'reschedulePolicy'));
  const d: Record<string, unknown> = {};
  if (policy) d.cancellationPolicy = policy;
  if (deposit) d.depositPercent = deposit;
  if (reschedule) d.reschedulePolicy = reschedule;
  try {
    await saveDraft(actor, { step: 5, data: d });
  } catch (e) {
    readOnlyRedirect(e);
    if (!(e instanceof DomainError)) throw e;
  }
  if (intent === 'next') {
    const f: Record<string, string> = {};
    if (!policy) f.cancellationPolicy = 'Изберете една политика.';
    if (!deposit) f.depositPercent = REQUIRED;
    if (!reschedule) f.reschedulePolicy = REQUIRED;
    if (Object.keys(f).length) return { error: CHECK_FORM, fields: f, saved: true, at: Date.now() };
    try {
      await saveStep(actor, { step: 5, data: d });
    } catch (e) {
      readOnlyRedirect(e);
      if (!(e instanceof DomainError)) throw e;
      return { error: CHECK_FORM, fields: issueFields(e), saved: true, at: Date.now() };
    }
  }
  return proceed(5, intent);
}
