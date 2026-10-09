'use client';
// Keyboard behaviour shared by the dropdowns (menus, filter menus) and the bell panel (WAI-ARIA menu button /
// disclosure): a click outside, Escape or focus leaving closes the popup; Escape returns focus to the trigger.
// For a menu (`items: true`) focus moves to the checked item (else the first) when it opens, and the arrow
// keys, Home and End move between the items (role="menuitem…", tabIndex -1); Tab leaves it from the trigger.
import { useEffect, useRef, type RefObject } from 'react';

const ITEM = '[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';

export function usePopup({ open, setOpen, wrap, trigger, items = false }: {
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Element holding the trigger and the popup. */
  wrap: RefObject<HTMLElement | null>;
  /** The element that opens it, where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  /** A menu: focus moves into it and the arrows move between items. */
  items?: boolean;
}) {
  const set = useRef(setOpen);
  set.current = setOpen;
  // ArrowDown / ArrowUp on the trigger open the menu at the first / last item.
  const startAt = useRef<'first' | 'last' | null>(null);

  useEffect(() => {
    if (!open) return;
    const w = wrap.current;
    const list = () => [...(w?.querySelectorAll<HTMLElement>(ITEM) ?? [])];
    if (items) {
      const xs = list();
      const at = startAt.current === 'last' ? xs.at(-1) : xs.find(x => x.getAttribute('aria-checked') === 'true') ?? xs[0];
      startAt.current = null;
      at?.focus({ preventScroll: true });
    }
    const close = (back: boolean) => { set.current(false); if (back) trigger.current?.focus({ preventScroll: true }); };
    const onDown = (e: MouseEvent) => { if (!w?.contains(e.target as Node)) close(false); };
    // Escape anywhere closes it; focus comes back to the trigger when it was inside.
    const onDocKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) close(!!w?.contains(document.activeElement)); };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (!items) return;
      const xs = list();
      const i = xs.indexOf(document.activeElement as HTMLElement);
      if (e.key === 'Tab') { if (i >= 0) close(true); return; }
      // Space activates a link item as it does a button (instead of scrolling the page).
      if (e.key === ' ' && i >= 0 && xs[i].tagName === 'A') { e.preventDefault(); xs[i].click(); return; }
      const next = e.key === 'ArrowDown' ? xs[(i + 1) % xs.length] : e.key === 'ArrowUp' ? xs[(i - 1 + xs.length) % xs.length]
        : e.key === 'Home' ? xs[0] : e.key === 'End' ? xs.at(-1) : null;
      if (next) { e.preventDefault(); next.focus({ preventScroll: true }); }
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && !w?.contains(to)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onDocKey);
    w?.addEventListener('keydown', onKey);
    w?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onDocKey);
      w?.removeEventListener('keydown', onKey);
      w?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, items, wrap, trigger]);

  /** onKeyDown for the trigger: ArrowDown / ArrowUp open a menu. */
  return (e: React.KeyboardEvent) => {
    if (!items || open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return;
    e.preventDefault();
    startAt.current = e.key === 'ArrowUp' ? 'last' : 'first';
    setOpen(true);
  };
}
