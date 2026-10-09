// /admin/moderatsiya — admin/moderation.html (SCREENS §8) [moderate_listings]: pending revisions (new
// services: price + description; edits: ‹Беше› / ‹Става›), what we check, this week, common notes.
import Link from 'next/link';
import '@/styles/m-admin-ops.css';
import { moderationCounts, moderationFilterNames, moderationItems, moderationWeek } from '@/lib/domain/views-admin-ops';
import { now } from '@/lib/clock';
import { Icon } from '@/components/ui/Icon';
import { requireTeam } from '../_ops/guard';
import { ago, n } from '../_ops/fmt';
import { ActionDialog, ActionForm, InsertChips, Submit } from '../_ops/ui';
import { approveChangeAction, publishRevisionAction, returnRevisionAction } from './actions';

export const metadata = { title: 'Модерация' };

const FILTERS = [{ key: 'vsichki', label: 'Всички' }, { key: 'novi', label: 'Нови' }, { key: 'redakcii', label: 'Редакции' }] as const;
type Filter = (typeof FILTERS)[number]['key'];
/** SPEC §15 moderation common notes. */
const COMMON_NOTES = ['Липсва обхват на цената', 'Снимка с чужд воден знак', 'Телефон в описанието', 'Няма продължителност'];

export default async function ModerationPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; partnyor?: string; usluga?: string }> }) {
  const { actor } = await requireTeam('moderate_listings', '/admin/moderatsiya');
  const sp = await searchParams;
  const filter: Filter = FILTERS.some(f => f.key === sp.filter) ? (sp.filter as Filter) : 'vsichki';
  const at = await now();
  const [items, week, counts, names] = await Promise.all([
    moderationItems(actor, { filter, partnerId: sp.partnyor, serviceId: sp.usluga, q: sp.q }),
    moderationWeek(), moderationCounts(), moderationFilterNames({ partnerId: sp.partnyor, serviceId: sp.usluga }),
  ]);
  const href = (p: Record<string, string | undefined>) => {
    const u = new URLSearchParams();
    const v = { filter: filter === 'vsichki' ? undefined : filter, partnyor: names.partnerName ? sp.partnyor : undefined, usluga: names.serviceName ? sp.usluga : undefined, q: sp.q || undefined, ...p };
    for (const [k, x] of Object.entries(v)) if (x) u.set(k, x);
    const s = u.toString();
    return s ? `/admin/moderatsiya?${s}` : '/admin/moderatsiya';
  };
  const back = href({});
  const sub = [n(counts.news, 'нова услуга', 'нови услуги'), `${n(counts.edits, 'редакция', 'редакции')} на публикувани`,
    week.avgHours != null ? `средно време ${n(week.avgHours, 'час', 'часа')}` : null].filter(Boolean).join(' · ');
  const chips = [
    names.partnerName ? { label: names.partnerName, href: href({ partnyor: '' }) } : null,
    names.serviceName ? { label: names.serviceName, href: href({ usluga: '' }) } : null,
    sp.q ? { label: `„${sp.q}“`, href: href({ q: '' }) } : null,
  ].filter(Boolean) as { label: string; href: string }[];

  return (
    <div className="ops-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Опашка за преглед</h1>
          <p className="page-sub">{sub}</p>
        </div>
        <div className="page-head-right">
          <span className="seg">
            {FILTERS.map(f => <Link key={f.key} href={href({ filter: f.key === 'vsichki' ? '' : f.key })} className={`ops-seg${filter === f.key ? ' is-on' : ''}`} scroll={false}>{f.label}</Link>)}
          </span>
        </div>
      </div>

      {chips.length > 0 && (
        <div className="ui-chips ops-chips">
          {chips.map(c => <Link key={c.href} className="ui-chip ops-chip" href={c.href} scroll={false}>{c.label}<Icon name="close" /></Link>)}
        </div>
      )}

      <div className="adm-grid adm-grid--wide">
        <section className="dcard">
          <div className="dcard-head">
            <h2 className="dcard-title">Чакат преглед</h2>
            <span className="badge badge--primary">{items.length}</span>
          </div>

          {items.length ? items.map(it => {
            const isNew = it.type === 'new';
            const pairs: { label: string; after: string; isNew: boolean }[] = it.pairs.map(p => ({ label: p.label, after: p.after, isNew: p.label !== 'Беше' }));
            const rows: (typeof pairs)[] = [];
            for (let i = 0; i < pairs.length; i += 2) rows.push(pairs.slice(i, i + 2));
            return (
              <div className="mod" key={it.revisionId} id={`r-${it.revisionId}`}>
                <span className="mod-img" style={it.cover ? { backgroundImage: `url('${it.cover}')` } : undefined}></span>
                <div>
                  <span className="mod-n">{isNew ? it.name : `${it.name}${it.priceChanged ? ' — промяна на цена' : ''}`}</span>
                  <span className="mod-by">{it.partnerName} · {it.categoryName} · {isNew ? 'нова услуга' : 'редакция'} · подадена {ago(it.submittedAt, at)}</span>
                  {rows.map((r, i) => (
                    <div className="mod-diff" key={i}>
                      {r.map((p, j) => (
                        <div className={`mod-side${p.isNew ? ' is-new' : ''}`} key={j}>
                          <span className="mod-side-l">{p.label}</span>
                          <span className="mod-side-v">{p.after || '—'}</span>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
                <div className="mod-act">
                  <ActionForm action={isNew ? publishRevisionAction : approveChangeAction} className="ops-inline">
                    <input type="hidden" name="revisionId" value={it.revisionId} />
                    <input type="hidden" name="back" value={back} />
                    <Submit className="btn btn--primary btn--sm ops-fill">{isNew ? 'Публикувай' : 'Одобри'}</Submit>
                  </ActionForm>
                  <ActionDialog trigger="Върни с бележка" triggerClass="btn btn--outline btn--sm" title={it.name} submitLabel="Върни с бележка"
                    action={returnRevisionAction} hidden={{ revisionId: it.revisionId, back }}>
                    <label className="fld">
                      <span className="fld-l">Бележка до изпълнителя<span className="required-mark">*</span></span>
                      <textarea className="fld-i fld-i--area" name="note" rows={4} maxLength={2000} required />
                    </label>
                    <div className="ops-chips-l">Чести бележки</div>
                    <InsertChips items={COMMON_NOTES} />
                  </ActionDialog>
                </div>
              </div>
            );
          }) : <div className="ui-empty">Няма записи в този изглед.</div>}
        </section>

        <aside>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>За какво гледаме</h2></div>
            <div className="rules">
              <div className="rule"><span className="rule-num">1</span><span><strong>Снимките са собствени.</strong> Без стокови кадри и без водни знаци на друго студио.</span></div>
              <div className="rule"><span className="rule-num">2</span><span><strong>Цената е пълна.</strong> Без „от“ без обхват и без скрити такси за транспорт.</span></div>
              <div className="rule"><span className="rule-num">3</span><span><strong>Без контакти в текста.</strong> Телефони и имейли в описанието заобикалят платформата.</span></div>
              <div className="rule"><span className="rule-num">4</span><span><strong>Описанието казва какво влиза.</strong> Часове, брой хора, какво носи изпълнителят.</span></div>
            </div>
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Тази седмица</h2></div>
            <div className="split"><span>Прегледани</span><b>{week.reviewed}</b></div>
            <div className="split"><span>Публикувани</span><b>{week.published}</b></div>
            <div className="split"><span>Върнати с бележка</span><b>{week.returned}</b></div>
            <div className="split is-total"><span>Средно време</span><b>{week.avgHours != null ? `${week.avgHours} ч` : '—'}</b></div>
          </section>

          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Чести бележки</h2></div>
            <div className="chips">{COMMON_NOTES.map(t => <span className="chip" key={t}>{t}</span>)}</div>
          </section>
        </aside>
      </div>
    </div>
  );
}
