// Markup pieces the client-booking screens share, ported from the prototype
// (crumb chevron, star row, the partner block at the top of `.sum`, the
// toolbar tabs). Server components: no state.
import Link from 'next/link';
import type { ReactNode } from 'react';
import type { PartnerCard } from '@/lib/domain/views-client-booking';
import { FilterMenu, type FilterOption } from './FilterMenu';

export const STAR = 'M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.8 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3z';

export function Chevron() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>;
}

export function Crumbs({ items }: { items: { label: string; href?: string }[] }) {
  return (
    <div className="crumbs">
      {items.map((it, i) => (
        <span key={i} className="cb-crumb">
          {i > 0 && <Chevron />}
          {it.href ? <Link href={it.href}>{it.label}</Link> : <span>{it.label}</span>}
        </span>
      ))}
    </div>
  );
}

export function Stars({ n = 5 }: { n?: number }) {
  return (
    <span className="v-stars">
      {Array.from({ length: n }, (_, i) => <svg key={i} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={STAR} /></svg>)}
    </span>
  );
}

/** `.sum-v`: photo, name, ‹DJ и озвучаване · София›, rating (when there are reviews). */
export function PartnerSum({ p, withRating = true }: { p: PartnerCard; withRating?: boolean }) {
  return (
    <div className="sum-v">
      <span className="sum-v-img" style={p.thumb ? { backgroundImage: `url('${p.thumb}')` } : undefined} />
      <div>
        <div className="sum-v-n">{p.name}</div>
        <div className="sum-v-c">{[p.category, p.cityName].filter(Boolean).join(' · ')}</div>
        {withRating && p.rating && <div className="v-rate" style={{ marginTop: 5 }}><Stars /><b>{p.rating}</b></div>}
      </div>
    </div>
  );
}

const keep = (base: string, params: Record<string, string | null | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `${base}?${s}` : base;
};
export { keep as withParams };

/** The ‹Заявки› / ‹Резервации› toolbar with the event filter (and the status filter on requests). */
export function AccountToolbar({ active, counts, events, eventId, status, statusOptions }: {
  active: 'requests' | 'bookings';
  counts: { requests: number; bookings: number };
  events: { id: string; label: string }[];
  eventId: string | null;
  status?: string;
  statusOptions?: readonly { value: string; label: string }[];
}) {
  const base = active === 'requests' ? '/akaunt/zayavki' : '/akaunt/rezervacii';
  const eventOptions: FilterOption[] = [
    { label: 'Всички събития', href: keep(base, { status }), active: !eventId },
    ...events.map(e => ({ label: e.label, href: keep(base, { 'sabitie-id': e.id, status }), active: e.id === eventId })),
  ];
  const eventLabel = events.find(e => e.id === eventId)?.label ?? 'Всички събития';
  return (
    <div className="toolbar">
      <nav className="tab-bar">
        <Link className={`tab-bar-item${active === 'requests' ? ' is-active' : ''}`} href={keep('/akaunt/zayavki', { 'sabitie-id': eventId })} aria-current={active === 'requests' ? 'page' : undefined}>
          Заявки<span className="tab-count">{counts.requests}</span>
        </Link>
        <Link className={`tab-bar-item${active === 'bookings' ? ' is-active' : ''}`} href={keep('/akaunt/rezervacii', { 'sabitie-id': eventId })} aria-current={active === 'bookings' ? 'page' : undefined}>
          Резервации<span className="tab-count">{counts.bookings}</span>
        </Link>
      </nav>
      <div className="toolbar-right">
        <FilterMenu icon="calendar" label={eventLabel} options={eventOptions} />
        {statusOptions && (
          <FilterMenu icon="status" label={statusOptions.find(s => s.value === (status ?? ''))?.label ?? statusOptions[0].label}
            options={statusOptions.map(s => ({ label: s.label, href: keep(base, { 'sabitie-id': eventId, status: s.value }), active: s.value === (status ?? '') }))} />
        )}
      </div>
    </div>
  );
}

export function MineGroup({ tone, title, count, hint, children, style }: { tone?: 'pay' | 'wait'; title: string; count: number; hint: string; children: ReactNode; style?: React.CSSProperties }) {
  return (
    <section className={`mine${tone ? ` mine--${tone}` : ''}`} style={style}>
      <div className="mine-head">
        <span className="mine-t">{title}</span>
        <span className="mine-c">{count}</span>
        <span className="mine-hint">{hint}</span>
      </div>
      {children}
    </section>
  );
}

/** Digits inside display-font headings go in `.num` (CLAUDE.md): ‹Коледно меню за <span class="num">40</span> гости›. */
export function Num({ children }: { children: string }) {
  const out: ReactNode[] = [];
  children.split(/(\d[\d  .,:–-]*\d|\d)/).forEach((part, i) => {
    if (!part) return;
    out.push(/^\d/.test(part) ? <span key={i} className="num">{part}</span> : part);
  });
  return <>{out}</>;
}
