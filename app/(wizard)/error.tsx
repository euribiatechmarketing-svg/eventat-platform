'use client';
// A step of the partner sign-up wizard failed.
import { ErrorBody } from '@/components/ui/ErrorBody';

export default function WizardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBody reset={reset} />;
}
