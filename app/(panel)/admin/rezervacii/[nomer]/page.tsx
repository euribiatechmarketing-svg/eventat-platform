// Резервация — the booking record (prototype admin/booking.html; SCREENS §8 /admin/rezervacii/[nomer]).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import '@/styles/m-admin-money.css';
import { PageChrome } from '../../_money/chrome';
import { BOOKING_BADGE, bookingRecord } from '@/lib/domain/views-admin-money';
import { date, dateNumeric, dateTime, money, plural } from '@/lib/format';
import { NUMBER_RE, adminActor, bookingPath, casePath } from '../../_money/server';
import { Dialog, DialogClose, NoteField, PrintLink, RefundSplit, Submit } from '../../_money/ui';
import { addNoteAction, cancelAction, declineCancelAction, extendAction, openDisputeAction } from './actions';

type P = Promise<{ nomer: string }>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  return { title: `Резервация ${decodeURIComponent((await params).nomer)}` };
}

const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>;
const CLOCK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const DOT = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="12" cy="12" r="4" /></svg>;
const TL_DONE = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M20 6L9 17l-5-5" /></svg>;
const TL_NOW = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const INFO = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>;

export default async function AdminBooking({ params }: { params: P }) {
  const number = decodeURIComponent((await params).nomer);
  if (!NUMBER_RE.test(number)) notFound();
  const page = bookingPath(number);
  const actor = await adminActor(page);
  const r = await bookingRecord(actor, number);
  if (!r) notFound();
  const { booking: b, money: m } = r;
  const badge = BOOKING_BADGE[b.status];
  const paid = m.paidCents + m.refundedCents;
  const line = m.line;
  const q = r.cancelQuote;
  const partnerReq = b.status === 'cancellation_requested';

  return (
    <div className="am">
      <PageChrome title={`Резервация\u00a0·\u00a0№\u00a0${b.number}`} short="Резервация" />
      <Link className="crumb" href="/admin/rezervacii"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>Резервации</Link>

      <div className="page-head">
        <div>
          <h1 className="page-title">Резервация</h1>
          <p className="page-sub">№ {b.number} · {r.event.name.toLowerCase()} на {date(b.eventDate)}{r.event.venue ? ` · ${[r.event.venue, r.event.locality].filter(Boolean).join(', ')}` : ''}</p>
        </div>
        <div className="page-head-right">
          <span className={`badge ${badge.cls}`}>{badge.label}</span>
          {r.days > 0 && ['awaiting_payment', 'confirmed', 'cancellation_requested'].includes(b.status) && <span className="badge badge--primary">след {plural(r.days, 'ден', 'дни')}</span>}
        </div>
      </div>

      <div className="adm-grid">
        <div>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Страни</h2></div>
            <div className="bkg-parties">
              <div className="bkg-party">
                <div className="bkg-party-h">
                  <span className="avatar">{r.client.initials}</span>
                  <div>
                    <div className="bkg-party-n">{r.client.name}</div>
                    <div className="bkg-party-r">{r.client.role}</div>
                  </div>
                  <Link className="btn btn--outline btn--sm bkg-party-a" href={`/admin/klienti/${r.client.id}`}>Профил</Link>
                </div>
                <div className="bkg-line"><span className="bkg-line-l">Имейл</span><span className="bkg-line-v">{r.client.email}</span></div>
                {r.client.phone && <div className="bkg-line"><span className="bkg-line-l">Телефон</span><span className="bkg-line-v">{r.client.phone}</span></div>}
                {r.client.card && <div className="bkg-line"><span className="bkg-line-l">Плащане</span><span className="bkg-line-v">{r.client.card}</span></div>}
                <div className="bkg-line"><span className="bkg-line-l">В платформата</span><span className="bkg-line-v">{r.client.stats}</span></div>
              </div>

              <Link className="bkg-party" href={`/admin/partnyori/${r.partner.id}`}>
                <div className="bkg-party-h">
                  <span className="avatar">{r.partner.initials}</span>
                  <div>
                    <div className="bkg-party-n">{r.partner.name}</div>
                    <div className="bkg-party-r">{r.partner.role}</div>
                  </div>
                </div>
                <div className="bkg-line"><span className="bkg-line-l">Контакт</span><span className="bkg-line-v">{r.partner.contactName}</span></div>
                <div className="bkg-line"><span className="bkg-line-l">Имейл</span><span className="bkg-line-v">{r.partner.email}</span></div>
                {r.partner.eik && <div className="bkg-line"><span className="bkg-line-l">ЕИК</span><span className="bkg-line-v">{r.partner.eik}</span></div>}
                <div className="bkg-line"><span className="bkg-line-l">В платформата</span><span className="bkg-line-v">{r.partner.stats}</span></div>
              </Link>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Събитието</h2>
              {['confirmed', 'cancellation_requested', 'awaiting_payment'].includes(b.status) && <span className="badge badge--success badge--dot">Датата е запазена</span>}
            </div>
            <div className="kv">
              <div className="kv-item"><div className="kv-label">Събитие</div><div className="kv-value">{r.event.name} <small>{r.event.guests}</small></div></div>
              <div className="kv-item"><div className="kv-label">Дата и час</div><div className="kv-value">{r.event.date} <small>{r.event.when}</small></div></div>
              <div className="kv-item"><div className="kv-label">Локация</div><div className="kv-value">{r.event.venue ?? '—'} {r.event.locality && <small>{r.event.locality}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Услуга</div><div className="kv-value">{r.event.service} {r.event.serviceSummary && <small>{r.event.serviceSummary}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Анулиране</div><div className="kv-value">{r.event.policy} {r.event.policyNote && <small>{r.event.policyNote}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Резервация №</div><div className="kv-value">{b.number} {r.event.origin && <small>{r.event.origin}</small>}</div></div>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title">Пари</h2>
              {m.paidOn
                ? <span className="badge badge--success badge--dot">Платена на {m.paidOn}</span>
                : <span className={`badge ${badge.cls}`}>{badge.label}</span>}
            </div>
            <div className="bkg-money">
              <div>
                <div className="split"><span>{m.serviceTitle}</span><b>{money(m.amountCents)}</b></div>
                <div className="split"><span>Такса резервация</span><b>{money(m.feeCents)}</b></div>
                <div className="split"><span>Платено от клиента</span><b>{money(paid)}</b></div>
                {m.refundedCents > 0 && <div className="split is-fee"><span>Върнати</span><b>− {money(m.refundedCents)}</b></div>}
                {m.commission && b.status !== 'cancelled' && b.status !== 'payment_expired' && b.status !== 'approval_withdrawn' && (
                  <>
                    <div className="split is-fee"><span>Комисиона ({m.commission.pct})</span><b>− {money(m.commission.cents)}</b></div>
                    <div className="split is-total"><span>За изплащане</span><b>{money(m.commission.partnerCents)}</b></div>
                  </>
                )}
                {m.commission && b.status === 'cancelled' && r.cancellation && (
                  <div className="split is-total"><span>За изплащане</span><b>{money(r.cancellation.partnerAmountCents)}</b></div>
                )}
              </div>
              <div className="kv" style={{ gridTemplateColumns: '1fr 1fr' }}>
                {m.paidAtLong
                  ? <div className="kv-item"><div className="kv-label">Платено на</div><div className="kv-value">{m.paidAtLong} {m.card && <small>{m.card}</small>}</div></div>
                  : <div className="kv-item"><div className="kv-label">Срок за плащане</div><div className="kv-value">{dateTime(m.dueAt)}</div></div>}
                <div className="kv-item"><div className="kv-label">Задържано до</div><div className="kv-value">{m.holdUntil} <small>денят след събитието</small></div></div>
                <div className="kv-item"><div className="kv-label">Партида</div><div className="kv-value">{m.batchDate} <small>първата след събитието</small></div></div>
                <div className="kv-item"><div className="kv-label">Сметка</div><div className="kv-value">{m.account ? <>IBAN ···{m.account.last4} <small>{m.account.bank}</small></> : '—'}</div></div>
              </div>
            </div>
            {['confirmed', 'cancellation_requested'].includes(b.status) && (
              <div className="bkg-hold">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>
                <span className="bkg-hold-t">Сумата стои в платформата до деня след събитието.{m.commission && <> Изпълнителят получава <b>{money(m.commission.partnerCents)}</b>, платформата задържа <b>{money(m.commission.cents)}</b> комисиона.</>}</span>
              </div>
            )}
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title">Какво се случи</h2></div>
            <div className="tl">
              {r.timeline.map((t, i) => (
                <div key={i} className={`tl-item${t.state === 'done' ? ' is-done' : t.state === 'current' ? ' is-current' : ''}`}>
                  <span className="tl-dot">{t.state === 'done' ? TL_DONE : t.state === 'current' ? TL_NOW : DOT}</span>
                  <div><div className="tl-title">{t.title}</div><div className="tl-time">{t.time}</div></div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <aside>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Действия</h2></div>
            <div className="am-acts">
              <PrintLink className="btn btn--outline btn--block" href={`${page}/pdf`}>Свали PDF</PrintLink>
              <a className="btn btn--outline btn--block" href={`mailto:${encodeURIComponent(r.client.email)},${encodeURIComponent(r.partner.email)}?subject=${encodeURIComponent(`Резервация № ${b.number}`)}`}>Свържи се с двете страни</a>
              {r.can.extend && (
                <form action={extendAction}>
                  <input type="hidden" name="number" value={b.number} />
                  <Submit className="btn btn--outline btn--block">Удължи срока</Submit>
                </form>
              )}
              {r.can.openDispute && (
                <Dialog className="btn btn--ghost btn--block" label="Отвори спор" title="Отвори спор">
                  <form action={openDisputeAction} className="am-form">
                    <input type="hidden" name="number" value={b.number} />
                    <label className="fld">
                      <span className="fld-l">Причина</span>
                      <span className="select-wrap am-select">
                        <select className="fld-i" name="reason" defaultValue="other">
                          {r.clientReasons.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                        <svg className="select-chevron" viewBox="0 0 20 20"><path d="M5.5 8l4.5 4.5L14.5 8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      </span>
                    </label>
                    <label className="fld">
                      <span className="fld-l">Сигналът накратко</span>
                      <textarea className="fld-i fld-i--area" name="description" rows={4} required maxLength={4000} />
                    </label>
                    <div className="hint">{INFO}<span>При отворен спор изплащането спира до вземането&nbsp;на&nbsp;решение.</span></div>
                    <div className="am-dialog-acts">
                      <Submit className="btn btn--primary">Отвори спор</Submit>
                      <DialogClose className="btn btn--ghost">Откажи</DialogClose>
                    </div>
                  </form>
                </Dialog>
              )}
              {r.can.viewDispute && r.dispute && <Link className="btn btn--ghost btn--block" href={casePath(r.dispute.number)}>Виж спора</Link>}
              {r.can.cancel && q && (
                <Dialog className="btn btn--ghost btn--block am-danger" label="Анулирай резервацията" title="Анулирай резервацията">
                  <form action={cancelAction} className="am-form">
                    <input type="hidden" name="number" value={b.number} />
                    <input type="hidden" name="mode" value={partnerReq ? 'partner' : 'team'} />
                    <div>
                      <div className="split"><span>Платено</span><b>{money(q.paidCents)}</b></div>
                      {partnerReq ? (
                        <>
                          <div className="split"><span>Връща се</span><b>{money(q.refundCents)}</b></div>
                          <div className="split is-fee"><span>Задържа се</span><b>{money(q.retainedCents)}</b></div>
                        </>
                      ) : <RefundSplit paidCents={q.paidCents} refundCents={q.refundCents} />}
                    </div>
                    {!partnerReq && (
                      <label className="fld">
                        <span className="fld-l">Причина за анулирането</span>
                        <textarea className="fld-i fld-i--area" name="reason" rows={3} required maxLength={2000} />
                      </label>
                    )}
                    <div className="am-dialog-acts">
                      <Submit className="btn btn--primary">Анулирай резервацията</Submit>
                      <DialogClose className="btn btn--ghost">Откажи</DialogClose>
                    </div>
                  </form>
                </Dialog>
              )}
              {r.can.cancel && partnerReq && (
                <form action={declineCancelAction}>
                  <input type="hidden" name="number" value={b.number} />
                  <Submit className="btn btn--ghost btn--block">Откажи анулирането</Submit>
                </form>
              )}
            </div>
            <div className="hint" style={{ marginTop: 16 }}>
              {INFO}
              <span>{r.partnerRequest ? `${r.partner.name} поиска анулиране на ${date(r.partnerRequest.requestedAt)}.` : <>При отворен спор изплащането спира до вземането&nbsp;на&nbsp;решение.</>}</span>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Състояние</h2></div>
            {b.paidAt ? (
              <div className="chk is-ok"><span className="chk-box">{CHECK}</span><span><span className="chk-n">Плащането е получено</span><span className="chk-d">{money(paid)} в платформата от {dateNumeric(b.paidAt)}</span></span></div>
            ) : b.status === 'awaiting_payment' ? (
              <div className="chk is-wait"><span className="chk-box">{CLOCK}</span><span><span className="chk-n">Чака плащане</span><span className="chk-d">Срокът изтича {dateTime(b.paymentDueAt)}</span></span></div>
            ) : null}
            {['awaiting_payment', 'confirmed', 'cancellation_requested', 'completed'].includes(b.status) && (
              <div className="chk is-ok"><span className="chk-box">{CHECK}</span><span><span className="chk-n">Датата е блокирана</span><span className="chk-d">{date(b.eventDate)} в календара на изпълнителя</span></span></div>
            )}
            {r.dispute ? (
              <div className={`chk ${r.dispute.open ? 'is-wait' : 'is-ok'}`}>
                <span className="chk-box">{r.dispute.open ? CLOCK : CHECK}</span>
                <span><span className="chk-n">{r.dispute.open ? 'Отворен спор' : r.dispute.badge.label}</span><span className="chk-d">Кейс № {r.dispute.number} · {r.dispute.badge.label.toLowerCase()}</span></span>
              </div>
            ) : (
              <div className="chk is-ok"><span className="chk-box">{CHECK}</span><span><span className="chk-n">Без спор</span><span className="chk-d">Няма оплакване от нито една от страните</span></span></div>
            )}
            {line && line.status !== 'cancelled' && (
              line.status === 'paid'
                ? <div className="chk is-ok"><span className="chk-box">{CHECK}</span><span><span className="chk-n">Изплатено</span><span className="chk-d">{m.commission ? `${money(line.amountCents)} ` : ''}на {line.paidAt ? dateNumeric(line.paidAt) : m.batchDate}</span></span></div>
                : <div className="chk is-wait"><span className="chk-box">{CLOCK}</span><span><span className="chk-n">{line.status === 'held' ? 'Изплащането е задържано' : 'Изплащането предстои'}</span><span className="chk-d">{m.commission ? `${money(line.amountCents)} ` : ''}в партидата на {dateNumeric(line.batchDate)}</span></span></div>
            )}
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Бележки от екипа</h2></div>
            {r.notes.map(n => (
              <div className="rev" key={n.id}>
                <div className="rev-head">
                  <span className="avatar avatar--sm">{n.initials}</span>
                  <div><div className="rev-name">{n.author}</div><div className="rev-meta">{n.at}</div></div>
                </div>
                <div className="rev-text">{n.body}</div>
              </div>
            ))}
            <NoteField action={addNoteAction} hidden={{ number: b.number }} />
            <div className="hint am-only">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
              <span>Бележката се вижда само от екипа на платформата.</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

