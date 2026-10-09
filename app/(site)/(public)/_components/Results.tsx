// Shared pieces of the result pages (/tarsene, /kategorii/[slug]): the partner card, the
// active-filter chips, the sort menu, the facet column, the zero state and the CTA block.
import Link from 'next/link';
import { Menu } from '@/components/ui/client';
import type { Card, SearchResult } from '@/lib/domain/search';
import { watchDatesAction } from '../tarsene/actions';
import { ChatIcon, Close, SearchIcon, ShieldCheck, Stars } from './icons';
import { CheckLink, FiltersPanel, NotifyButton, PriceRange, ToastLink } from './client';
import { Num } from './text';

export type Viewer = { kind: 'guest' | 'client' | 'other'; signIn: string; register: (href: string) => string };

/**
 * `a.v-card` (client/catalog.html). A card busy on the chosen date is greyed and offers ‹Уведоми ме›,
 * unless the date is held by the client's own booking with that partner (`ownBooking`).
 */
export function VCard({ c, date, sabitieId, viewer, ownBooking = false }: { c: Card; date: string | null; sabitieId: string | null; viewer: Viewer; ownBooking?: boolean }) {
  // The profile's widget opens on the date (and the event) the search is for.
  const q = new URLSearchParams();
  if (date) q.set('data', date);
  if (sabitieId) q.set('sabitie-id', sabitieId);
  const href = q.toString() ? `${c.href}?${q}` : c.href;
  const notify = !!(c.busy && date && viewer.kind !== 'other' && !ownBooking);
  const body = (
    <>
      <span className="v-cover" style={c.coverUrl ? { backgroundImage: `url('${c.coverUrl}')` } : undefined}>
        {c.verified && <span className="v-tag"><ShieldCheck />Проверен</span>}
      </span>
      <span className="v-body">
        <span className="v-cat">{c.categoryName}</span>
        <span className="v-name"><Num>{c.name}</Num></span>
        <span className="v-loc">{c.location}</span>
        {c.ratingText && (
          <span className="v-rate"><Stars className="v-stars" n={Math.round(c.ratingAvg ?? 0)} /><b>{c.ratingText}</b> · {c.reviewsLabel}</span>
        )}
        {c.fromPrice && (
          <span className="v-foot"><span className="v-price">{c.fromPrice.text}<small>{c.fromPrice.unitLabel}</small></span></span>
        )}
        {c.busy && date && (
          <span className="v-busy">
            <span className="badge badge--danger badge--dot">{c.busyLabel}</span>
            {notify && (
              <NotifyButton partnerId={c.partnerId} date={date} sabitieId={sabitieId} signIn={viewer.kind === 'guest' ? viewer.signIn : null} />
            )}
          </span>
        )}
      </span>
    </>
  );
  // ‹Уведоми ме› cannot sit inside the card's link (a button in a link is lost to keyboard and screen
  // reader users): that card is a box with its link stretched over it and the button above the link.
  if (notify) {
    return (
      <div className={`v-card v-card--split${c.busy ? ' is-off' : ''}`}>
        <a className="v-card-link" href={href} aria-label={c.name} />
        {body}
      </div>
    );
  }
  return <a className={`v-card${c.busy ? ' is-off' : ''}`} href={href}>{body}</a>;
}

/** The active filters, each removable on its own, and ‹Изчисти филтрите›. */
export function Chips({ chips, clearHref }: { chips: { label: string; href: string }[]; clearHref: string }) {
  if (!chips.length) return null;
  return (
    <div className="ui-chips">
      {chips.map(ch => (
        <Link key={ch.label + ch.href} className="ui-chip" href={ch.href} scroll={false} aria-label={`${ch.label} ×`}>
          <span>{ch.label}</span><Close />
        </Link>
      ))}
      <Link className="ui-chip-clear" href={clearHref} scroll={false}>Изчисти филтрите</Link>
    </div>
  );
}

/** ‹Подреди: Препоръчани› with its chevron; the options are links. */
export function Sort({ r }: { r: SearchResult }) {
  return (
    <Menu label="Подреди" align="down" className="pub-sort" items={r.sorts.map(s => ({ label: s.label, href: s.href }))}
      trigger={<span className="sort ui-click">{r.sortLabel} <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span>} />
  );
}

