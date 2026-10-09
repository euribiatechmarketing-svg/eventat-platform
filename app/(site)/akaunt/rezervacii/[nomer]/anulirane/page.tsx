// ‹Анулиране на резервация› (client/cancel.html → SCREENS §4 /akaunt/rezervacii/[nomer]/anulirane).
// The amounts are the exact cancellation.quote(booking, today, 'client') preview (SPEC §5).
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { ActionForm } from '@/components/client-booking/ActionForm';
import { Crumbs, Num, PartnerSum } from '@/components/client-booking/parts';
import { SubmitButton } from '@/components/client-booking/SubmitButton';
import { cancelPageData, numericDate } from '@/lib/domain/views-client-booking';
import { date, dateShort } from '@/lib/format';
import { numberParam, orNotFound, requireClient } from '@/lib/client-booking/guard';
import { cancelBookingAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Анулиране' };

const REASONS = [
  ['date_change', 'Промяна в датата'],
  ['other_vendor', 'Намерихме друг изпълнител'],
  ['event_cancelled', 'Събитието се отменя'],
] as const;

const SHIELD = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>;

export default async function CancelPage({ params }: { params: Promise<{ nomer: string }> }) {
  const { nomer } = await params;
  const number = numberParam(nomer);
  const n = encodeURIComponent(number);
  const { actor } = await requireClient(`/akaunt/rezervacii/${n}/anulirane`);
  const v = await orNotFound(cancelPageData(actor, number));
  if (!v.eligibility.allowed) redirect(`/akaunt/rezervacii/${n}`);
  const { booking: b, quote: q, partner: p } = v;
  const when = [date(b.eventDate), b.startTime ? b.startTime.slice(0, 5) : null].filter(Boolean).join(', ');

  return (
    <div className="hold" style={{ paddingBottom: 32 }}>
      <Crumbs items={[{ label: 'Моите резервации', href: '/akaunt/rezervacii' }, { label: 'Анулиране' }]} />
      <div className="h-row">
        <div>
          <h1 className="h-page">Анулиране на резервация</h1>
          {q.labels.headerSub && <p className="h-sub">{q.labels.headerSub}</p>}
        </div>
      </div>

      <div className="pv-grid">
        <ActionForm action={cancelBookingAction} className="form-card">
          <input type="hidden" name="number" value={b.number} />
          <div className="cx-top">
            <span className="cx-top-img" style={p.thumb ? { backgroundImage: `url('${p.thumb}')` } : undefined} />
            <div>
              <div className="cx-top-n"><Num>{p.name}</Num></div>
              <div className="cx-top-s">{[p.category, b.serviceTitle, when].filter(Boolean).join(' · ')}</div>
            </div>
          </div>

          <h2 className="cx-h">Политика на изпълнителя</h2>
          <div className="cx-pol">
            {SHIELD}
            <div>
              <div className="cx-pol-t">{v.policy.title}</div>
              <div className="cx-pol-d">{v.policy.policyBox ?? `${v.policy.description}.`}</div>
            </div>
          </div>

          <div className="cx-break">
            <div className="cx-cell">
              <div className="cx-cell-l">Платено</div>
              <div className="cx-cell-v">{q.labels.paid}</div>
              {v.paidOn && <div className="cx-cell-n">на {numericDate(v.paidOn)}</div>}
            </div>
            <div className="cx-cell cx-cell--back">
              <div className="cx-cell-l">Връща се</div>
              <div className="cx-cell-v">{q.labels.refund}</div>
              {q.labels.refundNote && <div className="cx-cell-n">{q.labels.refundNote}</div>}
            </div>
            <div className="cx-cell">
              <div className="cx-cell-l">Задържа се</div>
              <div className="cx-cell-v">{q.labels.retained}</div>
              {q.labels.retainedNote && <div className="cx-cell-n">{q.labels.retainedNote}</div>}
            </div>
          </div>

          <h2 className="cx-h" style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--app-line)' }}>Причина за анулирането</h2>
          <div className="cx-picks" role="radiogroup">
            {REASONS.map(([value, label]) => (
              <label key={value} className="cx-pick">
                <input type="radio" name="reason" value={value} required />
                <span className="cx-dot" />
                <span className="cx-pick-b"><span className="cx-pick-n">{label}</span></span>
              </label>
            ))}
            <label className="cx-pick cb-pick-other">
              <input type="radio" name="reason" value="other" required />
              <span className="cx-dot" />
              <span className="cx-pick-b">
                <span className="cx-pick-n">Друга причина</span>
                <textarea className="cx-free" name="reasonText" rows={2} maxLength={1000} aria-label="Друга причина" />
              </span>
            </label>
          </div>

          <div className="cx-next">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            <span>Изпълнителят получава известие веднага и датата му се освобождава. Потвърждението за анулирането и за възстановената сума идва на {v.email}.</span>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 20, flexWrap: 'wrap' }}>
            <SubmitButton className="btn btn--primary">Анулирай резервацията</SubmitButton>
            <Link className="btn btn--ghost" href="/akaunt/rezervacii">Назад</Link>
          </div>
        </ActionForm>

        <aside>
          <div className="sum">
            <PartnerSum p={p} withRating={false} />
            <div className="sum-row"><span>Резервация №</span><b>{b.number}</b></div>
            <div className="sum-row"><span>Събитие</span><b>{v.eventTitle}</b></div>
            <div className="sum-row"><span>Дата</span><b>{date(b.eventDate)}</b></div>
            <div className="sum-row"><span>Място</span><b>{b.venueName || b.locality || p.cityName || '—'}</b></div>
            {v.paidOn && <div className="sum-row"><span>Платено на</span><b>{numericDate(v.paidOn)}</b></div>}
            <div className="sum-total"><span>Връща се</span><b>{q.labels.refund}</b></div>
            {v.cardLast4 && q.refundCents > 0 && (
              <div className="book-note" style={{ marginTop: 16 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 11h20" /></svg>
                <span>Възстановяването тръгва към картата, завършваща на {v.cardLast4} — същата, с която платихте.</span>
              </div>
            )}
          </div>

          <div className="dcard" style={{ marginTop: 16 }}>
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Добре е да знаете</h2></div>
            {v.otherBookingsSameDay > 0 && (
              <div className="cx-side-l">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg>
                <span>Другите ви резервации за {dateShort(b.eventDate)} остават непроменени.</span>
              </div>
            )}
            <div className="cx-side-l">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M21 12a9 9 0 11-3-6.7" /><path d="M21 4v5h-5" /></svg>
              <span>Ако размислите, ще трябва нова заявка — датата може вече да е заета.</span>
            </div>
            <div className="cx-side-l">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path d="M4 5h16v12H8l-4 4z" /></svg>
              <span>Причината се вижда само от изпълнителя и не се публикува като ревю.</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
