// Step 1 ‹Бизнес информация› (prototype onboarding/business.html; SCREENS §6).
import type { Metadata } from 'next';
import { stepBusiness } from '@/lib/domain/views-partner-onboarding';
import { guardStep } from '../guard';
import { BusinessForm } from './BusinessForm';

export const metadata: Metadata = { title: 'Бизнес информация' };

export default async function BusinessStep() {
  const { actor } = await guardStep(1);
  const d = await stepBusiness(actor);
  return (
    <>
      <header className="wiz-step-header">
        <span className="wiz-step-counter">Стъпка 1 от 6</span>
        <h1 className="wiz-step-title">Да започнем с основите.</h1>
        <p className="wiz-step-intro">Името, категорията и градът ви ще се показват в каталога и в профила ви.</p>
      </header>
      <BusinessForm {...d} />
    </>
  );
}
