'use client';
// A toolbar filter (‹Всички събития›, ‹Всички статуси›): a button with its
// chevron that opens the options; each option is a link, so the filter lives
// in the URL and the view can be shared.
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export type FilterOption = { label: string; href: string; active: boolean };

const ICONS = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  status: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
};

export function FilterMenu({ icon, label, options }: { icon: keyof typeof ICONS; label: string; options: FilterOption[] }) {
  const [open, setOpen] = useState(false);
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
    <span ref={ref} className={`ui-anchor cb-filter${open ? ' is-open' : ''}`}>
      <button type="button" className="filter-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">{ICONS[icon]}</svg>
        {label}
        <svg className="proto-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="ui-menu ui-menu--down cb-filter-menu" role="menu">
          {options.map(o => (
            <Link key={o.href + o.label} href={o.href} role="menuitem" aria-current={o.active ? 'true' : undefined}
              className={o.active ? 'is-active' : undefined} onClick={() => setOpen(false)}>{o.label}</Link>
          ))}
        </div>
      )}
    </span>
  );
}
