// /admin/partnyori — admin/vendors.html (SCREENS §8) [approve_partners]: the approval queue (oldest first),
// recently approved, active and deactivated partners; the oldest application in the side panel.
import Link from 'next/link';
import '@/styles/m-admin-ops.css';
import { AdminSearch } from '../_ops/AdminSearch';
import { can } from '@/lib/domain/actor';
import { CHECK_LIST_LABEL, adminPartnerDetail, adminPartnerList, type PartnerTab } from '@/lib/domain/views-admin-ops';
import { now } from '@/lib/clock';
import { moneyShort } from '@/lib/format';
import { requireTeam } from '../_ops/guard';
import { Badge, Dots, Num, ago, initials, wait } from '../_ops/fmt';
import { ActionDialog, ActionForm, FilterMenu, Submit } from '../_ops/ui';
import { CheckRow, DecisionDialogs, NotesCard } from './_parts';
import { invitePartnerAction, requestPartnersExportAction } from './actions';

export const metadata = { title: 'Изпълнители' };

const TABS: { key: PartnerTab; label: string }[] = [
  { key: 'chakat', label: 'Чакат одобрение' }, { key: 'aktivni', label: 'Активни' }, { key: 'deaktivirani', label: 'Деактивирани' },
];

export default async function PartnersPage({ searchParams }: { searchParams: Promise<{ tab?: string; kategoriya?: string; grad?: string; q?: string }> }) {
  const { actor } = await requireTeam('approve_partners', '/admin/partnyori');
  const sp = await searchParams;
  const tab: PartnerTab = TABS.some(t => t.key === sp.tab) ? (sp.tab as PartnerTab) : 'chakat';
  const at = await now();
  const finance = can(actor, 'view_finance');
  const data = await adminPartnerList(actor, { tab, category: sp.kategoriya || null, city: sp.grad || null, q: sp.q || null });
  const category = data.categories.find(c => c.slug === sp.kategoriya) ?? null;
  const city = data.cities.find(c => c.slug === sp.grad) ?? null;
  const href = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const v = { tab: tab === 'chakat' ? undefined : tab, kategoriya: category?.slug, grad: city?.slug, q: sp.q || undefined, ...p };
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, x);
    const s = u.toString();
    return s ? `/admin/partnyori?${s}` : '/admin/partnyori';
  };
  const back = href({});
  const selected = tab === 'chakat' && data.rows[0] ? await adminPartnerDetail(actor, data.rows[0].id) : null;
  const count = { chakat: data.counts.submitted, aktivni: data.counts.approved, deaktivirani: data.counts.deactivated };

  const PartnerRow = ({ r, sel }: { r: (typeof data.rows)[number]; sel?: boolean }) => (
    <Link className={`rec${sel ? ' is-sel' : ''}`} href={`/admin/partnyori/${r.id}`}>
      <span className="avatar">{initials(r.name)}</span>
      <span>
        <span className="rec-n">{r.name}</span>
        <span className="rec-s"><Dots parts={[r.categoryName, r.cityName, r.status === 'submitted' ? r.contactName : null]} /></span>
      </span>
      {r.status === 'submitted' ? (
        <span className="rec-meta">
          <span className="rec-col"><span className="rec-l">Подадена</span><span className="rec-v">{r.submittedAt ? ago(r.submittedAt, at) : '—'}</span></span>
          <span className="rec-col"><span className="rec-l">Профил</span><span className="rec-v">{r.checksOk} от 6</span></span>
        </span>
      ) : (
        <span className="rec-meta">
          <span className="rec-col"><span className="rec-l">Резервации</span><span className="rec-v">{r.bookings}</span></span>
          {finance && <span className="rec-col"><span className="rec-l">Оборот</span><span className="rec-v">{moneyShort(r.turnoverCents)}</span></span>}
        </span>
      )}
      <span className="rec-end">
        {r.status === 'submitted' ? <Badge tone="warning">Чака</Badge> : r.status === 'approved' ? <Badge tone="success">Активен</Badge> : <Badge tone="">Деактивиран</Badge>}
      </span>
    </Link>
  );

  return (
    <div className="ops-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Изпълнители</h1>
          <p className="page-sub">{data.counts.registered} регистрирани · {data.counts.approved} активни · {data.counts.submitted} чакат одобрение</p>
        </div>
        <div className="page-head-right">
          <ActionForm action={requestPartnersExportAction} className="ops-inline">
            <input type="hidden" name="tab" value={tab} />
            <input type="hidden" name="kategoriya" value={category?.slug ?? ''} />
            <input type="hidden" name="grad" value={city?.slug ?? ''} />
            <input type="hidden" name="q" value={sp.q ?? ''} />
            <input type="hidden" name="back" value={back} />
            <Submit className="btn btn--outline btn--sm">Експорт</Submit>
          </ActionForm>
          {can(actor, 'invite_partner') && (
            <ActionDialog trigger="Покани изпълнител" triggerClass="btn btn--primary btn--sm" title="Покани изпълнител" submitLabel="Изпрати покана"
              action={invitePartnerAction} hidden={{ back }}>
              <label className="fld">
                <span className="fld-l">Имейл</span>
                <input className="fld-i" type="email" name="email" required maxLength={200} autoComplete="off" />
              </label>
            </ActionDialog>
          )}
        </div>
      </div>

      <AdminSearch inPage />
      <div className="toolbar">
        <nav className="tab-bar">
          {TABS.map(t => (
            <Link key={t.key} href={href({ tab: t.key === 'chakat' ? '' : t.key })} className={`tab-bar-item${tab === t.key ? ' is-active' : ''}`} scroll={false}>
              {t.label} <span className="tab-count">{count[t.key]}</span>
            </Link>
          ))}
        </nav>
        <div className="toolbar-right">
          <FilterMenu label={category?.name ?? 'Категория'} icon="filter"
            options={[{ label: 'Всички категории', href: href({ kategoriya: '' }), on: !category }, ...data.categories.map(c => ({ label: c.name, href: href({ kategoriya: c.slug }), on: category?.slug === c.slug }))]} />
          <FilterMenu label={city?.name ?? 'Град'} icon="pin"
            options={[{ label: 'Всички градове', href: href({ grad: '' }), on: !city }, ...data.cities.map(c => ({ label: c.name, href: href({ grad: c.slug }), on: city?.slug === c.slug }))]} />
        </div>
      </div>

      <div className={tab === 'chakat' ? 'adm-grid' : ''}>
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">{tab === 'chakat' ? 'Заявки за одобрение' : TABS.find(t => t.key === tab)!.label}</h2>
            {tab === 'chakat' && data.oldestSubmittedAt && <span className="badge badge--warning">най-старата от {wait(data.oldestSubmittedAt, at)}</span>}
          </div>
          {data.rows.length ? data.rows.map((r, i) => <PartnerRow key={r.id} r={r} sel={tab === 'chakat' && i === 0} />)
            : <div className="ui-empty">Няма записи в този изглед.</div>}

          {tab === 'chakat' && data.recent.length > 0 && (
            <>
              <div className="dcard-head" style={{ marginTop: 26 }}>
                <h2 className="dcard-title" style={{ fontSize: 17 }}>Наскоро одобрени</h2>
              </div>
              {data.recent.map(r => <PartnerRow key={r.id} r={r} />)}
            </>
          )}
        </section>

        {selected && (
          <aside>
            <section className="dcard">
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, paddingBottom: 18, marginBottom: 16, borderBottom: '1px solid var(--app-line)' }}>
                <span className="avatar avatar--lg">{initials(selected.partner.businessName)}</span>
                <div>
                  <Link href={`/admin/partnyori/${selected.partner.id}`} className="ops-link" style={{ fontFamily: 'var(--font-display)', fontWeight: 'var(--fw-bold)' as never, fontSize: 20, color: 'var(--primary-900)' }}><Num>{selected.partner.businessName}</Num></Link>
                  <div style={{ fontSize: 12.5, color: 'var(--neutral-600)', marginTop: 3 }}>
                    <Dots parts={[selected.categoryName, selected.cityName, selected.partner.submittedAt ? `подадена ${ago(selected.partner.submittedAt, at)}` : null]} />
                  </div>
                </div>
              </div>

              <div className="field-label" style={{ marginBottom: 10 }}>Проверка на профила</div>
              {selected.checks.checks.map(c => (
                <CheckRow key={c.kind} c={{ kind: c.kind, state: c.state, label: CHECK_LIST_LABEL[c.kind], detail: c.detail }} partnerId={selected.partner.id}
                  editable={false} back={back} openHref={`/admin/partnyori/${selected.partner.id}`} />
              ))}

              {selected.checks.checks.some(c => c.kind === 'bank_account' && c.state !== 'ok') && (
                <div className="hint" style={{ marginTop: 18 }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
                  <span>Може да одобрите и без банкова сметка.</span>
                </div>
              )}

              <DecisionDialogs partnerId={selected.partner.id} name={selected.partner.businessName} />
            </section>

            <NotesCard partnerId={selected.partner.id} notes={selected.notes} back={back} editable={false} />
          </aside>
        )}
      </div>
    </div>
  );
}
