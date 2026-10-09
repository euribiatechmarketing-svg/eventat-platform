'use client';
// A form that keeps what was typed when the server answers with errors. React resets a
// <form action={…}> after every submission; submitting through onSubmit keeps the fields.
// Such a form carries method="post": submitted before hydration, the browser's default GET would
// put the fields (a password, an email) in the address bar and the server logs.
import { startTransition, useActionState, type FormEvent } from 'react';
import type { FormState } from './messages';

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

export function useSubmit(action: Action) {
  const [state, dispatch, pending] = useActionState(action, null);
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(() => dispatch(fd));
  };
  /** Run the action with this form's fields from a button that is not the form's own submit. */
  const run = (form: HTMLFormElement | null | undefined) => {
    if (!form) return;
    const fd = new FormData(form);
    startTransition(() => dispatch(fd));
  };
  return { state, onSubmit, run, pending };
}
