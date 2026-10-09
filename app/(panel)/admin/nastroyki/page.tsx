// /admin/nastroyki — admin/settings.html (SCREENS §8, SPEC §2) [manage_team_settings]: categories with
// partners and this month's turnover, policies, commission, languages, bank transfer, the team preview and,
// in demo environments only, the platform clock.
import Link from 'next/link';
import '@/styles/m-admin-ops.css';
import { AdminSearch } from '../_ops/AdminSearch';
import { getSettings } from '@/lib/domain/settings';
import { listTeam } from '@/lib/domain/team';
import { commissionEffectiveFrom, matches, settingsCategories, timeTravelAllowed } from '@/lib/domain/views-admin-ops';
import { now } from '@/lib/clock';
import { dateShort, dateTime, moneyShort } from '@/lib/format';
import { requireTeam } from '../_ops/guard';
import { initials, n } from '../_ops/fmt';
import { ActionDialog, ActionForm, Submit } from '../_ops/ui';
import { PoliciesCard, RateInput, SettingsButtons, SettingsRoot, Toggle } from './SettingsForm';
import { addCategoryAction, advanceClockAction, updateSettingsAction } from './actions';

export const metadata = { title: 'Настройки' };

/** The prototype's category icons (admin/settings.html), by slug. */
const CAT_ICON: Record<string, React.ReactNode> = {
  'dj-i-ozvuchavane': <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  muzikanti: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
  ketaring: <><path d="M4 21V10a8 8 0 0116 0v11" /><path d="M2 21h20M9 10h6" /></>,
  fotografiya: <><rect x="3" y="6" width="18" height="14" rx="2" /><circle cx="12" cy="13" r="3.4" /><path d="M8 6l1.5-2h5L16 6" /></>,
  videozasnemane: <><rect x="2" y="6" width="14" height="12" rx="2" /><path d="M16 10l6-3v10l-6-3" /></>,
  'zali-i-lokatsii': <><path d="M12 21c-4-4-7-7-7-11a7 7 0 0114 0c0 4-3 7-7 11z" /><circle cx="12" cy="10" r="2.4" /></>,
  dekoratsiya: <><path d="M12 3v18M5 8c3 0 5 2 7 4M19 8c-3 0-5 2-7 4" /></>,
  fotokabini: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="3.4" /></>,
  'torti-i-deserti': <><path d="M4 21h16M5 21v-7h14v7M7 14v-3h10v3M12 11V8" /></>,
};

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor } = await requireTeam('manage_team_settings', '/admin/nastroyki');
  const sp = await searchParams;
  const q = (sp.q ?? '').trim();
  const at = await now();
  const [s, cats, team, effective] = await Promise.all([getSettings(), settingsCategories(), listTeam(actor), commissionEffectiveFrom()]);
  const pct = (bp: number) => (bp % 100 === 0 ? String(bp / 100) : (bp / 100).toFixed(2).replace(/0$/, '').replace('.', ','));

  // ‹Търси настройка›: rows whose label or note contains the query stay visible.
  const rows: Record<string, string[]> = {
    payment: ['Срок за плащане след одобрение', 'След изтичане датата се освобождава автоматично'],
    response: ['Срок за отговор от изпълнител'],
    policies: ['Политики за анулиране', 'Гъвкава Умерена Строга'],
    reviews: ['Ревюта само от платени резервации', 'Пази оценките от фалшиви мнения'],
    moderation: ['Ръчна модерация на всяка нова обява', 'Изключването пуска обявите директно на живо'],
    commission: ['Комисиона', 'Стандартна ставка', 'Бизнес клиенти', 'резервации'],
    bg: ['Български', 'Основен език', 'Езици и валута'],
    en: ['English', 'За чуждестранни клиенти', 'Езици и валута'],
    currency: ['Валута', 'Показва се в каталога и фактурите', 'EUR'],
    bank: ['Банков превод', 'Плащания'],
    team: ['Екип', 'Покани в екипа', ...team.members.map(m => m.name)],
    clock: ['Демо часовник'],
  };
  const hidden = new Set(q ? Object.entries(rows).filter(([, v]) => !matches(q, ...v)).map(([k]) => k) : []);
  const catHidden = (name: string) => !!q && !matches(q, name, 'Категории');
  const h = (k: string) => (hidden.has(k) ? ' ops-hidden-row' : '');
  const visibleCats = cats.filter(c => !catHidden(c.name));
  const card = (...keys: string[]) => keys.every(k => hidden.has(k)) ? ' ops-hidden-row' : '';

  return (
    <div className="ops-page">
      <SettingsRoot action={updateSettingsAction}>
        <div className="page-head">
          <div>
            <h1 className="page-title">Настройки на платформата</h1>
            <p className="page-sub">Категории, комисиона, политики и езици</p>
          </div>
          <div className="page-head-right"><SettingsButtons /></div>
        </div>

        <AdminSearch inPage />
        <div className="adm-grid">
          <div>
            <section className={`dcard${visibleCats.length || !q ? '' : ' ops-hidden-row'}`}>
              <div className="dcard-head">
                <h2 className="dcard-title">Категории</h2>
                <ActionDialog trigger="Добави категория" triggerClass="btn btn--outline btn--sm" triggerStyle={{ marginLeft: 'auto' }}
                  title="Добави категория" submitLabel="Добави категория" action={addCategoryAction}>
                  <label className="fld">
                    <span className="fld-l">Категория</span>
                    <input className="fld-i" name="name" required minLength={2} maxLength={60} autoComplete="off" />
                  </label>
                </ActionDialog>
              </div>
              {cats.map(c => (
                <div className={`cat-row${catHidden(c.name) ? ' ops-hidden-row' : ''}`} key={c.id}>
                  <span className={`cat-ico${c.visible ? '' : ' is-off'}`}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{c.visible ? (CAT_ICON[c.slug] ?? <><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 12l9 5 9-5" /></>) : <path d="M5 12h14" />}</svg>
                  </span>
                  <span>
                    <span className="cat-n">{c.name}</span>
                    <span className="cat-s">{n(c.partners, 'изпълнител', 'изпълнители')} · {c.visible ? (c.subtypes ? n(c.subtypes, 'подкатегория', 'подкатегории') : 'без подкатегории') : 'скрита от каталога'}</span>
                  </span>
                  <span className="cat-c">{c.gmvCents ? moneyShort(c.gmvCents) : '—'}</span>
                  <Toggle name={`cat.${c.id}`} initial={c.visible} label={c.name} />
                </div>
              ))}
            </section>

            <section className={`dcard${card('payment', 'response', 'policies', 'reviews', 'moderation')}`}>
              <div className="dcard-head"><h2 className="dcard-title">Политики</h2></div>
              <PoliciesCard s={{ paymentHours: s['payment.window_hours'], responseHours: s['request.response_hours'], policies: s['cancellation.policies'] }} hiddenRows={hidden} />
              <div className={`set-row${h('reviews')}`}>
                <div className="set-t">
                  <div className="set-n">Ревюта само от платени резервации</div>
                  <div className="set-d">Пази оценките от фалшиви мнения</div>
                </div>
                <Toggle initial label="Ревюта само от платени резервации" locked />
              </div>
              <div className={`set-row${h('moderation')}`}>
                <div className="set-t">
                  <div className="set-n">Ръчна модерация на всяка нова обява</div>
                  <div className="set-d">Изключването пуска обявите директно на живо</div>
                </div>
                <Toggle name="moderation.manual" initial={s['moderation.manual']} label="Ръчна модерация на всяка нова обява" />
              </div>
            </section>
          </div>

          <aside>
            <section className={`dcard${card('commission')}`}>
              <div className="dcard-head">
                <h2 className="dcard-title" style={{ fontSize: 17 }}>Комисиона</h2>
                {effective && <span className="badge badge--primary">в сила от {dateShort(effective)}</span>}
              </div>
              <div className="rate">
                <span className="rate-n">Стандартна ставка</span>
                <RateInput name="commission.standard" initial={pct(s['commission.standard_bp'])} label="Стандартна ставка" />
              </div>
              <div className="rate">
                <span className="rate-n">Първите <span className="num">{s['commission.intro_count']}</span> резервации</span>
                <RateInput name="commission.intro" initial={pct(s['commission.intro_bp'])} label={`Първите ${s['commission.intro_count']} резервации`} />
              </div>
              <div className="rate">
                <span className="rate-n">Бизнес клиенти</span>
                <RateInput name="commission.business" initial={pct(s['commission.business_bp'])} label="Бизнес клиенти" />
              </div>
              <div className="hint" style={{ marginTop: 14 }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
                <span>Промяната важи само за нови резервации.</span>
              </div>
            </section>

            <section className={`dcard${card('bg', 'en', 'currency')}`}>
              <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Езици и валута</h2></div>
              <div className={`set-row${h('bg')}`}>
                <div className="set-t"><div className="set-n">Български</div><div className="set-d">Основен език</div></div>
                <Toggle initial label="Български" locked />
              </div>
              <div className={`set-row${h('en')}`}>
                <div className="set-t"><div className="set-n">English</div><div className="set-d">За чуждестранни клиенти</div></div>
                <Toggle name="locale.en_enabled" initial={s['locale.en_enabled']} label="English" />
              </div>
              <div className={`set-row${h('currency')}`}>
                <div className="set-t"><div className="set-n">Валута</div><div className="set-d">Показва се в каталога и фактурите</div></div>
                <span className="set-v">EUR (€)</span>
              </div>
            </section>

            <section className={`dcard${card('bank')}`}>
              <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Плащания</h2></div>
              <div className="set-row">
                <div className="set-t"><div className="set-n">Банков превод</div></div>
                <Toggle name="payment.bank_transfer_enabled" initial={s['payment.bank_transfer_enabled']} label="Банков превод" />
              </div>
            </section>

            <section className={`dcard${card('team')}`}>
              <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Екип</h2></div>
              {team.members.map(m => (
                <Link className="mini" key={m.userId} href="/admin/nastroyki/ekip">
                  <span className="avatar avatar--sm">{initials(m.name)}</span>
                  <span><span className="mini-n">{m.name}</span><span className="mini-s">{m.roleLabel} · {m.roleScope.toLocaleLowerCase('bg')}</span></span>
                </Link>
              ))}
              <Link className="btn btn--outline btn--sm btn--block" href="/admin/nastroyki/ekip" style={{ marginTop: 14 }}>Покани в екипа</Link>
            </section>

            {timeTravelAllowed() && (
              <section className={`dcard${card('clock')}`}>
                <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Демо часовник</h2></div>
                <div className="ops-clock-v">{dateTime(at)}</div>
                <div className="ops-clock-acts">
                  {[{ h: 1, l: '+1 час' }, { h: 6, l: '+6 часа' }, { h: 24, l: '+1 ден' }, { h: 24 * 7, l: '+7 дни' }].map(x => (
                    <ActionForm key={x.h} action={advanceClockAction} className="ops-inline">
                      <input type="hidden" name="hours" value={x.h} />
                      <Submit className="btn btn--outline btn--sm">{x.l}</Submit>
                    </ActionForm>
                  ))}
                </div>
              </section>
            )}
          </aside>
        </div>
      </SettingsRoot>
    </div>
  );
}
