// Topbar search results (SCREENS §1 / §7 `/partner/tarsene?q=`): the partner's requests and
// bookings matching a client, service, event type, place, number or date, with the same rows
// as the requests inbox and the bookings ledger.
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { partnerSearch } from '@/lib/domain/views-partner-ops';
import { BookingTable, RequestRow } from '../_ops/rows';
import { Num } from '../_ops/num';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Търсене' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const u = await requireRole('partner', '/partner/tarsene');
  const v = await partnerSearch(await actorFromUser(u), { q: typeof sp.q === 'string' ? sp.q : '' });
  const nr = v.requests.length, nb = v.bookings.length;

  return (
    <div className="po">
      {!v.term && <h1 className="a11y-only">Търсене</h1>}
      <form className={`search po-search po-search--page${v.term ? '' : ' po-search--start'}`} action="/partner/tarsene" role="search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input name="q" type="search" defaultValue={v.term} placeholder="Търси по клиент, услуга или дата" aria-label="Търси по клиент, услуга или дата" autoComplete="off" autoFocus={!v.term} />
      </form>

      {v.term && (
        <div className="page-head">
          <div>
            <h1 className="page-title">„<Num>{v.term}</Num>“</h1>
            <p className="page-sub">{nr} {nr === 1 ? 'заявка' : 'заявки'} · {nb} {nb === 1 ? 'резервация' : 'резервации'}</p>
          </div>
        </div>
      )}

      {v.term && nr === 0 && nb === 0 && <div className="req-panel po-empty-panel"><div className="ui-empty">Няма записи в този изглед.</div></div>}

      {nr > 0 && (
        <section className="group">
          <header className="group-head">
            <span className="group-title" role="heading" aria-level={2}>Заявки</span>
            <span className="group-count">{nr}</span>
          </header>
          <div className="req-panel"><div className="req-list">
            {v.requests.map(r => <RequestRow key={r.number} r={r} now={v.now} />)}
          </div></div>
        </section>
      )}

      {nb > 0 && (
        <section className="dcard po-results">
          <div className="dcard-head"><h2 className="dcard-title">Резервации</h2></div>
          <BookingTable rows={v.bookings} fullDate />
        </section>
      )}
    </div>
  );
}
