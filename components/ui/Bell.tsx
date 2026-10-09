'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { markNotificationsRead } from '@/lib/actions/common';

export type BellItem = { id: string; title: string; body: string | null; href: string | null; unread: boolean };

/** The bell: unread dot, a panel with the latest notices, marks them read when opened. */
export function Bell({ items }: { items: BellItem[] }) {
  const [open, setOpen] = useState(false);
  // The header stays mounted across client-side navigation while `items` is refreshed from the
  // server: the dot follows the unread items, and opening the bell clears it until a new one arrives.
  const unreadKey = items.filter(i => i.unread).map(i => i.id).join(',');
  const [seenKey, setSeenKey] = useState('');
  const unread = unreadKey !== '' && unreadKey !== seenKey;
  const [, start] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, [open]);
  return (
    <span ref={ref} className="ui-anchor">
      <button className="icon-btn" aria-label="Известия" aria-expanded={open}
        onClick={() => { setOpen(o => !o); if (unread) { setSeenKey(unreadKey); start(() => markNotificationsRead()); } }}>
        <Icon name="bell" />
        {unread && <span className="dot" />}
      </button>
      {open && (
        <div className="ui-menu ui-menu--down ui-menu--wide" role="menu">
          {items.length === 0 && <div className="ui-empty">Нямате нови известия.</div>}
          {items.map(n => n.href
            ? <Link key={n.id} className="ui-note" href={n.href} onClick={() => setOpen(false)}><b>{n.title}</b>{n.body && <span>{n.body}</span>}</Link>
            : <div key={n.id} className="ui-note"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</div>)}
        </div>
      )}
    </span>
  );
}
