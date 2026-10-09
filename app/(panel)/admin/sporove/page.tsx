// Спорове и възстановявания — the case queue (prototype admin/disputes.html; SCREENS §8 /admin/sporove, resolve_disputes).
import type { Metadata } from 'next';
import Link from 'next/link';
import '@/styles/m-admin-money.css';
import { PageChrome } from '../_money/chrome';
import { DISPUTE_FILTERS, disputeQueue } from '@/lib/domain/views-admin-money';
import { moneyShort, plural } from '@/lib/format';
import { adminActor, casePath } from '../_money/server';

export const metadata: Metadata = { title: 'Спорове' };

type SP = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined;

export default async function AdminDisputes({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filter = one(sp.filter), q = one(sp.q);
  const actor = await adminActor(`/admin/sporove${filter ? `?filter=${filter}` : ''}`, 'resolve_disputes');
  const r = await disputeQueue(actor, { filter, q });
  const href = (f: string) => {
    const u = new URLSearchParams();
    if (f !== 'vsichki') u.set('filter', f);
    if (r.q) u.set('q', r.q);
    const s = u.toString();
    return `/admin/sporove${s ? `?${s}` : ''}`;
  };
  type Row = (typeof r.open)[number];
  const row = (c: Row) => (
    <Link key={c.number} className={`case ${c.cls}`} href={casePath(c.number)}>
      <span className="case-bar" />
      <span>
        <span className="case-n">{c.title}</span>
        <span className="case-s">{c.sub}</span>
      </span>
      <span className="case-end">
        <span className={`badge ${c.badge.cls}`}>{c.badge.label}</span>
        <span className="case-amt">{c.amount}</span>
      </span>
    </Link>
  );
  const sub = [
    `${r.openCount} ${r.openCount === 1 ? 'отворен' : 'отворени'}`,
    `${moneyShort(r.heldCents)} задържани`,
    ...(r.avgDays ? [`средно решение за ${r.avgDays} дни`] : []),
  ].join(' · ');

  return (
    <div className="am">
      <PageChrome title="Спорове и възстановявания" short="Спорове" />
      <div className="page-head">
        <div>
          <h1 className="page-title">Спорове и възстановявания</h1>
          <p className="page-sub">{sub}</p>
        </div>
        <div className="page-head-right">
          <span className="seg">
            {DISPUTE_FILTERS.map(f => <Link key={f.key} className={r.filter === f.key ? 'is-on' : undefined} href={href(f.key)} scroll={false} aria-current={r.filter === f.key ? 'page' : undefined}>{f.label}</Link>)}
          </span>
        </div>
      </div>

      <div className="adm-grid">
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Кейсове</h2>
            {r.openCount > 0 && <span className="badge badge--danger">{plural(r.openCount, 'отворен', 'отворени')}</span>}
          </div>
          {r.open.map(row)}
          {r.done.length > 0 && (
            <>
              {r.open.length > 0 && <div className="dcard-head case-sec" style={{ marginTop: 26 }}><h2 className="dcard-title" style={{ fontSize: 17 }}>Решени по-рано</h2></div>}
              {r.done.map(row)}
            </>
          )}
          {!r.open.length && !r.done.length && <div className="ui-empty">Няма записи в този изглед.</div>}
        </section>

        <aside>
          {r.peek && (
            <section className="dcard">
              <div className="dcard-head">
                <h2 className="dcard-title" style={{ fontSize: 19 }}>Най-спешно</h2>
                <span className={`badge ${r.peek.badge.cls}`}>{r.peek.badge.label}</span>
              </div>
              <span className="cs-peek-t">{r.peek.title}</span>
              <span className="cs-peek-s">{r.peek.parties}</span>
              <span className="cs-peek-s">{r.peek.held}</span>
              {r.peek.clientQuote && <><span className="cs-peek-l">{r.peek.clientLabel}</span><p className="cs-peek-q">„{r.peek.clientQuote}“</p></>}
              {r.peek.partnerQuote && <><span className="cs-peek-l">Изпълнителят</span><p className="cs-peek-q">„{r.peek.partnerQuote}“</p></>}
              <Link className="btn btn--primary btn--block" href={casePath(r.peek.number)} style={{ marginTop: 20 }}>Отвори кейса</Link>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
