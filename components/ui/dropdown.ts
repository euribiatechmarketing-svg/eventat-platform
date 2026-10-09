'use client';
// Keyboard and focus behaviour of the site's dropdowns, so they work without a mouse (WCAG 2.1.1, 2.4.3):
// a click outside, Escape or Tab leaving the dropdown closes it; Escape puts focus back on the trigger;
// opened from the keyboard, focus moves to the chosen (else the first) item; the arrow keys, Home and End
// move between the items. `menu: true` (role="menu"): the items are out of the Tab order (tabIndex -1) and
// Tab from an item closes the menu, as a menu button does. Radio groups made of buttons get the arrow keys
// and a single Tab stop through `radioKeys` / `radioTab`.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

/** The focusable, visible elements inside `el` (menu items with tabIndex -1 included). */
export function focusablesIn(el: HTMLElement | null | undefined): HTMLElement[] {
  if (!el) return [];
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(x => x.getClientRects().length > 0 && !x.closest('[hidden]'));
}

const chosen = (xs: HTMLElement[]) =>
  xs.find(x => x.getAttribute('aria-current') === 'true' || x.getAttribute('aria-current') === 'page' || x.getAttribute('aria-checked') === 'true');

export function useDropdown({ open, setOpen, wrap, trigger, panel, menu = false }: {
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Holds the trigger and the panel: focus or a click inside it keeps the dropdown open. */
  wrap: RefObject<HTMLElement | null>;
  /** Where focus returns. */
  trigger: RefObject<HTMLElement | null>;
  panel: RefObject<HTMLElement | null>;
  menu?: boolean;
}) {
  const set = useRef(setOpen);
  set.current = setOpen;
  /** Set by the trigger before it opens the dropdown from the keyboard: focus goes into the panel. */
  const fromKeyboard = useRef<false | 'first' | 'last'>(false);

  useEffect(() => {
    if (!open) return;
    const w = wrap.current;
    if (fromKeyboard.current) {
      const xs = focusablesIn(panel.current);
      const at = fromKeyboard.current === 'last' ? xs.at(-1) : chosen(xs) ?? xs[0];
      fromKeyboard.current = false;
      at?.focus({ preventScroll: true });
    }
    const close = (back: boolean) => { set.current(false); if (back) trigger.current?.focus({ preventScroll: true }); };
    const onDown = (e: MouseEvent) => { if (!w?.contains(e.target as Node)) close(false); };
    const onKey = (e: KeyboardEvent) => {
      // preventDefault marks the Escape as used, so an outer layer (the phone drawer) stays open.
      if (e.key === 'Escape') { e.preventDefault(); close(!!w?.contains(document.activeElement)); return; }
      if (menu && e.key === 'Tab' && panel.current?.contains(document.activeElement)) close(false);
    };
    const onFocusOut = (e: FocusEvent) => {
      const to = e.relatedTarget as Node | null;
      if (to && !w?.contains(to)) close(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    w?.addEventListener('focusout', onFocusOut);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      w?.removeEventListener('focusout', onFocusOut);
    };
  }, [open, menu, wrap, trigger, panel]);

  /** onKeyDown for a trigger that is not a native button: Enter / Space toggle; ArrowDown / ArrowUp open. */
  const onTriggerKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!open) fromKeyboard.current = 'first';
      set.current(!open);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (open) {
        const xs = focusablesIn(panel.current);
        (e.key === 'ArrowUp' ? xs.at(-1) : chosen(xs) ?? xs[0])?.focus({ preventScroll: true });
        return;
      }
      fromKeyboard.current = e.key === 'ArrowUp' ? 'last' : 'first';
      set.current(true);
    }
  };
  /** onClick for a native <button> trigger: a click from the keyboard (detail 0) moves focus into the panel. */
  const onTriggerClick = (e: { detail: number }) => {
    if (!open && e.detail === 0) fromKeyboard.current = 'first';
    set.current(!open);
  };
  return { onTriggerKey, onTriggerClick, onPanelKey: arrowKeys };
}

/** ArrowDown / ArrowUp / Home / End move focus between the items of a list (not inside a text or date field). */
export function arrowKeys(e: ReactKeyboardEvent<HTMLElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
  const t = e.target as HTMLElement;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return;
  const xs = focusablesIn(e.currentTarget);
  if (!xs.length) return;
  e.preventDefault();
  const i = xs.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? xs.length - 1
    : e.key === 'ArrowDown' ? (i + 1) % xs.length : (i - 1 + xs.length) % xs.length;
  xs[next].focus({ preventScroll: true });
}

/**
 * onKeyDown for a role="radiogroup" of role="radio" buttons: the arrow keys move to the previous / next
 * option and choose it (as native radios do), Home / End to the first / last.
 */
export function radioKeys(e: ReactKeyboardEvent<HTMLElement>) {
  const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
  if (!step && e.key !== 'Home' && e.key !== 'End') return;
  const xs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')).filter(x => !x.hasAttribute('disabled'));
  if (!xs.length) return;
  e.preventDefault();
  const i = xs.indexOf(document.activeElement as HTMLElement);
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? xs.length - 1 : (Math.max(i, 0) + step + xs.length) % xs.length;
  xs[next].focus();
  xs[next].click();
}

/** tabIndex of a role="radio" button: one Tab stop per group, on the checked option (else the first). */
export const radioTab = (checked: boolean, index: number, anyChecked: boolean) => (checked || (!anyChecked && index === 0) ? 0 : -1);
