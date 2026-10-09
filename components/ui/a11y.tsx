'use client';
// Keyboard and focus behaviour for dialogs, radio groups and replaced controls (WCAG 2.1.1, 2.4.3, 4.1.2);
// dropdowns use ./popup. Nothing here draws anything: it moves focus, keeps it inside a dialog and gives it
// back when the control that had it is replaced or briefly disabled.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const shown = (el: HTMLElement) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** The keyboard-reachable elements inside `root`, in DOM order. */
export function focusables(root: ParentNode): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(el => !el.hasAttribute('inert') && shown(el));
}

/** Focus `el` after React has committed (the element may only just have been rendered). */
export function focusSoon(get: () => HTMLElement | null | undefined) {
  requestAnimationFrame(() => get()?.focus());
}

/**
 * Radio buttons drawn as `button[role=radio]`: arrow keys move to the next option and select it,
 * and only the selected option is a Tab stop (WAI-ARIA radio group).
 */
export function onRadioKeys(e: ReactKeyboardEvent<HTMLElement>) {
  const next = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
  if (!next) return;
  const radios = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')].filter(r => !(r as HTMLButtonElement).disabled);
  const i = radios.indexOf(document.activeElement as HTMLElement);
  if (i < 0 || radios.length < 2) return;
  e.preventDefault();
  const to = radios[(i + next + radios.length) % radios.length];
  to.focus();
  to.click();
}

/**
 * A modal dialog: focus moves into it when it opens, Tab and Shift+Tab stay inside, Escape closes it,
 * and focus returns to the control that opened it.
 */
export function useModal(open: boolean, close: () => void, dialog: RefObject<HTMLElement | null>) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    focusSoon(() => {
      const d = dialog.current;
      if (!d) return null;
      return d.querySelector<HTMLElement>('[autofocus]') ?? focusables(d).find(el => !el.matches('.blk-x, [data-dialog-close]')) ?? focusables(d)[0] ?? d;
    });
    const onKey = (e: KeyboardEvent) => {
      const d = dialog.current;
      if (!d) return;
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const list = focusables(d);
      if (!list.length) { e.preventDefault(); return; }
      const first = list[0], last = list[list.length - 1];
      const at = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (at === first || !d.contains(at))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (at === last || !d.contains(at))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (opener && opener.isConnected) focusSoon(() => opener);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
}

/**
 * A control that is disabled while its action runs (‹disabled={pending}›) drops keyboard focus to the page.
 * This gives focus back to it once it is enabled again, if nothing else took focus meanwhile.
 * Mounted once per area (partner panel, sign-up wizard).
 */
export function FocusKeeper() {
  useEffect(() => {
    let last: HTMLElement | null = null;
    let parked: HTMLElement | null = null;
    const onFocusIn = (e: FocusEvent) => { last = e.target as HTMLElement; parked = null; };
    const mo = new MutationObserver(records => {
      for (const r of records) {
        const el = r.target as HTMLElement;
        if (r.attributeName !== 'disabled') continue;
        if ((el as HTMLButtonElement).disabled) {
          const at = document.activeElement;
          if (el === last && (at === el || at === document.body || at === null)) parked = el;
        } else if (el === parked) {
          parked = null;
          const at = document.activeElement;
          if (el.isConnected && (at === document.body || at === null || at === el)) el.focus();
        }
      }
    });
    document.addEventListener('focusin', onFocusIn);
    mo.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['disabled'] });
    return () => { document.removeEventListener('focusin', onFocusIn); mo.disconnect(); };
  }, []);
  return null;
}
