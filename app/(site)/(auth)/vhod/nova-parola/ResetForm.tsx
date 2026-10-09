'use client';
import { useRef } from 'react';
import { useFocusInvalid } from '@/components/ui/forms';
import { PasswordField } from '../../_ui/PasswordField';
import { useSubmit } from '../../_ui/useSubmit';
import { resetPasswordAction } from './actions';

export function ResetForm({ token }: { token: string }) {
  const { state, onSubmit, pending } = useSubmit(resetPasswordAction);
  const formRef = useRef<HTMLFormElement>(null);
  useFocusInvalid(formRef, state);
  return (
    <form ref={formRef} method="post" onSubmit={onSubmit} noValidate style={{ marginTop: 26 }}>
      <input type="hidden" name="token" value={token} />
      <PasswordField id="nova-parola" error={state?.errors?.password} wide={false} />
      {state?.error && <p className="acc-err acc-err--box" style={{ marginTop: 14 }} role="alert">{state.error}</p>}
      <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={pending} style={{ marginTop: 22 }}>Задай нова парола</button>
    </form>
  );
}
