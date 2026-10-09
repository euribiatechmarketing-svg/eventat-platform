// vendor/earnings.html → /partner/prihodi (SCREENS §7, figures SPEC §8.2). Partners see what they receive, never the commission.
import '@/styles/m-partner-catalogue.css';
import Link from 'next/link';
import { earningsPage, euros } from '@/lib/domain/views-partner-catalogue';
import { partnerActor } from '../_catalogue/server';
import { ClickRow } from '../_catalogue/ui';
import { Segs } from '../_catalogue/num';
import { ReportButton } from './ReportButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Приходи' };

const cap = (s: string) => s.charAt(0).toLocaleUpperCase('bg') + s.slice(1);

export default async function EarningsPage({ searchParams }: { searchParams: Promise<{ stranitsa?: string }> }) {
  const sp = await searchParams;
  const actor = await partnerActor('/partner/prihodi');
  const v = await earningsPage(actor, { page: Number(sp.stranitsa) || 1 });
  const delta = v.month.deltaPct;
  const pageHref = (p: number) => (p > 1 ? `/partner/prihodi?stranitsa=${p}` : '/partner/prihodi');

  return (
    <div className="pc-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Приходи</h1>
          <p className="page-sub"><Segs parts={[cap(v.month.label), 'изплащане на 1-во и 15-то число']} /></p>
        </div>
        <div className="page-head-right">
          {v.latestReport && <a className="btn btn--ghost btn--sm" href={`/partner/prihodi/spravka/${v.latestReport}`} download>Изтегли справката</a>}
          <ReportButton />
        </div>
      </div>

      <div className="earn-hero">
        <div className="eh-main">
          <div className="eh-label">Приходи · {v.month.label}</div>
          <div className="eh-value">{euros(v.month.cents)} <small>€</small></div>
          {delta != null && (
            <div className={`eh-delta${delta < 0 ? ' is-down' : ''}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M6 18L18 6M18 6h-7M18 6v7" /></svg>
              {delta > 0 ? '+' : delta < 0 ? '−' : ''}{Math.abs(delta)}% спрямо {v.month.prevMonthName}
            </div>
          )}
          <div className="eh-bars">
            {v.bars.map((b, i) => <i key={i} className={b.isNow ? 'is-now' : undefined} style={{ height: `${b.pct}%` }} />)}
          </div>
          <div className="eh-x">{v.bars.map((b, i) => <span key={i}>{b.label}</span>)}</div>
        </div>
        <div className="eh-side">
          <div className="eh-stat eh-stat--gold">
            <div className="eh-label">За изплащане</div>
            <div className="eh-stat-v">{euros(v.toBePaidCents)} <small>€</small></div>
            <div className="eh-stat-n">задържани до събитията</div>
          </div>
          <div className="eh-stat">
            <div className="eh-label">Изплатени за {v.paidYear.year}</div>
            <div className="eh-stat-v">{euros(v.paidYear.cents)} <small>€</small></div>
            <div className="eh-stat-n">по {v.paidYear.count} {v.paidYear.count === 1 ? 'резервация' : 'резервации'}</div>
          </div>
          <div className="eh-stat">
            <div className="eh-label">Средно на резервация</div>
            <div className="eh-stat-v">{v.paidYear.averageCents != null ? <>{euros(v.paidYear.averageCents)} <small>€</small></> : '—'}</div>
            <div className="eh-stat-n">за {v.paidYear.year}</div>
          </div>
        </div>
      </div>

      <div className="dash-grid">
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Движение по плащания</h2>
            <Link className="link-more" href="/partner/rezervacii">Резервации <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg></Link>
          </div>
          {v.lines.length === 0 ? <div className="ui-empty">Няма записи в този изглед.</div> : (
            <div className="pc-tbl-wrap pc-earn">
              <table className="tbl">
                <thead>
                  <tr><th>Дата</th><th>Събитие</th><th style={{ textAlign: 'right' }}>Получавате</th><th>Статус</th></tr>
                </thead>
                <tbody>
                  {v.lines.map(l => (
                    <ClickRow key={l.id} href={`/partner/rezervacii/${encodeURIComponent(l.number)}`}>
                      <td className="muted">{l.date}</td>
                      <td><div className="tbl-event"><Segs parts={l.event} /></div><div className="tbl-sub">{l.sub}</div></td>
                      <td className="num strong">{l.amount}</td>
                      <td><span className={`badge badge--${l.badge.tone} badge--dot`}>{l.badge.label}</span></td>
                    </ClickRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {v.pages > 1 && (
            <nav className="pc-pager" aria-label="Страници">
              {v.page > 1 ? <Link href={pageHref(v.page - 1)} aria-label="Предишна страница"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 18l-6-6 6-6" /></svg></Link>
                : <span className="is-off" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M15 18l-6-6 6-6" /></svg></span>}
              <span>{v.page} / {v.pages}</span>
              {v.page < v.pages ? <Link href={pageHref(v.page + 1)} aria-label="Следваща страница"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg></Link>
                : <span className="is-off" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg></span>}
            </nav>
          )}
        </section>
        <aside>
          <div className="panel">
            <h3 className="panel-title">Този месец</h3>
            <div className="split"><span>Приходи · {v.month.monthName}</span><b>{euros(v.month.cents)} €</b></div>
            <div className="split is-total"><span>За изплащане</span><b>{euros(v.toBePaidCents)} €</b></div>
          </div>
          <div className="panel">
            <h3 className="panel-title">Сметка за изплащане</h3>
            {v.account && (
              <div className="payout-acc">
                <span className="payout-logo">BG</span>
                <div>
                  <div className="payout-name">{v.account.holder}</div>
                  <div className="payout-sub">{v.account.masked} · {v.account.bank}</div>
                </div>
              </div>
            )}
            {v.pendingAccount && (
              <p className="panel-note" style={v.account ? undefined : { marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                <span className="badge badge--warning badge--dot">Новата сметка чака проверка</span>
              </p>
            )}
            <p className="panel-note"><strong>Как работи:</strong> сумата се задържа до събитието и се превежда на 1-во или 15-то число след него.</p>
            <div className="panel-actions" style={{ marginTop: 14 }}>
              <Link className="btn btn--outline btn--block" href="/partner/smetka">Промени сметката</Link>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
