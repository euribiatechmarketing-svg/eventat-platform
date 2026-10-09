// Автоматични имейли — every template with its sends, and the real outbox (prototype admin/emails.html;
// SCREENS §8 /admin/imeyli, /admin/imeyli/[key]). Shared by the list and the selected-key routes.
import Link from 'next/link';
import '@/styles/m-admin-money.css';
import { PageChrome } from '../_money/chrome';
import {
  AUDIENCE_FILTERS, AUDIENCE_WHO, canReadOutbox, emailCatalogue, emailSource, outboxList, templateStats,
} from '@/lib/domain/views-admin-money';
import { CATALOGUE } from '@/lib/email/templates';
import { dateTime, plural } from '@/lib/format';
import { adminActor } from '../_money/server';

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? undefined;

const LOCK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>;
const CLOCK = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
const SEARCH = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>;

export async function EmailsView({ selectedKey, sp }: { selectedKey: string | null; sp: SP }) {
  const audience = one(sp.audience) ?? null;
  const q = one(sp.q) ?? '';
  const actor = await adminActor(selectedKey ? `/admin/imeyli/${selectedKey}` : '/admin/imeyli');
  // The real outbox (‹Изпратени›) is for manage_team_settings; the other roles see the catalogue.
  const outbox = canReadOutbox(actor);
  const view = outbox && one(sp.izgled) === 'izprateni' ? 'sent' : 'templates';
  const msg = outbox ? one(sp.msg) ?? null : null;

  const cat = await emailCatalogue({ audience, q: view === 'templates' ? q : null });
  const out: Awaited<ReturnType<typeof outboxList>> = outbox ? await outboxList(actor, { audience, q: view === 'sent' ? q : null, limit: 60 }) : { total: 0, rows: [] };
  const params = (patch: Record<string, string | null | undefined>) => {
    const u = new URLSearchParams();
    const base: Record<string, string | null | undefined> = { audience: cat.audience, q: q || null, izgled: view === 'sent' ? 'izprateni' : null };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) u.set(k, v);
    const s = u.toString();
    return s ? `?${s}` : '';
  };
  const keyHref = (key: string, patch: Record<string, string | null | undefined> = {}) => `/admin/imeyli/${key}${params(patch)}`;

  // The selected email: the route's key, else the first row of the list (as the prototype).
  const firstKey = view === 'sent' ? out.rows[0]?.key ?? cat.groups[0]?.rows[0]?.key : cat.groups[0]?.rows[0]?.key;
  const key = selectedKey ?? firstKey ?? CATALOGUE[0].key;
  const entry = CATALOGUE.find(c => c.key === key)!;
  const message = msg ? out.rows.find(r => r.id === msg) ?? null : view === 'sent' && !selectedKey ? out.rows[0] ?? null : null;
  const stats = await templateStats(key);
  const source = await emailSource(key);
  const from = (process.env.EMAIL_FROM ?? 'EventAT <no-reply@eventat.bg>').match(/<([^>]+)>/)?.[1] ?? 'no-reply@eventat.bg';
  const previewSrc = `/admin/imeyli/${key}/preview${message ? `?id=${message.id}` : ''}`;

  return (
    <div className="am">
      <PageChrome title="Автоматични имейли" short="Имейли" />
      <div className="page-head">
        <div>
          <h1 className="page-title">Автоматични имейли</h1>
          <p className="page-sub">{cat.total} имейла · {cat.totals.client} към клиенти, {cat.totals.partner} към партньори, {cat.totals.team} към екипа · изпращат се от {from}</p>
        </div>
        <div className="page-head-right">
          <span className="seg">
            {AUDIENCE_FILTERS.map(f => (
              <Link key={f.label} className={cat.audience === f.key ? 'is-on' : undefined} scroll={false}
                href={selectedKey ? keyHref(selectedKey, { audience: f.key, msg: null }) : `/admin/imeyli${params({ audience: f.key })}`}>{f.label}</Link>
            ))}
          </span>
        </div>
      </div>
      <div className={`adm-grid adm-grid--mail am-mail${selectedKey ? ' is-picked' : ''}`}>
        <section className="dcard em-list">
          <div className="am-mail-head">
            <nav className="tab-bar am-mail-tabs">
              <Link className={`tab-bar-item${view === 'templates' ? ' is-active' : ''}`} scroll={false}
                href={selectedKey ? keyHref(selectedKey, { izgled: null, msg: null, q: null }) : `/admin/imeyli${params({ izgled: null, q: null })}`}>Шаблони <span className="tab-count">{cat.count}</span></Link>
              {outbox && (
                <Link className={`tab-bar-item${view === 'sent' ? ' is-active' : ''}`} scroll={false}
                  href={`/admin/imeyli${params({ izgled: 'izprateni', q: null })}`}>Изпратени <span className="tab-count">{out.total}</span></Link>
              )}
            </nav>
            <form className="search am-search" action={selectedKey ? `/admin/imeyli/${selectedKey}` : '/admin/imeyli'} role="search">
              {SEARCH}
              {cat.audience && <input type="hidden" name="audience" value={cat.audience} />}
              {view === 'sent' && <input type="hidden" name="izgled" value="izprateni" />}
              <input name="q" type="search" defaultValue={q} placeholder="Търси имейл по тема или събитие" aria-label="Търси имейл по тема или събитие" />
            </form>
          </div>

          {view === 'templates' ? (
            cat.groups.length ? cat.groups.map(g => (
              <div key={g.audience}>
                <div className="em-g">{g.title}</div>
                {g.rows.map(m => (
                  <Link key={m.key} className={`em-row${m.key === key ? ' is-sel' : ''}`} href={keyHref(m.key, { msg: null })} scroll={false}>
                    <span className="em-t">{m.trigger}</span>
                    <span className="em-end">
                      {m.optional ? <span className="em-kind">По избор</span> : <span className="em-kind is-req">{LOCK}Задължителен</span>}
                    </span>
                    <span className="em-s">{m.subject}</span>
                    <span className="em-when" title={m.when}>{CLOCK}<span>{m.when}</span></span>
                    {m.sent > 0 && <span className="em-sent">{plural(m.sent, 'изпратен', 'изпратени')}{m.lastSent ? ` · последно на ${dateTime(m.lastSent)}` : ''}</span>}
                  </Link>
                ))}
              </div>
            )) : <div className="ui-empty">Няма записи в този изглед.</div>
          ) : (
            out.rows.length ? (
              <div>
                {out.rows.map(m => (
                  <Link key={m.id} className={`em-row${message?.id === m.id ? ' is-sel' : ''}`} href={keyHref(m.key, { izgled: 'izprateni', msg: m.id })} scroll={false}>
                    <span className="em-t">{m.trigger}</span>
                    <span className="em-end"><span className={`badge ${m.badge.cls}`}>{m.badge.label}</span></span>
                    <span className="em-s">{m.subject}</span>
                    <span className="em-when">{CLOCK}<span>{m.to} · {m.when}</span></span>
                  </Link>
                ))}
              </div>
            ) : <div className="ui-empty">Няма записи в този изглед.</div>
          )}
        </section>

        <aside>
          <section className="dcard em-prev">
            <div className="em-prev-h"><h2 className="dcard-title" style={{ fontSize: 17 }}>{entry.trigger}</h2></div>
            <iframe className="em-frame" src={previewSrc} title="Преглед на имейла" />
            <div className="em-meta">
              <div className="kv-item"><div className="kv-label">Получател</div><div className="kv-value">{message ? message.to : AUDIENCE_WHO[entry.audience]}</div></div>
              <div className="kv-item"><div className="kv-label">Кога</div><div className="kv-value">{message ? message.when : entry.when}</div></div>
              {!message && (
                <div className="kv-item"><div className="kv-label">Изпратени</div><div className="kv-value">{stats.sent}{stats.last && <small>последно на {dateTime(stats.last)}</small>}</div></div>
              )}
              {message && <div className="kv-item"><div className="kv-label">Статус</div><div className="kv-value"><span className={`badge ${message.badge.cls}`}>{message.badge.label}</span></div></div>}
              {source && (
                <div className="kv-item"><div className="kv-label">Задейства се от</div><div className="kv-value">{source.href ? <Link href={source.href}>{source.label} →</Link> : source.label}</div></div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
