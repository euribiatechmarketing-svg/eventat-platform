'use client';
// ‹Бележки›: free text only the client sees; ‹Запази бележката›.
import { useEffect } from 'react';
import { useSubmit } from '../../../../(auth)/_ui/useSubmit';
import { toast } from '@/components/ui/client';
import { saveNotesAction } from './actions';

export function NotesForm({ eventId, notes, updated }: { eventId: string; notes: string; updated: string | null }) {
  const { state, onSubmit, pending } = useSubmit(saveNotesAction);
  useEffect(() => { if (state?.error) toast(state.error, 'error'); }, [state]);
  return (
    <form className="ev-note" method="post" onSubmit={onSubmit}>
      <input type="hidden" name="eventId" value={eventId} />
      <textarea className="ev-note-box" name="notes" defaultValue={notes} aria-label="Бележки" rows={Math.min(14, Math.max(3, notes.split('\n').reduce((n, l) => n + Math.ceil((l.length || 1) / 70), 0)))} maxLength={4000} />
      <div className="ev-note-foot">
        <span className="ev-note-meta">{updated ? `Последна промяна: ${updated}` : ''}</span>
        <button className="btn btn--outline btn--sm" type="submit" disabled={pending}>Запази бележката</button>
      </div>
    </form>
  );
}
