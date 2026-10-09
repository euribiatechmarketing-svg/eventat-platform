// /admin — admin/dashboard.html (SCREENS §8): KPIs from metrics_snapshot, open tasks, monthly turnover,
// latest bookings, top categories per city, platform ratios and the newest applications.
import Link from 'next/link';
import '@/styles/m-admin-ops.css';
import { can } from '@/lib/domain/actor';
import { attention } from '@/lib/domain/team';
import {
  BOOKING_ADMIN, PERIODS, dashboardMetrics, latestBookings, newestApplications, oldestPendingRevision, topCategories, type PeriodKind,
} from '@/lib/domain/views-admin-ops';
import { getSetting } from '@/lib/domain/settings';
import { now } from '@/lib/clock';
import { dateShort, money, moneyShort, monthName, sofiaDate } from '@/lib/format';
import { requireTeam } from './_ops/guard';
import { Badge, Dots, Num, initials, n, pct, wait } from './_ops/fmt';
import { ActionForm, FilterMenu, RowLink, Submit } from './_ops/ui';
import { requestDashboardExportAction } from './actions';

export const metadata = { title: 'Табло' };

const PERIOD_LABEL: Record<PeriodKind, string> = { month: 'Месец', quarter: 'Тримесечие', year: 'Година' };

const CatIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></svg>;
const ShieldIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>;
const AlertIcon = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l9 16H3l9-16z" /><path d="M12 10v4M12 17h.01" /></svg>;

