// client/dispute.html: ‹Сигнал до екипа› form (the client's eligible bookings, SPEC §4.11 X1) and
// ‹Моите сигнали›. `/akaunt/poddrazhka/nov?rezervaciya=` preselects a booking.
import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { ClientDisputeForm } from '@/components/messaging-support/DisputeForms';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { plural } from '@/lib/format';
import { CLIENT_REASON_OPTIONS, clientDisputeChoices, partyCases, supportSettings } from '@/lib/domain/views-messaging-support';
import { openDisputeAction, uploadEvidenceAction } from './actions';

const CHEVRON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg>;

export async function ClientSupportScreen({ preselect, path }: { preselect: string | null; path: string }) {
  const user = await requireRole('client', path);
  const actor = await actorFromUser(user);
  const [choices, cases, s] = await Promise.all([clientDisputeChoices(actor), partyCases(actor), supportSettings()]);
  return (
    <>
      <SiteHeader active="/akaunt/zayavki" />
      <main className="wrap" id="main">
        <div className="hold ms-hold" style={{ paddingBottom: 32 }}>
          <div className="crumbs"><Link href="/akaunt/rezervacii">Моите резервации</Link>{CHEVRON}<span>Сигнал до екипа</span></div>
          <div className="h-row">
            <div>
              <h1 className="h-page">Сигнал до екипа</h1>
              <p className="h-sub">Отворете сигнал, когато нещо по резервация не е наред. Средствата остават задържани, докато екипът разгледа случая.</p>
            </div>
          </div>

          <div className="pv-grid">
            <div>
              <ClientDisputeForm choices={choices} reasons={CLIENT_REASON_OPTIONS} preselect={preselect}
                action={openDisputeAction} upload={uploadEvidenceAction} maxPhotos={s.maxPhotos} maxMb={s.maxMb} />

              <section className="dcard" style={{ marginTop: 16 }}>
                <div className="dcard-head">
                  <h2 className="dcard-title" style={{ fontSize: 19 }}>Моите сигнали</h2>
                  {cases.openCount > 0 && <span className="badge badge--warning badge--dot">{cases.openCount} {cases.openCount === 1 ? 'отворен' : 'отворени'}</span>}
                </div>
                {cases.items.map(c => (
                  <Link key={c.number} className={`dp-case${c.open ? ' is-open' : c.done ? ' is-done' : ''}`} href={`/akaunt/poddrazhka/${encodeURIComponent(c.number)}`}>
                    <span className="dp-case-bar" />
                    <span>
                      <span className="dp-case-n">{c.title}</span>
                      <span className="dp-case-s">{c.sub}</span>
                    </span>
                    <span className="dp-case-end">
                      <span className={c.badge.cls}>{c.badge.label}</span>
                      <span className="dp-case-amt">{c.amount}</span>
                    </span>
                  </Link>
                ))}
                {!cases.items.length && <div className="ui-empty">Няма записи в този изглед.</div>}
              </section>
            </div>

            <aside>
              <div className="dcard">
                <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Какво следва</h2></div>
                <div className="dp-side-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                  <span>Екипът отговаря в рамките на {plural(s.teamHours, 'час', 'часа')} и може да поиска още детайли от вас.</span>
                </div>
                <div className="dp-side-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="4" y="10" width="16" height="10" rx="2" /><path d="M8 10V7a4 4 0 018 0v3" /></svg>
                  <span>Средствата по резервацията остават задържани, докато случаят се разглежда.</span>
                </div>
                <div className="dp-side-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></svg>
                  <span>Решението идва по имейл до вас и до изпълнителя, с мотив.</span>
                </div>
                <div className="dp-side-l">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 5h16v12H8l-4 4z" /></svg>
                  <span>Изпълнителят вижда сигнала и има срок да отговори със своята позиция.</span>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}
