// /akaunt/poddrazhka/[nomer] — the client's case (SCREENS §4, email CTAs ‹Моите сигнали›, ‹Отговори›,
// ‹Отговори на екипа›): both statements, the team's questions, the position deadline, the decision
// with its motive; ‹Отговори на екипа› → disputes.submitStatement(). Guard: client, own booking (404).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { DecisionCard, MoneyCard, Num, Parties, Questions, Timeline } from '@/components/messaging-support/CaseParts';
import { StatementForm } from '@/components/messaging-support/DisputeForms';
import { TimeLeft } from '@/components/messaging-support/live';
import { requireRole } from '@/lib/session';
import { now } from '@/lib/clock';
import { actorFromUser } from '@/lib/domain/actor';
import { caseView, supportSettings } from '@/lib/domain/views-messaging-support';
import { submitStatementAction, uploadEvidenceAction, withdrawDisputeAction } from '../actions';

export const dynamic = 'force-dynamic';

const CHEVRON = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg>;

export async function generateMetadata({ params }: { params: Promise<{ nomer: string }> }) {
  return { title: `Сигнал № ${decodeURIComponent((await params).nomer)}` };
}

export default async function ClientCasePage({ params }: { params: Promise<{ nomer: string }> }) {
  const number = decodeURIComponent((await params).nomer);
  const user = await requireRole('client', `/akaunt/poddrazhka/${encodeURIComponent(number)}`);
  const actor = await actorFromUser(user);
  const [view, s, at] = await Promise.all([caseView(actor, number), supportSettings(), now()]);
  if (!view) notFound();

  return (
    <>
      <SiteHeader active="/akaunt/zayavki" />
      <main className="wrap" id="main">
        <div className="hold ms-hold ms-case">
          <div className="crumbs"><Link href="/akaunt/poddrazhka">Моите сигнали</Link>{CHEVRON}<span>№ {view.number}</span></div>
          <div className="h-row">
            <div>
              <h1 className="h-page"><Num text={view.title} /></h1>
              <p className="h-sub">{view.sub}</p>
            </div>
            <div className="h-right"><span className={view.badge.cls}>{view.badge.label}</span></div>
          </div>

          <div className="pv-grid">
            <div className="cs-main">
              <Parties view={view} />
              <Questions view={view} />
              <Timeline view={view} />
              {view.open && (
                <StatementForm variant="client" disputeId={view.id} number={view.number} submitLabel="Изпрати"
                  action={submitStatementAction} upload={uploadEvidenceAction} maxPhotos={s.maxPhotos} maxMb={s.maxMb} />
              )}
            </div>
            <aside className="ms-aside">
              {view.deadline && (
                <div className="clock">
                  <div className="clock-l">{view.deadline.label}</div>
                  <div className="clock-v"><TimeLeft dueAt={view.deadline.dueAt} serverNow={at.toISOString()} /></div>
                  <div className="clock-n">{view.deadline.text}</div>
                </div>
              )}
              <MoneyCard view={view} />
              <DecisionCard view={view} />
              {view.canWithdraw && (
                <section className="dcard">
                  <p className="ms-note">Ако се разберете с изпълнителя преди решението, оттеглете сигнала.</p>
                  <form action={withdrawDisputeAction}>
                    <input type="hidden" name="disputeId" value={view.id} />
                    <input type="hidden" name="number" value={view.number} />
                    <button className="btn btn--outline btn--sm" type="submit">Оттегли сигнала</button>
                  </form>
                </section>
              )}
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
