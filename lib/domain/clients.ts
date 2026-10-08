// Client account (SPEC §4.1 A1–A13, §11.2 switches, §16 settings) — `accounts.*` in SCREENS.
// Better Auth owns passwords, codes and sessions; these functions are the business side of
// each step: profile and consent rows, the welcome / security emails, deletion, blocking.
//
//   ∅ ─A1─▶ unverified ─A3─▶ active ─A9─▶ deletion_requested ─A10─▶ deleted
//                                │                   └─A11 (T24)─▶ active
//                                └─A12─▶ blocked (no unblock in v1, D39)
import { and, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, type Queryable, type Tx } from '@/db';
import {
  account, accountDeletionRequest, booking, clientInvoiceProfile, clientProfile, consent, conversation, dateWatch, dispute,
  emailChangeRequest, notificationPreference, partner, partnerMember, savedSearch, searchHistory, session, twoFactor, user,
  type AcquisitionSource, type ClientType, type NotificationChannel,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { cancelJobs, scheduleJob } from '@/lib/jobs';
import { date as fmtDate } from '@/lib/format';
import { assertCan, isSystem, SYSTEM, type AnyActor } from './actor';
import { audit } from './audit';
import {
  DomainError, ForbiddenError, NotFoundError, PREFERENCE_DEFAULTS, assertClient, displayPhone, hashToken, mail, mediaUrl, newCode, newToken, normalizePhone, withTx,
} from './catalogue-kit';
import { ownMedia } from './media';
import { CONSENT_VERSION, isValidEik } from './partners';

export const DELETED_NAME = 'Изтрит профил';

// ── A1 sign-up, A3/A4 welcome ────────────────────────────────────────────

/**
 * A1 ‹Създай профил› (client): Better Auth has created the user and sends `client-verify-code`;
 * this adds the phone, the `client_profile` and the consent rows (‹Приемам Общите условия и
 * Политиката за поверителност› must be ticked).
 */
export async function registerClient(a: { userId: string; phone?: string | null; consent: boolean; acquisitionSource?: AcquisitionSource | null; ip?: string | null }, tx?: Tx) {
  if (!a.consent) throw new DomainError('consent_required');
  const phone = a.phone ? normalizePhone(a.phone) : null;
  if (a.phone && !phone) throw new DomainError('invalid_phone');
  return withTx(tx, async t => {
    const [u] = await t.select().from(user).where(eq(user.id, a.userId)).for('update');
    if (!u) throw new NotFoundError('user');
    if (u.role !== 'client') throw new DomainError('wrong_role');
    const at = await now();
    if (phone) await t.update(user).set({ phone, updatedAt: at }).where(eq(user.id, u.id));
    await t.insert(clientProfile).values({ userId: u.id, acquisitionSource: a.acquisitionSource ?? null, createdAt: at, updatedAt: at }).onConflictDoNothing();
    await t.insert(consent).values([
      { userId: u.id, document: 'general_terms', version: CONSENT_VERSION, acceptedAt: at, ip: a.ip ?? null },
      { userId: u.id, document: 'privacy', version: CONSENT_VERSION, acceptedAt: at, ip: a.ip ?? null },
    ]);
    await audit(t, { actor: { userId: u.id, role: 'client' }, action: 'client.registered', entity: 'user', entityId: u.id });
  });
}

/**
 * A3 / A4 / P2 — the email is confirmed (code or social sign-up): `client-welcome` (toast
 * ‹Профилът е създаден›) or `vendor-welcome` (toast ‹Имейлът е потвърден›). Sent once per user.
 */
export async function verifyEmail(a: { userId: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const [u] = await t.select().from(user).where(eq(user.id, a.userId)).for('update');
    if (!u) throw new NotFoundError('user');
    const at = await now();
    if (!u.emailVerified) await t.update(user).set({ emailVerified: true, updatedAt: at }).where(eq(user.id, u.id));
    if (u.role === 'client') {
      await t.insert(clientProfile).values({ userId: u.id, createdAt: at, updatedAt: at }).onConflictDoNothing();
      await mail(t, {
        key: 'client-welcome', to: u.email, toUserId: u.id, dedupeKey: `welcome:${u.id}`,
        vars: { clientName: u.name, email: u.email, ...(u.phone ? { phone: displayPhone(u.phone) } : {}), registeredOn: fmtDate(u.createdAt) },
      });
    } else if (u.role === 'partner') {
      const [p] = await t.select({ p: partner }).from(partnerMember).innerJoin(partner, eq(partner.id, partnerMember.partnerId)).where(eq(partnerMember.userId, u.id));
      if (!p) throw new NotFoundError('partner');
      await mail(t, {
        key: 'vendor-welcome', to: p.p.notificationEmail, toUserId: u.id, dedupeKey: `welcome:${u.id}`,
        vars: { partnerName: p.p.businessName, contactName: p.p.contactName, email: p.p.notificationEmail, phone: displayPhone(p.p.phone) },
      });
    }
    await audit(t, { actor: { userId: u.id, role: u.role }, action: 'user.email_verified', entity: 'user', entityId: u.id });
  });
}

