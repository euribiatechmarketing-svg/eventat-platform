'use client';
// The services grid with its toolbar, and ‹Подреди› (reorder mode: drag a card or use the arrows, then save).
import { useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Menu, toast } from '@/components/ui/client';
import { focusSoon } from '@/components/ui/a11y';
import { Num, Segs } from '../_catalogue/num';
import { reorderServicesAction } from './actions';

type Item = {
  id: string; name: string; description: string; kind: string; kindLabel: string; status: string; statusLabel: string;
  price: string | null; bookings: number; inquiries: number; coverUrl: string | null; pendingRevision: boolean;
};

const TONE: Record<string, string> = {
  active: 'badge--success', draft: 'badge--warning', pending_review: 'badge--info', returned: 'badge--danger', ready: 'badge--info', archived: '',
};

export function ServicesBoard({ sub, tabs, categories, categoryLabel, items, order, slug }: {
  sub: string[];
  tabs: { key: string; label: string; count: number; href: string; active: boolean }[];
  categories: { label: string; href: string; active: boolean }[];
  categoryLabel: string;
  items: Item[];
  order: string[];
  slug: string;
}) {
  const router = useRouter();
  const [sorting, setSorting] = useState(false);
  const [list, setList] = useState(items);
  const [drag, setDrag] = useState<number | null>(null);
  const [pending, start] = useTransition();
  const shown = sorting ? list : items;
  const head = useRef<HTMLDivElement>(null);
  const grid = useRef<HTMLDivElement>(null);
  /** ‹Подреди› swaps the buttons in the page head: focus goes to the first of the new ones. */
  const focusHead = () => focusSoon(() => head.current?.querySelector<HTMLElement>('button:not([disabled]), a'));

  const move = (from: number, to: number, dir?: 'left' | 'right') => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    setList(next);
    // The moved card keeps focus on its arrow (or the other one once it reaches an end).
    if (dir) focusSoon(() => {
      const card = grid.current?.querySelector<HTMLElement>(`[data-service="${it.id}"]`);
      const want = card?.querySelector<HTMLButtonElement>(`button[aria-label="Премести ${dir === 'left' ? 'наляво' : 'надясно'}"]`);
      return want && !want.disabled ? want : card?.querySelector<HTMLElement>('.pc-sort button:not([disabled])');
    });
  };
  const startSort = () => { setList(items); setSorting(true); focusHead(); };
  const cancel = () => { setSorting(false); setList(items); toast('Промените са отменени'); focusHead(); };
  const save = () => {
    const visible = new Set(list.map(i => i.id));
    let k = 0;
    const full = order.map(id => (visible.has(id) ? list[k++].id : id));
    start(async () => {
      const r = await reorderServicesAction(full);
      if (!r.ok) { toast(r.error, 'error'); return; }
      toast(r.message);
      setSorting(false);
      focusHead();
      router.refresh();
    });
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Услуги и пакети</h1>
          <p className="page-sub"><Segs parts={sub} /></p>
        </div>
        <div className="page-head-right" ref={head}>
          {sorting ? (
            <>
              <button type="button" className="btn btn--outline btn--sm" onClick={cancel} disabled={pending}>Откажи</button>
              <button type="button" className="btn btn--primary btn--sm" onClick={save} disabled={pending}>Запази промените</button>
            </>
          ) : (
            <>
              <button type="button" className="btn btn--outline btn--sm" onClick={startSort} disabled={items.length < 2}>Подреди</button>
              <Link className="btn btn--primary btn--sm" href="/partner/uslugi/nova">Добави услуга</Link>
            </>
          )}
        </div>
      </div>

      <div className="toolbar">
        <nav className="tab-bar" aria-label="Услуги">
          {tabs.map(t => (
            <Link key={t.key} href={t.href} className={`tab-bar-item${t.active ? ' is-active' : ''}`} aria-current={t.active ? 'page' : undefined}>
              {t.label}{t.count > 0 && <> <span className="tab-count">{t.count}</span></>}
            </Link>
          ))}
        </nav>
        {categories.length > 1 && (
          <div className="toolbar-right">
            <Menu items={categories.map(c => ({ label: c.label, href: c.href }))} trigger={
              <span className="filter-btn">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 5h18M6 12h12M10 19h4" /></svg>
                {categoryLabel}
                <svg className="proto-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 9l6 6 6-6" /></svg>
              </span>
            } />
          </div>
        )}
      </div>

      <div className={`svc-grid${sorting ? ' is-sorting' : ''}`} ref={grid}>
        {shown.length === 0 && <div className="ui-empty pc-empty">Няма записи в този изглед.</div>}
        {shown.map((s, i) => (
          <article key={s.id} className={`svc-card${sorting ? ' pc-sortable' : ''}${drag === i ? ' is-dragging' : ''}`} data-service={s.id}
            draggable={sorting} onDragStart={() => setDrag(i)} onDragEnd={() => setDrag(null)}
            onDragOver={e => { if (sorting) e.preventDefault(); }}
            onDrop={e => { e.preventDefault(); if (drag !== null) move(drag, i); setDrag(null); }}>
            <div className="svc-cover" style={s.coverUrl ? { backgroundImage: `url('${s.coverUrl}')` } : undefined}>
              <span className={`badge ${TONE[s.status] ?? ''} badge--dot`}>{s.statusLabel}</span>
              {sorting && (
                <span className="pc-sort">
                  <button type="button" aria-label="Премести наляво" aria-describedby={`svc-t-${s.id}`} onClick={() => move(i, i - 1, 'left')} disabled={i === 0}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M15 18l-6-6 6-6" /></svg>
                  </button>
                  <button type="button" aria-label="Премести надясно" aria-describedby={`svc-t-${s.id}`} onClick={() => move(i, i + 1, 'right')} disabled={i === shown.length - 1}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
                  </button>
                </span>
              )}
            </div>
            <div className="svc-body">
              <span className="svc-kind">{s.kindLabel}</span>
              <h2 className="svc-title" id={`svc-t-${s.id}`}><Num>{s.name}</Num></h2>
              <p className="svc-text">{s.description}</p>
              <div className="svc-meta">
                <div><div className="svc-meta-v">{s.price ?? '—'}</div><div className="svc-meta-l">{s.price ? 'Цена' : 'По оферта'}</div></div>
                <div><div className="svc-meta-v">{s.bookings}</div><div className="svc-meta-l">Резервации</div></div>
                <div><div className="svc-meta-v">{s.inquiries}</div><div className="svc-meta-l">Запитвания</div></div>
              </div>
              {!sorting && (
                <div className="svc-foot">
                  <Link className="btn btn--outline btn--sm" href={`/partner/uslugi/${s.id}`} aria-describedby={`svc-t-${s.id}`}>Редактирай</Link>
                  <Link className="btn btn--ghost btn--sm" href={`/partnyori/${slug}`} aria-describedby={`svc-t-${s.id}`}>Преглед</Link>
                </div>
              )}
            </div>
          </article>
        ))}
        {!sorting && (
          <Link className="svc-card svc-add" href="/partner/uslugi/nova">
            <span className="svc-add-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 5v14M5 12h14" /></svg></span>
            <span className="svc-add-title">Добави услуга или пакет</span>
            <span className="svc-add-text">Фиксирана цена или „по запитване“ — клиентите виждат само активните.</span>
          </Link>
        )}
      </div>
    </>
  );
}
