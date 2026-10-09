'use client';
// A <form> bound to a server action that answers `{ error }` when the domain
// refuses: the message shows above the form and as a toast.
// Once the page is interactive the action is started from onSubmit, because React
// resets a form after a <form action> finishes: a refused request would otherwise
// lose everything the client typed and picked. The browser's own field checks still
// run first (onSubmit fires only for a valid form).
// The form also carries the action itself, so a tap that comes before hydration (a
// phone on a slow network: ‹Плати›, ‹Изпрати заявката›) posts to the server action
// instead of reloading the page and dropping the tap. After hydration onSubmit
// prevents that path, and React only marks the form pending.
import { createContext, startTransition, useActionState, useEffect, type FormEvent, type ReactNode } from 'react';
import { toast } from '@/components/ui/client';

export type FormState = { error?: string } | null;

/** True while the form's action runs (read by SubmitButton). */
export const FormPending = createContext(false);

export function ActionForm({ action, children, className, id }: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>; children: ReactNode; className?: string; id?: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  useEffect(() => { if (state?.error) toast(state.error, 'error'); }, [state]);
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const fd = new FormData(e.currentTarget, submitter && submitter.getAttribute('name') ? submitter : undefined);
    startTransition(() => formAction(fd));
  }
  return (
    <FormPending.Provider value={pending}>
      <form action={formAction} onSubmit={onSubmit} className={className} id={id}>
        {state?.error && <div className="form-alert" role="alert">{state.error}</div>}
        {children}
      </form>
    </FormPending.Provider>
  );
}
