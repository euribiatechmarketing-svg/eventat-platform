// Shared plumbing for the catalogue modules (partners, services, availability,
// search, reviews, saved, messaging, clients, team, payout accounts, media):
// domain errors, transactions, actor guards, recipients, email + bell (SPEC §4
// bell rule, D54), tokens and contact masking (SPEC §10).
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import { notificationPreference, partner, partnerMember, smsOutbox, teamMember, user } from '@/db/schema';
import { sendEmail } from '@/lib/email/send';
import { TEMPLATES } from '@/lib/email/templates';
import { notify } from '@/lib/notify';
import { now } from '@/lib/clock';
import { fileUrl } from '@/lib/storage';
import { ForbiddenError, isSystem, teamRolesWith, type Actor, type AnyActor, type TeamPermission } from './actor';

export type Partner = typeof partner.$inferSelect;

// ── Errors ───────────────────────────────────────────────────────────────

/**
 * A business rule refused the action. `code` is stable and maps to UI copy in
 * the server action (the domain never invents user-facing text).
 */
export class DomainError extends Error {
  constructor(public code: string, message?: string, public details?: Record<string, unknown>) {
    super(message ?? code);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) { super('not_found', `${what} not found`); this.name = 'NotFoundError'; }
}

export { ForbiddenError };

// ── Transactions ─────────────────────────────────────────────────────────

/** Run inside the caller's transaction, or open one. Every state transition goes through this. */
export async function withTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.transaction(fn);
}

// ── Actor guards (defence in depth: the server action checked the role too) ──

/** The partner this actor acts for; verified against partner_member. */
export async function partnerOf(actor: AnyActor, tx: Queryable): Promise<Partner> {
  if (isSystem(actor) || actor.role !== 'partner' || !actor.partnerId) throw new ForbiddenError('partner');
  const [row] = await tx.select({ p: partner }).from(partnerMember)
    .innerJoin(partner, eq(partner.id, partnerMember.partnerId))
    .where(and(eq(partnerMember.userId, actor.userId), eq(partnerMember.partnerId, actor.partnerId)))
    .limit(1);
  if (!row) throw new ForbiddenError('partner');
  return row.p;
}

/** Lock and return the actor's partner row (for transitions). */
export async function lockPartnerOf(actor: AnyActor, tx: Tx): Promise<Partner> {
  const p = await partnerOf(actor, tx);
  const [locked] = await tx.select().from(partner).where(eq(partner.id, p.id)).for('update');
  return locked;
}

export function assertClient(actor: AnyActor): asserts actor is Actor {
  if (isSystem(actor) || actor.role !== 'client') throw new ForbiddenError('client');
}

export function assertTeamMember(actor: AnyActor): asserts actor is Actor {
  if (isSystem(actor) || actor.role !== 'admin' || !actor.teamRole) throw new ForbiddenError('team');
}

// ── Recipients ───────────────────────────────────────────────────────────

export type Recipient = { userId: string; email: string; name: string };

/** Active team members holding any of the permissions (SPEC §11.5). */
export async function teamRecipients(tx: Tx, perms: TeamPermission[]): Promise<Recipient[]> {
  const roles = [...new Set(perms.flatMap(p => teamRolesWith(p)))];
  if (!roles.length) return [];
  return tx.select({ userId: user.id, email: user.email, name: user.name }).from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(eq(teamMember.status, 'active'), inArray(teamMember.role, roles), isNull(user.deletedAt), eq(user.banned, false)))
    .orderBy(user.id);
}

/** The partner's owner (bell, preferences) and the address partner emails go to (‹Имейл за известия›). */
export async function partnerRecipient(tx: Tx, partnerId: string): Promise<Recipient & { partner: Partner }> {
  const [row] = await tx.select({ p: partner, userId: user.id, name: user.name }).from(partner)
    .innerJoin(partnerMember, eq(partnerMember.partnerId, partner.id))
    .innerJoin(user, eq(user.id, partnerMember.userId))
    .where(eq(partner.id, partnerId))
    .orderBy(partnerMember.createdAt)
    .limit(1);
  if (!row) throw new NotFoundError('partner');
  return { userId: row.userId, email: row.p.notificationEmail, name: row.name, partner: row.p };
}

// ── Email + bell (SPEC §4 bell rule, D54) ────────────────────────────────

