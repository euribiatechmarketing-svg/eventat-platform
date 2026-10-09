'use server';
// Step 6 ‹Преглед и подаване› (SPEC §4.2 P4): ‹Подай за одобрение› → partners.submitApplication()
// → vendor-application-received, team-vendor-application → /partner/registratsiya/podadeno.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { submitApplication } from '@/lib/domain/partners';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { BASE, CHECK_FORM, proceed, readIntent, readOnlyRedirect, wizardActor, type StepState } from '../flow';

export async function submitAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const actor = await wizardActor();
  const intent = readIntent(fd);
  if (intent === 'autosave') return {};
  if (intent !== 'submit' && intent !== 'next') return proceed(6, intent);
  const acceptTerms = fd.get('acceptTerms') === 'on';
  const confirmInfo = fd.get('confirmInfo') === 'on';
  if (!acceptTerms || !confirmInfo) {
    return { error: CHECK_FORM, fields: { ...(acceptTerms ? {} : { acceptTerms: 'x' }), ...(confirmInfo ? {} : { confirmInfo: 'x' }) }, at: Date.now() };
  }
  const h = await headers();
  try {
    await submitApplication(actor, { acceptTerms, confirmInfo, ip: h.get('x-forwarded-for')?.split(',')[0]?.trim() || null });
  } catch (e) {
    readOnlyRedirect(e);
    if (e instanceof DomainError && e.code === 'steps_incomplete') return { error: CHECK_FORM, at: Date.now() };
    throw e;
  }
  revalidatePath(BASE, 'layout');
  redirect(`${BASE}/podadeno`);
}