// ── A6 – A8 security ─────────────────────────────────────────────────────

/** A6: a new password was saved through the reset link — `password_changed_at`; every other session revoked; `client-password-changed`. */
export async function afterPasswordChanged(a: { userId: string; keepSessionId?: string | null }, tx?: Tx) {
  return withTx(tx, async t => {
    const [u] = await t.select().from(user).where(eq(user.id, a.userId));
    if (!u) throw new NotFoundError('user');
    const at = await now();
    await t.update(user).set({ passwordChangedAt: at, updatedAt: at }).where(eq(user.id, u.id));
    await t.delete(session).where(a.keepSessionId ? and(eq(session.userId, u.id), ne(session.id, a.keepSessionId)) : eq(session.userId, u.id));
    await audit(t, { actor: { userId: u.id, role: u.role }, action: 'user.password_changed', entity: 'user', entityId: u.id });
    if (u.role === 'client') {
      await mail(t, { key: 'client-password-changed', to: u.email, toUserId: u.id, dedupeKey: `pwchanged:${u.id}:${at.toISOString()}`, vars: { email: u.email, changedOn: fmtDate(at) } });
    }
  });
}

/** A7 two-step toggle: on needs a phone and sends `client-2fa-on`; off sends nothing. */
export async function setTwoFactor(actor: AnyActor, a: { enabled: boolean }, tx?: Tx) {
  assertClient(actor);
  return withTx(tx, async t => {
    const [u] = await t.select().from(user).where(eq(user.id, actor.userId)).for('update');
    if (a.enabled && !u.phone) throw new DomainError('phone_required');
    if (u.twoFactorEnabled === a.enabled) return;
    const at = await now();
    await t.update(user).set({ twoFactorEnabled: a.enabled, updatedAt: at }).where(eq(user.id, u.id));
    await audit(t, { actor, action: a.enabled ? 'user.2fa_on' : 'user.2fa_off', entity: 'user', entityId: u.id });
    if (a.enabled) {
      await mail(t, { key: 'client-2fa-on', to: u.email, toUserId: u.id, dedupeKey: `2fa:${u.id}:${at.toISOString()}`, vars: { email: u.email, phone: displayPhone(u.phone) } });
    }
  });
}

/** ‹MacBook›, ‹iPhone› … from the user agent when the session has no label (approximate, §16). */
export function deviceFromUserAgent(ua: string | null | undefined): string {
  const s = ua ?? '';
  if (/iPhone/i.test(s)) return 'iPhone';
  if (/iPad/i.test(s)) return 'iPad';
  if (/Android/i.test(s)) return 'Android';
  if (/Macintosh|Mac OS X/i.test(s)) return 'MacBook';
  if (/Windows/i.test(s)) return 'Windows';
  if (/Linux/i.test(s)) return 'Linux';
  return 'Браузър';
}

