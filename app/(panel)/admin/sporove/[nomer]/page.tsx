// Кейс — the case page (prototype admin/dispute.html?c=…; SCREENS §8 /admin/sporove/[nomer], resolve_disputes).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment, type ReactNode } from 'react';
import '@/styles/m-admin-money.css';
import { PageChrome } from '../../_money/chrome';
import { disputeCase, type CaseParty } from '@/lib/domain/views-admin-money';
import { hoursText } from '@/lib/format';
import { NUMBER_RE, adminActor, bookingPath, casePath } from '../../_money/server';
import { DecisionForm, Dialog, DialogClose, Submit } from '../../_money/ui';
import { decideAction, extendAction, holdAction, remindAction, requestInfoAction } from './actions';

type P = Promise<{ nomer: string }>;

export async function generateMetadata({ params }: { params: P }): Promise<Metadata> {
  return { title: `Кейс ${decodeURIComponent((await params).nomer)}` };
}

const ICON = {
  back: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>,
  check: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M20 6L9 17l-5-5" /></svg>,
  clock: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>,
  dot: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="4" /></svg>,
  info: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>,
  warn: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l9 16H3l9-16z" /><path d="M12 10v4M12 17h.01" /></svg>,
  flag: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 21V4M5 4h12l-2.5 4 2.5 4H5" /></svg>,
  doc: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>,
};