export type MailArgs = {
  key: string;
  to: string;
  toUserId?: string | null;
  vars: Record<string, unknown>;
  dedupeKey?: string;
  /** Bell item override (the prototype's notice pattern); false = no bell. Default: heading / preheader / CTA. */
  bell?: { title?: string; body?: string; href?: string } | false;
};

// ── Notification switches (SPEC §11.2 client, §11.3 partner) ──────────────

export type PreferenceDefault = { key: string; email: boolean; sms: boolean | null; emailLocked?: boolean; emails: string[] };
/** Defaults (a missing row means these), the locked service emails, the SMS column and the emails each switch controls. */
export const PREFERENCE_DEFAULTS: Record<'client' | 'partner', PreferenceDefault[]> = {
  client: [
    { key: 'client.request-response', email: true, sms: true, emailLocked: true, emails: ['client-request-approved', 'client-request-declined'] },
    { key: 'client.payment-deadline', email: true, sms: true, emails: ['client-payment-reminder'] },
    { key: 'client.booking-confirmed', email: true, sms: false, emailLocked: true, emails: ['client-booking-confirmed'] },
    { key: 'client.messages', email: true, sms: false, emails: ['client-new-message'] },
    { key: 'client.event-reminder', email: true, sms: true, emails: ['client-event-reminder'] },
    { key: 'client.review-invite', email: true, sms: false, emails: ['client-review-invite'] },
  ],
  partner: [
    { key: 'partner.new-request', email: true, sms: null, emails: ['vendor-new-request', 'vendor-new-inquiry'] },
    { key: 'partner.payment-reminder', email: true, sms: null, emails: ['vendor-payment-reminder'] },
    { key: 'partner.new-review', email: true, sms: null, emails: ['vendor-new-review'] },
    { key: 'partner.news', email: false, sms: null, emails: [] },
  ],
};

const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');

/**
 * SPEC §11.4: for a client email under an SMS switch that is on, the same event records an SMS
 * whose text is the email subject followed by the CTA link (D20: approved subjects only). With
 * ⚙ sms.transport = outbox the SMS is recorded only.
 */
async function smsFor(tx: Tx, a: MailArgs, subject: string, href: string | undefined) {
  const pref = PREFERENCE_DEFAULTS.client.find(p => p.emails.includes(a.key));
  if (!pref || pref.sms === null || !a.toUserId) return;
  const [row] = await tx.select({ enabled: notificationPreference.enabled }).from(notificationPreference)
    .where(and(eq(notificationPreference.userId, a.toUserId), eq(notificationPreference.key, pref.key), eq(notificationPreference.channel, 'sms')));
  if (!(row?.enabled ?? pref.sms)) return;
  const [u] = await tx.select({ phone: user.phone, deleted: user.deletedAt }).from(user).where(eq(user.id, a.toUserId));
  if (!u?.phone || u.deleted) return;
  const link = href ? (/^https?:/.test(href) ? href : `${appUrl()}${href.startsWith('/') ? href : `/${href}`}`) : '';
  await tx.insert(smsOutbox).values({
    templateKey: a.key, toPhone: u.phone, toUserId: a.toUserId, body: link ? `${subject} ${link}` : subject,
    dedupeKey: a.dedupeKey ? `${a.dedupeKey}:sms` : null, createdAt: await now(),
  }).onConflictDoNothing();
}

/**
 * Queue an email in the caller's transaction and, for clients and partners,
 * add the bell item. The bell is added even when the recipient switched the
 * optional email off (only the email is suppressed), and only once per
 * dedupe key (a second send with the same key adds nothing). Client emails
 * under an SMS switch also record the SMS (§11.4).
 */
export async function mail(tx: Tx, a: MailArgs): Promise<string | null> {
  const tpl = TEMPLATES[a.key];
  if (!tpl) throw new Error(`Unknown email template: ${a.key}`);
  const id = await sendEmail({ key: a.key, to: a.to, toUserId: a.toUserId ?? null, vars: a.vars, dedupeKey: a.dedupeKey }, tx);
  if (id && a.toUserId && tpl.audience !== 'team') {
    const c = tpl.render(a.vars);
    if (a.bell !== false) {
      const b = a.bell ?? {};
      await notify(a.toUserId, { kind: a.key, title: b.title ?? c.heading, body: b.body ?? c.preheader, href: b.href ?? c.cta?.href }, tx);
    }
    if (tpl.audience === 'client') await smsFor(tx, a, c.subject, a.bell ? a.bell.href ?? c.cta?.href : c.cta?.href);
  }
  return id;
}

