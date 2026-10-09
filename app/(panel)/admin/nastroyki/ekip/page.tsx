// /admin/nastroyki/ekip — admin/team.html (SCREENS §8, SPEC §1.2, §4.15) [manage_team_settings]: members
// with their last activity (audit log), invites, the permission matrix.
import Link from 'next/link';
import '@/styles/m-admin-ops.css';
import { ROLE_PERMISSIONS, type TeamPermission } from '@/lib/domain/actor';
import { listTeam, ROLE_LABEL } from '@/lib/domain/team';
import { matches, teamMatches } from '@/lib/domain/views-admin-ops';
import { now } from '@/lib/clock';
import { monthName, sofiaParts } from '@/lib/format';
import { Icon } from '@/components/ui/Icon';
import { requireTeam } from '../../_ops/guard';
import { Badge, ago, dayTime, initials } from '../../_ops/fmt';
import { ActionDialog, ActionForm, Submit } from '../../_ops/ui';
import { inviteMemberAction, removeMemberAction, revokeInviteAction } from './actions';

export const metadata = { title: 'Екип' };

/** SPEC §1.2 (admin/team.html „Какво може всяка роля“). */
const CAPS: Record<TeamPermission, [string, string]> = {
  approve_partners: ['Одобрява изпълнители', 'Проверява профила и пуска обявите на живо'],
  moderate_listings: ['Модерира обяви и снимки', 'Одобрява промените по вече публикувани обяви'],
  resolve_disputes: ['Решава спорове', 'Взема решение за възстановяване и го изпраща до двете страни'],
  message_users: ['Пише на клиенти и изпълнители', 'Отговаря на запитвания и свързва страните по резервация'],
  view_finance: ['Вижда плащания и комисиони', 'Отваря партидите, сметките и счетоводните справки'],
  release_payouts: ['Пуска изплащанията', 'Потвърждава партидата към банката'],
  manage_team_settings: ['Управлява екипа и настройките', 'Кани хора, сменя роли и редактира политиките'],
};
const ROLES = ['admin', 'moderator', 'support', 'accounting'] as const;
const Check = () => <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>;

