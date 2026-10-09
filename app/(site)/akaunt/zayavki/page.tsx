// ‹Моите заявки› (client/requests.html → SCREENS §4 /akaunt/zayavki?sabitie-id=&status=).
import Link from 'next/link';
import { AccountToolbar, MineGroup } from '@/components/client-booking/parts';
import { Countdown } from '@/components/client-booking/Countdown';
import { clientRequestList, REQUEST_STATUS_FILTERS, type RequestListRow } from '@/lib/domain/views-client-booking';
import { one, requireClient, withQuery } from '@/lib/client-booking/guard';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Моите заявки' };

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function RequestsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { actor } = await requireClient(withQuery('/akaunt/zayavki', sp));
  const v = await clientRequestList(actor, { eventId: one(sp['sabitie-id']), status: one(sp.status) });
  const g = v.groups;
  const empty = !g.pay.length && !g.offers.length && !g.wait.length && !g.closed.length;

  return (
    <div className="hold">
      <div className="h-row">
        <div>
          <h1 className="h-page">Моите заявки</h1>
          <p className="h-sub">Изпратени заявки към изпълнители за вашите събития</p>
        </div>
        <div className="h-right">
          <Link className="btn btn--outline btn--sm" href="/tarsene">Добави още услуги</Link>
        </div>
      </div>

      <AccountToolbar active="requests" counts={v.counts} events={v.events} eventId={v.eventId} status={v.status} statusOptions={REQUEST_STATUS_FILTERS} />

      {g.pay.length > 0 && (
        <MineGroup tone="pay" title="Одобрени · чакат плащане" count={g.pay.length} hint={`Датата е запазена за ${v.payHours} часа — след това се освобождава автоматично`}>
          {g.pay.map(r => <Row key={r.number} r={r} now={v.nowIso} />)}
        </MineGroup>
      )}
      {g.offers.length > 0 && (
        <MineGroup tone="wait" title="Нова оферта" count={g.offers.length} hint="Плащате едва след като изберете оферта и изпълнителят я потвърди.">
          {g.offers.map(r => <Row key={r.number} r={r} now={v.nowIso} />)}
        </MineGroup>
      )}
      {g.wait.length > 0 && (
        <MineGroup tone="wait" title="Чакат отговор" count={g.wait.length} hint={`Изпълнителите отговарят до ${v.responseHours} часа`}>
          {g.wait.map(r => <Row key={r.number} r={r} now={v.nowIso} />)}
        </MineGroup>
      )}
      {g.closed.length > 0 && (
        <MineGroup title="Приключени" count={g.closed.length} hint="Отказани или изтекли заявки">
          {g.closed.map(r => <Row key={r.number} r={r} now={v.nowIso} />)}
        </MineGroup>
      )}
      {empty && <div className="cb-empty"><div className="ui-empty">Няма записи в този изглед.</div></div>}
    </div>
  );
}

function Row({ r, now }: { r: RequestListRow; now: string }) {
  return (
    <div className={`mrow cb-mrow${r.off ? ' is-off' : ''}`}>
      <Link className="cb-mrow-link" href={r.href} aria-label={`${r.partner.name} · ${r.number}`} />
      <span className="mrow-img" style={r.partner.thumb ? { backgroundImage: `url('${r.partner.thumb}')` } : undefined} />
      <span className="mrow-main">
        <span className="mrow-n">{r.partner.name}</span>
        <span className="mrow-s">{r.subtitle}</span>
      </span>
      <span className="mrow-meta">
        <span className="mrow-col"><span className="mrow-l">Събитие</span><span className="mrow-v">{r.eventTitle}</span></span>
        <span className="mrow-col"><span className="mrow-l">Заявка №</span><span className="mrow-v">{r.number}</span></span>
        <span className="mrow-col"><span className="mrow-l">Изпратена</span><span className="mrow-v">{r.sent}</span></span>
      </span>
      <span className="mrow-end">
        <span className="mrow-status">
          {'countdownTo' in r.badge
            ? <span className="badge badge--pink badge--dot"><Countdown to={r.badge.countdownTo} now={now} prefix="Остават " suffix=" ч" /></span>
            : <span className={`badge badge--${r.badge.tone} badge--dot`}>{r.badge.text}</span>}
          {r.age && <span className="mrow-age">{r.age}</span>}
        </span>
        <span className="mrow-price">{r.price}</span>
        <Link className={`btn ${r.action.primary ? 'btn--primary' : 'btn--outline'} btn--sm`} href={r.action.href}>{r.action.label}</Link>
      </span>
    </div>
  );
}
