// vendor/messages.html: ‹N разговора · N непрочетени съобщения›, ‹Само непрочетени›, the list and the
// open thread with the status of its request/booking. `/partner/saobshteniya` shows the newest
// conversation beside the list (wide screens); `/partner/saobshteniya/[id]` opens one.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Fragment } from 'react';
import { PartnerComposer } from '@/components/messaging-support/Composer';
import { Num } from '@/components/messaging-support/CaseParts';
import { ListSearch, OpenWhenShown, Poll, ThreadBody } from '@/components/messaging-support/live';
import { requireRole } from '@/lib/session';
import { actorFromUser } from '@/lib/domain/actor';
import { markRead } from '@/lib/domain/messaging';
import { plural } from '@/lib/format';
import { conversationList, conversationView } from '@/lib/domain/views-messaging-support';
import { saveDraftAction, sendMessageAction, uploadMessageFileAction } from './actions';

const CHEVRON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 6l6 6-6 6" /></svg>;
const BACK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>;
const CHECK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M4 13l4 4L20 5" /></svg>;
const DOC = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;

export async function PartnerMessagesScreen({ id, q, unreadOnly }: { id?: string; q?: string; unreadOnly: boolean }) {
  const path = id ? `/partner/saobshteniya/${id}` : '/partner/saobshteniya';
  const user = await requireRole('partner', path);
  const actor = await actorFromUser(user);
  if (!actor.partnerId) notFound();
  if (id) {
    try { await markRead(actor, { conversationId: id }); } catch { notFound(); }
  }
  const list = await conversationList(actor, { q, unreadOnly, keepId: id });
  const activeId = id ?? list.items[0]?.id ?? null;
  const view = activeId ? await conversationView(actor, activeId).catch(() => null) : null;
  if (id && !view) notFound();

  const params = (over: { unread?: boolean }) => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (over.unread ?? unreadOnly) p.set('neprocheteni', '1');
    const s = p.toString();
    return s ? `?${s}` : '';
  };
  // ‹Само непрочетени› on: the unread conversations (the newest one opens beside them on wide screens);
  // off: back to every conversation, the open one staying open.
  const toggleHref = unreadOnly
    ? `${id ? `/partner/saobshteniya/${id}` : '/partner/saobshteniya'}${params({ unread: false })}`
    : `/partner/saobshteniya${params({ unread: true })}`;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Съобщения</h1>
          <p className="page-sub">{plural(list.totals.conversations, 'разговор', 'разговора')} · {plural(list.totals.unreadMessages, 'непрочетено съобщение', 'непрочетени съобщения')}</p>
        </div>
        <div className="page-head-right">
          <Link className={`btn ${unreadOnly ? 'btn--primary' : 'btn--outline'} btn--sm`} href={toggleHref}
            aria-current={unreadOnly ? 'true' : undefined} scroll={false}>Само непрочетени</Link>
        </div>
      </div>

      <div className={`vmsg-shell ${id ? 'ms-open' : 'ms-index'}`}>
        <aside className="vmsg-list">
          <div className="vmsg-list-head">
            <span className="vmsg-list-t" role="heading" aria-level={2}>Разговори</span>
            <span className="vmsg-list-c">{unreadOnly ? 'Непрочетени' : 'Всички'}</span>
          </div>
          <ListSearch className="vmsg-find" placeholder="Търсене по клиент или събитие" />
          <nav className="vmsg-convs" aria-label="Разговори">
            {list.items.map(c => (
              <Link key={c.id} className={`vmsg-conv${c.id === activeId ? ' is-on' : ''}${c.unread ? ' is-unread' : ''}`}
                href={`/partner/saobshteniya/${c.id}${params({})}`} aria-current={c.id === activeId ? 'page' : undefined}>
                <span className="avatar">{c.otherInitials}</span>
                <span>
                  <span className="vmsg-conv-top"><span className="vmsg-conv-n">{c.otherName}</span><span className="vmsg-conv-time">{c.time}</span></span>
                  <span className="vmsg-conv-e">{c.event}</span>
                  <span className="vmsg-conv-p">
                    <span className="vmsg-conv-x">{c.preview}</span>
                    {c.unread > 0 && <span className="vmsg-unread">{c.unread}</span>}
                  </span>
                </span>
              </Link>
            ))}
            {!list.items.length && <div className="ui-empty">Няма записи в този изглед.</div>}
          </nav>
        </aside>

        {view ? (
          <section className="vmsg-pane">
            <Link className="crumb ms-back" href={`/partner/saobshteniya${params({})}`}>{BACK}Разговори</Link>
            <div className="vmsg-head">
              <span className="avatar avatar--lg">{view.otherInitials}</span>
              <div className="ms-head-main">
                <div className="vmsg-head-n" role="heading" aria-level={2}><Num text={view.otherName} /></div>
                {view.contextLink
                  ? <Link className="vmsg-ctx" href={view.contextLink.href}>{view.summary}{CHEVRON}</Link>
                  : view.summary && <span className="vmsg-ctx">{view.summary}</span>}
              </div>
              <div className="vmsg-head-right">
                {view.badge && <span className={`badge badge--${view.badge.tone} badge--dot`}>{view.badge.label}</span>}
                {view.contextLink && <Link className="btn btn--outline btn--sm" href={view.contextLink.href}>{view.contextLink.label}</Link>}
              </div>
            </div>
            <ThreadBody className="vmsg-thread" lastId={view.lastMessageId} label={`Съобщения · ${view.otherName}`}>
              {view.days.map(d => (
                <Fragment key={d.label}>
                  <div className="vmsg-day" role="heading" aria-level={3}><span>{d.label}</span></div>
                  {d.messages.map(m => (
                    <div key={m.id} className={`vmsg-m${m.mine ? ' vmsg-m--out' : ''}`}>
                      {m.body && <div className="vmsg-b">{m.body}</div>}
                      {m.attachments.map(a => a.mime.startsWith('image/')
                        ? <a key={a.id} className="ms-att ms-att--img" href={`/api/files/${a.id}`} target="_blank" rel="noopener"><img src={`/api/files/${a.id}`} alt={a.name ?? ''} /></a>
                        : <a key={a.id} className="ms-att" href={`/api/files/${a.id}`} target="_blank" rel="noopener">{DOC}<span>{a.name ?? 'PDF'}</span></a>)}
                      <div className="vmsg-meta">
                        {!m.mine && <b>{view.otherName}</b>}
                        <span>{m.time}</span>
                        {m.mine && m.read && CHECK}
                      </div>
                    </div>
                  ))}
                </Fragment>
              ))}
            </ThreadBody>
            <PartnerComposer key={view.id} conversationId={view.id} draft={view.draft}
              actions={{ send: sendMessageAction, saveDraft: saveDraftAction, upload: uploadMessageFileAction }} />
            {!id && <OpenWhenShown href={`/partner/saobshteniya/${view.id}${params({})}`} />}
          </section>
        ) : (
          <section className="vmsg-pane ms-thread-empty"><div className="ui-empty">Няма записи в този изглед.</div></section>
        )}
      </div>
      <Poll />
    </>
  );
}
