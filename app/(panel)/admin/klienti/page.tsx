// /admin/klienti — admin/clients.html (SCREENS §8): clients with bookings and spend, the computed status
// badge (D96: ‹Блокиран› > ‹Отворен спор› > ‹Активен›; the type stays in the sub-line), demand and sources.
import Link from 'next/link';
import '@/styles/m-admin-ops.css';
import { AdminSearch } from '../_ops/AdminSearch';
import { can } from '@/lib/domain/actor';
import { adminClientList, type ClientRegistered, type ClientTab } from '@/lib/domain/views-admin-ops';
import { moneyShort } from '@/lib/format';
import { requireTeam } from '../_ops/guard';
import { Badge, Dots, initials } from '../_ops/fmt';
import { ActionForm, FilterMenu, Submit } from '../_ops/ui';
import { requestClientsExportAction } from './actions';

export const metadata = { title: 'Клиенти' };

const TABS: { key: ClientTab; label: string }[] = [
  { key: 'vsichki', label: 'Всички' }, { key: 's-rezervatsiya', label: 'С резервация' }, { key: 'biznes', label: 'Бизнес клиенти' },
];
const REG: { key: ClientRegistered; label: string }[] = [
  { key: 'vsichki', label: 'Всички' }, { key: '30-dni', label: 'Последните 30 дни' }, { key: 'tazi-godina', label: 'Тази година' },
];

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ tab?: string; grad?: string; registratsiya?: string; q?: string }> }) {
  const { actor } = await requireTeam(undefined, '/admin/klienti');
  const sp = await searchParams;
  const tab: ClientTab = TABS.some(t => t.key === sp.tab) ? (sp.tab as ClientTab) : 'vsichki';
  const reg: ClientRegistered = REG.some(r => r.key === sp.registratsiya) ? (sp.registratsiya as ClientRegistered) : 'vsichki';
  const finance = can(actor, 'view_finance');
  const data = await adminClientList(actor, { tab, city: sp.grad || null, registered: reg, q: sp.q || null });
  const city = data.cities.find(c => c.slug === sp.grad) ?? null;
  const href = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const v = { tab: tab === 'vsichki' ? undefined : tab, grad: city?.slug, registratsiya: reg === 'vsichki' ? undefined : reg, q: sp.q || undefined, ...p };
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, x);
    const s = u.toString();
    return s ? `/admin/klienti?${s}` : '/admin/klienti';
  };
  const back = href({});

  return (
    <div className="ops-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Клиенти</h1>
          <p className="page-sub">{data.counts.all} регистрирани · {data.counts.withBookings} с поне една резервация · {data.counts.newThisMonth} {data.counts.newThisMonth === 1 ? 'нов' : 'нови'} този месец</p>
        </div>
        <div className="page-head-right">
          <ActionForm action={requestClientsExportAction} className="ops-inline">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="grad" value={city?.slug ?? ''} />
            <input type="hidden" name="registratsiya" value={reg} />
            <input type="hidden" name="q" value={sp.q ?? ''} />
            <input type="hidden" name="back" value={back} />
            <Submit className="btn btn--outline btn--sm">Експорт</Submit>
          </ActionForm>
        </div>
      </div>

      <AdminSearch inPage />
      <div className="toolbar">
        <nav className="tab-bar">
          {TABS.map(t => (
            <Link key={t.key} href={href({ tab: t.key === 'vsichki' ? '' : t.key })} className={`tab-bar-item${tab === t.key ? ' is-active' : ''}`} scroll={false}>
              {t.label} <span className="tab-count">{data.tabCounts[t.key]}</span>
            </Link>
          ))}
        </nav>
        <div className="toolbar-right">
          <FilterMenu label={city?.name ?? 'Град'} icon="pin"
            options={[{ label: 'Всички градове', href: href({ grad: '' }), on: !city }, ...data.cities.map(c => ({ label: c.name, href: href({ grad: c.slug }), on: city?.slug === c.slug }))]} />
          <FilterMenu label={reg === 'vsichki' ? 'Регистрация' : REG.find(r => r.key === reg)!.label} icon="calendar"
            options={REG.map(r => ({ label: r.label, href: href({ registratsiya: r.key === 'vsichki' ? '' : r.key }), on: reg === r.key }))} />
        </div>
      </div>

      <div className="adm-grid adm-grid--wide">
        <section className="dcard ops-recs--wide">
          <div className="dcard-head"><h2 className="dcard-title">{tab === 'vsichki' ? 'Активни клиенти' : TABS.find(t => t.key === tab)!.label}</h2></div>
          {data.rows.length ? data.rows.map(c => (
            <Link key={c.id} className="rec" href={`/admin/klienti/${c.id}`}>
              <span className="avatar">{initials(c.name)}</span>
              <span>
                <span className="rec-n">{c.name}</span>
                <span className="rec-s"><Dots parts={[c.typeLabel, c.cityName, c.email]} /></span>
              </span>
              <span className="rec-meta">
                <span className="rec-col"><span className="rec-l">Резервации</span><span className="rec-v">{c.bookings}</span></span>
                {finance && <span className="rec-col"><span className="rec-l">Похарчени</span><span className="rec-v">{moneyShort(c.spentCents)}</span></span>}
              </span>
              <span className="rec-end"><Badge tone={c.badge.tone}>{c.badge.label}</Badge><span className="btn btn--outline btn--sm">Профил</span></span>
            </Link>
          )) : <div className="ui-empty">Няма записи в този изглед.</div>}
        </section>

        <aside>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Профил на търсенето</h2></div>
            {data.demand.length ? data.demand.map(d => <div className="split" key={d.label}><span>{d.label}</span><b>{d.pct}%</b></div>)
              : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Откъде идват</h2></div>
            {data.sources.map(s => (
              <div className="mini" key={s.key}>
                <span><span className="mini-n">{s.label}</span><span className="mini-s">{s.sub}</span></span>
                <span className="mini-end"><span className="mini-v">{s.pct != null ? `${s.pct}%` : '—'}</span></span>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
