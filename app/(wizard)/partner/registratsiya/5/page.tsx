// Step 5 ‹Политика за анулиране› (prototype onboarding/policy.html; SCREENS §6).
import type { Metadata } from 'next';
import { stepPolicy } from '@/lib/domain/views-partner-onboarding';
import { guardStep } from '../guard';
import { PolicyForm } from './PolicyForm';

export const metadata: Metadata = { title: 'Политика за анулиране' };

export default async function PolicyStep() {
  const { actor } = await guardStep(5);
  const d = await stepPolicy(actor);
  return (
    <>
      <header className="wiz-step-header">
        <span className="wiz-step-counter">Стъпка 5 от 6</span>
        <h1 className="wiz-step-title">Какво се случва при анулиране?</h1>
        <p className="wiz-step-intro">Изберете една политика. Тя се прилага автоматично към всички ваши резервации, а клиентите я виждат, преди да платят — така няма изненади.</p>
      </header>
      <PolicyForm {...d} />
    </>
  );
}
