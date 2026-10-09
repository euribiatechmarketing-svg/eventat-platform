// Partner sign-up wizard frame (SCREENS §1 wizard top, §6): top bar with the save status,
// the steps rail with each finished step's meta, the footer with progress and buttons.
import { redirect } from 'next/navigation';
import { date } from '@/lib/format';
import '@/styles/m-partner-onboarding.css';
import { wizardContext } from './guard';
import { WizardChrome } from './_ui/WizardChrome';

export default async function RegistrationLayout({ children }: { children: React.ReactNode }) {
  const { chrome } = await wizardContext();
  if (chrome.status === 'deleted') redirect('/');
  if (chrome.status === 'deactivated') redirect('/partner');
  const saved = chrome.draftSavedAt;
  return (
    <WizardChrome steps={chrome.steps}
      elapsedMs={saved ? chrome.serverNow.getTime() - saved.getTime() : null}
      savedLongLabel={saved ? `Запазено на ${date(saved)}` : ''}>
      {children}
    </WizardChrome>
  );
}