/** The same email to every recipient, one outbox row each (dedupe key suffixed with the user id). */
export async function mailEach(tx: Tx, to: Recipient[], a: Omit<MailArgs, 'to' | 'toUserId'>): Promise<number> {
  let n = 0;
  for (const r of to) {
    const id = await mail(tx, { ...a, to: r.email, toUserId: r.userId, dedupeKey: a.dedupeKey ? `${a.dedupeKey}:${r.userId}` : undefined });
    if (id) n++;
  }
  return n;
}

// ── Tokens ───────────────────────────────────────────────────────────────

export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/** A URL-safe one-time token; only its hash is stored. */
export function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** A 6-digit code (email change, D55). */
export function newCode(): { code: string; hash: string } {
  const code = String(Math.floor(100000 + (randomBytes(4).readUInt32BE(0) % 900000)));
  return { code, hash: hashToken(code) };
}

// ── Contact masking (SPEC §10, D19) ──────────────────────────────────────

const MASK = '•••';
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
/**
 * Dates (14.06.2026, 2026-06-14), booking numbers (2026-0614-ЕА) and money (1 450,00 €) are excluded
 * by format. The formats are strict so a phone cannot hide behind them: a date must be a real
 * day and month, and an amount must not start with 0 (unless it is 0,xx), has at most six plain
 * digits or two thousands groups, and may not continue a digit run (‹088 412 7730 лв› is a phone).
 */
const PROTECTED_RE = new RegExp([
  '\\d{4}-\\d{4}-[А-ЯЁ]{2}(?![А-Яа-яЁё])',                                                 // booking number
  '\\b(?:0?[1-9]|[12]\\d|3[01])\\.(?:0?[1-9]|1[0-2])\\.(?:19|20)\\d{2}\\b',                   // 14.06.2026
  '\\b(?:19|20)\\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\\d|3[01])\\b',                       // 2026-06-14
  '(?<![\\d+][ \\u00a0.\\-/()]?)(?:[1-9]\\d{0,2}(?:[ \\u00a0.]\\d{3}){1,2}|[1-9]\\d{0,5}|0)(?:,\\d{1,2})?(?!\\d)[ \\u00a0]?(?:€|EUR|евро|лв\\.?)', // 1 450,00 €
].join('|'), 'g');
/** A run of digits with optional +, spaces, -, ., / or parentheses. */
const PHONE_RUN_RE = /\+?\(?\d[\d\s\-./()]*\d\)?/g;

/** Replace phone numbers (≥ 7 digits) and email addresses with •••. */
export function maskContacts(text: string): string {
  const kept: string[] = [];
  const sentinel = (i: number) => `${String.fromCharCode(0xE100 + i)}`;
  let s = text.replace(PROTECTED_RE, m => { kept.push(m); return sentinel(kept.length - 1); });
  s = s.replace(EMAIL_RE, MASK);
  s = s.replace(PHONE_RUN_RE, m => (m.replace(/\D/g, '').length >= 7 ? MASK : m));
  return s.replace(/(.)/g, (_, c: string) => kept[c.charCodeAt(0) - 0xE100]);
}

// ── Misc ─────────────────────────────────────────────────────────────────

/** URL of a public stored file (listing photos, avatars). A private file is linked with mediaHref(). */
export const mediaUrl = (storageKey: string | null | undefined) => (storageKey ? fileUrl(storageKey) : null);

/** URL of a media row of any kind: a private file by its id through /api/files (access-checked), never by its storage key. */
export const mediaHref = (id: string, storageKey: string | null | undefined) =>
  (!storageKey ? null : storageKey.startsWith('private/') ? `/api/files/${id}` : fileUrl(storageKey));

/** Phone to E.164: '+359 88 412 7730' / '0884127730' → '+359884127730'; null if it cannot be one. */
export function normalizePhone(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.replace(/[\s\-./()]/g, '');
  if (s.startsWith('00')) s = `+${s.slice(2)}`;
  if (/^0\d{8,9}$/.test(s)) s = `+359${s.slice(1)}`;
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

/** Display a stored E.164 phone the way the prototype does: '+359 88 412 7730'. */
export function displayPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+359(\d{2})(\d{3})(\d{3,4})$/.exec(e164);
  return m ? `+359 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

/** Bulgarian count noun: plural(1, 'изпълнител', 'изпълнители') → '1 изпълнител'. Plain space (copy, not layout). */
export const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
