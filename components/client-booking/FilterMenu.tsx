'use client';
// A toolbar filter (‹Всички събития›, ‹Всички статуси›): a button with its
// chevron that opens the options; each option is a link, so the filter lives
// in the URL and the view can be shared. The button discloses the list (the
// chosen option is aria-current): from the keyboard focus moves to the chosen
// option, the arrows move, Escape closes it and returns to the button.
import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useDropdown } from '@/components/ui/dropdown';

export type FilterOption = { label: string; href: string; active: boolean };

const ICONS = {
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  status: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
};

export function FilterMenu({ icon, label, options }: { icon: keyof typeof ICONS; label: string; options: FilterOption[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const { onTriggerClick, onPanelKey } = useDropdown({ open, setOpen, wrap: ref, trigger: btn, panel });
  return (
    <span ref={ref} className={`ui-anchor cb-filter${open ? ' is-open' : ''}`}>
      <button ref={btn} type="button" className="filter-btn" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onTriggerClick}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">{ICONS[icon]}</svg>
        {label}
        <svg className="proto-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && (
        <div ref={panel} id={id} className="ui-menu ui-menu--down cb-filter-menu" onKeyDown={onPanelKey}>
          {options.map(o => (
            <Link key={o.href + o.label} href={o.href} aria-current={o.active ? 'true' : undefined}
              className={o.active ? 'is-active' : undefined} onClick={() => setOpen(false)}>{o.label}</Link>
          ))}
        </div>
      )}
    </span>
  );
}
