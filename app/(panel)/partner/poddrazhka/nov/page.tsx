// /partner/poddrazhka/nov?rezervaciya=[nomer] — SCREENS §7 vendor/dispute.html form (guard: partner).
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { PartnerDisputeForm } from '@/components/messaging-support/DisputeForms';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { plural } from '@/lib/format';
import { PARTNER_REASON_OPTIONS, existingCaseNumber, partnerDisputeChoices, supportSettings } from '@/lib/domain/views-messaging-support';
import { openDisputeAction, uploadEvidenceAction } from '../actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Сигнал до екипа' };

const BACK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>;

export default async function PartnerNewCasePage({ searchParams }: { searchParams: Promise<{ rezervaciya?: string }> }) {
  const { rezervaciya } = await searchParams;
  const preselect = typeof rezervaciya === 'string' ? rezervaciya : null;
  const user = await requireRole('partner', `/partner/poddrazhka/nov${preselect ? `?rezervaciya=${encodeURIComponent(preselect)}` : ''}`);
  const actor = await actorFromUser(user);
  if (!actor.partnerId) notFound();
  // A booking that already has its case (one per booking) opens the case, as ‹Сигнал до екипа› on the booking does.
  const existing = preselect ? await existingCaseNumber(actor, preselect) : null;
  if (existing) redirect(`/partner/poddrazhka/${encodeURIComponent(existing)}`);
  const [choices, s] = await Promise.all([partnerDisputeChoices(actor, preselect ?? undefined), supportSettings()]);
  return (
    <>
      <Link className="crumb" href="/partner/rezervacii">{BACK}Назад към резервациите</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">Сигнал до екипа</h1>
          <p className="page-sub">Опишете какво се случва по дадена резервация и екипът на EventAT поема случая.</p>
        </div>
      </div>
      <PartnerDisputeForm choices={choices} reasons={PARTNER_REASON_OPTIONS} defaultReason="client_unresponsive" preselect={preselect}
        action={openDisputeAction} upload={uploadEvidenceAction} maxPhotos={s.maxPhotos} maxMb={s.maxMb}
        aside={
          <aside>
            <div className="panel">
              <h3 className="panel-title">Какво следва</h3>
              <div className="rules">
                <div className="rule"><span className="rule-num">1</span><span>Екипът отговаря до <strong>{plural(s.teamHours, 'час', 'часа')}</strong> и иска позиция от клиента.</span></div>
                <div className="rule"><span className="rule-num">2</span><span>Изплащането по резервацията <strong>спира до решение</strong>.</span></div>
                <div className="rule"><span className="rule-num">3</span><span>Решението идва <strong>по имейл</strong> до двете страни.</span></div>
              </div>
              <p className="panel-note">Резервацията остава в календара ви, докато случаят е отворен. Ако се разберете с клиента преди решението, оттеглете сигнала и изплащането тръгва по обичайния график.</p>
            </div>
          </aside>
        } />
    </>
  );
}
