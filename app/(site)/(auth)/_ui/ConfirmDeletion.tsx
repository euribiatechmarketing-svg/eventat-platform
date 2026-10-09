'use client';
// The one button of the deletion links (client and partner), with the error line when the
// link no longer works or the partner still has upcoming bookings.
import { useSubmit } from './useSubmit';
import type { FormState } from './messages';

export function ConfirmDeletion({ action, token }: { action: (p: FormState, fd: FormData) => Promise<FormState>; token: string }) {
  const { state, onSubmit, pending } = useSubmit(action);
  return (
    <form method="post" onSubmit={onSubmit} style={{ marginTop: 28 }}>
      <input type="hidden" name="token" value={token} />
      {state?.error && <p className="acc-err acc-err--box" style={{ marginTop: 0 }} role="alert">{state.error}</p>}
      <button className="btn btn--danger btn--lg btn--block" type="submit" disabled={pending}>Потвърди изтриването</button>
    </form>
  );
}

/** The bin mark above the deletion screens. */
export function BinMark() {
  return (
    <div className="ver-mark acc-mark--danger">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6M14 11v6" /></svg>
    </div>
  );
}
