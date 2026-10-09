'use client';
// Small client-side pieces shared by every area: toasts, dropdown menus,
// the menu button that opens the nav/rail on small screens, flash messages.
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { usePopup } from './popup';

/* ---------- toasts ---------- */
type ToastKind = 'ok' | 'error';
export function toast(message: string, kind: ToastKind = 'ok') {
  window.dispatchEvent(new CustomEvent('eventat:toast', { detail: { message, kind } }));
}

export function Toaster() {
  const [t, setT] = useState<{ message: string; kind: ToastKind; id: number } | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { message: string; kind: ToastKind };
      setT({ ...d, id: Date.now() });
      clearTimeout(timer);
      timer = setTimeout(() => setT(null), 3200);
    };
    window.addEventListener('eventat:toast', on);
    return () => { window.removeEventListener('eventat:toast', on); clearTimeout(timer); };
  }, []);
  return (
    <div className={`ui-toast${t ? ' is-on' : ''}${t?.kind === 'error' ? ' ui-toast--error' : ''}`} role="status" aria-live="polite">
      {t && <Icon name={t.kind === 'error' ? 'alert' : 'check'} />}
      <span>{t?.message}</span>
    </div>
  );
}

/** Shows a one-time message set by a server action (lib/flash.ts) and clears it. */
export function FlashToast({ message, kind = 'ok' }: { message: string | null; kind?: ToastKind }) {
  useEffect(() => {
    if (!message) return;
    toast(message, kind);
    document.cookie = 'flash=; Max-Age=0; path=/';
  }, [message, kind]);
  return null;
}

/* ---------- dropdown menu ---------- */
export type MenuItem = { label: string; href?: string; onSelect?: () => void | Promise<void> } | null;

export function Menu({ trigger, items, align = 'down', className = '', wide = false, label }: {
  trigger: ReactNode; items?: MenuItem[]; children?: ReactNode; align?: 'down' | 'up'; className?: string; wide?: boolean;
  /** Accessible name of the trigger; leave it out when the trigger shows text (the name must contain it). */
  label?: string;
} & { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLSpanElement>(null);
  const id = useId();
  const onArrow = usePopup({ open, setOpen, wrap: ref, trigger: btn, items: true });
  // The trigger element itself becomes the button (a display: contents wrapper can take no focus).
  const props = {
    ref: btn, role: 'button', tabIndex: 0, 'aria-haspopup': 'menu' as const, 'aria-expanded': open, 'aria-controls': open ? id : undefined, 'aria-label': label,
    onClick: () => setOpen(o => !o),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } else onArrow(e); },
  };
  return (
    <span ref={ref} className={`ui-menu-wrap ${className}`}>
      {isValidElement(trigger) ? cloneElement(trigger as ReactElement<Record<string, unknown>>, props) : <span {...props}>{trigger}</span>}
      {open && (
        <div id={id} className={`ui-menu ui-menu--${align}${wide ? ' ui-menu--wide' : ''}`} role="menu">
          {items?.map((it, i) => it === null ? <hr key={i} /> : it.href
            ? <Link key={i} href={it.href} role="menuitem" tabIndex={-1} onClick={() => setOpen(false)}>{it.label}</Link>
            : <button key={i} type="button" className="ui-menu-item" role="menuitem" tabIndex={-1} onClick={() => { setOpen(false); it.onSelect?.(); }}>{it.label}</button>)}
        </div>
      )}
    </span>
  );
}

/* ---------- menu button for small screens ---------- */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Burger({ target }: { target: 'nav' | 'shell' }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const host = () => ref.current?.closest(target === 'nav' ? '.nav' : '.shell') as HTMLElement | null;
  // The drawer is opened here and closed here, by DrawerAutoClose (a link, the backdrop) or by Escape.
  useEffect(() => {
    const h = host();
    if (!h) return;
    const mo = new MutationObserver(() => setOpen(h.classList.contains('is-open')));
    mo.observe(h, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    const h = host();
    // The panel rail is a modal drawer over a backdrop: focus moves into it and stays there until it closes.
    const panel = target === 'shell' ? h?.querySelector<HTMLElement>('.side') : null;
    const inPanel = () => [...(panel?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])].filter(x => x.getClientRects().length);
    if (panel) requestAnimationFrame(() => inPanel()[0]?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) { h?.classList.remove('is-open'); ref.current?.focus(); return; }
      if (e.key !== 'Tab' || !panel) return;
      const xs = inPanel();
      if (!xs.length) return;
      const i = xs.indexOf(document.activeElement as HTMLElement);
      if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === xs.length - 1)) {
        e.preventDefault();
        (e.shiftKey ? xs[xs.length - 1] : xs[0]).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button ref={ref} type="button" className="ui-burger" aria-label="Меню" aria-expanded={open}
      onClick={() => host()?.classList.toggle('is-open')}>
      <Icon name="menu" />
    </button>
  );
}

/** Closes the open nav/rail drawer after navigating. */
export function DrawerAutoClose() {
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest('a');
      if (!a) return;
      document.querySelectorAll('.nav.is-open, .shell.is-open').forEach(el => el.classList.remove('is-open'));
    };
    const onBackdrop = (e: MouseEvent) => {
      const shell = document.querySelector('.shell.is-open');
      if (shell && !(e.target as HTMLElement).closest('.side, .ui-burger')) shell.classList.remove('is-open');
    };
    document.addEventListener('click', onClick);
    document.addEventListener('click', onBackdrop);
    return () => { document.removeEventListener('click', onClick); document.removeEventListener('click', onBackdrop); };
  }, []);
  return null;
}
