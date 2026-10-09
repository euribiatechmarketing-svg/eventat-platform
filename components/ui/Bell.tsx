'use client';
import { useId, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { useDropdown } from './dropdown';
import { markNotificationsRead } from '@/lib/actions/common';

export type BellItem = { id: string; title: string; body: string | null; href: string | null; unread: boolean };

/**
 * The bell: unread dot, a panel with the latest notices, marks them read when opened. The panel is a
 * list of notices, not a menu: the bell discloses it (Tab moves through the notices, Escape closes it
 * and returns focus to the bell).
 */
export function Bell({ items }: { items: BellItem[] }) {
  const [open, setOpen] = useState(false);
  // The header stays mounted across client-side navigation while `items` is refreshed from the
  // server: the dot follows the unread items, and opening the bell clears it until a new one arrives.
  const unreadKey = items.filter(i => i.unread).map(i => i.id).join(',');
  const [seenKey, setSeenKey] = useState('');
  const unread = unreadKey !== '' && unreadKey !== seenKey;
  const [, start] = useTransition();
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const newId = useId();
  const { onTriggerClick, onPanelKey } = useDropdown({ open, setOpen, wrap: ref, trigger: btn, panel });
  return (
    <span ref={ref} className="ui-anchor">
      <button ref={btn} type="button" className="icon-btn" aria-label="Известия" aria-expanded={open} aria-controls={open ? id : undefined}
        aria-describedby={unread ? newId : undefined}
        onClick={e => { onTriggerClick(e); if (unread) { setSeenKey(unreadKey); start(() => markNotificationsRead()); } }}>
        <Icon name="bell" />
        {unread && <span className="dot" />}
      </button>
      {/* The dot, for screen readers. */}
      {unread && <span id={newId} hidden>Имате нови известия</span>}
      {open && (
        <div ref={panel} id={id} className="ui-menu ui-menu--down ui-menu--wide" role="group" aria-label="Известия" onKeyDown={onPanelKey}>
          {items.length === 0 && <div className="ui-empty">Нямате нови известия.</div>}
          {items.map(n => n.href
            ? <Link key={n.id} className="ui-note" href={n.href} onClick={() => setOpen(false)}><b>{n.title}</b>{n.body && <span>{n.body}</span>}</Link>
            : <div key={n.id} className="ui-note"><b>{n.title}</b>{n.body && <span>{n.body}</span>}</div>)}
        </div>
      )}
    </span>
  );
}