export default async function TeamPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { actor, user } = await requireTeam('manage_team_settings', '/admin/nastroyki/ekip');
  const sp = await searchParams;
  const at = await now();
  const team = await listTeam(actor);
  const members = team.members.filter(m => teamMatches(sp.q, m));
  const invites = team.invites.filter(i => matches(sp.q, i.email, i.roleLabel, i.inviterName));
  const cap = (s: string) => s.charAt(0).toLocaleUpperCase('bg') + s.slice(1);

  return (
    <div className="ops-page">
      <Link className="crumb" href="/admin/nastroyki"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>Настройки</Link>

      <div className="page-head">
        <div>
          <h1 className="page-title">Екип</h1>
          <p className="page-sub">{team.members.length} {team.members.length === 1 ? 'човек' : 'души'} с достъп до панела · {team.invites.length} {team.invites.length === 1 ? 'чакаща покана' : 'чакащи покани'}</p>
        </div>
      </div>

      <section className="dcard">
        <div className="dcard-head">
          <h2 className="dcard-title">Хора с достъп</h2>
          <span className="badge badge--success">{team.members.length} {team.members.length === 1 ? 'активен' : 'активни'}</span>
        </div>
        {members.length ? (
          <div className="ops-tbl-wrap">
            <table className="tbl tm-tbl">
              <thead>
                <tr><th>Име</th><th>Имейл</th><th>Роля</th><th>Последна активност</th><th>Статус</th><th className="tm-acc">Достъп</th></tr>
              </thead>
              <tbody>
                {members.map(m => {
                  const last = m.lastActivity ?? m.lastActiveAt;
                  const joined = sofiaParts(m.joinedAt);
                  const me = m.userId === user.id;
                  return (
                    <tr key={m.userId}>
                      <td>
                        <div className="tm-p"><span className="avatar avatar--sm">{initials(m.name)}</span><div><div className="tbl-event">{m.name}</div>
                          <div className="tbl-sub">{m.isOwner ? 'Собственик на профила' : m.title ?? `В екипа от ${monthName(joined.m)} ${joined.y}`}</div></div></div>
                      </td>
                      <td className="tm-mail">{m.email}</td>
                      <td><div className="tbl-event">{m.roleLabel}</div><div className="tbl-sub">{m.roleScope}</div></td>
                      <td>
                        <div className="tbl-event">{me ? 'Онлайн сега' : last ? cap(ago(last, at)) : '—'}</div>
                        {last && <div className="tbl-sub">{dayTime(last, at)}</div>}
                      </td>
                      <td><Badge tone="success">Активен</Badge></td>
                      <td className="tm-acc">
                        {m.isOwner ? <span className="tm-owner">Собственик</span> : me ? null : (
                          <ActionDialog trigger="Премахни" triggerClass="btn btn--ghost btn--sm" title={m.name} submitLabel="Премахни" submitClass="btn btn--danger"
                            action={removeMemberAction} hidden={{ userId: m.userId }}>
                            <p className="tm-mail" style={{ margin: 0 }}>{m.roleLabel} · {m.email}</p>
                          </ActionDialog>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : <div className="ui-empty">Няма записи в този изглед.</div>}
      </section>

      <section className="dcard">
        <div className="dcard-head"><h2 className="dcard-title">Покани в екипа</h2></div>
        <ActionForm action={inviteMemberAction}>
          <div className="tm-invite">
            <label className="fld">
              <span className="fld-l">Имейл</span>
              <input className="fld-i" type="email" name="email" placeholder="име@eventat.bg" required maxLength={200} autoComplete="off" />
            </label>
            <label className="fld">
              <span className="fld-l">Роля</span>
              <span className="ops-select">
                <select className="fld-i" name="role" defaultValue="moderator">
                  {ROLES.map(r => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                </select>
                <Icon name="chevronDown" />
              </span>
            </label>
            <Submit className="btn btn--primary">Изпрати покана</Submit>
          </div>
          <div className="fld-hint" style={{ marginTop: 9 }}>Поканеният получава имейл с линк и си избира парола при първото влизане.</div>
        </ActionForm>

        <div className="tm-div"><b>Чакащи покани</b><span>{team.invites.length}</span></div>
        {invites.length ? invites.map(i => (
          <div className="tm-inv" key={i.id}>
            <span className="tm-inv-i"><Icon name="mail" /></span>
            <span>
              <span className="tm-inv-n">{i.email}</span>
              <span className="tm-inv-s">{i.roleLabel} · изпратена {ago(i.sentAt, at)} от {i.inviterName}</span>
            </span>
            <Badge tone="warning">Чака отговор</Badge>
            <ActionForm action={revokeInviteAction} className="ops-inline">
              <input type="hidden" name="inviteId" value={i.id} />
              <Submit className="btn btn--ghost btn--sm">Оттегли</Submit>
            </ActionForm>
          </div>
        )) : <div className="ui-empty">Няма записи в този изглед.</div>}
      </section>

      <section className="dcard">
        <div className="dcard-head"><h2 className="dcard-title">Какво може всяка роля</h2></div>
        <div className="ops-tbl-wrap">
          <table className="tbl tm-cap">
            <thead>
              <tr><th>Право в панела</th>{ROLES.map(r => <th key={r}>{ROLE_LABEL[r]}</th>)}</tr>
            </thead>
            <tbody>
              {team.matrix.map(row => (
                <tr key={row.permission}>
                  <td><div className="tm-cap-n">{CAPS[row.permission][0]}</div><div className="tm-cap-d">{CAPS[row.permission][1]}</div></td>
                  {ROLES.map(r => <td key={r}>{ROLE_PERMISSIONS[r].includes(row.permission) ? <span className="tm-can"><Check /></span> : <span className="tm-cant">—</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
