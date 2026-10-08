'use client';
// Small client-side pieces shared by every area: toasts, dropdown menus,
// the menu button that opens the nav/rail on small screens, flash messages.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';

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
  trigger: ReactNode; items?: MenuItem[]; children?: ReactNode; align?: 'down' | 'up'; className?: string; wide?: boolean; label?: string;
} & { children?: ReactNode }) {
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
    <span ref={ref} className={`ui-menu-wrap ${className}`}>
      <span role="button" tabIndex={0} aria-haspopup="menu" aria-expanded={open} aria-label={label}
        onClick={() => setOpen(o => !o)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpen(o => !o); } }}
        style={{ display: 'contents' }}>
        {trigger}
      </span>
      {open && (
        <div className={`ui-menu ui-menu--${align}${wide ? ' ui-menu--wide' : ''}`} role="menu">
          {items?.map((it, i) => it === null ? <hr key={i} /> : it.href
            ? <Link key={i} href={it.href} role="menuitem" onClick={() => setOpen(false)}>{it.label}</Link>
            : <button key={i} type="button" className="ui-menu-item" role="menuitem" onClick={() => { setOpen(false); it.onSelect?.(); }}>{it.label}</button>)}
        </div>
      )}
    </span>
  );
}

/* ---------- menu button for small screens ---------- */
export function Burger({ target }: { target: 'nav' | 'shell' }) {
  return (
    <button type="button" className="ui-burger" aria-label="Меню"
      onClick={e => (e.currentTarget.closest(target === 'nav' ? '.nav' : '.shell') as HTMLElement | null)?.classList.toggle('is-open')}>
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
