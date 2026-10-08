// The team (SPEC §4.15, §1.2, §11.5; T19 daily digest, T25 invite expiry) and admin notes.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { runDueJobs } from '@/lib/jobs';
import { sofiaInstant } from '@/lib/format';
import {
  acceptInvite, addNote, attention, changeRole, expireInvite, invite, inviteByToken, listTeam, notes, removeMember, revokeInvite, roleDescription,
  scheduleDigest, sendDailyDigest,
} from '@/lib/domain/team';
import { submitApplication } from '@/lib/domain/partners';
import { submit } from '@/lib/domain/services';
import { createAdmin, createBookingRow, createClient, categoryId, eventTypeId } from '../helpers/factories';
import { NOW, draftPartner, emails, expectLedgerClean, failure, fillOnboarding, jobsByPrefix, listedPartner, plain, signUpUser } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

describe('roles', () => {
  it('keeps the prototype’s moderator text and builds the others from the matrix', () => {
    expect(roleDescription('moderator')).toBe('Като модератор одобрявате изпълнители, модерирате обяви и снимки, решавате спорове и пишете на клиенти и изпълнители. Плащанията, изплащанията и управлението на екипа не влизат в тази роля.');
    expect(roleDescription('admin')).toBe('Като администратор одобрявате изпълнители, модерирате обяви и снимки, решавате спорове, пишете на клиенти и изпълнители, виждате плащанията и комисионите, пускате изплащанията и управлявате екипа и настройките.');
    expect(roleDescription('accounting')).toBe('В счетоводството виждате плащанията и комисионите. Изплащанията и управлението на екипа не влизат в тази роля.');
  });
});

describe('invites', () => {
  it('invites (manage_team_settings), replaces a pending invite, revokes', async () => {
    const { actor: owner } = await createAdmin('admin', { name: 'Моника Ковачева' });
    const { actor: mod } = await createAdmin('moderator');
    expect(await failure(invite(mod, { email: 'kalina@eventat.bg', role: 'moderator' }))).toContain('ForbiddenError');
    const first = await invite(owner, { email: 'Kalina@eventat.bg', role: 'support' });
    const second = await invite(owner, { email: 'kalina@eventat.bg', role: 'moderator' });
    expect((await db.select().from(s.teamInvite).where(eq(s.teamInvite.id, first.invite.id)))[0].status).toBe('revoked');
    const mails = (await emails('team-invite')).filter(m => m.toEmail === 'kalina@eventat.bg');
    expect(mails).toHaveLength(2);
    expect(mails[1].vars).toEqual({
      inviterName: 'Моника Ковачева', inviterRole: 'Администратор', role: 'Модератор', roleScope: 'обяви и спорове', roleDescription: roleDescription('moderator'),
      email: 'kalina@eventat.bg', url: `/admin/pokana/${second.token}`,
    });
    expect((await jobsByPrefix(`teaminvite:${second.invite.id}`))[0]).toMatchObject({ kind: 'teaminvite.expire', runAt: new Date(NOW.getTime() + 7 * 86_400_000) });
    expect((await inviteByToken(second.token))?.valid).toBe(true);
    await revokeInvite(owner, { inviteId: second.invite.id });
    expect((await inviteByToken(second.token))?.valid).toBe(false);
    expect(await failure(revokeInvite(owner, { inviteId: second.invite.id }))).toContain('invite_status');
    expect(await failure(invite(owner, { email: (await createAdmin('support')).user.email, role: 'support' }))).toContain('already_member');
  });

  it('accepts with the invited address only; the user becomes an admin in that role', async () => {
    const { actor: owner, user: ownerUser } = await createAdmin('admin');
    const { invite: inv, token } = await invite(owner, { email: 'ani@eventat.bg', role: 'accounting' });
    const wrong = await signUpUser({ email: 'other@eventat.bg' });
    expect(await failure(acceptInvite({ token, userId: wrong.id }))).toContain('email_mismatch');
    const u = await signUpUser({ name: 'Ани Георгиева', email: 'ani@eventat.bg' });
    expect(await acceptInvite({ token, userId: u.id })).toEqual({ userId: u.id, role: 'accounting' });
    expect((await db.select().from(s.user).where(eq(s.user.id, u.id)))[0]).toMatchObject({ role: 'admin', emailVerified: true });
    expect((await db.select().from(s.teamMember).where(eq(s.teamMember.userId, u.id)))[0]).toMatchObject({ role: 'accounting', invitedBy: ownerUser.id, status: 'active' });
    expect((await db.select().from(s.teamInvite).where(eq(s.teamInvite.id, inv.id)))[0].status).toBe('accepted');
    expect(await failure(acceptInvite({ token, userId: u.id }))).toContain('invalid_token');
  });

  it('T25: a pending invite expires after 7 days (idempotent)', async () => {
    const { actor: owner } = await createAdmin('admin');
    const { invite: inv, token } = await invite(owner, { email: 'late@eventat.bg', role: 'support' });
    advanceTestNow(7 * 86_400_000 - 60_000);
    await runDueJobs();
    expect((await db.select().from(s.teamInvite).where(eq(s.teamInvite.id, inv.id)))[0].status).toBe('pending');
    advanceTestNow(120_000);
    await runDueJobs();
    expect((await db.select().from(s.teamInvite).where(eq(s.teamInvite.id, inv.id)))[0].status).toBe('expired');
    expect(await expireInvite({ inviteId: inv.id })).toBe(false);
    const u = await signUpUser({ email: 'late@eventat.bg' });
    expect(await failure(acceptInvite({ token, userId: u.id }))).toContain('invalid_token');
  });
});

