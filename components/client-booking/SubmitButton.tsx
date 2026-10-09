'use client';
// A form's submit button that cannot be pressed twice while the action runs.
import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

export function SubmitButton({ className, children, name, value, disabled }: { className: string; children: ReactNode; name?: string; value?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} name={name} value={value} disabled={disabled || pending} aria-busy={pending || undefined}>
      {children}
    </button>
  );
}
