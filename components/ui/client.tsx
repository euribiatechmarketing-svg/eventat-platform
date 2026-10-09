'use client';
// Small client-side pieces shared by every area: toasts, dropdown menus,
// the menu button that opens the nav/rail on small screens, flash messages.
import { cloneElement, isValidElement, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import Link from 'next/link';
import { Icon } from './Icon';
import { useDropdown } from './dropdown';

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

/**
 * A menu button (WAI-ARIA menu button). The trigger element itself becomes the button: it gets the role,
 * the Tab stop (so its focus ring shows), the state and the keys. Its accessible name is its own text, or
 * its own `aria-label` when that text alone does not say what it opens; `label` names the menu.
 */
export function Menu({ trigger, items, align = 'down', className = '', wide = false, label }: {
  trigger: ReactNode; items?: MenuItem[]; children?: ReactNode; align?: 'down' | 'up'; className?: string; wide?: boolean; label?: string;
} & { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  const { onTriggerKey, onPanelKey } = useDropdown({ open, setOpen, wrap: ref, trigger: btn, panel, menu: true });
  const props = {
    ref: btn, role: 'button', tabIndex: 0, 'aria-haspopup': 'menu' as const, 'aria-expanded': open, 'aria-controls': open ? id : undefined,
    onClick: () => setOpen(!open), onKeyDown: onTriggerKey,
  };
  return (
    <span ref={ref} className={`ui-menu-wrap ${className}`}>
      {isValidElement(trigger)
        ? cloneElement(trigger as ReactElement<Record<string, unknown>>, props)
        : <span {...props} aria-label={label}>{trigger}</span>}
      {open && (
        <div ref={panel} id={id} className={`ui-menu ui-menu--${align}${wide ? ' ui-menu--wide' : ''}`} role="menu" aria-label={label} onKeyDown={onPanelKey}>
          {items?.map((it, i) => it === null ? <hr key={i} /> : it.href
            ? <Link key={i} href={it.href} role="menuitem" tabIndex={-1} onClick={() => setOpen(false)}
                onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}>{it.label}</Link>
            : <button key={i} type="button" className="ui-menu-item" role="menuitem" tabIndex={-1} onClick={() => { setOpen(false); btn.current?.focus(); it.onSelect?.(); }}>{it.label}</button>)}
        </div>
      )}
    </span>
  );
}

/* ---------- menu button for small screens ---------- */
/**
 * Opens the client nav / the panel rail on small screens. Its expanded state follows the `is-open` class
 * (DrawerAutoClose closes the drawer too); Escape closes the drawer and brings focus back here.
 */
export function Burger({ target }: { target: 'nav' | 'shell' }) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const host = () => btn.current?.closest(target === 'nav' ? '.nav' : '.shell') as HTMLElement | null;
  useEffect(() => {
    const h = host();
    if (!h) return;
    const mo = new MutationObserver(() => setOpen(h.classList.contains('is-open')));
    mo.observe(h, { attributes: true, attributeFilter: ['class'] });
    return () => mo.disconnect();
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    // On window, so it runs after a menu, the bell or the search suggestions inside the drawer have
    // handled the same Escape: one Escape closes only the innermost layer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const h = host();
      const inside = !!h?.contains(document.activeElement);
      h?.classList.remove('is-open');
      if (inside) btn.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button ref={btn} type="button" className="ui-burger" aria-label="Меню" aria-expanded={open}
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
