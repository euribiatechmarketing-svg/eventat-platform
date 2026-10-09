'use client';
// ‹Отговори› under a review without a reply: opens the box, publishes once.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/client';
import { replyToReviewAction } from './actions';

export function ReplyBox({ reviewId, author }: { reviewId: string; author: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!open) {
    return <div className="pc-reply"><button type="button" className="btn btn--outline btn--sm" onClick={() => setOpen(true)}>Отговори</button></div>;
  }
  return (
    <form className="pc-reply" onSubmit={e => {
      e.preventDefault();
      if (!text.trim()) { setError('Напишете отговор.'); return; }
      start(async () => {
        const r = await replyToReviewAction({ reviewId, text });
        if (!r.ok) { setError(r.error); toast(r.error, 'error'); return; }
        toast(r.message);
        router.refresh();
      });
    }}>
      <label className="fld">
        <span className="fld-l">Вашият отговор</span>
        <textarea className="fld-i fld-i--area" value={text} maxLength={2000} autoFocus aria-label={`Отговор на ${author}`}
          onChange={e => { setText(e.target.value); setError(null); }} aria-invalid={!!error} />
      </label>
      {error && <span className="form-error">{error}</span>}
      <div className="pc-reply-acts">
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => { setOpen(false); setText(''); setError(null); }} disabled={pending}>Откажи</button>
        <button type="submit" className="btn btn--primary btn--sm" disabled={pending}>Отговори</button>
      </div>
    </form>
  );
}
