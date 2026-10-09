// /akaunt/sabitiya — the client's event folders (prototype client/events.html). Guard: client.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { requireRole } from '@/lib/session';
import { moneyShort } from '@/lib/format';
import { actorFromUser } from '@/lib/domain/actor';
import { eventsView } from '@/lib/domain/views-auth-account';
import { Num } from '../_num';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Моите събития' };

const Pin = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 21s-7-5.2-7-11a7 7 0 1114 0c0 5.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.6" /></svg>;
const People = () => <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 6.2a3.4 3.4 0 010 6.6M17.5 20a6.5 6.5 0 00-2.2-4.9" /></svg>;

export default async function EventsPage() {
  const u = await requireRole('client', '/akaunt/sabitiya');
  const events = await eventsView(await actorFromUser(u));
  return (
    <>
      <SiteHeader active="/akaunt/zayavki" />
      <main className="wrap m-acc" id="main">
        <div className="hold">
          <div className="h-row">
            <div>
              <h1 className="h-page">Моите събития</h1>
              <p className="h-sub">Всяко събитие е отделна папка&nbsp;— заявките, резервациите и разходите за него са на едно място.</p>
            </div>
            <div className="h-right">
              <Link className="btn btn--outline btn--sm" href="/tarsene">Добави още услуги</Link>
            </div>
          </div>

          <div className="ev-list">
            {events.map(e => (
              <div className={`ev-card${e.upcoming ? '' : ' ev-card--past'}`} key={e.id}>
                <Link className="ev-card-link" href={`/akaunt/sabitiya/${e.id}`} aria-label={e.title}></Link>
                <span className="nx-date">
                  <span className="nx-d">{e.parts.day}</span>
                  <span className="nx-m">{e.parts.month}</span>
                  <span className="nx-y">{e.parts.year} · {e.parts.weekday}</span>
                </span>
                <span className="ev-main">
                  {e.upcoming ? <span className="badge badge--primary badge--dot">Предстоящо</span> : <span className="badge">Минало събитие</span>}
                  {e.upcoming && e.awaitingPaymentCount > 0 && (
                    <span className="badge badge--pink badge--dot">{e.awaitingPaymentCount === 1 ? '1 заявка чака плащане' : `${e.awaitingPaymentCount} заявки чакат плащане`}</span>
                  )}
                  <span className="ev-name"><Num text={e.title} /></span>
                  <span className="nx-line">
                    {e.place && <span><Pin />{e.place}</span>}
                    {e.guests != null && <span><People />{e.guests} {e.guests === 1 ? 'гост' : 'гости'}</span>}
                  </span>
                  {e.addHref && <Link className="btn btn--outline btn--sm ev-add" href={e.addHref}>Добави услуга към събитието</Link>}
                </span>
                <span className="ev-counts">
                  <span className="ev-stat"><span className="ev-num">{e.requestsCount}</span><span className="ev-lab">{e.requestsCount === 1 ? 'заявка' : 'заявки'}</span></span>
                  <span className="ev-stat"><span className="ev-num">{e.bookingsCount}</span><span className="ev-lab">{e.bookingsCount === 1 ? 'резервация' : 'резервации'}</span></span>
                </span>
                <span className="ev-money">
                  <span className="mrow-price">{moneyShort(e.paidCents)}</span>
                  <span className="ev-money-l">Платено</span>
                </span>
                <span className="ev-go"><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 6l6 6-6 6" /></svg></span>
              </div>
            ))}
          </div>
          {events.length === 0 && (
            <div className="empty">
              <span className="empty-icon"><svg aria-hidden="true" style={{ width: 22, height: 22 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></svg></span>
              <div className="card-footer" style={{ justifyContent: 'center', marginTop: 0 }}>
                <Link className="btn btn--primary" href="/tarsene">Добави още услуги</Link>
              </div>
            </div>
          )}

          <div className="ev-flat">
            <span>Вижте и пълните списъци:</span>
            <Link href="/akaunt/zayavki">Всички заявки</Link>
            <span className="ev-flat-sep">·</span>
            <Link href="/akaunt/rezervacii">Всички резервации</Link>
          </div>
        </div>
      </main>
    </>
  );
}
