// /akaunt/zapazeni — saved searches and date watches (prototype client/saved.html). Guard: client.
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { savedView } from '@/lib/domain/views-auth-account';
import { deleteSearchAction, setNotifyAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Запазени търсения' };

const Bell = ({ off }: { off?: boolean }) => (
  <svg aria-hidden="true" className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" />{off && <path d="M3.5 3.5l17 17" />}</svg>
);

export default async function SavedPage() {
  const u = await requireRole('client', '/akaunt/zapazeni');
  const { searches, watches } = await savedView(await actorFromUser(u));
  return (
    <>
      <SiteHeader />
      <main className="wrap m-acc" id="main">
        <div className="hold">
          <div className="h-row">
            <div>
              <h1 className="h-page">Запазени търсения</h1>
              <p className="h-sub">Пазим филтрите ви и ви казваме, когато се появи нов изпълнител по тях.</p>
            </div>
            <div className="h-right">
              <Link className="btn btn--outline btn--sm" href="/tarsene">Отвори каталога</Link>
            </div>
          </div>

          {searches.length > 0 ? (
            <section className="mine mine--wait">
              <div className="mine-head">
                <span className="mine-t">Запазени търсения</span>
                <span className="mine-c">{searches.length}</span>
                <span className="mine-hint">Отваряте търсенето с всички филтри · звънчето спира и пуска известията</span>
              </div>
              {searches.map(s => {
                const open = `/akaunt/zapazeni/${s.id}/otvori`;
                return (
                  <div className="mrow" key={s.id}>
                    <span className="mrow-img" style={s.image ? { backgroundImage: `url('${s.image}')` } : undefined}></span>
                    <span className="mrow-main">
                      <a className="mrow-n" href={open}>{s.title}</a>
                      <span className="mrow-s">{s.summary}</span>
                    </span>
                    <span className="mrow-meta">
                      <span className="mrow-col"><span className="mrow-l">Запазено</span><span className="mrow-v">{s.savedOn}</span></span>
                      <span className="mrow-col"><span className="mrow-l">Резултати</span><span className="mrow-v">{s.results}</span></span>
                    </span>
                    <span className="mrow-end">
                      <span className="mrow-status">
                        <span className={s.fresh === 'Без нови' ? 'badge' : 'badge badge--success badge--dot'}>{s.fresh}</span>
                        <span className="mrow-age">{s.free}</span>
                      </span>
                      <a className="btn btn--outline btn--sm" href={open}>Отвори</a>
                      <form action={setNotifyAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <input type="hidden" name="notify" value={s.notify ? '0' : '1'} />
                        {s.notify ? (
                          <button className="btn btn--primary btn--icon btn--sm" type="submit" aria-label="Изключи известията за това търсене" title="Изключи известията за това търсене"><Bell /></button>
                        ) : (
                          <button className="btn btn--outline btn--icon btn--sm" type="submit" aria-label="Включи известията за това търсене" title="Включи известията за това търсене"><Bell off /></button>
                        )}
                      </form>
                      <form action={deleteSearchAction}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="btn btn--ghost btn--icon btn--sm" type="submit" aria-label="Изтрий запазеното търсене" title="Изтрий запазеното търсене">
                          <svg aria-hidden="true" className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6.5 7l1 13h9l1-13" /><path d="M10 11v6M14 11v6" /></svg>
                        </button>
                      </form>
                    </span>
                  </div>
                );
              })}
            </section>
          ) : (
            <div className="empty">
              <span className="empty-icon"><svg aria-hidden="true" style={{ width: 22, height: 22 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M6 3.5h12v17l-6-4.2-6 4.2v-17z" /></svg></span>
              <h2 className="empty-title t-h3">Нямате запазени търсения</h2>
              <p className="empty-text">Запазеното търсене пази филтрите ви и ви известява, когато се появи нов изпълнител по тях.</p>
              <div className="card-footer" style={{ justifyContent: 'center', marginTop: 0 }}>
                <Link className="btn btn--primary" href="/tarsene">Отвори каталога</Link>
              </div>
            </div>
          )}

          {watches.length > 0 && (
            <section className="mine">
              <div className="mine-head">
                <span className="mine-t">Чакам да се освободи</span>
                <span className="mine-c">{watches.length}</span>
                <span className="mine-hint">Проверяваме наличността всеки ден&nbsp;— щом се освободи, можете да заявите отново</span>
              </div>
              {watches.map(w => (
                <Link className="mrow" href={w.href} key={w.id}>
                  <span className="mrow-img" style={w.image ? { backgroundImage: `url('${w.image}')` } : undefined}></span>
                  <span className="mrow-main">
                    <span className="mrow-n">{w.partnerName}</span>
                    <span className="mrow-s">{w.line}</span>
                  </span>
                  <span className="mrow-meta">
                    <span className="mrow-col"><span className="mrow-l">Следим</span><span className="mrow-v">{w.date}</span></span>
                    {w.eventTitle && <span className="mrow-col"><span className="mrow-l">Събитие</span><span className="mrow-v">{w.eventTitle}</span></span>}
                  </span>
                  <span className="mrow-end">
                    <span className="mrow-status">
                      <span className="badge badge--danger badge--dot">{w.badge}</span>
                      <span className="mrow-age">{w.since}</span>
                    </span>
                    <span className="btn btn--outline btn--sm">Виж профила</span>
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
