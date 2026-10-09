// /partner/registratsiya → the step to continue from (SPEC §1.3: the saved onboarding step).
import { redirect } from 'next/navigation';
import { wizardContext } from './guard';
import { BASE } from './flow';

export default async function RegistrationIndex() {
  const { chrome } = await wizardContext();
  if (chrome.status === 'approved') redirect('/partner');
  if (chrome.status === 'submitted' || chrome.status === 'rejected') redirect(`${BASE}/podadeno`);
  const step = Math.min(chrome.onboardingStep, chrome.firstOpen);
  redirect(`${BASE}/${chrome.steps[step - 1]?.reachable ? step : chrome.firstOpen}`);
}
