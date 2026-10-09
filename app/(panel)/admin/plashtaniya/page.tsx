// Плащания — money held, the next batch, history, accounts to check (prototype admin/payouts.html; SCREENS §8, view_finance).
import type { Metadata } from 'next';
import Link from 'next/link';
import '@/styles/m-admin-money.css';
import { PageChrome } from '../_money/chrome';
import { kpiAmount, payoutsOverview } from '@/lib/domain/views-admin-money';
import { dateShort, money, moneyShort, plural } from '@/lib/format';
import { adminActor, casePath } from '../_money/server';
import { Dialog, DialogClose, RowAction, Submit } from '../_money/ui';
import { accountingReportAction, batchReportAction, confirmAccountAction, rejectAccountAction, releaseAction } from './actions';

export const metadata: Metadata = { title: 'Плащания' };

const CAL = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>;

export default async function AdminPayouts() {
  const actor = await adminActor('/admin/plashtaniya', 'view_finance');
  const r = await payoutsOverview(actor);
  const k = r.kpis;
  const nb = r.next;
  const delta = k.commission.deltaPct;
  const batchPath = (partnerId?: string) => (nb.id ? `/admin/plashtaniya/partidi/${nb.id}${partnerId ? `?partnyor=${partnerId}` : ''}` : null);

  const release = (label: string, source: 'head' | 'card', cls: string) => r.canRelease && (
    <Dialog className={cls} label={label} title={label} disabled={!r.releasable}>
      <form action={releaseAction} className="am-form">
        <input type="hidden" name="batchDate" value={nb.batchDate} />
        <input type="hidden" name="source" value={source} />
        <div>
          <div className="split"><span>{nb.label}</span><b>{nb.date}</b></div>
          <div className="split"><span>Изпълнители</span><b>{nb.partners}</b></div>
          <div className="split is-total"><span>За превод</span><b>{moneyShort(nb.netCents)}</b></div>
        </div>
        {nb.approvedBy && r.secondAdmin && <div className="hint">{CAL}<span>Одобрена от {nb.approvedBy} — чака втори администратор.</span></div>}
        <div className="am-dialog-acts">
          <Submit className="btn btn--primary">{label}</Submit>
          <DialogClose className="btn btn--ghost">Откажи</DialogClose>
        </div>
      </form>
    </Dialog>
  );

  return (
    <div className="am">
      <PageChrome title="Плащания и изплащания" short="Плащания" />
      <div className="page-head">
        <div>
          <h1 className="page-title">Плащания</h1>
          <p className="page-sub">{r.monthTitle} · {moneyShort(k.commission.cents)} комисиона · {moneyShort(r.toPayCents)} за изплащане</p>
        </div>
        <div className="page-head-right">
          <form action={accountingReportAction}><Submit className="btn btn--outline btn--sm">Счетоводна справка</Submit></form>
          {release('Пусни изплащанията', 'head', 'btn btn--primary btn--sm')}
        </div>
      </div>

      <div className="gmv">
        <div className="gmv-cell gmv-cell--lead">
          <div className="gmv-l">Задържани до събитията</div>
          <div className="gmv-v">{kpiAmount(k.heldForEvents.cents)} <small>€</small></div>
          <div className="gmv-d is-flat">по {plural(k.heldForEvents.bookings, 'предстояща резервация', 'предстоящи резервации')}</div>
        </div>
        <div className="gmv-cell">
          <div className="gmv-l">За изплащане тази седмица</div>
          <div className="gmv-v">{kpiAmount(nb.netCents)} <small>€</small></div>
          <div className="gmv-d is-flat">{plural(nb.partners, 'изпълнител', 'изпълнители')}</div>
        </div>
        <div className="gmv-cell">
          <div className="gmv-l">Комисиона {r.commissionMonth}</div>
          <div className="gmv-v">{kpiAmount(k.commission.cents)} <small>€</small></div>
          {delta === null
            ? <div className="gmv-d is-flat">{moneyShort(k.commission.prevCents)} през {r.prevMonth}</div>
            : <div className={`gmv-d${delta === 0 ? ' is-flat' : delta < 0 ? ' am-down' : ''}`}>{delta >= 0 ? '↗' : '↘'} {delta > 0 ? '+' : delta < 0 ? '−' : ''}{Math.abs(delta)}% спрямо {r.prevMonth}</div>}
        </div>
        <div className="gmv-cell">
          <div className="gmv-l">Възстановено</div>
          <div className="gmv-v">{kpiAmount(k.refunded.cents)} <small>€</small></div>
          <div className="gmv-d is-flat">{plural(k.refunded.cases, 'кейс', 'кейса')}</div>
        </div>
      </div>

      <div className="adm-grid" style={{ marginTop: 20 }}>
        <div>
          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Готови за изплащане</h2>
              <span className="badge badge--success">събитието е минало</span>
            </div>
            {r.items.length ? r.items.map(it => (
              <div className="batch" key={it.partnerId}>
                <span>
                  <span className="batch-n">{it.partnerName}</span>
                  <span className="batch-s">{[
                    plural(it.bookings, 'резервация', 'резервации'),
                    it.held ? it.holdText : it.lastEvent ? `последната на ${dateShort(it.lastEvent)}` : null,
                    it.ibanLast4 ? `IBAN ···${it.ibanLast4}` : null,
                  ].filter(Boolean).join(' · ')}</span>
                </span>
                <span className={`badge ${it.held ? 'badge--warning' : 'badge--success'} badge--dot`}>{it.held ? 'Задържано' : 'Готово'}</span>
                <span className="batch-amt">{money(it.amountCents)}</span>
                <span>
                  {it.disputeNumber
                    ? <Link className="btn btn--outline btn--sm" href={casePath(it.disputeNumber)}>Виж спора</Link>
                    : batchPath(it.partnerId) ? <Link className="btn btn--outline btn--sm" href={batchPath(it.partnerId)!}>Детайли</Link> : null}
                </span>
              </div>
            )) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">История на изплащанията</h2></div>
            {r.history.length ? (
              <div className="am-tbl-wrap"><table className="tbl am-stack am-hist">
                <thead><tr><th>Дата</th><th>Партида</th><th style={{ textAlign: 'right' }}>Изпълнители</th><th style={{ textAlign: 'right' }}>Сума</th><th>Статус</th></tr></thead>
                <tbody>
                  {r.history.map(h => {
                    const cells = (
                      <>
                        <td className="c-date"><div className="tbl-event">{h.date}</div><div className="tbl-sub">{h.weekday}</div></td>
                        <td className="c-main"><div className="tbl-event"><Link className="am-link" href={`/admin/plashtaniya/partidi/${h.id}`}>{h.label}</Link></div>{h.rail && <div className="tbl-sub">{h.rail}</div>}</td>
                        <td className="num muted c-count">{h.partners}</td>
                        <td className="num strong c-amount">{money(h.netCents)}</td>
                        <td className="c-status"><span className={`badge ${h.badge.cls}`}>{h.badge.label}</span></td>
                      </>
                    );
                    return h.reportable ? (
                      <RowAction key={h.id} formId={`report-${h.id}`} label={`Отчет за партида · ${h.label}`}>{cells}</RowAction>
                    ) : <tr key={h.id}>{cells}</tr>;
                  })}
                </tbody>
              </table></div>
            ) : <div className="ui-empty">Няма записи в този изглед.</div>}
            {r.history.filter(h => h.reportable).map(h => (
              <form key={h.id} id={`report-${h.id}`} action={batchReportAction} hidden>
                <input type="hidden" name="batchId" value={h.id} />
              </form>
            ))}
          </section>

          {r.accounts.length > 0 && (
            <section className="dcard">
              <div className="dcard-head">
                <h2 className="dcard-title">Нова сметка за проверка</h2>
                <span className="badge badge--warning">{r.accounts.length}</span>
              </div>
              {r.accounts.map(a => (
                <div className="batch am-acct" key={a.id}>
                  <span>
                    <span className="batch-n">{a.partnerName}</span>
                    <span className="batch-s">{[a.legalName, a.eik ? `ЕИК ${a.eik}` : null, `IBAN ···${a.ibanLast4}`, a.bankName].filter(Boolean).join(' · ')}</span>
                    <span className="batch-s">Титуляр: {a.holderName} · {a.submitted}</span>
                  </span>
                  <span className="am-acct-acts">
                    <form action={confirmAccountAction}>
                      <input type="hidden" name="accountId" value={a.id} />
                      <Submit className="btn btn--primary btn--sm">Потвърди</Submit>
                    </form>
                    <Dialog className="btn btn--outline btn--sm" label="Откажи" title="Откажи сметката">
                      <form action={rejectAccountAction} className="am-form">
                        <input type="hidden" name="accountId" value={a.id} />
                        <label className="fld">
                          <span className="fld-l">Причина</span>
                          <textarea className="fld-i fld-i--area" name="reason" rows={3} required maxLength={1000} />
                        </label>
                        <div className="am-dialog-acts">
                          <Submit className="btn btn--primary">Откажи сметката</Submit>
                          <DialogClose className="btn btn--ghost">Назад</DialogClose>
                        </div>
                      </form>
                    </Dialog>
                  </span>
                </div>
              ))}
            </section>
          )}
        </div>

        <aside>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Как се движат парите</h2></div>
            <div className="rules">
              <div className="rule"><span className="rule-num">1</span><span>Клиентът плаща <strong>цялата сума</strong> в платформата до 24 часа след одобрение.</span></div>
              <div className="rule"><span className="rule-num">2</span><span>Сумата стои <strong>задържана</strong> до деня след събитието.</span></div>
              <div className="rule"><span className="rule-num">3</span><span>Платформата удържа <strong>{r.commissionPct} комисиона</strong> и изплаща остатъка.</span></div>
              <div className="rule"><span className="rule-num">4</span><span>При спор изплащането спира, докато не се вземе решение.</span></div>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title" style={{ fontSize: 17 }}>Следваща партида</h2>
              {batchPath() && <Link className="link-more" href={batchPath()!}>{nb.date}</Link>}
            </div>
            <div className="split"><span>Изпълнители</span><b>{nb.partners}</b></div>
            <div className="split"><span>Бруто</span><b>{moneyShort(nb.grossCents)}</b></div>
            <div className="split is-fee"><span>Комисиона</span><b>− {moneyShort(nb.commissionCents)}</b></div>
            <div className="split is-total"><span>За превод</span><b>{moneyShort(nb.netCents)}</b></div>
            <div className="hint" style={{ marginTop: 14 }}>
              {CAL}
              <span>Партидите тръгват на {r.payoutDays.map((d, i) => <span key={d}>{i > 0 && (i === r.payoutDays.length - 1 ? ' и ' : ', ')}<b>{d}-{d === 1 ? 'во' : 'то'}</b></span>)} число.</span>
            </div>
            {nb.approvedBy && r.secondAdmin && <div className="hint" style={{ marginTop: 10 }}>{CAL}<span>Одобрена от {nb.approvedBy} — чака втори администратор.</span></div>}
            {r.canRelease && <div style={{ marginTop: 16 }}>{release('Пусни партидата', 'card', 'btn btn--primary btn--block')}</div>}
          </section>
        </aside>
      </div>
    </div>
  );
}
