'use client';
// A <form> bound to a server action that answers `{ error }` when the domain
// refuses: the message shows above the form and as a toast.
// The action is started from onSubmit, because React resets a form after an
// action it ran itself finishes: a refused request would otherwise lose
// everything the client typed and picked. The browser's own field checks still
// run first (onSubmit fires only for a valid form). The form also carries the
// action (`action={formAction}`) so a tap before the page's JavaScript has
// loaded posts to the server action like any form; without it the browser sent
// a GET to the page itself, with the fields (the note, the venue, the cancel
// reason) in the address, and nothing happened. Once hydrated, onSubmit's
// preventDefault() keeps React from running that action a second time.
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
