import 'server-only';
// Guard partner:wizard (SCREENS §0, §6; SPEC §1.3): a partner whose status is draft,
// returned or submitted. Steps are for draft / returned only; reachable steps only (§12.1).
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { wizardChrome } from '@/lib/domain/views-partner-onboarding';
import { BASE } from './flow';

/** The signed-in partner and the wizard frame, once per request (layout + page). */
export const wizardContext = cache(async () => {
  const user = await requireRole('partner', BASE);
  const actor = await actorFromUser(user);
  if (!actor.partnerId) redirect('/registratsiya?as=partner');
  return { user, actor, chrome: await wizardChrome(actor) };
});

/** Steps 1–6: draft / returned partners, and only steps they may open. */
export async function guardStep(n: number) {
  const ctx = await wizardContext();
  const { status } = ctx.chrome;
  if (status === 'approved' || status === 'deactivated') redirect('/partner');
  if (status === 'submitted' || status === 'rejected') redirect(`${BASE}/podadeno`);
  if (status === 'deleted') redirect('/');
  if (!ctx.chrome.steps[n - 1].reachable) redirect(`${BASE}/${ctx.chrome.firstOpen}`);
  return ctx;
}
