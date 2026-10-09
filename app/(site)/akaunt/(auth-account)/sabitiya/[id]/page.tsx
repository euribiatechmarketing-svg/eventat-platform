// /akaunt/sabitiya/[id] — one event folder (prototype client/event.html). Guard: client, own event (404 otherwise).
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '@/components/site/SiteHeader';
import { requireRole } from '@/lib/session';
import { dateNumeric, date, moneyShort } from '@/lib/format';
import { actorFromUser } from '@/lib/domain/actor';
import { NotFoundError } from '@/lib/domain/catalogue-kit';
import { eventView, sentOn } from '@/lib/domain/views-auth-account';
import { Num } from '../../_num';
import { NotesForm } from './NotesForm';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Моите събития' };

const TONE: Record<string, string> = { pink: 'badge badge--pink badge--dot', primary: 'badge badge--primary badge--dot', danger: 'badge badge--danger badge--dot', neutral: 'badge', success: 'badge badge--success badge--dot', warning: 'badge badge--warning badge--dot' };

export default async function EventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await requireRole('client', `/akaunt/sabitiya/${id}`);
  let e: Awaited<ReturnType<typeof eventView>>;
  try {
    e = await eventView(await actorFromUser(u), id);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  return (
    <>
      <SiteHeader active="/akaunt/zayavki" />
      <main className="wrap m-acc" id="main">
        <div className="hold">
          <div className="crumbs"><Link href="/akaunt/sabitiya">Моите събития</Link><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg><span>{e.title}</span></div>

          <div className="h-row">
            <div>
              <h1 className="h-page"><Num text={e.title} /></h1>
              <p className="h-sub">{e.eventType.name} · всички заявки и резервации за него на едно място</p>
            </div>
            {e.addHref && (
              <div className="h-right">
                <span className="mine-hint">Търсенето се филтрира по {e.searchHint}</span>
                <Link className="btn btn--primary btn--sm" href={e.addHref}>Добави услуга към събитието</Link>
              </div>
            )}
          </div>

          <div className="ev-facts">
            <div className="ev-fact">
              <div className="kv-label">Дата</div>
              <div className="kv-value">{date(e.date)} <small>{[e.parts.weekday, e.startTime].filter(Boolean).join(', ')}</small></div>
            </div>
            <div className="ev-fact">
              <div className="kv-label">Локация</div>
              <div className="kv-value">{e.venueName ?? e.placeSmall ?? ''} {e.venueName && e.placeSmall && <small>{e.placeSmall}</small>}</div>
            </div>
            <div className="ev-fact">
              <div className="kv-label">Гости</div>
              <div className="kv-value">{e.guests != null ? `${e.guests} души` : ''}</div>
            </div>
            <div className="ev-fact">
              <div className="kv-label">В папката</div>
              <div className="kv-value">{plural(e.requestsCount, 'заявка', 'заявки')} <small>{plural(e.bookingsCount, 'резервация', 'резервации')}</small></div>
            </div>
            <div className="ev-fact">
              <div className="kv-label">Платено до момента</div>
              <div className="kv-value ev-total">{moneyShort(e.paidCents)} {e.pendingCents > 0 && <small>още {moneyShort(e.pendingCents)} по чакащите заявки</small>}</div>
            </div>
          </div>

          <section className="mine" style={{ marginTop: 22 }}>
            <div className="mine-head">
              <span className="mine-t">Бележки</span>
              <span className="mine-hint">Виждате ги само вие — изпълнителите нямат достъп</span>
            </div>
            <NotesForm eventId={e.id} notes={e.notes ?? ''} updated={e.notesUpdatedAt ? sentOn(e.notesUpdatedAt) : null} />
          </section>

          {e.requests.length > 0 && (
            <section className="mine">
              <div className="mine-head">
                <span className="mine-t">Заявки</span>
                <span className="mine-c">{e.requests.length}</span>
                <span className="mine-hint">Одобрените заявки се плащат до 24 часа — след това датата се освобождава</span>
              </div>
              {e.requests.map(r => (
                <div className={`mrow acc-row${r.off ? ' is-off' : ''}`} key={r.number}>
                  <Link className="acc-row-link" href={r.href} aria-label={`${r.partnerName} · ${r.number}`}></Link>
                  <span className="mrow-img" style={r.image ? { backgroundImage: `url('${r.image}')` } : undefined}></span>
                  <span className="mrow-main">
                    <span className="mrow-n">{r.partnerName}</span>
                    <span className="mrow-s">{r.line}</span>
                  </span>
                  <span className="mrow-meta">
                    <span className="mrow-col"><span className="mrow-l">Заявка №</span><span className="mrow-v">{r.number}</span></span>
                    <span className="mrow-col"><span className="mrow-l">Изпратена</span><span className="mrow-v">{r.sent}</span></span>
                  </span>
                  <span className="mrow-end">
                    <span className="mrow-status">
                      <span className={TONE[r.badge.tone]}>{r.badge.text}</span>
                      {r.age && <span className="mrow-age">{r.age}</span>}
                    </span>
                    {r.amountCents != null && <span className="mrow-price">{moneyShort(r.amountCents)}</span>}
                    <Link className={`btn ${r.action.primary ? 'btn--primary' : 'btn--outline'} btn--sm`} href={r.action.href}>{r.action.label}</Link>
                  </span>
                </div>
              ))}
            </section>
          )}

          {e.bookings.length > 0 && (
            <section className="mine">
              <div className="mine-head">
                <span className="mine-t">Резервации</span>
                <span className="mine-c">{e.bookings.length}</span>
                <span className="mine-hint">Платени и потвърдени услуги за това събитие</span>
              </div>
              {e.bookings.map(b => (
                <Link className="mrow" href={b.href} key={b.number}>
                  <span className="mrow-img" style={b.image ? { backgroundImage: `url('${b.image}')` } : undefined}></span>
                  <span className="mrow-main">
                    <span className="mrow-n">{b.partnerName}</span>
                    <span className="mrow-s">{b.line}</span>
                  </span>
                  <span className="mrow-meta">
                    <span className="mrow-col"><span className="mrow-l">Дата</span><span className="mrow-v">{b.date}</span></span>
                    {b.time && <span className="mrow-col"><span className="mrow-l">Час</span><span className="mrow-v">{b.time}</span></span>}
                  </span>
                  <span className="mrow-end">
                    <span className="mrow-status">
                      <span className={TONE[b.tone]}>{b.badge}</span>
                      {b.paidOn && <span className="mrow-age">платена на {dateNumeric(b.paidOn)}</span>}
                    </span>
                    <span className="mrow-price">{moneyShort(b.amountCents)}</span>
                    <span className="btn btn--outline btn--sm">Детайли</span>
                  </span>
                </Link>
              ))}
            </section>
          )}
        </div>
      </main>
    </>
  );
}
