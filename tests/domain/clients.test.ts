// Client account (SPEC §4.1 A1–A12, §11.2 switches, §16 settings, D55).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { runDueJobs } from '@/lib/jobs';
import {
  afterPasswordChanged, block, clientStatus, confirmDeletion, confirmEmailChange, deviceFromUserAgent, expireDeletion, getPreferences, registerClient,
  requestDeletion, requestEmailChange, setAvatar, setMarketing, setPreferences, setTwoFactor, signOutEverywhere, updateClient, updateInvoiceProfile, verifyEmail,
} from '@/lib/domain/clients';
import { createAdmin, createBookingRow, createClient, cityId } from '../helpers/factories';
import { NOW, bells, draftPartner, emails, expectLedgerClean, failure, listedPartner, mediaRow, plain, signUpUser } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

async function addSession(userId: string, o: { device?: string; city?: string; ua?: string } = {}) {
  const id = `s_${Math.random().toString(36).slice(2)}`;
  await db.insert(s.session).values({ id, token: id, userId, expiresAt: new Date('2030-01-01'), deviceLabel: o.device ?? null, city: o.city ?? null, userAgent: o.ua ?? null });
  return id;
}

describe('A1 / A3 sign-up and welcome', () => {
  it('registers the profile and consents, then welcomes once after verification', async () => {
    const u = await signUpUser({ name: 'Мария Димитрова' });
    expect(await failure(registerClient({ userId: u.id, consent: false }))).toContain('consent_required');
    await registerClient({ userId: u.id, phone: '+359 88 412 7730', consent: true, acquisitionSource: 'meta' });
    const [row] = await db.select().from(s.user).where(eq(s.user.id, u.id));
    expect(row.phone).toBe('+359884127730');
    expect((await db.select().from(s.clientProfile).where(eq(s.clientProfile.userId, u.id)))[0]).toMatchObject({ clientType: 'private', acquisitionSource: 'meta' });
    expect((await db.select().from(s.consent).where(eq(s.consent.userId, u.id))).map(c => c.document).sort()).toEqual(['general_terms', 'privacy']);
    await verifyEmail({ userId: u.id });
    await verifyEmail({ userId: u.id });
    const mails = await emails('client-welcome', u.id);
    expect(mails).toHaveLength(1);
    expect(plain(mails[0].vars)).toEqual({ clientName: 'Мария Димитрова', email: u.email, phone: '+359 88 412 7730', registeredOn: '31 август 2025' });
    expect(await bells(u.id)).toHaveLength(1);
    expect((await db.select().from(s.user).where(eq(s.user.id, u.id)))[0].emailVerified).toBe(true);
  });

  it('P2: a partner gets vendor-welcome at the notification address', async () => {
    const { user, partner } = await draftPartner();
    await verifyEmail({ userId: user.id });
    const [mail] = await emails('vendor-welcome', user.id);
    expect(mail.toEmail).toBe(partner.notificationEmail);
    expect(plain(mail.vars)).toEqual({ partnerName: 'Студио Мелодия', contactName: 'Мартин Стоянов', email: partner.notificationEmail, phone: '+359 88 123 4567' });
  });
});

