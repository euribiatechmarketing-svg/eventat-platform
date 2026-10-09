// client/messages.html: conversation list + open thread. `/akaunt/saobshteniya` shows the newest
// conversation beside the list (wide screens; the list alone on phones); `/akaunt/saobshteniya/[id]`
// opens one (the thread alone on phones).
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { SiteHeader } from '@/components/site/SiteHeader';
import { ClientComposer } from '@/components/messaging-support/Composer';
import { Num } from '@/components/messaging-support/CaseParts';
import { ListSearch, OpenWhenShown, Poll, ThreadBody } from '@/components/messaging-support/live';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { markRead } from '@/lib/domain/messaging';
import { conversationList, conversationView } from '@/lib/domain/views-messaging-support';
import { saveDraftAction, sendMessageAction, uploadMessageFileAction } from './actions';

const CHEVRON = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg>;
const BACK = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>;
const DOC = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;
const bg = (url: string | null) => (url ? { backgroundImage: `url('${url}')` } : undefined);

export async function MessagesScreen({ id, q }: { id?: string; q?: string }) {
  const path = id ? `/akaunt/saobshteniya/${id}` : '/akaunt/saobshteniya';
  const user = await requireRole('client', path);
  const actor = await actorFromUser(user);
  if (id) {
    // Opening it reads the partner's messages (SPEC §4.16); not the client's conversation → 404.
    try { await markRead(actor, { conversationId: id }); } catch { notFound(); }
  }
  const list = await conversationList(actor, { q });
  const activeId = id ?? list.items[0]?.id ?? null;
  const view = activeId ? await conversationView(actor, activeId).catch(() => null) : null;
  if (id && !view) notFound();
  const qs = q ? `?q=${encodeURIComponent(q)}` : '';

  return (
    <>
      <SiteHeader />
      <main className="wrap" id="main">
        <div className="hold ms-hold">
          <div className="h-row">
            <div>
              <h1 className="h-page">Съобщения</h1>
              <p className="h-sub">Разговори с изпълнителите по вашите събития</p>
            </div>
            <div className="h-right">
              <Link className="btn btn--outline btn--sm" href="/akaunt/rezervacii">Моите резервации</Link>
            </div>
          </div>

          <div className={`msg-shell ${id ? 'ms-open' : 'ms-index'}`}>
            <aside className="msg-list">
              <div className="msg-list-head">
                <span className="msg-list-t">Разговори</span>
                <span className="msg-list-c">{list.totals.conversations}</span>
              </div>
              <ListSearch className="msg-search" placeholder="Търсене по изпълнител или събитие" />
              <div className="msg-list-body">
                {list.items.map(c => {
                  const active = c.id === activeId;
                  return (
                    <Link key={c.id} className={`msg-item${active ? ' is-active' : ''}${c.unread ? ' is-new' : ''}`} href={`/akaunt/saobshteniya/${c.id}${qs}`}
                      aria-current={active ? 'page' : undefined}>
                      <span className="msg-item-img" style={bg(c.avatarUrl)} />
                      <span className="msg-item-main">
                        <span className="msg-item-top">
                          <span className="msg-item-n">{c.otherName}</span>
                          <span className="msg-item-time">{c.time}</span>
                        </span>
                        <span className="msg-item-ev">{c.event}</span>
                        <span className="msg-item-foot">
                          <span className="msg-item-p">{c.preview}</span>
                          {c.unread > 0 && <span className="msg-item-dot" role="img" aria-label="Непрочетено" />}
                        </span>
                      </span>
                    </Link>
                  );
                })}
                {!list.items.length && <div className="ui-empty">Няма записи в този изглед.</div>}
              </div>
            </aside>

            {view ? (
              <section className="msg-thread">
                <Link className="ms-back" href={`/akaunt/saobshteniya${qs}`}>{BACK}Разговори</Link>
                <header className="msg-ctx">
                  <span className="msg-ctx-img" style={bg(view.partnerAvatarUrl)} />
                  <span className="msg-ctx-main">
                    <span className="msg-ctx-n" id="msg-ctx-n"><Num text={view.otherName} /></span>
                    <span className="msg-ctx-d">{view.detail}</span>
                  </span>
                  {view.contextLink && <Link className="msg-ctx-link" href={view.contextLink.href}>{view.contextLink.label}{CHEVRON}</Link>}
                </header>
                <ThreadBody className="msg-body" lastId={view.lastMessageId} labelledBy="msg-ctx-n">
                  {view.days.map(d => (
                    <Fragment key={d.label}>
                      <div className="msg-day"><span>{d.label}</span></div>
                      {d.messages.map(m => (
                        <div key={m.id} className={`msg-line msg-line--${m.mine ? 'out' : 'in'}`}>
                          {!m.mine && <span className="msg-av" style={bg(view.partnerAvatarUrl)} />}
                          <div className="msg-col">
                            {m.body && <div className="msg-b">{m.body}</div>}
                            {m.attachments.map(a => a.mime.startsWith('image/')
                              ? <a key={a.id} className="ms-att ms-att--img" href={`/api/files/${a.id}`} target="_blank" rel="noopener"><img src={`/api/files/${a.id}`} alt={a.name ?? ''} /></a>
                              : <a key={a.id} className="ms-att" href={`/api/files/${a.id}`} target="_blank" rel="noopener">{DOC}<span>{a.name ?? 'PDF'}</span></a>)}
                            <div className="msg-t">{m.time}{m.readMark ? ' · прочетено' : ''}</div>
                          </div>
                        </div>
                      ))}
                    </Fragment>
                  ))}
                </ThreadBody>
                <ClientComposer key={view.id} conversationId={view.id} draft={view.draft}
                  actions={{ send: sendMessageAction, saveDraft: saveDraftAction, upload: uploadMessageFileAction }} />
                {!id && <OpenWhenShown href={`/akaunt/saobshteniya/${view.id}${qs}`} />}
              </section>
            ) : (
              <section className="msg-thread ms-thread-empty"><div className="ui-empty">Няма записи в този изглед.</div></section>
            )}
          </div>
        </div>
      </main>
      <Poll />
    </>
  );
}