/** A8 ‹Излез навсякъде›: every session revoked; `client-signout-all` lists them; redirect `/`. */
export async function signOutEverywhere(actor: AnyActor, tx?: Tx) {
  assertClient(actor);
  return withTx(tx, async t => {
    const [u] = await t.select().from(user).where(eq(user.id, actor.userId));
    const rows = await t.delete(session).where(eq(session.userId, u.id)).returning();
    const at = await now();
    await audit(t, { actor, action: 'user.signed_out_everywhere', entity: 'user', entityId: u.id, data: { sessions: rows.length } });
    const sessions = rows.map(r => ({ device: r.deviceLabel ?? deviceFromUserAgent(r.userAgent), city: r.city ?? u.lastLoginCity ?? 'София' }));
    await mail(t, {
      key: 'client-signout-all', to: u.email, toUserId: u.id, dedupeKey: `signout:${u.id}:${at.toISOString()}`,
      vars: { email: u.email, sessions: sessions.length ? sessions : [{ device: 'Браузър', city: u.lastLoginCity ?? 'София' }] },
    });
    return { revoked: rows.length };
  });
}

// ── A9 – A11 deletion ────────────────────────────────────────────────────

/** A9 ‹Изтрий профила›: a 24 h link (`client-delete-confirm`); toast ‹Изпратихме имейл за потвърждение на изтриването›. */
export async function requestDeletion(actor: AnyActor, tx?: Tx): Promise<{ token: string; expiresAt: Date }> {
  assertClient(actor);
  return withTx(tx, async t => {
    const [u] = await t.select().from(user).where(eq(user.id, actor.userId)).for('update');
    if (u.deletedAt) throw new DomainError('deleted');
    const at = await now();
    const expiresAt = new Date(at.getTime() + 24 * 3600_000);
    await supersedeDeletionRequests(t, u.id);
    const { token, hash } = newToken();
    const [req] = await t.insert(accountDeletionRequest).values({ userId: u.id, tokenHash: hash, requestedAt: at, expiresAt }).returning();
    await scheduleJob('deletion.expire', expiresAt, { requestId: req.id }, `deletion:${req.id}:expire`, t);
    await audit(t, { actor, action: 'user.deletion_requested', entity: 'user', entityId: u.id });
    await mail(t, { key: 'client-delete-confirm', to: u.email, toUserId: u.id, dedupeKey: `deletion:${req.id}`, vars: { email: u.email, url: `/akaunt/iztrivane?token=${token}` } });
    return { token, expiresAt };
  });
}

/** A new ‹Изтрий› replaces the open link: the old request expires and its T24 job is cancelled. */
export async function supersedeDeletionRequests(t: Tx, userId: string) {
  const old = await t.update(accountDeletionRequest).set({ status: 'expired' })
    .where(and(eq(accountDeletionRequest.userId, userId), eq(accountDeletionRequest.status, 'requested'))).returning({ id: accountDeletionRequest.id });
  for (const r of old) await cancelJobs(`deletion:${r.id}:`, t);
}

/** The open, unexpired deletion request a link points at (for the given role), marked confirmed (its T24 job cancelled). */
export async function consumeDeletionToken(tx: Tx, token: string, role: 'client' | 'partner') {
  const [req] = await tx.select().from(accountDeletionRequest).where(eq(accountDeletionRequest.tokenHash, hashToken(token ?? ''))).for('update');
  if (!req || req.status !== 'requested') throw new DomainError('invalid_token');
  const at = await now();
  if (req.expiresAt <= at) throw new DomainError('token_expired');
  const [u] = await tx.select({ role: user.role }).from(user).where(eq(user.id, req.userId));
  if (!u || u.role !== role) throw new DomainError('invalid_token');
  await tx.update(accountDeletionRequest).set({ status: 'confirmed', confirmedAt: at }).where(eq(accountDeletionRequest.id, req.id));
  await cancelJobs(`deletion:${req.id}:`, tx);
  return req;
}