describe('members and notes', () => {
  it('removes (never the owner), changes roles, lists last activity', async () => {
    const { actor: owner, user: ownerUser } = await createAdmin('admin', { isOwner: true });
    const { actor: admin } = await createAdmin('admin');
    const { user: mod } = await createAdmin('moderator');
    await db.insert(s.session).values({ id: `s_${mod.id}`, token: `t_${mod.id}`, userId: mod.id, expiresAt: new Date('2030-01-01') });
    expect(await failure(removeMember(admin, { userId: ownerUser.id }))).toContain('owner');
    expect(await failure(removeMember(owner, { userId: ownerUser.id }))).toContain('owner');
    await changeRole(owner, { userId: mod.id, role: 'support' });
    expect((await db.select().from(s.teamMember).where(eq(s.teamMember.userId, mod.id)))[0].role).toBe('support');
    expect(await failure(changeRole(owner, { userId: ownerUser.id, role: 'support' }))).toContain('owner');
    await removeMember(admin, { userId: mod.id });
    expect((await db.select().from(s.teamMember).where(eq(s.teamMember.userId, mod.id)))[0]).toMatchObject({ status: 'removed' });
    expect(await db.select().from(s.session).where(eq(s.session.userId, mod.id))).toHaveLength(0);
    const team = await listTeam(owner);
    expect(team.members.find(m => m.userId === mod.id)).toBeUndefined();
    expect(team.members[0].isOwner).toBe(true);
    expect(team.members.find(m => m.userId === admin.userId)?.lastActivity?.getTime()).toBe(NOW.getTime());
    expect(team.matrix.find(x => x.permission === 'release_payouts')?.roles).toEqual(['admin']);
  });

  it('adds team notes (any team member), never clients or partners', async () => {
    const { actor: support } = await createAdmin('support');
    const { actor: client, user } = await createClient();
    expect(await failure(addNote(client, { subjectType: 'client', subjectId: user.id, body: 'x' }))).toContain('ForbiddenError');
    expect(await failure(addNote(support, { subjectType: 'client', subjectId: user.id, body: ' ' }))).toContain('note_required');
    await addNote(support, { subjectType: 'client', subjectId: user.id, body: 'Клиентът е коректен и отговаря бързо.' });
    expect((await notes(support, { subjectType: 'client', subjectId: user.id })).map(n => n.n.body)).toEqual(['Клиентът е коректен и отговаря бързо.']);
  });
});

describe('T19 daily digest', () => {
  it('is quiet with no open task; otherwise reaches approve / moderate / resolve holders once per day and schedules the next', async () => {
    const admin = await createAdmin('admin');
    const mod = await createAdmin('moderator');
    const acc = await createAdmin('accounting');
    expect(await scheduleDigest()).toBe('2025-09-01');
    expect((await attention()).total).toBe(0);
    setTestNow(sofiaInstant('2025-09-01', 9, 0));
    await runDueJobs();
    expect(await emails('team-daily-digest')).toHaveLength(0);
    expect((await jobsByPrefix('digest:')).find(j => j.dedupeKey === 'digest:2025-09-02')?.status).toBe('pending');

    // Open tasks: an application waiting 2 days, a new service, an urgent dispute.
    setTestNow(sofiaInstant('2025-08-31', 9, 0));
    const d = await draftPartner();
    await fillOnboarding(d.actor);
    await submitApplication(d.actor, { acceptTerms: true, confirmInfo: true });
    const pr = await listedPartner({ businessName: 'Флора Студио' });
    await submit(pr.actor, { kind: 'package_fixed', name: 'Арка', categoryId: await categoryId('dekoratsiya'), description: 'Арка от цветя.', priceCents: 30_000, eventTypeIds: [await eventTypeId()] });
    const { user: client } = await createClient({ name: 'Петя и Николай' });
    const b = await createBookingRow({ client, partner: pr, eventDate: '2025-06-07', status: 'completed' });
    await db.insert(s.dispute).values({
      number: b.number, bookingId: b.booking.id, openedBy: 'client', reason: 'not_as_described', title: 't', description: 'd', urgent: true, heldCents: 118_000,
      teamReplyDueAt: NOW, positionFrom: 'partner', positionRequestedAt: NOW, positionDueAt: NOW,
    });
    setTestNow(sofiaInstant('2025-09-02', 9, 0));
    await runDueJobs();
    const digests = await emails('team-daily-digest');
    // Earlier tests in this file left other active members; every recipient holds one of the three permissions.
    const roles = new Map((await db.select().from(s.teamMember)).map(m => [m.userId, m]));
    expect(digests.every(m => ['admin', 'moderator'].includes(roles.get(m.toUserId!)!.role) && roles.get(m.toUserId!)!.status === 'active')).toBe(true);
    expect(digests.map(m => m.toUserId)).toEqual(expect.arrayContaining([admin.user.id, mod.user.id]));
    expect(digests.map(m => m.toUserId)).not.toContain(acc.user.id);
    const sent = digests.length;
    expect(plain(digests[0].vars)).toEqual({
      totalTasks: 3, approvals: 1, oldestWaitDays: 2, moderation: 1, newServices: 1, edits: 0, disputes: 1, disputesHeld: '1 180,00 €',
      urgent: { caseNo: b.number, clientName: 'Петя и Николай', partnerName: 'Флора Студио', heldAmount: '1 180,00 €' },
    });
    expect(await db.select().from(s.notification).where(eq(s.notification.userId, admin.user.id))).toHaveLength(0); // team bell is computed
    await sendDailyDigest({ date: '2025-09-02' });
    expect(await emails('team-daily-digest')).toHaveLength(sent);
    expect((await jobsByPrefix('digest:')).find(j => j.dedupeKey === 'digest:2025-09-03')?.runAt.getTime()).toBe(sofiaInstant('2025-09-03', 9, 0).getTime());
  });
});
