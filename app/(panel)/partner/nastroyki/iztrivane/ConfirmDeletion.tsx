'use client';
import { useActionState } from 'react';
import Link from 'next/link';
import { confirmDeletionAction } from './actions';

export function ConfirmDeletion({ token }: { token: string }) {
  const [state, action, pending] = useActionState(confirmDeletionAction, {} as { error?: string });
  return (
    <form action={action}>
      <input type="hidden" name="token" value={token} />
      {state.error && <div className="form-alert">{state.error}</div>}
      <div className="panel-actions">
        <Link className="btn btn--outline btn--sm" href="/partner/nastroyki">Откажи</Link>
        <button type="submit" className="btn btn--danger btn--sm" disabled={pending || !token}>Потвърди изтриването</button>
      </div>
    </form>
  );
}
