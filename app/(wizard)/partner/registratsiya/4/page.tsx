// Step 4 ‹Наличност› (prototype onboarding/availability.html; SCREENS §6). ?mesec=YYYY-MM picks the calendar month.
import type { Metadata } from 'next';
import { stepAvailability } from '@/lib/domain/views-partner-onboarding';
import { guardStep } from '../guard';
import { AvailabilityForm } from './AvailabilityForm';

export const metadata: Metadata = { title: 'Наличност' };

export default async function AvailabilityStep({ searchParams }: { searchParams: Promise<{ mesec?: string }> }) {
  const { actor } = await guardStep(4);
  const d = await stepAvailability(actor, (await searchParams).mesec);
  return (
    <>
      <header className="wiz-step-header">
        <span className="wiz-step-counter">Стъпка 4 от 6</span>
        <h1 className="wiz-step-title">Кога сте свободни?</h1>
        <p className="wiz-step-intro">Изберете колко събития поемате на ден и кои дати вече са заети. Наличността си можете да променяте по всяко време от календара.</p>
      </header>
      <AvailabilityForm {...d} />
    </>
  );
}
