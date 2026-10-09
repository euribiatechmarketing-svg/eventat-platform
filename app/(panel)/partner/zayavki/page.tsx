// Заявки (prototype vendor/requests.html; SCREENS §7 `/partner/zayavki?tab=&filtar=`).
import Link from 'next/link';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import {
  REQUEST_FILTERS, REQUEST_TABS, requestsInbox, type RequestFilter, type RequestGroup, type RequestRowView, type RequestTab,
} from '@/lib/domain/views-partner-ops';
import { RequestRow } from '../_ops/rows';
import { FilterMenu, Submit } from '../_ops/ui';
import { exportRequestsAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Заявки' };

const GROUPS: { key: Exclude<RequestGroup, 'other'>; title: string; cls: string; hint: string | null }[] = [
  { key: 'new', title: 'Нови заявки', cls: 'group--new', hint: 'Отговорете до 24 часа, за да запазите рейтинга си за отзивчивост' },
  { key: 'pay', title: 'Чакат плащане', cls: 'group--pay', hint: 'Датите са запазени, докато клиентът плати' },
  { key: 'confirmed', title: 'Потвърдени', cls: '', hint: null },
  { key: 'declined', title: 'Отказани', cls: '', hint: null },
];

function href(tab: RequestTab, filter: RequestFilter) {
  const p = new URLSearchParams();
  if (tab !== 'vsichki') p.set('tab', tab);
  if (filter !== 'vsichki') p.set('filtar', filter);
  const s = p.toString();
  return `/partner/zayavki${s ? `?${s}` : ''}`;
}

export default async function RequestsPage({ searchParams }: { searchParams: Promise<{ tab?: string; filtar?: string }> }) {
  const sp = await searchParams;
  const u = await requireRole('partner', '/partner/zayavki');
  const tab = (REQUEST_TABS.find(t => t.key === sp.tab)?.key ?? 'vsichki') as RequestTab;
  const filter = (REQUEST_FILTERS.find(f => f.key === sp.filtar)?.key ?? 'vsichki') as RequestFilter;
  const v = await requestsInbox(await actorFromUser(u), { tab, filter });
  const current = REQUEST_TABS.find(t => t.key === tab)!;
  const shown = GROUPS.filter(g => current.groups.includes(g.key));
  const rowsOf = (k: Exclude<RequestGroup, 'other'>): RequestRowView[] => v.groups[k];
  const visible = tab === 'vsichki' ? shown.filter(g => rowsOf(g.key).length > 0) : shown;
  const filterLabel = filter === 'vsichki' ? 'Филтри' : REQUEST_FILTERS.find(f => f.key === filter)!.label;

  return (
    <div className="po">
      <div className="toolbar">
        <nav className="tab-bar">
          {REQUEST_TABS.map(t => {
            const n = t.key === 'novi' ? v.counts.new : t.key === 'plashtane' ? v.counts.pay : t.key === 'potvardeni' ? v.counts.confirmed : 0;
            return (
              <Link key={t.key} className={`tab-bar-item${t.key === tab ? ' is-active' : ''}`} href={href(t.key, filter)} scroll={false} aria-current={t.key === tab ? 'page' : undefined}>
                {t.label}{t.count && n > 0 ? <> <span className="tab-count">{n}</span></> : null}
              </Link>
            );
          })}
        </nav>
        <div className="toolbar-right">
          <FilterMenu label={filterLabel} icon="filter" options={REQUEST_FILTERS.map(f => ({ label: f.label, href: href(tab, f.key), active: f.key === filter }))} />
          <form action={exportRequestsAction}>
            <input type="hidden" name="back" value={href(tab, filter)} />
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="filtar" value={filter} />
            <Submit className="filter-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12M7 10l5 5 5-5M4 21h16" /></svg>Експорт</Submit>
          </form>
        </div>
      </div>

      {visible.length === 0 && <div className="req-panel po-empty-panel"><div className="ui-empty">Няма записи в този изглед.</div></div>}
      {visible.map(g => {
        const rows = rowsOf(g.key);
        return (
          <section key={g.key} className={`group ${g.cls}`.trim()}>
            <header className="group-head">
              <span className="group-title">{g.title}</span>
              <span className="group-count">{rows.length}</span>
              {g.hint && <span className="group-hint">{g.hint}</span>}
            </header>
            <div className="req-panel"><div className="req-list">
              {rows.length === 0 && <div className="ui-empty">Няма записи в този изглед.</div>}
              {rows.map(r => <RequestRow key={r.number} r={r} now={v.now} />)}
            </div></div>
          </section>
        );
      })}
    </div>
  );
}