/** Digits never in the display face: wrap each run in .num. */
function Num({ text }: { text: string }) {
  return <>{text.split(/(\d+)/).map((p, i) => (/^\d+$/.test(p) ? <span key={i} className="num">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}

function Party({ p }: { p: CaseParty }) {
  return (
    <div className={`cs-party${p.vendor ? ' is-vendor' : ''}`}>
      <div className="cs-party-h">
        <span className="cs-av">{p.initials}</span>
        <span><span className="cs-party-n">{p.name}</span><span className="cs-party-r">{p.role}</span></span>
        {p.filer && <span className="cs-filer">{ICON.flag}{p.plural ? 'Подадоха сигнала' : 'Подаде сигнала'}</span>}
      </div>
      {p.wait ? (
        <div className="cs-wait"><b>{p.wait[0]}</b>{p.wait[1] && <span>{p.wait[1]}</span>}</div>
      ) : p.statements.map((s, i) => (
        <Fragment key={i}>
          <div className="cs-quote">„{s.body}“<span className="cs-quote-m">{s.meta}</span></div>
          {(s.pics.length > 0 || s.docs.length > 0) && (
            <div className="cs-att">
              {s.pics.map(k => <a key={k.href} className="cs-att-i" href={k.href} target="_blank" rel="noopener" style={{ backgroundImage: `url('${k.thumb}')` }} aria-label={k.name} title={k.name} />)}
              {s.docs.map((d, i) => d.href
                ? <a key={d.href} className="cs-doc" href={d.href} target="_blank" rel="noopener">{ICON.doc}{d.name}</a>
                : <span key={`${d.name}${i}`} className="cs-doc">{ICON.doc}{d.name}</span>)}
            </div>
          )}
        </Fragment>
      ))}
    </div>
  );
}

function Card({ title, children, small }: { title: string; children: ReactNode; small?: boolean }) {
  return (
    <section className="dcard">
      <div className="dcard-head"><h2 className="dcard-title" style={small ? { fontSize: 17 } : undefined}>{title}</h2></div>
      {children}
    </section>
  );
}

export default async function AdminCase({ params }: { params: P }) {
  const number = decodeURIComponent((await params).nomer);
  if (!NUMBER_RE.test(number)) notFound();
  const actor = await adminActor(casePath(number), 'resolve_disputes');
  const c = await disputeCase(actor, number);
  if (!c) notFound();

  return (
    <div className="am">
      <PageChrome title={`Кейс\u00a0·\u00a0№\u00a0${c.number}`} />
      <Link className="crumb" href="/admin/sporove">{ICON.back}Назад към споровете</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Num text={c.title} /></h1>
          <p className="page-sub">{c.sub}</p>
        </div>
        <div className="page-head-right">
          {c.urgent && <span className="badge badge--danger">Спешно</span>}
          <span className={`badge ${c.badge.cls}`}>{c.badge.label}</span>
        </div>
      </div>

      <div className="adm-grid">
        <div className="cs-main">
          <Card title="Сигналът накратко">
            <p className="cs-sum">{c.summary}</p>
            {c.facts.length > 0 && (
              <div className="cs-facts">
                {c.facts.map((f, i) => (
                  <div key={i} className={`cs-fact${f[2] === 'warn' ? ' is-warn' : ''}`}><span className="cs-fact-l">{f[0]}</span><span className="cs-fact-v">{f[1]}</span></div>
                ))}
              </div>
            )}
          </Card>

          <div className="cs-vs"><Party p={c.client} /><Party p={c.partner} /></div>

          {(c.agreed.length > 0 || c.comparison || c.note) && (
            <Card title="Какво е договорено">
              {c.agreed.length > 0 && (
                <div className="kv">
                  {c.agreed.map((a, i) => (
                    <div key={i} className={`kv-item${a[3] === 'key' ? ' cs-key' : ''}`}>
                      <div className="kv-label">{a[0]}</div>
                      <div className="kv-value">{a[1]}{a[2] ? <> <small>{a[2]}</small></> : null}</div>
                    </div>
                  ))}
                </div>
              )}
              {c.comparison && (
                <div className="cs-cmp">
                  {c.comparison.map((x, i) => (
                    <div key={i} className={`mod-side${x[2] ? ' is-new' : ''}`}><span className="mod-side-l">{x[0]}</span><span className="mod-side-v">{x[1]}</span></div>
                  ))}
                </div>
              )}
              {(c.note || c.revisionHref) && (
                <div className="cs-note">{ICON.info}<span>{c.note}{c.revisionHref && <> <Link href={c.revisionHref}>Виж редакцията →</Link></>}</span></div>
              )}
            </Card>
          )}

          <Card title="Хронология">
            <div className="tl">
              {c.timeline.map((t, i) => (
                <div key={i} className={`tl-item${t.state === 'done' ? ' is-done' : t.state === 'current' ? ' is-current' : ''}`}>
                  <span className="tl-dot">{t.state === 'done' ? ICON.check : t.state === 'current' ? ICON.clock : ICON.dot}</span>
                  <div><div className="tl-title">{t.title}</div>{t.time && <div className="tl-time">{t.time}</div>}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <aside>
          <Card title="Пари по случая" small>
            <span className="cs-money-v">{c.money.value}</span>
            <span className="cs-money-l">{c.money.label}</span>
            <div className="cs-note">{ICON.info}<span>{c.money.note}</span></div>
            {c.open && c.paid > 0 && (
              <form action={holdAction} className="am-hold">
                <input type="hidden" name="number" value={c.number} />
                <input type="hidden" name="hold" value={c.holdsPayout ? 'off' : 'on'} />
                <button type="submit" className="am-hold-btn" role="switch" aria-checked={c.holdsPayout}>
                  <span className={`toggle${c.holdsPayout ? ' is-on' : ''}`} aria-hidden="true" />
                  <span className="am-hold-t">{c.holdsPayout ? 'Изплащането е спряно до решението' : 'Изплащането следва обичайния график'}</span>
                </button>
              </form>
            )}
            <Link className="link-more am-booking-link" href={bookingPath(c.bookingNumber)}>Резервация № {c.bookingNumber}<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 6l6 6-6 6" /></svg></Link>
          </Card>

          {c.decision ? (
            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Решение</h2><span className="badge badge--success badge--dot">Изпратено</span></div>
              <div className="cs-done"><span className="cs-done-n">{c.decision.title}</span>{c.decision.detail && <span className="cs-done-d">{c.decision.detail}</span>}</div>
              <div className="fld-l" style={{ marginTop: 18 }}>Мотив към двете страни</div>
              <p className="cs-motive-t" style={{ marginTop: 0 }}>{c.decision.motive}</p>
              <span className="cs-by">{c.decision.by}</span>
            </section>
          ) : c.open ? (
            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Решение</h2></div>
              {c.warn && (
                <div className="cs-warn">{ICON.warn}<span className="cs-warn-b"><span>{c.warn.text}</span>
                  {c.warn.extend && (
                    <form action={extendAction}>
                      <input type="hidden" name="number" value={c.number} />
                      <Submit className="btn btn--outline btn--sm">Удължи срока с {hoursText(c.warn.extendHours ?? 0)}</Submit>
                    </form>
                  )}
                </span></div>
              )}
              <DecisionForm action={decideAction} disputeId={c.id} number={c.number} options={c.options} paidCents={c.paid} />
              <div className="cs-acts am-case-acts">
                {c.remind && (c.remind.side === 'partner' ? (
                  <form action={remindAction}>
                    <input type="hidden" name="number" value={c.number} />
                    <input type="hidden" name="side" value="partner" />
                    <Submit className="btn btn--outline btn--block">Напомни на изпълнителя</Submit>
                  </form>
                ) : (
                  <Dialog className="btn btn--outline btn--block" label="Напомни на клиента" title="Напомни на клиента">
                    <form action={remindAction} className="am-form">
                      <input type="hidden" name="number" value={c.number} />
                      <input type="hidden" name="side" value="client" />
                      <label className="fld">
                        <span className="fld-l">Какво очакваме от клиента</span>
                        <textarea className="fld-i fld-i--area" name="need" rows={3} required maxLength={1000} />
                      </label>
                      <div className="am-dialog-acts">
                        <Submit className="btn btn--primary">Напомни на клиента</Submit>
                        <DialogClose className="btn btn--ghost">Откажи</DialogClose>
                      </div>
                    </form>
                  </Dialog>
                ))}
                <Dialog className="btn btn--outline btn--block" label="Поискай още информация" title="Поискай още информация">
                  <form action={requestInfoAction} className="am-form">
                    <input type="hidden" name="number" value={c.number} />
                    <label className="fld">
                      <span className="fld-l">Въпрос към двете страни</span>
                      <textarea className="fld-i fld-i--area" name="question" rows={4} required maxLength={4000} />
                    </label>
                    <div className="am-dialog-acts">
                      <Submit className="btn btn--primary">Изпрати</Submit>
                      <DialogClose className="btn btn--ghost">Откажи</DialogClose>
                    </div>
                  </form>
                </Dialog>
              </div>
            </section>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