/**
 * Anonymise a user (A10, P10): name ‹Изтрит профил› (new copy), email deleted+<id>@eventat.invalid,
 * phone and photo gone, sign-in methods and sessions removed, saved searches, watches and history
 * dropped. Bookings, payments, invoices and the ledger are kept (legal retention).
 */
export async function anonymiseUser(tx: Tx, userId: string, at: Date) {
  await tx.update(user).set({
    name: DELETED_NAME, email: `deleted+${userId}@eventat.invalid`, phone: null, image: null, twoFactorEnabled: false,
    deletedAt: at, updatedAt: at,
  }).where(eq(user.id, userId));
  await tx.delete(session).where(eq(session.userId, userId));
  await tx.delete(account).where(eq(account.userId, userId));
  await tx.delete(twoFactor).where(eq(twoFactor.userId, userId));
  await tx.update(clientInvoiceProfile).set({ recipientType: 'individual', name: DELETED_NAME, companyName: null, eik: null, mol: null, address: null, updatedAt: at })
    .where(eq(clientInvoiceProfile.userId, userId));
  await tx.delete(savedSearch).where(eq(savedSearch.clientId, userId));
  await tx.delete(searchHistory).where(eq(searchHistory.clientId, userId));
  const watches = await tx.update(dateWatch).set({ status: 'removed', closedAt: at })
    .where(and(eq(dateWatch.clientId, userId), inArray(dateWatch.status, ['watching', 'notified']))).returning({ id: dateWatch.id });
  for (const w of watches) await cancelJobs(`datewatch:${w.id}:`, tx);
  await tx.update(conversation).set({ clientDraft: null }).where(eq(conversation.clientId, userId));
}

/** A10 ‹Потвърди изтриването› (email link): the profile is anonymised; confirmed bookings stay valid until the event. */
export async function confirmDeletion(a: { token: string }, tx?: Tx) {
  return withTx(tx, async t => {
    const req = await consumeDeletionToken(t, a.token, 'client');
    const at = await now();
    await anonymiseUser(t, req.userId, at);
    await audit(t, { actor: SYSTEM, action: 'user.deleted', entity: 'user', entityId: req.userId });
    return { userId: req.userId };
  });
}

/** T24 `deletion.expire` (A11): a link not used in 24 h → the request expires; the account stays. Idempotent. */
export async function expireDeletion(a: { requestId: string }, tx?: Tx): Promise<boolean> {
  return withTx(tx, async t => {
    const rows = await t.update(accountDeletionRequest).set({ status: 'expired' })
      .where(and(eq(accountDeletionRequest.id, a.requestId), eq(accountDeletionRequest.status, 'requested'), sql`${accountDeletionRequest.expiresAt} <= ${(await now()).toISOString()}::timestamptz`))
      .returning({ id: accountDeletionRequest.id });
    if (rows.length) await audit(t, { actor: SYSTEM, action: 'user.deletion_expired', entity: 'account_deletion_request', entityId: a.requestId });
    return rows.length > 0;
  });
}

// ── A12 block ────────────────────────────────────────────────────────────

/** Open disputes on any of the client's bookings (a moderator may block only then, D39). */
async function hasOpenDispute(q: Queryable, clientId: string): Promise<boolean> {
  const [d] = await q.select({ id: dispute.id }).from(dispute).innerJoin(booking, eq(booking.id, dispute.bookingId))
    .where(and(eq(booking.clientId, clientId), inArray(dispute.status, ['collecting', 'awaiting_decision']))).limit(1);
  return !!d;
}

/**
 * A12 ‹Блокирай профила› (`/admin/klienti/[id]`): admin, or a moderator while a dispute is open
 * (D39). `banned = true`; every session revoked; `client-account-blocked`; toast ‹Профилът е
 * блокиран›. Open requests stay; a blocked client cannot send new ones.
 */
