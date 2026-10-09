// /partner/poddrazhka — the partner's cases (SCREENS §7 vendor/dispute.html, cases list; guard: partner).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { partyCases } from '@/lib/domain/views-messaging-support';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Поддръжка' };

export default async function PartnerSupportPage() {
  const user = await requireRole('partner', '/partner/poddrazhka');
  const actor = await actorFromUser(user);
  if (!actor.partnerId) notFound();
  const cases = await partyCases(actor);
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Поддръжка</h1>
          <p className="page-sub">Опишете какво се случва по дадена резервация и екипът на EventAT поема случая.</p>
        </div>
        <div className="page-head-right">
          <Link className="btn btn--primary btn--sm" href="/partner/poddrazhka/nov">Сигнал до екипа</Link>
        </div>
      </div>
      <section className="dcard ms-cases">
        <div className="dcard-head">
          <h2 className="dcard-title">Моите сигнали</h2>
          {cases.openCount > 0 && <span className="badge badge--warning badge--dot">{cases.openCount} {cases.openCount === 1 ? 'отворен' : 'отворени'}</span>}
        </div>
        {cases.items.map(c => (
          <Link key={c.number} className={`case${c.open ? ' is-open' : c.done ? ' is-done' : ''}`} href={`/partner/poddrazhka/${encodeURIComponent(c.number)}`}>
            <span className="case-bar" />
            <span>
              <span className="case-n">{c.title}</span>
              <span className="case-s">{c.sub}</span>
            </span>
            <span className="case-end">
              <span className={c.badge.cls}>{c.badge.label}</span>
              <span className="case-amt">{c.amount}</span>
            </span>
          </Link>
        ))}
        {!cases.items.length && <div className="ui-empty">Няма записи в този изглед.</div>}
      </section>
    </>
  );
}
