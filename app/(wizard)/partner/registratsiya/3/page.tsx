// Step 3 ‹Пакети и услуги› (prototype onboarding/services.html; SCREENS §6).
import type { Metadata } from 'next';
import { stepServices } from '@/lib/domain/views-partner-onboarding';
import { guardStep } from '../guard';
import { ServicesForm } from './ServicesForm';

export const metadata: Metadata = { title: 'Пакети и услуги' };

export default async function ServicesStep() {
  const { actor } = await guardStep(3);
  const d = await stepServices(actor);
  return (
    <>
      <header className="wiz-step-header">
        <span className="wiz-step-counter">Стъпка 3 от 6</span>
        <h1 className="wiz-step-title">Какво предлагате?</h1>
        <p className="wiz-step-intro">Добавете поне един пакет с фиксирана цена — така клиентите веднага виждат какво включва и колко струва. Ако цената зависи от събитието, добавете и услуга по запитване.</p>
      </header>
      <ServicesForm {...d} />
    </>
  );
}