export async function block(actor: AnyActor, a: { clientId: string; reason?: string | null }, tx?: Tx) {
  return withTx(tx, async t => {
    assertCan(actor, 'block_client', { disputeOpen: await hasOpenDispute(t, a.clientId) });
    const [u] = await t.select().from(user).where(eq(user.id, a.clientId)).for('update');
    if (!u || u.role !== 'client' || u.deletedAt) throw new NotFoundError('client');
    if (u.banned) return;
    const at = await now();
    await t.update(user).set({ banned: true, banReason: a.reason?.trim() || null, updatedAt: at }).where(eq(user.id, u.id));
    const revoked = await t.delete(session).where(eq(session.userId, u.id)).returning({ id: session.id });
    await audit(t, { actor, action: 'client.blocked', entity: 'user', entityId: u.id, data: { reason: a.reason ?? null, sessions: revoked.length } });
    const [prof] = await t.select({ type: clientProfile.clientType }).from(clientProfile).where(eq(clientProfile.userId, u.id));
    await mail(t, {
      key: 'client-account-blocked', to: u.email, toUserId: u.id, dedupeKey: `blocked:${u.id}`,
      vars: { clientName: u.name, accountType: prof?.type === 'business' ? 'бизнес клиент' : 'частно лице', email: u.email },
    });
  });
}

/** Admin badge (D96): ‹Блокиран› > ‹Отворен спор› > ‹Активен›. */
export async function clientStatus(clientId: string, q: Queryable = db): Promise<'blocked' | 'open_dispute' | 'active' | 'deleted'> {
  const [u] = await q.select({ banned: user.banned, deleted: user.deletedAt }).from(user).where(eq(user.id, clientId));
  if (!u) throw new NotFoundError('client');
  if (u.deleted) return 'deleted';
  if (u.banned) return 'blocked';
  return (await hasOpenDispute(q, clientId)) ? 'open_dispute' : 'active';
}

// ── Settings (§16) ───────────────────────────────────────────────────────

const clientSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  phone: z.string().trim().min(1).optional(),
  cityId: z.uuid().nullish(),
  clientType: z.enum(['private', 'business']).optional(),
});

/** ‹Запази промените› on `/akaunt/nastroyki` (toast ‹Промените са запазени›). The email changes only through D55. */
export async function updateClient(actor: AnyActor, input: z.input<typeof clientSchema>, tx?: Tx) {
  assertClient(actor);
  const r = clientSchema.safeParse(input);
  if (!r.success) throw new DomainError('validation', r.error.message);
  const d = r.data;
  return withTx(tx, async t => {
    const at = await now();
    const set: Partial<typeof user.$inferSelect> = { updatedAt: at };
    if (d.name !== undefined) set.name = d.name;
    if (d.phone !== undefined) { const ph = normalizePhone(d.phone); if (!ph) throw new DomainError('invalid_phone'); set.phone = ph; }
    await t.update(user).set(set).where(eq(user.id, actor.userId));
    if (d.cityId !== undefined || d.clientType !== undefined) {
      await t.insert(clientProfile).values({ userId: actor.userId, cityId: d.cityId ?? null, clientType: (d.clientType ?? 'private') as ClientType, createdAt: at, updatedAt: at })
        .onConflictDoUpdate({ target: clientProfile.userId, set: { ...(d.cityId !== undefined ? { cityId: d.cityId } : {}), ...(d.clientType ? { clientType: d.clientType } : {}), updatedAt: at } });
    }
    await audit(t, { actor, action: 'client.updated', entity: 'user', entityId: actor.userId, data: { fields: Object.keys(d) } });
  });
}