/** The facet column (catalog.html `aside.filters`): counts under every other active group (D43). */
export function Facets({ r, basePath, baseQuery }: { r: SearchResult; basePath: string; baseQuery: string }) {
  const f = r.facets;
  const group = (title: string, items: SearchResult['facets']['types'], n: number) => (
    <div className="f-group" role="group" aria-labelledby={`f-title-${n}`}>
      <div className="f-title" id={`f-title-${n}`}>{title}</div>
      {items.map(it => (
        <CheckLink key={it.value} className="f-item" href={it.href} checked={it.active}>
          <span className={`f-box${it.active ? ' is-on' : ''}`} />{it.label}<span className="f-count">{it.count}</span>
        </CheckLink>
      ))}
    </div>
  );
  const priceQuery = new URLSearchParams(baseQuery);
  priceQuery.delete('cena-ot'); priceQuery.delete('cena-do');
  const active = [...f.types, ...f.cities, ...f.ratings, ...f.policies, ...f.others].filter(x => x.active).length + (f.price.active ? 1 : 0);
  return (
    <FiltersPanel activeCount={active}>
      {group('Тип събитие', f.types, 1)}
      {group('Град', f.cities, 2)}
      <div className="f-group" role="group" aria-labelledby="f-title-3">
        <div className="f-title" id="f-title-3">Цена за събитие</div>
        <PriceRange key={`${f.price.from}-${f.price.to}`} from={f.price.from} to={f.price.to} basePath={basePath} baseQuery={priceQuery.toString()} />
      </div>
      {group('Рейтинг', f.ratings, 4)}
      {group('Политика за анулиране', f.policies, 5)}
      {/* ‹Предлагат друга дата› means something only once a date is chosen (§13.4). */}
      {group('Други', f.others.filter(o => o.value !== 'druga-data' || !!r.params.data), 6)}
    </FiltersPanel>
  );
}

/** The zero state (§13.6): what emptied the list, and buttons that undo just that. */
export function Zero({ r, qs, back, viewer, watchable = true }: { r: SearchResult; qs: string; back: string; viewer: Viewer; watchable?: boolean }) {
  const z = r.zero!;
  return (
    <div className="empty">
      <span className="empty-icon"><SearchIcon style={{ width: 22, height: 22 }} /></span>
      <h2 className="empty-title t-h3">{z.title}</h2>
      <p className="empty-text">{z.text}</p>
      <div className="card-footer" style={{ justifyContent: 'center', marginTop: 0 }}>
        {z.buttons.map(b => {
          const cls = `btn ${b.kind === 'widen_date' ? 'btn--primary' : 'btn--outline'}`;
          if (b.kind === 'widen_date' || b.kind === 'other_city') return <ToastLink key={b.kind} className={cls} href={b.href!} message={b.toast!}>{b.label}</ToastLink>;
          if (b.kind === 'brief') return viewer.kind === 'other' ? null : <Link key={b.kind} className={cls} href={viewer.kind === 'guest' ? viewer.register(b.href!) : b.href!}>{b.label}</Link>;
          if (viewer.kind === 'other') return null;
          if (viewer.kind === 'guest') return <Link key={b.kind} className={cls} href={viewer.signIn}>{b.label}</Link>;
          // Only the client's own bookings hold the date: there is nothing to be told about.
          if (!watchable) return null;
          return (
            <form key={b.kind} action={watchDatesAction}>
              <input type="hidden" name="qs" value={qs} />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className={cls}>{b.label}</button>
            </form>
          );
        })}
      </div>
    </div>
  );
}

/** ‹Не намирате точно това, което търсите?› (only with results; never together with the zero state). */
export function Cta({ r, viewer }: { r: SearchResult; viewer: Viewer }) {
  const c = r.cta!;
  return (
    <div className="empty empty--cta">
      <span className="empty-icon"><ChatIcon style={{ width: 22, height: 22 }} /></span>
      <h2 className="empty-title t-h3">{c.title}</h2>
      <p className="empty-text">{c.text}</p>
      <div className="card-footer" style={{ justifyContent: 'center', marginTop: 0 }}>
        {viewer.kind !== 'other' && <Link className="btn btn--primary" href={viewer.kind === 'guest' ? viewer.register(c.briefHref) : c.briefHref}>Изпрати запитване</Link>}
        {c.eventType && <Link className="btn btn--outline" href={c.eventType.href}>{c.eventType.label}</Link>}
      </div>
    </div>
  );
}
