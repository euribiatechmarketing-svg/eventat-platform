'use client';
import { PasswordField } from '../../_ui/PasswordField';
import { useSubmit } from '../../_ui/useSubmit';
import { resetPasswordAction } from './actions';

export function ResetForm({ token }: { token: string }) {
  const { state, onSubmit, pending } = useSubmit(resetPasswordAction);
  return (
    <form method="post" onSubmit={onSubmit} noValidate style={{ marginTop: 26 }}>
      <input type="hidden" name="token" value={token} />
      <PasswordField id="nova-parola" error={state?.errors?.password} wide={false} />
      {state?.error && <p className="acc-err acc-err--box" style={{ marginTop: 14 }} role="alert">{state.error}</p>}
      <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={pending} style={{ marginTop: 22 }}>Задай нова парола</button>
    </form>
  );
}
