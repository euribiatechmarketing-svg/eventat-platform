// /partner/poddrazhka/[nomer] — the partner's case (SCREENS §7; email CTAs ‹Изпрати позицията›,
// ‹Отговори на екипа›): the other side's statement and evidence, the 48 h countdown, the decision once
// made; ‹Изпрати позицията› / ‹Отговори на екипа› → disputes.submitStatement(); withdraw (X9).
// Guard: partner, own booking (404).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DecisionCard, MoneyCard, Num, Parties, Questions, Timeline } from '@/components/messaging-support/CaseParts';
import { StatementForm } from '@/components/messaging-support/DisputeForms';
import { TimeLeft } from '@/components/messaging-support/live';
import { requireRole } from '@/lib/session';
import { now } from '@/lib/clock';
import { actorFromUser } from '@/lib/domain/actor';
import { caseView, supportSettings } from '@/lib/domain/views-messaging-support';
import { submitStatementAction, uploadEvidenceAction, withdrawDisputeAction } from '../actions';

export const dynamic = 'force-dynamic';

const BACK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>;

export async function generateMetadata({ params }: { params: Promise<{ nomer: string }> }) {
  return { title: `Кейс № ${decodeURIComponent((await params).nomer)}` };
}

export default async function PartnerCasePage({ params }: { params: Promise<{ nomer: string }> }) {
  const number = decodeURIComponent((await params).nomer);
  const user = await requireRole('partner', `/partner/poddrazhka/${encodeURIComponent(number)}`);
  const actor = await actorFromUser(user);
  if (!actor.partnerId) notFound();
  const [view, s, at] = await Promise.all([caseView(actor, number), supportSettings(), now()]);
  if (!view) notFound();

  return (
    <>
      <Link className="crumb" href="/partner/poddrazhka">{BACK}Поддръжка</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title"><Num text={view.title} /></h1>
          <p className="page-sub">{view.sub}</p>
        </div>
        <div className="page-head-right"><span className={view.badge.cls}>{view.badge.label}</span></div>
      </div>

      <div className="dash-grid ms-case-grid">
        <div className="cs-main">
          <Parties view={view} />
          <Questions view={view} />
          <Timeline view={view} />
          {view.open && (
            <StatementForm variant="partner" disputeId={view.id} number={view.number}
              submitLabel={view.positionPending ? 'Изпрати позицията' : 'Изпрати'}
              action={submitStatementAction} upload={uploadEvidenceAction} maxPhotos={s.maxPhotos} maxMb={s.maxMb} />
          )}
        </div>
        <aside className="ms-aside">
          {view.deadline && (
            <div className="countdown">
              <div className="countdown-label">{view.deadline.label}</div>
              <div className="countdown-time"><TimeLeft dueAt={view.deadline.dueAt} serverNow={at.toISOString()} /></div>
              <div className="countdown-note">{view.deadline.text}</div>
            </div>
          )}
          <MoneyCard view={view} />
          <DecisionCard view={view} />
          {view.canWithdraw && (
            <div className="panel">
              <p className="panel-text">Ако се разберете с клиента преди решението, оттеглете сигнала и изплащането тръгва по обичайния график.</p>
              <form action={withdrawDisputeAction}>
                <input type="hidden" name="disputeId" value={view.id} />
                <input type="hidden" name="number" value={view.number} />
                <button className="btn btn--outline btn--sm" type="submit">Оттегли сигнала</button>
              </form>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
