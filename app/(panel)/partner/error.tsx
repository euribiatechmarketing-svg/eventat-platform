'use client';
// A partner panel page failed: the rail stays.
import { ErrorBody } from '@/components/ui/ErrorBody';

export default function PartnerError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBody reset={reset} home="/partner" homeLabel="Към таблото" inShell />;
}
