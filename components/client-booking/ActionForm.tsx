'use client';
// A <form> bound to a server action that answers `{ error }` when the domain
// refuses: the message shows above the form and as a toast.
import { useActionState, useEffect, type ReactNode } from 'react';
import { toast } from '@/components/ui/client';

export type FormState = { error?: string } | null;

export function ActionForm({ action, children, className, id }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>; children: ReactNode; className?: string; id?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  useEffect(() => { if (state?.error) toast(state.error, 'error'); }, [state]);
  return (
    <form action={formAction} className={className} id={id}>
      {state?.error && <div className="form-alert" role="alert">{state.error}</div>}
      {children}
    </form>
  );
}
