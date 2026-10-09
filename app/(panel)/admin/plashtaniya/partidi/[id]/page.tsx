// A payout batch: its items (one per partner) and their lines (one per booking) — SCREENS §8 /admin/plashtaniya/partidi/[id] [new screen], view_finance.
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import '@/styles/m-admin-money.css';
import { PageChrome } from '../../../_money/chrome';
import { LINE_LABEL, ITEM_BADGE, batchPage } from '@/lib/domain/views-admin-money';
import { date, money, plural } from '@/lib/format';
import { adminActor, bookingPath } from '../../../_money/server';
import { RowLink } from '../../../_money/ui';

export const metadata: Metadata = { title: 'Партида' };

type P = Promise<{ id: string }>;
type SP = Promise<Record<string, string | string[] | undefined>>;

function Num({ text }: { text: string }) {
  return <>{text.split(/(\d+)/).map((p, i) => (/^\d+$/.test(p) ? <span key={i} className="num">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}

export default async function AdminBatch({ params, searchParams }: { params: P; searchParams: SP }) {
  const { id } = await params;
  const sp = await searchParams;
  const partnerId = typeof sp.partnyor === 'string' && /^[0-9a-f-]{36}$/.test(sp.partnyor) ? sp.partnyor : null;
  const actor = await adminActor(`/admin/plashtaniya/partidi/${id}`, 'view_finance');
  const r = await batchPage(actor, id, partnerId);
  if (!r) notFound();
  const b = r.batch;

  return (
    <div className="am">
      <PageChrome title="Плащания и изплащания" short="Плащания" />
      <Link className="crumb" href="/admin/plashtaniya"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>Плащания</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Num text={b.label} /></h1>
          <p className="page-sub">{[r.date, b.railLabel, plural(r.totals.partners, 'изпълнител', 'изпълнители')].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="page-head-right">
          <span className={`badge ${r.badge.cls}`}>{r.badge.label}</span>
          {r.groups.length > 0 && <a className="btn btn--outline btn--sm" href={`/admin/plashtaniya/partidi/${b.id}/otchet`} download>Свали отчета</a>}
        </div>
      </div>

      <div className="adm-grid am-batch">
        <div>
          {r.filtered && (
            <div className="am-filter-note"><span>{r.partnerName}</span><Link className="link-more" href={`/admin/plashtaniya/partidi/${b.id}`}>Виж всички</Link></div>
          )}
          {r.groups.length ? r.groups.map(g => (
            <section className="dcard" key={g.partnerId}>
              <div className="dcard-head">
                <h2 className="dcard-title" style={{ fontSize: 17 }}><Link className="am-link" href={`/admin/partnyori/${g.partnerId}`}><Num text={g.partnerName} /></Link></h2>
                <span className={`badge ${g.badge.cls}`}>{g.badge.label}</span>
                <span className="batch-amt">{money(g.amountCents)}</span>
              </div>
              {g.holdText && <div className="hint am-hold-hint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg><span>{g.holdText}</span></div>}
              <div className="am-tbl-wrap"><table className="tbl am-stack am-lines">
                <thead><tr><th>Резервация</th><th>Събитие</th><th style={{ textAlign: 'right' }}>Бруто</th><th style={{ textAlign: 'right' }}>Комисиона</th><th style={{ textAlign: 'right' }}>Нето</th><th>Статус</th></tr></thead>
                <tbody>
                  {g.lines.map(l => {
                    const badge = ITEM_BADGE[l.held ? 'held' : l.status] ?? null;
                    return (
                      <RowLink key={l.number} href={bookingPath(l.number)}>
                        <td className="c-main"><div className="tbl-event">{l.number}</div></td>
                        <td className="c-date">{date(l.eventDate)}</td>
                        <td className="num c-gross">{money(l.baseCents)}</td>
                        <td className="num muted c-com">{money(l.commissionCents)}</td>
                        <td className="num strong c-amount">{money(l.amountCents)}</td>
                        <td className="c-status">{badge ? <span className={`badge ${badge.cls}`}>{badge.label}</span> : <span className="badge badge--dot">{LINE_LABEL[l.status] ?? l.status}</span>}</td>
                      </RowLink>
                    );
                  })}
                </tbody>
              </table></div>
            </section>
          )) : <section className="dcard"><div className="ui-empty">Няма записи в този изглед.</div></section>}
        </div>
        <aside>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}><Num text={r.date} /></h2></div>
            <div className="split"><span>Изпълнители</span><b>{r.totals.partners}</b></div>
            <div className="split"><span>Бруто</span><b>{money(r.totals.grossCents)}</b></div>
            <div className="split is-fee"><span>Комисиона</span><b>− {money(r.totals.commissionCents)}</b></div>
            <div className="split is-total"><span>За превод</span><b>{money(r.totals.netCents)}</b></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
