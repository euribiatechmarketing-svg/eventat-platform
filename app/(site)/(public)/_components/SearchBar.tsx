'use client';
// The search bar (client/search.html, catalog.html, category.html, event-type.html):
// the query cell with its suggestion panel (SPEC §13.7) and the dropdown cells
// (‹Локация›, ‹Дата›, ‹Гости›, ‹Тип събитие›). Every choice is a GET parameter, so each
// change re-queries at once and the URL describes the view (§13.1). The page gives this
// component a `key` per URL, so it starts fresh after every navigation.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/client';
import type { SuggestRow } from '@/lib/domain/search';
import { recordQueryAction, suggestAction } from '../tarsene/actions';

export type BarOption = { label: string; href: string; on?: boolean };
export type BarMenu = {
  label: string; value: string; empty: boolean; options: BarOption[];
  /** ‹Дата›: a calendar for any day besides the listed ones. */
  date?: { min: string; value: string | null; basePath: string; baseQuery: string };
};
export type QueryCell = {
  label: string; placeholder: string; icon: boolean;
  /** The text shown at first: the query, or the name of the chosen category. */
  text: string;
  /** The category the field is showing (picked from the panel, or the page's own). */
  picked: { slug: string; name: string } | null;
  /** Params kept when the query runs (everything but q / kategoriya / vid). */
  baseQuery: string;
  /** `vid` belongs to the chosen category; kept only while that category stays. */
  vid: string | null;
  /** Where a run goes (`/tarsene`; picking a category from the panel runs it too). */
  submitPath: string;
  /** The chosen date, for ‹свободен / зает на …› in the panel. */
  date: string | null;
  /** ‹Опишете събитието си› (a guest is sent to sign up first). */
  briefHref: string;
  /** A signed-in client: runs are written to the search history. */
  record: boolean;
};

/** Two URLs describe the same view: same path, same parameters in any order. */
function sameView(a: string, b: string): boolean {
  const u = new URL(a, 'http://x'), v = new URL(b, 'http://x');
  const norm = (x: URL) => [...x.searchParams.entries()].map(([k, val]) => `${k}=${val}`).sort().join('&');
  return u.pathname === v.pathname && norm(u) === norm(v);
}

const CHEVRON = <svg className="sb-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>;

function useOutside(open: boolean, close: () => void) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const on = (e: MouseEvent | globalThis.KeyboardEvent) => {
      if (e instanceof globalThis.KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener('mousedown', on);
    document.addEventListener('keydown', on);
    return () => { document.removeEventListener('mousedown', on); document.removeEventListener('keydown', on); };
  }, [open, close]);
  return ref;
}

/** A dropdown cell: label, value, chevron; the options are links. */
function MenuCell({ m }: { m: BarMenu }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const ref = useOutside(open, () => setOpen(false));
  const toggle = () => setOpen(o => !o);
  return (
    <span ref={ref} className="ui-anchor ui-anchor--block">
      <div className={`sb-cell ui-click${open ? ' is-open' : ''}`} role="button" tabIndex={0} aria-haspopup="menu" aria-expanded={open}
        onClick={toggle} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}>
        <div className="sb-l">{m.label}</div>
        <div className={`sb-v${m.empty ? ' is-empty' : ''}`}>{m.value}</div>
        {CHEVRON}
      </div>
      <div className="ui-menu ui-menu--down ui-bar-menu" role="menu" hidden={!open}>
        {m.options.map(o => (
          <Link key={o.href + o.label} href={o.href} scroll={false} role="menuitem" className={o.on ? 'is-on' : undefined} onClick={() => setOpen(false)}>{o.label}</Link>
        ))}
        {m.date && (
          <>
            {m.options.length > 0 && <hr />}
            <input className="fld-i sb-date" type="date" aria-label={m.label} min={m.date.min} defaultValue={m.date.value ?? ''}
              onChange={e => {
                const v = e.target.value;
                if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || v < m.date!.min) return;
                const u = new URLSearchParams(m.date!.baseQuery);
                u.set('data', v);
                setOpen(false);
                router.push(`${m.date!.basePath}?${u.toString()}`, { scroll: false });
              }} />
          </>
        )}
      </div>
    </span>
  );
}

type Group = { heading: string; rows: SuggestRow[] };

