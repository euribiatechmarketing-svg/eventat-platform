'use client';
// Rail links and the topbar title follow the current URL.
import { useLayoutEffect, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';

export type RailItem = { label: string; href: string; icon: IconName; count?: number };
export type RailGroup = { label: string; items: RailItem[] };

/** The rail item a path belongs to: exact match for the area home, longest prefix otherwise.
 *  `aliases` maps a path prefix that is not a rail item to the item it belongs under. */
function activeHref(groups: RailGroup[], path: string, home: string, aliases: Record<string, string> = {}): string | null {
  const alias = Object.entries(aliases).filter(([p]) => path === p || path.startsWith(p + '/')).sort((a, b) => b[0].length - a[0].length)[0];
  if (alias) path = alias[1];
  let best: string | null = null;
  for (const g of groups) for (const it of g.items) {
    const hit = it.href === home ? path === home : path === it.href || path.startsWith(it.href + '/');
    if (hit && (!best || it.href.length > best.length)) best = it.href;
  }
  return best;
}

export function RailNav({ groups, home, aliases }: { groups: RailGroup[]; home: string; aliases?: Record<string, string> }) {
  const path = usePathname();
  const active = activeHref(groups, path, home, aliases);
  return (
    <>
      {groups.map((g, gi) => (
        <div key={g.label}>
          <div className={`side-label${gi === 0 ? ' side-label--first' : ''}`}>{g.label}</div>
          <nav className="side-nav">
            {g.items.map(it => (
              <Link key={it.href} className={`side-item${active === it.href ? ' is-active' : ''}`} href={it.href}>
                <Icon name={it.icon} />{it.label}{it.count ? <span className="side-count">{it.count}</span> : null}
              </Link>
            ))}
          </nav>
        </div>
      ))}
    </>
  );
}

/* A page can name itself in the topbar (record pages: ‹Резервация · № 2026-0614-ЕА›). The title
   lives in a tiny store so the shared TopbarTitle re-renders; it applies only on the page that set it. */
type Override = { path: string; text: string; short?: string } | null;
let override: Override = null;
const listeners = new Set<() => void>();
function setOverride(v: Override) { override = v; listeners.forEach(l => l()); }
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const PHONE = '(max-width: 640px)';
const subscribePhone = (l: () => void) => { const mq = window.matchMedia(PHONE); mq.addEventListener('change', l); return () => mq.removeEventListener('change', l); };

/** Sets the topbar title while the page is shown; `short` replaces it on phones. */
export function PageTitle({ text, short }: { text: string; short?: string }) {
  const path = usePathname();
  useLayoutEffect(() => {
    setOverride({ path, text, short });
    return () => { if (override?.path === path && override.text === text) setOverride(null); };
  }, [path, text, short]);
  return null;
}

export function TopbarTitle({ groups, home, titles = {}, aliases }: { groups: RailGroup[]; home: string; titles?: Record<string, string>; aliases?: Record<string, string> }) {
  const path = usePathname();
  const o = useSyncExternalStore(subscribe, () => override, () => null);
  const phone = useSyncExternalStore(subscribePhone, () => window.matchMedia(PHONE).matches, () => false);
  if (o && o.path === path) return <span className="topbar-title">{phone && o.short ? o.short : o.text}</span>;
  const own = Object.entries(titles).filter(([p]) => path === p || path.startsWith(p + '/')).sort((a, b) => b[0].length - a[0].length)[0];
  if (own) return <span className="topbar-title">{own[1]}</span>;
  const active = activeHref(groups, path, home, aliases);
  const label = groups.flatMap(g => g.items).find(i => i.href === active)?.label ?? '';
  return <span className="topbar-title">{label}</span>;
}
