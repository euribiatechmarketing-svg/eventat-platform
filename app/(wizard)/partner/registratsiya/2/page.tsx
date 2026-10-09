// Step 2 ‹Профил и галерия› (prototype onboarding/profile.html; SCREENS §6).
import type { Metadata } from 'next';
import { stepProfile } from '@/lib/domain/views-partner-onboarding';
import { guardStep } from '../guard';
import { ProfileForm } from './ProfileForm';

export const metadata: Metadata = { title: 'Профил и галерия' };

export default async function ProfileStep() {
  const { actor } = await guardStep(2);
  const d = await stepProfile(actor);
  return (
    <>
      <header className="wiz-step-header">
        <span className="wiz-step-counter">Стъпка 2 от 6</span>
        <h1 className="wiz-step-title">Покажете се отблизо.</h1>
        <p className="wiz-step-intro">Снимките и краткото представяне помагат на клиентите да ви опознаят и да решат по-бързо.</p>
      </header>
      <ProfileForm {...d} />
    </>
  );
}
