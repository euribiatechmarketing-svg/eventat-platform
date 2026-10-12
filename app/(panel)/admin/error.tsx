'use client';
// An admin panel page failed: the rail stays.
import { ErrorBody } from '@/components/ui/ErrorBody';

export default function AdminError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorBody reset={reset} home="/admin" homeLabel="Към таблото" inShell />;
}