/** ‹Смени снимката› (toast ‹Снимката е обновена›): `media.upload()` then this. */
export async function setAvatar(actor: AnyActor, a: { mediaId: string }, tx?: Tx) {
  assertClient(actor);
  return withTx(tx, async t => {
    const m = await ownMedia(t, actor, a.mediaId, ['user_avatar']);
    await t.update(user).set({ image: mediaUrl(m.storageKey), updatedAt: await now() }).where(eq(user.id, actor.userId));
    await audit(t, { actor, action: 'client.avatar_changed', entity: 'user', entityId: actor.userId });
  });
}

/** ‹Маркетингови съобщения› (off by default; stored with the opt-in time; sent by an external tool, D71). */
export async function setMarketing(actor: AnyActor, a: { on: boolean }, tx?: Tx) {
  assertClient(actor);
  return withTx(tx, async t => {
    const at = await now();
    await t.insert(clientProfile).values({ userId: actor.userId, marketingOptIn: a.on, marketingOptInAt: a.on ? at : null, createdAt: at, updatedAt: at })
      .onConflictDoUpdate({ target: clientProfile.userId, set: { marketingOptIn: a.on, marketingOptInAt: a.on ? at : null, updatedAt: at } });
    await audit(t, { actor, action: a.on ? 'client.marketing_on' : 'client.marketing_off', entity: 'user', entityId: actor.userId });
  });
}

const invoiceSchema = z.object({
  recipientType: z.enum(['individual', 'company']),
  name: z.string().trim().min(1).max(200),
  companyName: z.string().trim().max(200).nullish(),
  eik: z.string().trim().nullish(),
  mol: z.string().trim().max(200).nullish(),
  address: z.string().trim().max(300).nullish(),
});

/**
 * ‹Данни за фактура› (‹Издавай фактура на›): ‹Частно лице› + name, or ‹Фирма› + company name,
 * ЕИК and МОЛ. Snapshotted onto each invoice at payment (§9).
 */
export async function updateInvoiceProfile(actor: AnyActor, input: z.input<typeof invoiceSchema>, tx?: Tx) {
  assertClient(actor);
  const r = invoiceSchema.safeParse(input);
  if (!r.success) throw new DomainError('validation', r.error.message);
  const d = r.data;
  if (d.recipientType === 'company') {
    if (!d.companyName || !d.eik || !d.mol) throw new DomainError('company_fields_required');
    if (!isValidEik(d.eik)) throw new DomainError('invalid_eik');
  }
  return withTx(tx, async t => {
    const at = await now();
    const values = {
      recipientType: d.recipientType, name: d.name,
      companyName: d.recipientType === 'company' ? d.companyName! : null, eik: d.recipientType === 'company' ? d.eik!.replace(/\s/g, '') : null,
      mol: d.recipientType === 'company' ? d.mol! : null, address: d.address || null, updatedAt: at,
    };
    await t.insert(clientInvoiceProfile).values({ userId: actor.userId, ...values })
      .onConflictDoUpdate({ target: clientInvoiceProfile.userId, set: values });
    await audit(t, { actor, action: 'client.invoice_profile_updated', entity: 'user', entityId: actor.userId });
  });
}

// ── Notification switches (§11.2, §11.3) ─────────────────────────────────

export { PREFERENCE_DEFAULTS };

/** The effective switches: stored rows over the defaults. */
export async function getPreferences(actor: AnyActor, q: Queryable = db) {
  if (isSystem(actor) || (actor.role !== 'client' && actor.role !== 'partner')) throw new ForbiddenError('preferences');
  const rows = await q.select().from(notificationPreference).where(eq(notificationPreference.userId, actor.userId));
  return PREFERENCE_DEFAULTS[actor.role].map(p => ({
    key: p.key, emailLocked: !!p.emailLocked,
    email: p.emailLocked ? true : rows.find(r => r.key === p.key && r.channel === 'email')?.enabled ?? p.email,
    sms: p.sms === null ? null : rows.find(r => r.key === p.key && r.channel === 'sms')?.enabled ?? p.sms,
  }));
}

