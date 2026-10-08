// The EventAT team (SPEC §4.15, §1.2, §11.5; T19 daily digest, T25 invite expiry).
//
//   team_invite:  pending ‹Чака отговор› → accepted | revoked | expired (T25, 7 days, D50)
//   team_member:  active ‹Активен› → removed (‹Премахни›, never the owner)
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Queryable, type Tx } from '@/db';
import {
  adminNote, auditLog, booking, dispute, partner, serviceRevision, session, teamInvite, teamMember, user, type TeamRole,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { cancelJobs, scheduleJob } from '@/lib/jobs';
import { addDays, daysBetween, money, sofiaDate, sofiaInstant, type DateStr } from '@/lib/format';
import { ROLE_PERMISSIONS, SYSTEM, TEAM_PERMISSIONS, assertCan, type AnyActor, type TeamPermission } from './actor';
import { audit } from './audit';
import { DomainError, NotFoundError, assertTeamMember, hashToken, mail, mailEach, newToken, teamRecipients, withTx } from './catalogue-kit';
import { getSetting } from './settings';

export type TeamInvite = typeof teamInvite.$inferSelect;

/** admin/team.html: role names and their sub-line. */
export const ROLE_LABEL: Record<TeamRole, string> = { admin: 'Администратор', moderator: 'Модератор', support: 'Поддръжка', accounting: 'Счетоводство' };
export const ROLE_SCOPE: Record<TeamRole, string> = { admin: 'Пълен достъп', moderator: 'Обяви и спорове', support: 'Клиенти и изпълнители', accounting: 'Плащания и справки' };

/** The permission matrix in running text (2nd person plural), as in the approved moderator sentence. */
const CAN: Record<TeamPermission, string> = {
  approve_partners: 'одобрявате изпълнители', moderate_listings: 'модерирате обяви и снимки', resolve_disputes: 'решавате спорове',
  message_users: 'пишете на клиенти и изпълнители', view_finance: 'виждате плащанията и комисионите', release_payouts: 'пускате изплащанията',
  manage_team_settings: 'управлявате екипа и настройките',
};
const NOT_IN_ROLE: Partial<Record<TeamPermission, string>> = {
  view_finance: 'плащанията', release_payouts: 'изплащанията', manage_team_settings: 'управлението на екипа',
};
const AS: Record<TeamRole, string> = { admin: 'Като администратор', moderator: 'Като модератор', support: 'В поддръжката', accounting: 'В счетоводството' };
const and_ = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs.at(-1)}`);

/**
 * The `team-invite` paragraph about the role. The moderator text is the prototype's; the other
 * three are built the same way from the permission matrix and are new copy (needs Nikola's approval).
 */
export function roleDescription(role: TeamRole): string {
  const has = ROLE_PERMISSIONS[role];
  const lacks = TEAM_PERMISSIONS.filter(p => !has.includes(p) && NOT_IN_ROLE[p]).map(p => NOT_IN_ROLE[p]!);
  const first = `${AS[role]} ${and_(has.map(p => CAN[p]))}.`;
  const rest = and_(lacks);
  return lacks.length ? `${first} ${rest.charAt(0).toUpperCase()}${rest.slice(1)} не влизат в тази роля.` : first;
}

// ── Invites ──────────────────────────────────────────────────────────────

/**
 * ‹Изпрати покана› (Имейл, Роля) → `team-invite` with a 7-day link (T25); toast ‹Поканата е изпратена›.
 * A newer invite to the same address replaces a pending one.
 */
export async function invite(actor: AnyActor, a: { email: string; role: TeamRole }, tx?: Tx): Promise<{ invite: TeamInvite; token: string }> {
  assertCan(actor, 'manage_team_settings');
  const email = (a.email ?? '').trim().toLowerCase();
  if (!z.email().safeParse(email).success) throw new DomainError('invalid_email');
  if (!(a.role in ROLE_LABEL)) throw new DomainError('invalid_role');
  return withTx(tx, async t => {
    const [member] = await t.select({ id: user.id }).from(teamMember).innerJoin(user, eq(user.id, teamMember.userId))
      .where(and(sql`lower(${user.email}) = ${email}`, eq(teamMember.status, 'active')));
    if (member) throw new DomainError('already_member');
    const at = await now();
    const old = await t.update(teamInvite).set({ status: 'revoked', revokedAt: at })
      .where(and(sql`lower(${teamInvite.email}) = ${email}`, eq(teamInvite.status, 'pending'))).returning({ id: teamInvite.id });
    for (const o of old) await cancelJobs(`teaminvite:${o.id}:`, t);
    const { token, hash } = newToken();
    const expiresAt = new Date(at.getTime() + 7 * 86_400_000);
    const [inv] = await t.insert(teamInvite).values({ email, role: a.role, invitedBy: actor.userId, tokenHash: hash, sentAt: at, expiresAt }).returning();
    await scheduleJob('teaminvite.expire', expiresAt, { inviteId: inv.id }, `teaminvite:${inv.id}:expire`, t);
    await audit(t, { actor, action: 'team.invited', entity: 'team_invite', entityId: inv.id, data: { email, role: a.role } });
    const [me] = await t.select({ name: user.name }).from(user).where(eq(user.id, actor.userId));
    await mail(t, {
      key: 'team-invite', to: email, dedupeKey: `teaminvite:${inv.id}`,
      vars: {
        inviterName: me.name, inviterRole: ROLE_LABEL[actor.teamRole!], role: ROLE_LABEL[a.role], roleScope: ROLE_SCOPE[a.role].toLocaleLowerCase('bg'),
        roleDescription: roleDescription(a.role), email, url: `/admin/pokana/${token}`,
      },
    });
    return { invite: inv, token };
  });
}

/** ‹Оттегли› (toast ‹Поканата е оттеглена›). */
export async function revokeInvite(actor: AnyActor, a: { inviteId: string }, tx?: Tx) {
  assertCan(actor, 'manage_team_settings');
  return withTx(tx, async t => {
    const [inv] = await t.select().from(teamInvite).where(eq(teamInvite.id, a.inviteId)).for('update');
    if (!inv) throw new NotFoundError('team_invite');
    if (inv.status !== 'pending') throw new DomainError('invite_status');
    const [row] = await t.update(teamInvite).set({ status: 'revoked', revokedAt: await now() }).where(eq(teamInvite.id, inv.id)).returning();
    await cancelJobs(`teaminvite:${inv.id}:`, t);
    await audit(t, { actor, action: 'team.invite_revoked', entity: 'team_invite', entityId: inv.id });
    return row;
  });
}

/** The invite behind a link, if it can still be accepted (`/admin/pokana/[token]`). */
export async function inviteByToken(token: string, q: Queryable = db) {
  const [inv] = await q.select().from(teamInvite).where(eq(teamInvite.tokenHash, hashToken(token ?? ''))).limit(1);
  if (!inv) return null;
  return { invite: inv, valid: inv.status === 'pending' && inv.expiresAt > await now() };
}

/**
 * ‹Приеми поканата› + password: the page creates the user through Better Auth with the invited
 * address; this makes it an admin with a `team_member` row in the invited role.
 */
export async function acceptInvite(a: { token: string; userId: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const [inv] = await t.select().from(teamInvite).where(eq(teamInvite.tokenHash, hashToken(a.token ?? ''))).for('update');
    const at = await now();
    if (!inv || inv.status !== 'pending') throw new DomainError('invalid_token');
    if (inv.expiresAt <= at) throw new DomainError('token_expired');
    const [u] = await t.select().from(user).where(eq(user.id, a.userId)).for('update');
    if (!u || u.email.toLowerCase() !== inv.email.toLowerCase()) throw new DomainError('email_mismatch');
    if (u.role === 'partner') throw new DomainError('wrong_role');
    await t.update(user).set({ role: 'admin', emailVerified: true, updatedAt: at }).where(eq(user.id, u.id));
    await t.insert(teamMember).values({ userId: u.id, role: inv.role, invitedBy: inv.invitedBy, joinedAt: at, status: 'active' })
      .onConflictDoUpdate({ target: teamMember.userId, set: { role: inv.role, status: 'active', invitedBy: inv.invitedBy, joinedAt: at, removedAt: null, removedBy: null } });
    await t.update(teamInvite).set({ status: 'accepted', acceptedAt: at }).where(eq(teamInvite.id, inv.id));
    await cancelJobs(`teaminvite:${inv.id}:`, t);
    await audit(t, { actor: { userId: u.id, role: 'admin', teamRole: inv.role }, action: 'team.invite_accepted', entity: 'team_invite', entityId: inv.id });
    return { userId: u.id, role: inv.role };
  });
}

/** T25 `teaminvite.expire`: a pending invite past its 7 days → `expired`. Idempotent. */
export async function expireInvite(a: { inviteId: string }, tx?: Tx): Promise<boolean> {
  return withTx(tx, async t => {
    const rows = await t.update(teamInvite).set({ status: 'expired' })
      .where(and(eq(teamInvite.id, a.inviteId), eq(teamInvite.status, 'pending'), sql`${teamInvite.expiresAt} <= ${(await now()).toISOString()}::timestamptz`))
      .returning({ id: teamInvite.id });
    if (rows.length) await audit(t, { actor: SYSTEM, action: 'team.invite_expired', entity: 'team_invite', entityId: a.inviteId });
    return rows.length > 0;
  });
}

// ── Members ──────────────────────────────────────────────────────────────

async function lockMember(t: Tx, userId: string) {
  const [m] = await t.select().from(teamMember).where(eq(teamMember.userId, userId)).for('update');
  if (!m || m.status !== 'active') throw new NotFoundError('team_member');
  return m;
}

/** ‹Премахни› (not the owner): status removed, sessions revoked; toast ‹Премахнато›. */
export async function removeMember(actor: AnyActor, a: { userId: string }, tx?: Tx) {
  assertCan(actor, 'manage_team_settings');
  return withTx(tx, async t => {
    const m = await lockMember(t, a.userId);
    if (m.isOwner) throw new DomainError('owner');
    if (m.userId === actor.userId) throw new DomainError('self');
    const at = await now();
    await t.update(teamMember).set({ status: 'removed', removedAt: at, removedBy: actor.userId }).where(eq(teamMember.userId, m.userId));
    await t.delete(session).where(eq(session.userId, m.userId));
    await audit(t, { actor, action: 'team.member_removed', entity: 'team_member', entityId: m.userId });
  });
}

/** ‹Кани хора, сменя роли›: change a member's role (never the owner's). */
export async function changeRole(actor: AnyActor, a: { userId: string; role: TeamRole }, tx?: Tx) {
  assertCan(actor, 'manage_team_settings');
  if (!(a.role in ROLE_LABEL)) throw new DomainError('invalid_role');
  return withTx(tx, async t => {
    const m = await lockMember(t, a.userId);
    if (m.isOwner) throw new DomainError('owner');
    await t.update(teamMember).set({ role: a.role }).where(eq(teamMember.userId, m.userId));
    await audit(t, { actor, action: 'team.role_changed', entity: 'team_member', entityId: m.userId, data: { from: m.role, to: a.role } });
  });
}

/** `/admin/nastroyki/ekip`: members with their last activity (audit log), pending invites, the matrix. */
export async function listTeam(actor: AnyActor, q: Queryable = db) {
  assertCan(actor, 'manage_team_settings');
  const members = await q.select({ m: teamMember, name: user.name, email: user.email, lastActivity: sql<Date | null>`(select max(created_at) from audit_log where actor_id = ${user.id})`.mapWith(auditLog.createdAt) })
    .from(teamMember).innerJoin(user, eq(user.id, teamMember.userId)).where(eq(teamMember.status, 'active')).orderBy(desc(teamMember.isOwner), asc(teamMember.joinedAt));
  const invites = await q.select({ i: teamInvite, inviterName: user.name }).from(teamInvite).innerJoin(user, eq(user.id, teamInvite.invitedBy))
    .where(eq(teamInvite.status, 'pending')).orderBy(desc(teamInvite.sentAt));
  return {
    members: members.map(r => ({ ...r.m, name: r.name, email: r.email, roleLabel: ROLE_LABEL[r.m.role], roleScope: ROLE_SCOPE[r.m.role], lastActivity: r.lastActivity })),
    invites: invites.map(r => ({ ...r.i, inviterName: r.inviterName, roleLabel: ROLE_LABEL[r.i.role] })),
    matrix: TEAM_PERMISSIONS.map(p => ({ permission: p, roles: (Object.keys(ROLE_PERMISSIONS) as TeamRole[]).filter(r => ROLE_PERMISSIONS[r].includes(p)) })),
  };
}

// ── Admin notes (‹Бележки на екипа›, ‹Вътрешна бележка›) ─────────────────

/** `notes.add()`: a team note on a partner, client, booking or dispute. */
export async function addNote(actor: AnyActor, a: { subjectType: 'partner' | 'client' | 'booking' | 'dispute'; subjectId: string; body: string }, tx?: Tx) {
  assertTeamMember(actor);
  const body = (a.body ?? '').trim();
  if (!body) throw new DomainError('note_required');
  if (!['partner', 'client', 'booking', 'dispute'].includes(a.subjectType)) throw new DomainError('validation');
  return withTx(tx, async t => {
    const [row] = await t.insert(adminNote).values({ subjectType: a.subjectType, subjectId: a.subjectId, authorId: actor.userId, body, createdAt: await now() }).returning();
    await audit(t, { actor, action: 'note.added', entity: a.subjectType, entityId: a.subjectId, data: { noteId: row.id } });
    return row;
  });
}

export async function notes(actor: AnyActor, a: { subjectType: string; subjectId: string }, q: Queryable = db) {
  assertTeamMember(actor);
  return q.select({ n: adminNote, authorName: user.name }).from(adminNote).innerJoin(user, eq(user.id, adminNote.authorId))
    .where(and(eq(adminNote.subjectType, a.subjectType), eq(adminNote.subjectId, a.subjectId))).orderBy(desc(adminNote.createdAt));
}

// ── Open tasks: admin bell, dashboard and T19 ────────────────────────────

/**
 * `admin_attention` (DATA-MODEL §2.21; the computed admin bell, SPEC §4): partners waiting for
 * approval (the oldest wait), pending revisions (new / edits), open disputes (Σ held) and the most urgent case.
 */
export async function attention(q: Queryable = db) {
  const at = await now();
  const [pa] = await q.select({ n: sql<number>`count(*)::int`, oldest: sql<string | null>`min(${partner.submittedAt})` }).from(partner).where(eq(partner.status, 'submitted'));
  const revs = await q.select({ type: serviceRevision.type, n: sql<number>`count(*)::int` }).from(serviceRevision).where(eq(serviceRevision.status, 'pending')).groupBy(serviceRevision.type);
  const open = await q.select({ d: dispute, clientName: user.name, partnerName: partner.businessName }).from(dispute)
    .innerJoin(booking, eq(booking.id, dispute.bookingId)).innerJoin(user, eq(user.id, booking.clientId)).innerJoin(partner, eq(partner.id, booking.partnerId))
    .where(inArray(dispute.status, ['collecting', 'awaiting_decision']))
    .orderBy(desc(dispute.urgent), sql`(${dispute.status} = 'awaiting_decision') desc`, asc(dispute.openedAt));
  const oldest = pa.oldest ? new Date(pa.oldest) : null;
  const newServices = revs.find(r => r.type === 'new')?.n ?? 0, edits = revs.find(r => r.type === 'edit')?.n ?? 0;
  const held = open.filter(o => o.d.holdsPayout).reduce((s, o) => s + o.d.heldCents, 0);
  return {
    approvals: pa.n, oldestSubmittedAt: oldest, oldestWaitDays: oldest ? daysBetween(sofiaDate(oldest), sofiaDate(at)) : 0,
    moderation: newServices + edits, newServices, edits,
    disputes: open.length, disputesHeldCents: held,
    urgent: open[0] ? { caseNo: open[0].d.number, clientName: open[0].clientName, partnerName: open[0].partnerName, heldCents: open[0].d.heldCents } : null,
    total: pa.n + newServices + edits + open.length,
  };
}

/** Schedule the next T19 digest at ⚙ digest.time (today if still ahead, else tomorrow). Idempotent. */
export async function scheduleDigest(tx?: Tx, after?: Date): Promise<DateStr> {
  const at = after ?? await now();
  const [hh, mm] = (await getSetting('digest.time', at, tx)).split(':').map(Number);
  let d = sofiaDate(at);
  if (sofiaInstant(d, hh, mm) <= at) d = addDays(d, 1);
  await scheduleJob('digest.daily', sofiaInstant(d, hh, mm), { date: d }, `digest:${d}`, tx);
  return d;
}

/**
 * T19 `digest.daily` (09:00): with ≥ 1 open task, `team-daily-digest` to every admin holding
 * approve_partners, moderate_listings or resolve_disputes. Then the next day's digest is scheduled.
 * Idempotent per day and recipient.
 */
export async function sendDailyDigest(a: { date?: DateStr } = {}): Promise<{ sent: number }> {
  const at = await now();
  const day = a.date ?? sofiaDate(at);
  const sent = await db.transaction(async t => {
    const x = await attention(t);
    if (!x.total) return 0;
    const to = await teamRecipients(t, ['approve_partners', 'moderate_listings', 'resolve_disputes']);
    return mailEach(t, to, {
      key: 'team-daily-digest', dedupeKey: `digest:${day}`,
      vars: {
        totalTasks: x.total, approvals: x.approvals, oldestWaitDays: x.oldestWaitDays, moderation: x.moderation, newServices: x.newServices, edits: x.edits,
        disputes: x.disputes, disputesHeld: money(x.disputesHeldCents),
        ...(x.urgent ? { urgent: { caseNo: x.urgent.caseNo, clientName: x.urgent.clientName, partnerName: x.urgent.partnerName, heldAmount: money(x.urgent.heldCents) } } : {}),
      },
    });
  });
  await scheduleDigest(undefined, new Date(Math.max(sofiaInstant(day, 23, 59).getTime(), at.getTime())));
  return { sent };
}

