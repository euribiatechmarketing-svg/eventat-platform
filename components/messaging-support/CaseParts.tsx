// Pieces of the case page shared by /akaunt/poddrazhka/[nomer] and /partner/poddrazhka/[nomer], drawn
// with the admin case page's classes (admin/dispute.html: .cs-party, .cs-quote, .tl, ‹Пари по случая›, ‹Решение›).
import type { CaseView } from '@/lib/domain/views-messaging-support';

const FLAG = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 21V4M5 4h12l-2.5 4 2.5 4H5" /></svg>;
const DOC = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M20 6L9 17l-5-5" /></svg>;
const CLOCK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const DOT = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="4" /></svg>;
const INFO = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>;

/** Digits never in the display face (CLAUDE.md copy rules). */
export function Num({ text }: { text: string }) {
  return <>{text.split(/(\d+)/).map((p, i) => (/^\d+$/.test(p) ? <span key={i} className="num">{p}</span> : p))}</>;
}

type File = CaseView['parties'][number]['statements'][number]['files'][number];
function Files({ files }: { files: File[] }) {
  if (!files.length) return null;
  return (
    <div className="cs-att">
      {files.map(f => f.isImage
        ? (f.href
          ? <a key={f.id} className="cs-att-i" href={f.href} target="_blank" rel="noopener" title={f.name} style={{ backgroundImage: `url('${f.href}')` }} aria-label={f.name} />
          : <span key={f.id} className="cs-doc">{DOC}{f.name}</span>)
        : (f.href
          ? <a key={f.id} className="cs-doc" href={f.href} target="_blank" rel="noopener">{DOC}{f.name}</a>
          : <span key={f.id} className="cs-doc">{DOC}{f.name}</span>))}
    </div>
  );
}

/** Both sides in their own words, client on the left. */
export function Parties({ view }: { view: CaseView }) {
  return (
    <div className="cs-vs">
      {view.parties.map(p => (
        <div key={p.party} className={`cs-party${p.party === 'partner' ? ' is-vendor' : ''}`}>
          <div className="cs-party-h">
            <span className="cs-av">{p.initials}</span>
            <span><span className="cs-party-n">{p.name}</span><span className="cs-party-r">{p.role}</span></span>
            {p.filer && <span className="cs-filer">{FLAG}{p.filer}</span>}
          </div>
          {p.statements.map(s => (
            <div key={s.id}>
              <div className="cs-quote">„{s.body}“<span className="cs-quote-m">{s.meta}</span></div>
              <Files files={s.files} />
            </div>
          ))}
          {p.waiting && <div className="cs-wait"><b>{p.waitingTitle}</b><span>{p.waiting}</span></div>}
        </div>
      ))}
    </div>
  );
}

/** The team's questions to this side (‹Въпрос по сигнала›, the subject of client-dispute-info-request). */
export function Questions({ view, cardClass = 'dcard' }: { view: CaseView; cardClass?: string }) {
  if (!view.questions.length) return null;
  return (
    <section className={cardClass}>
      <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Въпрос по сигнала</h2></div>
      {view.questions.map(q => (
        <div key={q.id} className="cs-quote">„{q.body}“<span className="cs-quote-m">{q.at}</span></div>
      ))}
    </section>
  );
}

/** ‹Хронология› */
export function Timeline({ view }: { view: CaseView }) {
  return (
    <section className="dcard">
      <div className="dcard-head"><h2 className="dcard-title">Хронология</h2></div>
      <div className="tl">
        {view.timeline.map((t, i) => (
          <div key={i} className={`tl-item${t.state === 'done' ? ' is-done' : t.state === 'current' ? ' is-current' : ''}`}>
            <span className="tl-dot">{t.state === 'done' ? CHECK : t.state === 'current' ? CLOCK : DOT}</span>
            <div><div className="tl-title">{t.title}</div>{t.time && <div className="tl-time">{t.time}</div>}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** ‹Пари по случая› */
export function MoneyCard({ view }: { view: CaseView }) {
  if (!view.money) return null;
  return (
    <section className="dcard">
      <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Пари по случая</h2></div>
      <span className="cs-money-v">{view.money.value}</span>
      <span className="cs-money-l">{view.money.label}</span>
      {view.money.note && <div className="cs-note">{INFO}<span>{view.money.note}</span></div>}
    </section>
  );
}

/** ‹Решение› once the team has decided (X8), with ‹Мотив към двете страни›. */
export function DecisionCard({ view }: { view: CaseView }) {
  if (!view.decision) return null;
  return (
    <section className="dcard">
      <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Решение</h2><span className="badge badge--success badge--dot">Изпратено</span></div>
      <div className="cs-done">
        <span className="cs-done-n">{view.decision.title}</span>
        {view.decision.detail && <span className="cs-done-d">{view.decision.detail}</span>}
      </div>
      {view.decision.motive && (
        <>
          <div className="fld-l" style={{ marginTop: 18 }}>Мотив към двете страни</div>
          <p className="cs-motive-t" style={{ marginTop: 0 }}>{view.decision.motive}</p>
        </>
      )}
      {view.decision.by && <span className="cs-by">{view.decision.by}</span>}
    </section>
  );
}
