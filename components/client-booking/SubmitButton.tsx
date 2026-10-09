'use client';
// A form's submit button that cannot be pressed twice while the action runs
// (a plain <form action> through useFormStatus, an ActionForm through its context).
import { useContext, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { FormPending } from './ActionForm';

export function SubmitButton({ className, children, name, value, disabled }: { className: string; children: ReactNode; name?: string; value?: string; disabled?: boolean }) {
  const { pending: formPending } = useFormStatus();
  const ctxPending = useContext(FormPending);
  const pending = formPending || ctxPending;
  return (
    <button type="submit" className={className} name={name} value={value} disabled={disabled || pending} aria-busy={pending || undefined}>
      {children}
    </button>
  );
}