/**
 * `notifications.setPreferences()`: store switches. A locked email switch cannot be turned off
 * (‹Този имейл е служебен — идва винаги, за да имате потвърждение и разписка›); SMS is client-only.
 */
export async function setPreferences(actor: AnyActor, prefs: { key: string; channel: NotificationChannel; enabled: boolean }[], tx?: Tx) {
  if (isSystem(actor) || (actor.role !== 'client' && actor.role !== 'partner')) throw new ForbiddenError('preferences');
  const defs = PREFERENCE_DEFAULTS[actor.role];
  for (const p of prefs) {
    const d = defs.find(x => x.key === p.key);
    if (!d) throw new DomainError('unknown_preference', p.key);
    if (p.channel === 'sms' && d.sms === null) throw new DomainError('no_sms', p.key);
    if (p.channel === 'email' && d.emailLocked && !p.enabled) throw new DomainError('locked', p.key);
  }
  return withTx(tx, async t => {
    const at = await now();
    for (const p of prefs) {
      await t.insert(notificationPreference).values({ userId: actor.userId, key: p.key, channel: p.channel, enabled: p.enabled, updatedAt: at })
        .onConflictDoUpdate({ target: [notificationPreference.userId, notificationPreference.key, notificationPreference.channel], set: { enabled: p.enabled, updatedAt: at } });
    }
    await audit(t, { actor, action: 'preferences.changed', entity: 'user', entityId: actor.userId, data: { prefs } });
  });
}

// ── D55 email change ─────────────────────────────────────────────────────

/**
 * D55: a code goes to the new address before the email switches. The template
 * (`client-email-change-code`) is a proposed key without approved copy, so nothing is sent
 * yet: the request is recorded and the code returned to the caller.
 */
export async function requestEmailChange(actor: AnyActor, a: { newEmail: string }, tx?: Tx): Promise<{ requestId: string; code: string; expiresAt: Date }> {
  assertClient(actor);
  const email = (a.newEmail ?? '').trim().toLowerCase();
  if (!z.email().safeParse(email).success) throw new DomainError('invalid_email');
  return withTx(tx, async t => {
    const [taken] = await t.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${email}`);
    if (taken) throw new DomainError('email_taken');
    const at = await now();
    const { code, hash } = newCode();
    const expiresAt = new Date(at.getTime() + 10 * 60_000);
    const [req] = await t.insert(emailChangeRequest).values({ userId: actor.userId, newEmail: email, codeHash: hash, expiresAt, createdAt: at }).returning();
    await audit(t, { actor, action: 'user.email_change_requested', entity: 'user', entityId: actor.userId, data: { requestId: req.id } });
    return { requestId: req.id, code, expiresAt };
  });
}

/** D55 confirm: the latest open request with this code switches the email. */
export async function confirmEmailChange(actor: AnyActor, a: { code: string }, tx?: Tx) {
  assertClient(actor);
  return withTx(tx, async t => {
    const [req] = await t.select().from(emailChangeRequest)
      .where(and(eq(emailChangeRequest.userId, actor.userId), isNull(emailChangeRequest.confirmedAt))).orderBy(desc(emailChangeRequest.createdAt)).limit(1);
    const at = await now();
    if (!req || req.expiresAt <= at || req.codeHash !== hashToken((a.code ?? '').trim())) throw new DomainError('invalid_code');
    const [taken] = await t.select({ id: user.id }).from(user).where(sql`lower(${user.email}) = ${req.newEmail}`);
    if (taken) throw new DomainError('email_taken');
    await t.update(user).set({ email: req.newEmail, emailVerified: true, updatedAt: at }).where(eq(user.id, actor.userId));
    await t.update(emailChangeRequest).set({ confirmedAt: at }).where(eq(emailChangeRequest.id, req.id));
    await audit(t, { actor, action: 'user.email_changed', entity: 'user', entityId: actor.userId, data: { to: req.newEmail } });
  });
}