/** The first cell: free text, the suggestion panel, Enter / blur runs the search. */
function QueryField({ c, onRun, again }: { c: QueryCell; onRun: (run: () => Promise<void>) => void; again?: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(c.text);
  const [picked, setPicked] = useState(c.picked);
  const [open, setOpen] = useState(false);
  const [groups, setGroups] = useState<Group[]>([]);
  const ran = useRef(false);
  const seq = useRef(0);
  const input = useRef<HTMLInputElement>(null);
  const ref = useOutside(open, () => setOpen(false));

  const load = (t: string, p: typeof picked) => {
    const n = ++seq.current;
    // While the field shows the chosen category, the panel offers the empty-field lists.
    const q = p && t === p.name ? '' : t;
    void suggestAction({ q, data: c.date }).then(g => { if (n === seq.current) setGroups(g); });
  };
  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => load(text, picked), 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, open]);

  const href = (t: string, p: typeof picked) => {
    const u = new URLSearchParams(c.baseQuery);
    if (p && (t === p.name || !t.trim())) {
      u.set('kategoriya', p.slug);
      if (c.vid && c.picked?.slug === p.slug) u.set('vid', c.vid);
    } else {
      u.set('q', t.trim());
    }
    return `${c.submitPath}?${u.toString()}`;
  };

  const run = async (t = text, p = picked) => {
    if (ran.current) return;
    ran.current = true;
    setTimeout(() => { ran.current = false; }, 1200);
    setOpen(false);
    const usesQuery = !(p && (t === p.name || !t.trim()));
    if (c.record && usesQuery && t.trim()) await recordQueryAction(t.trim());
    const target = href(t, p);
    // ‹Търси› on the view already shown: the results are these; say so instead of doing nothing.
    if (again && sameView(target, window.location.pathname + window.location.search)) { toast(again); return; }
    router.push(target, { scroll: false });
  };
  // the Търси button runs this field too
  useEffect(() => { onRun(() => run()); });

  const changed = () => text !== c.text || picked?.slug !== c.picked?.slug;
  const pick = (r: SuggestRow) => {
    if (r.kind === 'partner' || r.kind === 'brief') { setOpen(false); router.push(r.kind === 'brief' ? c.briefHref : r.href); return; }
    if (r.kind === 'category' && r.categorySlug) {
      const p = { slug: r.categorySlug, name: r.label };
      setPicked(p); setText(r.label); void run(r.label, p);
      return;
    }
    setPicked(null); setText(r.label); void run(r.label, null);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); void run(); }
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <span ref={ref} className="ui-anchor ui-anchor--block">
      <div className="sb-cell" onClick={() => { input.current?.focus(); setOpen(true); }}>
        <div className="sb-l">{c.label}</div>
        {c.icon && <svg className="sb-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.9-3.9" /></svg>}
        <input ref={input} className="sb-v" type="search" enterKeyHint="search" autoComplete="off" aria-label={c.label} placeholder={c.placeholder}
          value={text} role="combobox" aria-expanded={open} aria-autocomplete="list"
          onFocus={e => { setOpen(true); if (picked && text === picked.name) e.target.select(); }}
          onChange={e => { const v = e.target.value; setText(v); if (picked && v !== picked.name) setPicked(null); setOpen(true); }}
          onKeyDown={onKey}
          onBlur={() => { setTimeout(() => { if (changed()) void run(); }, 0); }} />
      </div>
      <div className="ui-menu ui-menu--down ui-menu--wide ui-suggest" role="listbox" hidden={!open || !groups.length}
        onMouseDown={e => e.preventDefault()}>
        {groups.map(g => (
          <div key={g.heading}>
            <div className="ui-suggest-h">{g.heading}</div>
            {g.rows.map(r => (
              <a key={r.kind + r.href + r.label} className="ui-note" href={r.kind === 'brief' ? c.briefHref : r.href} role="option" aria-selected={false}
                onClick={e => { e.preventDefault(); pick(r); }}>
                <b>{r.label}</b><span>{r.meta}</span>
              </a>
            ))}
          </div>
        ))}
      </div>
    </span>
  );
}

/**
 * The bar. `query` (search and category pages) or a `type` menu (event-type page) in the
 * first cell, then the dropdown cells, then ‹Търси›.
 */
export function SearchBar({ query, type, menus, submit, style }: {
  query?: QueryCell; type?: BarMenu; menus: BarMenu[];
  /**
   * ‹Търси› when there is no query cell: where it goes. `toast`: the default-state confirmation.
   * `again`: the confirmation when ‹Търси› is pressed on the view already shown.
   */
  submit: { href?: string; toast?: string | null; again?: string | null };
  style?: CSSProperties;
}) {
  const router = useRouter();
  const runQuery = useRef<null | (() => Promise<void>)>(null);
  const go = () => {
    if (submit.toast) toast(submit.toast);
    if (runQuery.current) void runQuery.current();
    else if (submit.href) router.push(submit.href);
  };
  return (
    <div className="searchbar" style={style} role="search">
      {query && <QueryField c={query} again={submit.again} onRun={r => { runQuery.current = r; }} />}
      {type && <MenuCell m={type} />}
      {menus.map(m => <MenuCell key={m.label} m={m} />)}
      <div className="sb-go"><button type="button" className="btn btn--primary" onClick={go}>Търси</button></div>
    </div>
  );
}
