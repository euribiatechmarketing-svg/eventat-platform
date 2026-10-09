'use client';
// Small interactive pieces of the public pages: a link that confirms with a toast, the
// ‹Уведоми ме› button, the BG/EN switch, the mobile filter drawer, the price range and the
// legal page's side navigation.
import { useEffect, useId, useRef, useState, useTransition, type MouseEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from '@/components/ui/client';
import { watchDateAction } from '../tarsene/actions';

/** A navigation link whose arrival is confirmed by a toast (‹Разшири датата› → ‹Показваме изпълнители за всяка дата›). */
export function ToastLink({ href, message, className, children }: { href: string; message: string; className?: string; children: ReactNode }) {
  return <Link href={href} className={className} scroll={false} onClick={() => toast(message)}>{children}</Link>;
}

export const WATCH_TOAST = 'Ще ви известим, ако датата се освободи';

/**
 * ‹Уведоми ме› (busy card, inside the card link: it never opens the card) and
 * ‹Уведоми ме, ако се освободи› (profile widget). A guest is sent to sign in and back.
 */
export function NotifyButton({ partnerId, date, sabitieId, signIn, label = 'Уведоми ме', className = 'btn btn--outline btn--sm', onDone }: {
  partnerId: string; date: string; sabitieId?: string | null; signIn: string | null; label?: string; className?: string; onDone?: () => void;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const click = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (signIn) { router.push(signIn); return; }
    start(async () => {
      const r = await watchDateAction({ partnerId, date, sabitieId: sabitieId ?? null, back: window.location.pathname + window.location.search });
      if (r.ok) { toast(WATCH_TOAST); onDone?.(); } else router.refresh();
    });
  };
  return <button type="button" className={className} onClick={click} disabled={pending} aria-busy={pending}>{label}</button>;
}

/** A filter link that reads as a checkbox (role="checkbox"): Space toggles it as Enter does. */
export function CheckLink({ href, checked, className, children }: { href: string; checked: boolean; className?: string; children: ReactNode }) {
  return (
    <Link className={className} href={href} scroll={false} role="checkbox" aria-checked={checked}
      onKeyDown={e => { if (e.key === ' ') { e.preventDefault(); e.currentTarget.click(); } }}>{children}</Link>
  );
}

/** ‹BG› / ‹EN› lives with the site header. */
export { Lang } from '@/components/site/Lang';

/** The facet column; below 960 px it folds behind a ‹Филтри› button. */
export function FiltersPanel({ children, activeCount }: { children: ReactNode; activeCount: number }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const id = useId();
  useEffect(() => { setOpen(false); }, [pathname]);
  return (
    <div className={`pub-filters${open ? ' is-open' : ''}`}>
      <button type="button" className="filter-btn pub-filters-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        Филтри{activeCount ? <span className="pub-filters-n">{activeCount}</span> : null}
        <svg className="proto-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      <aside className="filters" id={id} aria-label="Филтри">{children}</aside>
    </div>
  );
}

/**
 * ‹Цена за събитие›: the two pills (default 400 € — 2 000 €). Changing either applies the range
 * at once (SPEC §13.1 `cena-ot`, `cena-do`).
 */
export function PriceRange({ from, to, baseQuery, basePath }: { from: number; to: number; baseQuery: string; basePath: string }) {
  const router = useRouter();
  const fmt = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0');
  const [lo, setLo] = useState(fmt(from));
  const [hi, setHi] = useState(fmt(to));
  const apply = () => {
    const a = parseInt(lo.replace(/\D/g, ''), 10), b = parseInt(hi.replace(/\D/g, ''), 10);
    if (!Number.isFinite(a) || !Number.isFinite(b)) { setLo(fmt(from)); setHi(fmt(to)); return; }
    if (a === from && b === to) return;
    const u = new URLSearchParams(baseQuery);
    u.set('cena-ot', String(Math.min(a, b)));
    u.set('cena-do', String(Math.max(a, b)));
    router.push(`${basePath}?${u.toString()}`, { scroll: false });
  };
  const field = (v: string, set: (s: string) => void, label: string) => (
    <label className="f-pill">
      <input inputMode="numeric" aria-label={label} value={v}
        style={{ width: `${Math.max(v.replace(/\D/g, '').length, 1) + (v.match(/[\s\u00a0]/g)?.length ?? 0) * 0.4 + 0.1}ch` }}
        onChange={e => set(e.target.value.replace(/[^\d\s\u00a0]/g, ''))}
        onBlur={apply} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }} />
      <span>€</span>
    </label>
  );
  return (
    <div className="f-range">
      {field(lo, setLo, 'Цена от')}
      <span style={{ color: 'var(--neutral-400)' }}>—</span>
      {field(hi, setHi, 'Цена до')}
    </div>
  );
}

/**
 * The legal page's ‹На тази страница›: the section in view is highlighted. A clicked section
 * stays highlighted while it is on screen (the last ones cannot scroll to the top), until the
 * reader scrolls by hand.
 */
export function DocNav({ items, children }: { items: { id: string; label: string }[]; children?: ReactNode }) {
  const [on, setOn] = useState(items[0]?.id);
  const clicked = useRef<string | null>(null);
  useEffect(() => {
    const pick = () => {
      const els = items.map(i => document.getElementById(i.id)).filter(Boolean) as HTMLElement[];
      if (!els.length) return;
      if (clicked.current) {
        const el = document.getElementById(clicked.current);
        const r = el?.getBoundingClientRect();
        if (r && r.top < window.innerHeight && r.bottom > 0) { setOn(clicked.current); return; }
      }
      let cur = els[0].id;
      for (const el of els) if (el.getBoundingClientRect().top <= window.innerHeight * 0.3) cur = el.id;
      setOn(cur);
    };
    const fromHash = () => { const h = decodeURIComponent(window.location.hash.slice(1)); if (items.some(i => i.id === h)) { clicked.current = h; setOn(h); } };
    const byHand = () => { clicked.current = null; };
    fromHash();
    pick();
    window.addEventListener('hashchange', fromHash);
    window.addEventListener('scroll', pick, { passive: true });
    for (const ev of ['wheel', 'touchmove', 'keydown'] as const) window.addEventListener(ev, byHand, { passive: true });
    return () => {
      window.removeEventListener('hashchange', fromHash);
      window.removeEventListener('scroll', pick);
      for (const ev of ['wheel', 'touchmove', 'keydown'] as const) window.removeEventListener(ev, byHand);
    };
  }, [items]);
  return (
    <nav className="doc-nav" aria-labelledby="doc-nav-t">
      <div className="doc-nav-t" id="doc-nav-t">На тази страница</div>
      {items.map(i => (
        <a key={i.id} className={`doc-link${on === i.id ? ' is-on' : ''}`} href={`#${i.id}`} aria-current={on === i.id ? 'location' : undefined} onClick={() => { clicked.current = i.id; setOn(i.id); }}>{i.label}</a>
      ))}
      {children}
    </nav>
  );
}

/** A document link: downloads the file and confirms with ‹Файлът се изтегля›. */
export function DownloadLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="doc-link" href={href} download onClick={() => toast('Файлът се изтегля')}>{children}</a>;
}