export default async function AdminDashboard({ searchParams }: { searchParams: Promise<{ period?: string; grad?: string }> }) {
  const { actor } = await requireTeam();
  const sp = await searchParams;
  const kind: PeriodKind = PERIODS.includes(sp.period as PeriodKind) ? (sp.period as PeriodKind) : 'month';
  const at = await now();
  const finance = can(actor, 'view_finance');
  const { period, data: m, refreshedAt } = await dashboardMetrics(kind);
  const cities = [
    { slug: 'sofia', name: 'София' }, { slug: 'plovdiv', name: 'Пловдив' }, { slug: 'varna', name: 'Варна' }, { slug: 'burgas', name: 'Бургас' },
  ];
  const city = cities.find(c => c.slug === sp.grad) ?? null;
  const [att, oldestRev, latest, top, regs, target] = await Promise.all([
    attention(), oldestPendingRevision(), latestBookings(4), topCategories(period, city?.slug ?? null), newestApplications(4),
    getSetting('partner.approval_target_hours'),
  ]);
  const qs = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const v = { period: kind === 'month' ? undefined : kind, grad: city?.slug, ...p };
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, x);
    const s = u.toString();
    return s ? `/admin?${s}` : '/admin';
  };
  const back = qs({});

  // ‹Изисква вашето внимание›: only what this role can act on.
  const tasks: React.ReactNode[] = [];
  let taskCount = 0;
  if (att.approvals > 0 && can(actor, 'approve_partners')) {
    taskCount += att.approvals;
    tasks.push(
      <Link key="p" className="rec" href="/admin/partnyori">
        <span className="cat-ico"><CatIcon /></span>
        <span>
          <span className="rec-n">{n(att.approvals, 'изпълнител чака', 'изпълнители чакат')} одобрение</span>
          <span className="rec-s"><Dots parts={[`${att.approvals === 1 ? 'Чака' : 'Най-старата чака'} от ${att.oldestSubmittedAt ? wait(att.oldestSubmittedAt, at) : ''}`, `целта е ${n(target, 'час', 'часа')}`]} /></span>
        </span>
        <span></span>
        <span className="rec-end">{att.oldestSubmittedAt && <Badge tone="warning">{wait(att.oldestSubmittedAt, at)}</Badge>}<span className="btn btn--primary btn--sm">Прегледай</span></span>
      </Link>,
    );
  }
  if (att.moderation > 0 && can(actor, 'moderate_listings')) {
    taskCount += att.moderation;
    const parts = [att.newServices ? n(att.newServices, 'нова услуга', 'нови услуги') : null, att.edits ? `${n(att.edits, 'редакция', 'редакции')} на публикувани` : null].filter(Boolean);
    const today = oldestRev && sofiaDate(oldestRev) === sofiaDate(at);
    tasks.push(
      <Link key="m" className="rec" href="/admin/moderatsiya">
        <span className="cat-ico"><ShieldIcon /></span>
        <span>
          <span className="rec-n">{n(att.moderation, 'обява', 'обяви')} за модерация</span>
          <span className="rec-s">{parts.join(' и ')}</span>
        </span>
        <span></span>
        <span className="rec-end">{oldestRev && <Badge tone={today ? 'primary' : 'warning'}>{today ? 'Днес' : wait(oldestRev, at)}</Badge>}<span className="btn btn--outline btn--sm">Отвори</span></span>
      </Link>,
    );
  }
  if (att.disputes > 0 && can(actor, 'resolve_disputes')) {
    taskCount += att.disputes;
    tasks.push(
      <Link key="d" className="rec" href="/admin/sporove">
        <span className="cat-ico" style={{ background: 'var(--danger-50)', color: 'var(--danger-600)' }}><AlertIcon /></span>
        <span>
          <span className="rec-n">{n(att.disputes, 'отворен спор', 'отворени спора')}</span>
          <span className="rec-s">Общо {moneyShort(att.disputesHeldCents)} в задържани средства</span>
        </span>
        <span></span>
        <span className="rec-end">{att.urgent && <Badge tone="danger">Спешно</Badge>}<span className="btn btn--outline btn--sm">Отвори</span></span>
      </Link>,
    );
  }

  const maxBar = Math.max(1, ...m.months.map(x => x.gmv));
  const gmvDelta = m.prevGmv > 0 ? Math.round((100 * (m.gmv - m.prevGmv)) / m.prevGmv) : null;
  const bookingDelta = m.bookings - m.prevBookings;
  const ratio = (a: number, b: number, digits = 0) => (b > 0 ? pct((100 * a) / b, digits) : '—');
  const minutes = Math.max(0, Math.floor((at.getTime() - refreshedAt.getTime()) / 60_000));

  return (
    <div className="ops-page">
      <div className="page-head">
        <div>
          <h1 className="page-title"><Num>{period.title}</Num></h1>
          <p className="page-sub">Платформата на един поглед · обновено {minutes < 1 ? 'току-що' : `преди ${n(minutes, 'минута', 'минути')}`}</p>
        </div>
        <div className="page-head-right">
          <span className="seg">
            {PERIODS.map(p => <Link key={p} href={qs({ period: p === 'month' ? '' : p })} className={`ops-seg${kind === p ? ' is-on' : ''}`} scroll={false}>{PERIOD_LABEL[p]}</Link>)}
          </span>
          <ActionForm action={requestDashboardExportAction} className="ops-inline">
            <input type="hidden" name="period" value={kind} />
            <input type="hidden" name="grad" value={city?.slug ?? ''} />
            <input type="hidden" name="back" value={back} />
            <Submit className="btn btn--outline btn--sm">Експорт</Submit>
          </ActionForm>
        </div>
      </div>

      <div className={`gmv${finance ? '' : ' ops-gmv--2'}`}>
        {finance && (
          <div className="gmv-cell gmv-cell--lead">
            <div className="gmv-l">Оборот през платформата (GMV)</div>
            <div className="gmv-v">{moneyShort(m.gmv).replace(/\s€$/, '')} <small>€</small></div>
            {gmvDelta != null && <div className={`gmv-d${gmvDelta < 0 ? ' is-flat' : ''}`}>{gmvDelta >= 0 ? '↗ +' : '↘ −'}{Math.abs(gmvDelta)}% спрямо {period.prevLabel}</div>}
          </div>
        )}
        {finance && (
          <div className="gmv-cell">
            <div className="gmv-l">Комисиона</div>
            <div className="gmv-v">{moneyShort(m.commission).replace(/\s€$/, '')} <small>€</small></div>
            {m.gmv > 0 && <div className="gmv-d">{pct((100 * m.commission) / m.gmv)} от оборота</div>}
          </div>
        )}
        <div className={`gmv-cell${finance ? '' : ' gmv-cell--lead'}`}>
          <div className="gmv-l">Потвърдени резервации</div>
          <div className="gmv-v">{m.bookings}</div>
          <div className={`gmv-d${bookingDelta < 0 ? ' is-flat' : ''}`}>{bookingDelta >= 0 ? '↗ +' : '↘ −'}{Math.abs(bookingDelta)} спрямо {period.prevLabel}</div>
        </div>
        <div className="gmv-cell">
          <div className="gmv-l">Активни изпълнители</div>
          <div className="gmv-v">{m.activePartners}</div>
          <div className="gmv-d is-flat">от {m.registeredPartners} регистрирани</div>
        </div>
      </div>

      <div className="adm-grid" style={{ marginTop: 20 }}>
        <div>
          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Изисква вашето внимание</h2>
              {taskCount > 0 && <span className="badge badge--primary">{n(taskCount, 'задача', 'задачи')}</span>}
            </div>
            {tasks.length ? tasks : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>

          {finance && (
            <section className="dcard">
              <div className="dcard-head">
                <h2 className="dcard-title">Оборот по месеци</h2>
                <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--neutral-600)' }}>{m.months.at(-1)?.start.slice(0, 4)}</span>
              </div>
              <div className="bars" style={{ height: 96 }}>
                {m.months.map((x, i) => <i key={x.start} title={money(x.gmv)} style={{ height: `${Math.max(2, Math.round((100 * x.gmv) / maxBar))}%` }} className={i === m.months.length - 1 ? 'is-now' : undefined} />)}
              </div>
              <div className="bars-x">
                {m.months.map(x => <span key={x.start}>{monthName(Number(x.start.slice(5, 7))).slice(0, 3)}</span>)}
              </div>
              {m.seasonShare != null && (
                <div className="earn-note">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 15, height: 15, color: 'var(--primary-500)' }}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  <span>Сватбеният сезон носи <b>{m.seasonShare}%</b> от оборота между май и септември.</span>
                </div>
              )}
            </section>
          )}

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Последни резервации</h2>
              <Link className="crumb" href="/admin/rezervacii" style={{ marginLeft: 'auto', marginBottom: 0 }}>Виж всички
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l6 6-6 6" /></svg>
              </Link>
            </div>
            {latest.length ? (
              <div className="ops-tbl-wrap">
                <table className="tbl ops-tbl">
                  <thead><tr><th>Резервация</th><th>Изпълнител</th><th style={{ textAlign: 'right' }}>Сума</th>{finance && <th style={{ textAlign: 'right' }}>Комисиона</th>}<th>Статус</th></tr></thead>
                  <tbody>
                    {latest.map(b => (
                      <RowLink key={b.number} href={`/admin/rezervacii/${encodeURIComponent(b.number)}`}>
                        <td><Link className="tbl-event ops-link" href={`/admin/rezervacii/${encodeURIComponent(b.number)}`}>{b.number}</Link><div className="tbl-sub"><Dots parts={[b.clientName, dateShort(b.eventDate)]} /></div></td>
                        <td><div className="tbl-event">{b.partnerName}</div><div className="tbl-sub">{b.categoryName}</div></td>
                        <td className="num" data-l="Сума">{money(b.amountCents)}</td>
                        {finance && <td className="num strong" data-l="Комисиона">{money(b.commissionCents)}</td>}
                        <td><Badge tone={BOOKING_ADMIN[b.status]?.tone ?? ''}>{BOOKING_ADMIN[b.status]?.label}</Badge></td>
                      </RowLink>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>
        </div>

        <aside>
          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title" style={{ fontSize: 17 }}>Топ категории</h2>
              <FilterMenu label={city?.name ?? 'Всички градове'} icon="pin"
                options={[{ label: 'Всички градове', href: qs({ grad: '' }), on: !city }, ...cities.map(c => ({ label: c.name, href: qs({ grad: c.slug }), on: city?.slug === c.slug }))]} />
            </div>
            {top.length ? top.map(c => (
              <Link key={c.slug} className="mini ops-mini-link" href={`/admin/rezervacii?kategoriya=${c.slug}${city ? `&grad=${city.slug}` : ''}`}>
                <span><span className="mini-n">{c.name}</span><span className="mini-s">{n(c.bookings, 'резервация', 'резервации')}</span></span>
                <span className="mini-end"><span className="mini-v">{finance ? moneyShort(c.gmv) : c.bookings}</span></span>
              </Link>
            )) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Данни</h2></div>
            <div className="split"><span>Заявки → резервация</span><b>{ratio(m.converted, m.requests)}</b></div>
            <div className="split"><span>Отговор до 24 часа</span><b>{ratio(m.answeredOnTime, m.answerable)}</b></div>
            {finance && <div className="split"><span>Средна стойност</span><b>{m.bookings ? moneyShort(Math.round(m.gmv / m.bookings / 100) * 100) : '—'}</b></div>}
            <div className="split"><span>Анулирани</span><b>{ratio(m.cancelled, m.bookings, 1)}</b></div>
            <div className="split is-total"><span>Средно ревю</span><b>{m.avgReview != null ? m.avgReview.toFixed(1).replace('.', ',') : '—'}</b></div>
          </section>

          {can(actor, 'approve_partners') && (
            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Нови регистрации</h2></div>
              {/* the four newest applications, in queue order (oldest first) as admin/dashboard.html lists them */}
              {regs.length ? [...regs].reverse().map(r => (
                <Link key={r.id} className="mini ops-mini-link" href={`/admin/partnyori/${r.id}`}>
                  <span className="avatar avatar--sm">{initials(r.name)}</span>
                  <span><span className="mini-n">{r.name}</span><span className="mini-s"><Dots parts={[r.categoryName, r.cityName]} /></span></span>
                  <span className="mini-end"><span className="badge badge--warning">Чака</span></span>
                </Link>
              )) : <div className="ui-empty">Няма записи в този изглед.</div>}
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