describe('A6 – A8 security', () => {
  it('A6: password changed — other sessions revoked, client-password-changed', async () => {
    const { user } = await createClient();
    const keep = await addSession(user.id);
    await addSession(user.id);
    await afterPasswordChanged({ userId: user.id, keepSessionId: keep });
    expect((await db.select().from(s.session).where(eq(s.session.userId, user.id))).map(x => x.id)).toEqual([keep]);
    expect(plain((await emails('client-password-changed', user.id))[0].vars)).toEqual({ email: user.email, changedOn: '31 август 2025' });
    expect((await db.select().from(s.user).where(eq(s.user.id, user.id)))[0].passwordChangedAt?.getTime()).toBe(NOW.getTime());
  });

  it('A7: two-step needs a phone; turning it on emails, off does not', async () => {
    const noPhone = await createClient({ phone: null });
    expect(await failure(setTwoFactor(noPhone.actor, { enabled: true }))).toContain('phone_required');
    const { actor, user } = await createClient();
    await setTwoFactor(actor, { enabled: true });
    await setTwoFactor(actor, { enabled: true });
    await setTwoFactor(actor, { enabled: false });
    const mails = await emails('client-2fa-on', user.id);
    expect(mails).toHaveLength(1);
    expect(plain(mails[0].vars)).toEqual({ email: user.email, phone: '+359 88 800 0000' });
  });

  it('A8: sign out everywhere lists the revoked sessions', async () => {
    const { actor, user } = await createClient();
    await addSession(user.id, { device: 'MacBook', city: 'София' });
    await addSession(user.id, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', city: 'София' });
    expect(await signOutEverywhere(actor)).toEqual({ revoked: 2 });
    expect(await db.select().from(s.session).where(eq(s.session.userId, user.id))).toHaveLength(0);
    expect((await emails('client-signout-all', user.id))[0].vars).toEqual({ email: user.email, sessions: [{ device: 'MacBook', city: 'София' }, { device: 'iPhone', city: 'София' }] });
    expect(deviceFromUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('MacBook');
    expect(deviceFromUserAgent(null)).toBe('Браузър');
  });

  it('A8: a session whose city is unknown is listed without a place, never as „София“', async () => {
    const { actor, user } = await createClient();
    await addSession(user.id, { device: 'MacBook' });
    await addSession(user.id, { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' });
    await signOutEverywhere(actor);
    const [m] = await emails('client-signout-all', user.id);
    expect(m.vars).toEqual({ email: user.email, sessions: [{ device: 'MacBook', city: null }, { device: 'iPhone', city: null }] });
    expect(m.text).not.toContain('София');
    expect(m.text).toContain('прекратихме всички активни сесии в профила ви, включително на MacBook и iPhone.');
    expect(m.text).toMatch(/Прекратени сесии\W+MacBook, iPhone/);

    // One place known, one not: each session with what is known about it.
    const other = await createClient();
    await addSession(other.user.id, { device: 'MacBook', city: 'Пловдив' });
    await addSession(other.user.id, { device: 'iPhone' });
    await signOutEverywhere(other.actor);
    const [m2] = await emails('client-signout-all', other.user.id);
    expect(m2.text).toContain('включително на MacBook в Пловдив и iPhone.');
    expect(m2.text).toMatch(/Прекратени сесии\W+MacBook · Пловдив, iPhone/);
  });
});

describe('A9 – A11 deletion', () => {
  it('requests with a 24 h link and anonymises on confirmation; bookings and payments stay', async () => {
    const pr = await listedPartner();
    const { actor, user } = await createClient({ name: 'Мария Димитрова' });
    await addSession(user.id);
    const b = await createBookingRow({ client: user, partner: pr, eventDate: '2026-06-14', status: 'confirmed' });
    await db.insert(s.savedSearch).values({ clientId: user.id, title: 't', filtersSummary: 'f' });
    const { token } = await requestDeletion(actor);
    expect((await emails('client-delete-confirm', user.id))[0].vars).toEqual({ email: user.email, url: `/akaunt/iztrivane?token=${token}` });
    expect(await failure(confirmDeletion({ token: 'nope' }))).toContain('invalid_token');
    await confirmDeletion({ token });
    const [u] = await db.select().from(s.user).where(eq(s.user.id, user.id));
    expect(u).toMatchObject({ name: 'Изтрит профил', email: `deleted+${user.id}@eventat.invalid`, phone: null });
    expect(u.deletedAt?.getTime()).toBe(NOW.getTime());
    expect(await db.select().from(s.session).where(eq(s.session.userId, user.id))).toHaveLength(0);
    expect(await db.select().from(s.savedSearch).where(eq(s.savedSearch.clientId, user.id))).toHaveLength(0);
    expect((await db.select().from(s.booking).where(eq(s.booking.id, b.booking.id)))[0].status).toBe('confirmed');
    expect(await failure(confirmDeletion({ token }))).toContain('invalid_token');
    // A partner's link cannot delete a client and vice versa.
    const { actor: other } = await createClient();
    const t2 = await requestDeletion(other);
    const { confirmDeletion: partnerConfirm } = await import('@/lib/domain/partners');
    expect(await failure(partnerConfirm({ token: t2.token }))).toContain('invalid_token');
  });

  it('A11 / T24: the link expires after 24 h; a new request replaces the old one', async () => {
    const { actor, user } = await createClient();
    const first = await requestDeletion(actor);
    const second = await requestDeletion(actor);
    const rows = await db.select().from(s.accountDeletionRequest).where(eq(s.accountDeletionRequest.userId, user.id));
    expect(rows.map(r => r.status).sort()).toEqual(['expired', 'requested']);
    advanceTestNow(24 * 3600_000 + 60_000);
    await runDueJobs();
    expect((await db.select().from(s.accountDeletionRequest).where(eq(s.accountDeletionRequest.userId, user.id))).every(r => r.status === 'expired')).toBe(true);
    for (const r of rows) expect(await expireDeletion({ requestId: r.id })).toBe(false);
    expect(await failure(confirmDeletion({ token: second.token }))).toContain('invalid_token');
    expect(await failure(confirmDeletion({ token: first.token }))).toContain('invalid_token');
    expect((await db.select().from(s.user).where(eq(s.user.id, user.id)))[0].deletedAt).toBeNull();
  });
});

describe('A12 block (D39)', () => {
  it('admin blocks; a moderator only while a dispute is open; support never', async () => {
    const pr = await listedPartner();
    const { user } = await createClient({ name: 'Иван Петров' });
    await addSession(user.id);
    const { actor: support } = await createAdmin('support');
    const { actor: mod } = await createAdmin('moderator');
    const { actor: admin } = await createAdmin('admin');
    expect(await failure(block(support, { clientId: user.id }))).toContain('ForbiddenError');
    expect(await failure(block(mod, { clientId: user.id }))).toContain('ForbiddenError');
    const b = await createBookingRow({ client: user, partner: pr, eventDate: '2026-06-14' });
    await db.insert(s.dispute).values({
      number: b.number, bookingId: b.booking.id, openedBy: 'client', reason: 'no_show', title: 't', description: 'd', teamReplyDueAt: NOW,
      positionFrom: 'partner', positionRequestedAt: NOW, positionDueAt: NOW,
    });
    expect(await clientStatus(user.id)).toBe('open_dispute');
    await block(mod, { clientId: user.id });
    expect(await clientStatus(user.id)).toBe('blocked');
    expect(await db.select().from(s.session).where(eq(s.session.userId, user.id))).toHaveLength(0);
    expect((await emails('client-account-blocked', user.id))[0].vars).toEqual({ clientName: 'Иван Петров', accountType: 'частно лице', email: user.email });
    await block(admin, { clientId: user.id });
    expect(await emails('client-account-blocked', user.id)).toHaveLength(1);
    expect(await failure(block(admin, { clientId: pr.user.id }))).toContain('not_found');
  });
});

describe('settings', () => {
  it('profile, avatar, marketing, invoice data', async () => {
    const { actor, user } = await createClient();
    await updateClient(actor, { name: 'Мария Иванова', phone: '0884127730', cityId: await cityId('varna'), clientType: 'business' });
    const [u] = await db.select().from(s.user).where(eq(s.user.id, user.id));
    expect(u).toMatchObject({ name: 'Мария Иванова', phone: '+359884127730' });
    expect((await db.select().from(s.clientProfile).where(eq(s.clientProfile.userId, user.id)))[0].clientType).toBe('business');
    expect(await failure(updateClient(actor, { phone: '12' }))).toContain('invalid_phone');
    const av = await mediaRow(user.id, 'user_avatar');
    await setAvatar(actor, { mediaId: av.id });
    expect((await db.select().from(s.user).where(eq(s.user.id, user.id)))[0].image).toMatch(/^\/uploads\//);
    await setMarketing(actor, { on: true });
    expect((await db.select().from(s.clientProfile).where(eq(s.clientProfile.userId, user.id)))[0]).toMatchObject({ marketingOptIn: true });
    expect(await failure(updateInvoiceProfile(actor, { recipientType: 'company', name: 'Мария' }))).toContain('company_fields_required');
    expect(await failure(updateInvoiceProfile(actor, { recipientType: 'company', name: 'Мария', companyName: 'Технолинк ЕООД', eik: '175074753', mol: 'Мария' }))).toContain('invalid_eik');
    await updateInvoiceProfile(actor, { recipientType: 'company', name: 'Мария', companyName: 'Технолинк ЕООД', eik: '175074752', mol: 'Мария Иванова', address: 'гр. София' });
    await updateInvoiceProfile(actor, { recipientType: 'individual', name: 'Мария Иванова', companyName: 'ignored' });
    expect((await db.select().from(s.clientInvoiceProfile).where(eq(s.clientInvoiceProfile.userId, user.id)))[0]).toMatchObject({ recipientType: 'individual', companyName: null });
    const pr = await listedPartner();
    expect(await failure(setMarketing(pr.actor, { on: true }))).toContain('ForbiddenError');
  });

  it('notification switches: defaults, locked service emails, client-only SMS', async () => {
    const { actor } = await createClient();
    expect(await failure(setPreferences(actor, [{ key: 'client.request-response', channel: 'email', enabled: false }]))).toContain('locked');
    expect(await failure(setPreferences(actor, [{ key: 'client.nothing', channel: 'email', enabled: false }]))).toContain('unknown_preference');
    await setPreferences(actor, [{ key: 'client.messages', channel: 'email', enabled: false }, { key: 'client.messages', channel: 'sms', enabled: true }]);
    const prefs = await getPreferences(actor);
    expect(prefs.find(p => p.key === 'client.messages')).toEqual({ key: 'client.messages', emailLocked: false, email: false, sms: true });
    expect(prefs.find(p => p.key === 'client.booking-confirmed')).toEqual({ key: 'client.booking-confirmed', emailLocked: true, email: true, sms: false });
    const pr = await listedPartner();
    expect(await failure(setPreferences(pr.actor, [{ key: 'partner.new-review', channel: 'sms', enabled: true }]))).toContain('no_sms');
    await setPreferences(pr.actor, [{ key: 'partner.new-review', channel: 'email', enabled: false }]);
    expect((await getPreferences(pr.actor)).find(p => p.key === 'partner.new-review')?.email).toBe(false);
  });

  it('D55: the email changes only after the code is confirmed', async () => {
    const { actor, user } = await createClient();
    const other = await createClient();
    expect(await failure(requestEmailChange(actor, { newEmail: other.user.email }))).toContain('email_taken');
    const { code } = await requestEmailChange(actor, { newEmail: 'New@Example.invalid' });
    expect((await db.select().from(s.user).where(eq(s.user.id, user.id)))[0].email).toBe(user.email);
    expect(await failure(confirmEmailChange(actor, { code: '000000' === code ? '111111' : '000000' }))).toContain('invalid_code');
    await confirmEmailChange(actor, { code });
    expect((await db.select().from(s.user).where(eq(s.user.id, user.id)))[0].email).toBe('new@example.invalid');
    const late = await requestEmailChange(actor, { newEmail: 'late@example.invalid' });
    advanceTestNow(11 * 60_000);
    expect(await failure(confirmEmailChange(actor, { code: late.code }))).toContain('invalid_code');
  });
});
