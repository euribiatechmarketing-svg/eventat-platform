'use client';
// Rail links and the topbar title follow the current URL.
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon, type IconName } from '@/components/ui/Icon';

export type RailItem = { label: string; href: string; icon: IconName; count?: number };
export type RailGroup = { label: string; items: RailItem[] };

/** The rail item a path belongs to: exact match for the area home, longest prefix otherwise. */
function activeHref(groups: RailGroup[], path: string, home: string): string | null {
  let best: string | null = null;
  for (const g of groups) for (const it of g.items) {
    const hit = it.href === home ? path === home : path === it.href || path.startsWith(it.href + '/');
    if (hit && (!best || it.href.length > best.length)) best = it.href;
  }
  return best;
}

export function RailNav({ groups, home }: { groups: RailGroup[]; home: string }) {
  const path = usePathname();
  const active = activeHref(groups, path, home);
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

export function TopbarTitle({ groups, home, titles = {} }: { groups: RailGroup[]; home: string; titles?: Record<string, string> }) {
  const path = usePathname();
  const own = Object.entries(titles).filter(([p]) => path === p || path.startsWith(p + '/')).sort((a, b) => b[0].length - a[0].length)[0];
  if (own) return <span className="topbar-title">{own[1]}</span>;
  const active = activeHref(groups, path, home);
  const label = groups.flatMap(g => g.items).find(i => i.href === active)?.label ?? '';
  return <span className="topbar-title">{label}</span>;
}
