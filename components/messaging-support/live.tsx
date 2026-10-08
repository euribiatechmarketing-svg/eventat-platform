'use client';
// Live pieces of the messages screens: refresh every 15 s, mark the shown thread read,
// keep the thread scrolled to the newest message, filter the list by URL (?q=).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

/** New messages arrive without a reload: re-render the server page every `ms` while the tab is visible. */
export function Poll({ ms = 15_000 }: { ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, ms);
    const onVisible = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [router, ms]);
  return null;
}

/**
 * The list page shows the newest conversation beside the list on wide screens (client/messages.html).
 * When that pane is actually on screen, open it properly — `/…/saobshteniya/[id]`, which marks it read
 * (`messages.markRead()`). On phones the pane is hidden and only the list shows, so nothing is read unseen.
 */
export function OpenWhenShown({ href }: { href: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const router = useRouter();
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || el.offsetParent === null || getComputedStyle(el).display === 'none') return;
    router.replace(href, { scroll: false });
  }, [href, router]);
  return <span ref={ref} hidden />;
}

/** The scrolling message area; follows the newest message. */
export function ThreadBody({ className, lastId, children }: { className: string; lastId: string | null; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastId]);
  return <div className={className} ref={ref}>{children}</div>;
}

/** ‹Търсене по изпълнител или събитие›: filters the list through ?q= (shareable), keeping other params. */
export function ListSearch({ className, placeholder }: { className: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get('q') ?? '');
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const apply = (v: string) => {
    const p = new URLSearchParams(params.toString());
    if (v.trim()) p.set('q', v.trim()); else p.delete('q');
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  return (
    <form className={className} role="search" onSubmit={e => { e.preventDefault(); clearTimeout(timer.current); apply(value); }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4.2-4.2" /></svg>
      <input type="search" name="q" value={value} placeholder={placeholder} aria-label={placeholder} autoComplete="off"
        onChange={e => { const v = e.target.value; setValue(v); clearTimeout(timer.current); timer.current = setTimeout(() => apply(v), 300); }} />
    </form>
  );
}

/** Time left to a deadline, ticking every 30 s (‹10 мин›, ‹23 ч 12 мин›, ‹2 дни›). */
export function TimeLeft({ dueAt, serverNow }: { dueAt: string; serverNow: string }) {
  // Business time comes from the server clock (lib/clock); keep its offset from the browser's.
  const [offset] = useState(() => new Date(serverNow).getTime() - Date.now());
  const [nowMs, setNowMs] = useState(() => new Date(serverNow).getTime());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now() + offset), 30_000);
    return () => clearInterval(t);
  }, [offset]);
  const mins = Math.max(0, Math.round((new Date(dueAt).getTime() - nowMs) / 60_000));
  const h = Math.floor(mins / 60), m = mins % 60;
  const text = h >= 48 ? `${Math.floor(h / 24)} дни` : h ? `${h} ч ${m} мин` : `${m} мин`;
  return <>{text}</>;
}
