import 'server-only';
// Read models and small orchestrations for the auth screens (SCREENS §3) and the client's own
// account pages (§4: /akaunt/nastroyki, /akaunt/zapazeni, /akaunt/sabitiya). Business rules stay
// in clients.ts, saved.ts and events.ts; this module assembles what the pages show and wraps the
// multi-step saves in one transaction.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  accountDeletionRequest, auditLog, booking, category, city, clientEvent, clientInvoiceProfile, clientProfile, emailChangeRequest, eventType, media,
  partner, partnerMember, request, session, user, verification,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { sendEmail } from '@/lib/email/send';
import { date, daysBetween, monthName, sofiaDate, sofiaParts, time, weekdayName, type DateStr } from '@/lib/format';
import type { Actor } from './actor';
import { audit } from './audit';
import { DomainError, NotFoundError, assertClient, displayPhone, hashToken, mediaUrl, withTx } from './catalogue-kit';
import {
  confirmEmailChange, deviceFromUserAgent, getPreferences, requestEmailChange, setMarketing, setPreferences, setTwoFactor, updateClient,
} from './clients';
import { eventSummaries, type ClientEventSummary } from './events';
import { listSaved } from './saved';
import { parseSearchParams, searchHref } from './search';

// ── Time words (SPEC §0 Countdown) ───────────────────────────────────────

/** ‹преди 2 часа›, ‹вчера›, ‹преди 4 месеца› — how long ago `at` was. */
export function ago(at: Date, nowAt: Date): string {
  const mins = Math.max(1, Math.floor((nowAt.getTime() - at.getTime()) / 60_000));
  if (mins < 60) return `преди ${mins} мин`;
  const h = Math.floor(mins / 60);
  if (h < 24) return h === 1 ? 'преди 1 час' : `преди ${h} часа`;
  const d = Math.max(1, daysBetween(sofiaDate(at), sofiaDate(nowAt)));
  if (d === 1) return 'вчера';
  if (d < 30) return `преди ${d} дни`;
  const m = Math.floor(d / 30);
  if (m < 12) return m === 1 ? 'преди 1 месец' : `преди ${m} месеца`;
  const y = Math.floor(m / 12);
  return y === 1 ? 'преди 1 година' : `преди ${y} години`;
}

/** ‹Остават 19:40 ч› — deadline − now as hours:minutes. */
export function countdown(nowAt: Date, deadline: Date): string {
  const mins = Math.max(0, Math.floor((deadline.getTime() - nowAt.getTime()) / 60_000));
  return `Остават ${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')} ч`;
}

/**
 * The compact dates of the account rows (prototype saved.html / event.html): ‹12 авг›, with the year
 * ‹19 дек 2026›. The month is its first three letters, as in the event cards' date tiles.
 */
export function dateAbbr(d: Date | DateStr, withYear = false): string {
  const p = typeof d === 'string' ? (([y, m, day]) => ({ y, m, d: day }))(d.split('-').map(Number)) : sofiaParts(d);
  return `${p.d}\u00a0${monthName(p.m).slice(0, 3)}${withYear ? ` ${p.y}` : ''}`;
}

/** ‹11 авг, 11:05› */
export const sentOn = (at: Date) => `${dateAbbr(at)}, ${time(at)}`;

/** Demo photos live in public/photos with 620 px copies in public/photos/thumbs; small tiles use those. */
const thumbs = new Map<string, string>();
export function thumb(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = url.startsWith('/') || /^https?:/.test(url) ? url : `/${url}`;
  if (!u.startsWith('/photos/') || u.startsWith('/photos/thumbs/')) return u;
  if (!thumbs.has(u)) {
    const t = u.replace('/photos/', '/photos/thumbs/');
    thumbs.set(u, existsSync(join(process.cwd(), 'public', t)) ? t : u);
  }
  return thumbs.get(u)!;
}

// ── Role homes and sign-in redirects (SPEC §1.3, D47, D51) ───────────────

export type Who = { id: string; role: 'client' | 'partner' | 'admin' };

/** Where a signed-in user belongs: client → /tarsene; partner → the wizard step, the pending page or the panel; admin → /admin. */
export async function homeFor(u: Who, q: Queryable = db): Promise<string> {
  if (u.role === 'admin') return '/admin';
  if (u.role === 'client') return '/tarsene';
  const [p] = await q.select({ status: partner.status, step: partner.onboardingStep }).from(partnerMember)
    .innerJoin(partner, eq(partner.id, partnerMember.partnerId)).where(eq(partnerMember.userId, u.id)).limit(1);
  if (!p) return '/registratsiya?as=partner';
  if (p.status === 'draft' || p.status === 'returned') return `/partner/registratsiya/${p.step ?? 1}`;
  if (p.status === 'submitted' || p.status === 'rejected') return '/partner/registratsiya/podadeno';
  return '/partner';
}

/** A `next` that stays on this site (a path, never `//host` or a scheme). */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || typeof next !== 'string') return null;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\') || /[\r\n]/.test(next)) return null;
  if (next.startsWith('/api/') || next.startsWith('/vhod') || next.startsWith('/registratsiya') || next.startsWith('/potvarzhdenie')) return null;
  return next;
}

/** SPEC §1.3 sign-in redirect: the client goes to `next` (else /tarsene); partners and admins to their area (a `next` inside it is kept). */
export async function signInDestination(u: Who, next: string | null | undefined, q: Queryable = db): Promise<string> {
  const n = safeNext(next);
  const home = await homeFor(u, q);
  const area = (p: string, root: string) => p === root || p.startsWith(`${root}/`) || p.startsWith(`${root}?`);
  if (u.role === 'client') return n && !area(n, '/partner') && !area(n, '/admin') ? n : home;
  if (u.role === 'admin') return n && area(n, '/admin') ? n : home;
  return home === '/partner' && n && area(n, '/partner') ? n : home;
}

/** Recorded on every sign-in (admin client pages show it). */
export async function recordSignIn(userId: string, q: Queryable = db) {
  await q.update(user).set({ lastLoginAt: await now() }).where(eq(user.id, userId));
}

/** The account behind an email (sign-in checks a blocked profile first, SPEC §1.3). */
export async function accountByEmail(email: string, q: Queryable = db) {
  const [u] = await q.select({ id: user.id, role: user.role, banned: user.banned, emailVerified: user.emailVerified, deletedAt: user.deletedAt })
    .from(user).where(sql`lower(${user.email}) = ${email.trim().toLowerCase()}`).limit(1);
  return u ?? null;
}

// ── Email code (SPEC §4.1 A2/A3, §16 Verification, D49) ──────────────────

/** ‹Поискайте нов след 0:42›: the resend cooldown. */
export const RESEND_COOLDOWN_MS = 60_000;
/** Code lifetime (lib/auth.ts emailOTP expiresIn). */
const CODE_TTL_MS = 10 * 60_000;

/**
 * /potvarzhdenie: the unverified account behind the email and when the last code went out.
 * Better Auth keeps codes on its own (wall) clock, so `sentAt` is on that clock too; the page
 * only uses it for the 60 s resend countdown.
 */
export async function verificationView(email: string, q: Queryable = db) {
  const e = email.trim().toLowerCase();
  const [u] = await q.select({ id: user.id, role: user.role, emailVerified: user.emailVerified }).from(user)
    .where(sql`lower(${user.email}) = ${e}`).limit(1);
  const [v] = await q.select({ expiresAt: verification.expiresAt }).from(verification)
    .where(eq(verification.identifier, `email-verification-otp-${e}`)).orderBy(desc(verification.createdAt)).limit(1);
  return { account: u ?? null, sentAt: v ? new Date(v.expiresAt.getTime() - CODE_TTL_MS) : null };
}

/** ‹Сменете имейла›: the code sent to this address stops working (SPEC §16 Verification). */
export async function invalidateEmailCode(email: string, q: Queryable = db) {
  await q.delete(verification).where(eq(verification.identifier, `email-verification-otp-${email.trim().toLowerCase()}`));
}

/** Milliseconds until another code may be requested (0 = now). */
export function resendWaitMs(sentAt: Date | null, wallNow: number): number {
  return sentAt ? Math.max(0, sentAt.getTime() + RESEND_COOLDOWN_MS - wallNow) : 0;
}

// ── Password reset link (SPEC §4.1 A5/A6, D50) ───────────────────────────

/** The account a reset link belongs to, or null when the link is unknown or expired (Better Auth's `reset-password:<token>` row). */
export async function resetTokenUser(token: string | null | undefined, wallNow: number, q: Queryable = db): Promise<Who | null> {
  if (!token || !/^[A-Za-z0-9_-]{8,128}$/.test(token)) return null;
  const [v] = await q.select({ value: verification.value, expiresAt: verification.expiresAt }).from(verification)
    .where(eq(verification.identifier, `reset-password:${token}`)).orderBy(desc(verification.createdAt)).limit(1);
  if (!v || v.expiresAt.getTime() <= wallNow) return null;
  return accountById(v.value, q);
}

/** id + role of a user (null when unknown). */
export async function accountById(id: string, q: Queryable = db): Promise<Who | null> {
  const [u] = await q.select({ id: user.id, role: user.role }).from(user).where(eq(user.id, id)).limit(1);
  return u ?? null;
}

// ── Two-factor step (SPEC §1.3, §11.4) ───────────────────────────────────

/** Better Auth's signed `two_factor` cookie → the user it was issued for, the masked phone and when the code went out. */
export async function twoFactorChallenge(cookieValue: string | null | undefined, wallNow: number, q: Queryable = db) {
  if (!cookieValue) return null;
  const raw = cookieValue.includes('%') ? decodeURIComponent(cookieValue) : cookieValue;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const id = raw.slice(0, dot);
  const sig = Buffer.from(raw.slice(dot + 1));
  const expected = Buffer.from(createHmac('sha256', process.env.BETTER_AUTH_SECRET ?? '').update(id).digest('base64'));
  if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return null;
  const [v] = await q.select({ value: verification.value, expiresAt: verification.expiresAt }).from(verification)
    .where(eq(verification.identifier, id)).orderBy(desc(verification.createdAt)).limit(1);
  if (!v || v.expiresAt.getTime() <= wallNow) return null;
  const [u] = await q.select({ id: user.id, phone: user.phone }).from(user).where(eq(user.id, v.value)).limit(1);
  if (!u) return null;
  const [otp] = await q.select({ expiresAt: verification.expiresAt }).from(verification)
    .where(eq(verification.identifier, `2fa-otp-${id}`)).orderBy(desc(verification.createdAt)).limit(1);
  return { userId: u.id, phone: maskPhone(u.phone), sentAt: otp ? new Date(otp.expiresAt.getTime() - 10 * 60_000) : null };
}

/** '+359884127730' → '+359 88 ••• ••30' */
export function maskPhone(e164: string | null | undefined): string {
  const p = displayPhone(e164);
  if (!p) return '';
  const digits = p.replace(/\D/g, '');
  return p.startsWith('+359') && digits.length >= 11 ? `+359 ${digits.slice(3, 5)} ••• ••${digits.slice(-2)}` : `••${digits.slice(-2)}`;
}

// ── Deletion links (SPEC §4.1 A10, §4.2 P10, D50) ────────────────────────

/** What an unused, unexpired deletion link points at (for the confirmation screen); null otherwise. */
export async function deletionLinkView(token: string | null | undefined, role: 'client' | 'partner', q: Queryable = db) {
  if (!token) return null;
  const [r] = await q.select({ status: accountDeletionRequest.status, expiresAt: accountDeletionRequest.expiresAt, userId: user.id, role: user.role, email: user.email })
    .from(accountDeletionRequest).innerJoin(user, eq(user.id, accountDeletionRequest.userId))
    .where(eq(accountDeletionRequest.tokenHash, hashToken(token))).limit(1);
  if (!r || r.status !== 'requested' || r.role !== role || r.expiresAt <= await now()) return null;
  let partnerName: string | null = null;
  if (role === 'partner') {
    const [p] = await q.select({ name: partner.businessName }).from(partnerMember).innerJoin(partner, eq(partner.id, partnerMember.partnerId))
      .where(eq(partnerMember.userId, r.userId)).limit(1);
    partnerName = p?.name ?? null;
  }
  return { userId: r.userId, email: r.email, partnerName };
}

// ── Settings (SPEC §16, §11.2, D55) ──────────────────────────────────────

export type SessionLine = { id: string; device: string; city: string | null; age: string; current: boolean };

/** /akaunt/nastroyki: profile, security (password date, 2FA, sessions), preferences, notification switches, invoice data. */
export async function settingsView(actor: Actor, currentSessionId: string | null, q: Queryable = db) {
  assertClient(actor);
  const at = await now();
  const [u] = await q.select().from(user).where(eq(user.id, actor.userId)).limit(1);
  if (!u) throw new NotFoundError('user');
  const [prof] = await q.select().from(clientProfile).where(eq(clientProfile.userId, u.id)).limit(1);
  const cities = await q.select({ id: city.id, name: city.name }).from(city).where(eq(city.isActive, true)).orderBy(asc(city.sortOrder));
  const [inv] = await q.select().from(clientInvoiceProfile).where(eq(clientInvoiceProfile.userId, u.id)).limit(1);
  const rows = await q.select().from(session).where(eq(session.userId, u.id)).orderBy(desc(session.updatedAt));
  const sessions: SessionLine[] = rows
    .map(r => ({
      id: r.id, device: r.deviceLabel ?? deviceFromUserAgent(r.userAgent), city: r.city ?? u.lastLoginCity ?? null, current: r.id === currentSessionId,
      age: r.id === currentSessionId || r.updatedAt.getTime() >= at.getTime() - 5 * 60_000 ? 'активна сега' : ago(r.updatedAt, at),
    }))
    .sort((a, b) => Number(b.current) - Number(a.current))
    .slice(0, 3);
  return {
    user: { name: u.name, email: u.email, phone: displayPhone(u.phone), image: u.image, registeredOn: date(u.createdAt), twoFactor: u.twoFactorEnabled },
    passwordChangedOn: date(u.passwordChangedAt ?? u.createdAt),
    cityId: prof?.cityId ?? null, cities, marketing: prof?.marketingOptIn ?? false,
    sessions,
    preferences: await getPreferences(actor, q),
    invoice: inv
      ? { recipientType: inv.recipientType, name: inv.name, companyName: inv.companyName, eik: inv.eik, mol: inv.mol, address: inv.address }
      : { recipientType: 'individual' as const, name: u.name, companyName: null, eik: null, mol: null, address: null },
    pendingEmail: (await pendingEmailChange(actor, q))?.newEmail ?? null,
  };
}

export type SettingsInput = {
  name: string; phone: string; email: string; cityId: string | null;
  marketing: boolean; twoFactor: boolean;
  prefs: { key: string; channel: 'email' | 'sms'; enabled: boolean }[];
};

/**
 * ‹Запази промените›: the profile (`accounts.updateClient()`), the switches (`notifications.setPreferences()`),
 * ‹Маркетингови съобщения› (`accounts.setMarketing()`) and the two-step toggle (`accounts.setTwoFactor()`)
 * in one transaction. A new email starts the D55 code flow instead of changing at once.
 */
export async function saveSettings(actor: Actor, input: SettingsInput, tx?: Tx): Promise<{ emailChange: string | null }> {
  assertClient(actor);
  return withTx(tx, async t => {
    const [u] = await t.select().from(user).where(eq(user.id, actor.userId)).for('update');
    const [prof] = await t.select().from(clientProfile).where(eq(clientProfile.userId, actor.userId));
    await updateClient(actor, { name: input.name, phone: input.phone, ...(input.cityId !== (prof?.cityId ?? null) ? { cityId: input.cityId } : {}) }, t);
    const current = await getPreferences(actor, t);
    const changed = input.prefs.filter(p => {
      const c = current.find(x => x.key === p.key);
      if (!c) return true;
      if (p.channel === 'email') return !c.emailLocked && c.email !== p.enabled;
      return c.sms !== null && c.sms !== p.enabled;
    });
    if (changed.length) await setPreferences(actor, changed, t);
    if ((prof?.marketingOptIn ?? false) !== input.marketing) await setMarketing(actor, { on: input.marketing }, t);
    if (u.twoFactorEnabled !== input.twoFactor) await setTwoFactor(actor, { enabled: input.twoFactor }, t);
    const email = input.email.trim().toLowerCase();
    if (email && email !== u.email.toLowerCase()) {
      await requestEmailChangeCode(actor, email, t);
      return { emailChange: email };
    }
    return { emailChange: null };
  });
}

/**
 * D55: the code for a new address. `client-email-change-code` has no approved copy yet, so the code
 * goes out with the approved `client-verify-code` email to the new address.
 */
export async function requestEmailChangeCode(actor: Actor, newEmail: string, tx?: Tx) {
  return withTx(tx, async t => {
    const r = await requestEmailChange(actor, { newEmail }, t);
    const [row] = await t.select({ email: emailChangeRequest.newEmail }).from(emailChangeRequest).where(eq(emailChangeRequest.id, r.requestId));
    await sendEmail({ key: 'client-verify-code', to: row.email, toUserId: actor.userId, vars: { code: r.code, email: row.email }, dedupeKey: `email-change:${r.requestId}` }, t);
    return r;
  });
}

/** The open D55 request (latest, unconfirmed, unexpired). */
export async function pendingEmailChange(actor: Actor, q: Queryable = db) {
  assertClient(actor);
  const [r] = await q.select().from(emailChangeRequest)
    .where(and(eq(emailChangeRequest.userId, actor.userId), sql`${emailChangeRequest.confirmedAt} is null`))
    .orderBy(desc(emailChangeRequest.createdAt)).limit(1);
  if (!r || r.expiresAt <= await now()) return null;
  return { id: r.id, newEmail: r.newEmail, sentAt: r.createdAt };
}

/** ‹Поискайте нов› on the email-change screen: a fresh code to the same new address (the old one stops working). */
export async function resendEmailChangeCode(actor: Actor, tx?: Tx) {
  return withTx(tx, async t => {
    const p = await pendingEmailChange(actor, t);
    if (!p) throw new DomainError('invalid_code');
    if ((await now()).getTime() - p.sentAt.getTime() < RESEND_COOLDOWN_MS) throw new DomainError('too_soon');
    await t.update(emailChangeRequest).set({ expiresAt: await now() }).where(eq(emailChangeRequest.id, p.id));
    return requestEmailChangeCode(actor, p.newEmail, t);
  });
}

/** D55 confirm, with the D49 limit of 5 attempts per code (a sixth wrong try needs a new code). */
export async function confirmEmailChangeLimited(actor: Actor, code: string) {
  assertClient(actor);
  const p = await pendingEmailChange(actor);
  if (!p) throw new DomainError('invalid_code');
  const [{ n }] = await db.select({ n: count() }).from(auditLog)
    .where(and(eq(auditLog.action, 'user.email_change_failed'), eq(auditLog.entityId, p.id)));
  if (n >= 5) throw new DomainError('too_many_attempts');
  try {
    await confirmEmailChange(actor, { code });
  } catch (e) {
    if (e instanceof DomainError && e.code === 'invalid_code') {
      await audit(db, { actor, action: 'user.email_change_failed', entity: 'email_change_request', entityId: p.id });
    }
    throw e;
  }
}

// ── Saved searches and date watches (SPEC §13.9) ─────────────────────────

/** /akaunt/zapazeni: listSaved() plus the row pictures (category photo, event-type photo or a matching partner's cover). */
export async function savedView(actor: Actor, q: Queryable = db) {
  const { searches, watches } = await listSaved(actor, q);
  const cats = await q.select({ slug: category.slug, photo: category.heroPhotoUrl, id: category.id }).from(category);
  const types = await q.select({ slug: eventType.slug, photo: eventType.heroPhotoUrl }).from(eventType);
  const covers = await q.select({ categoryId: partner.primaryCategoryId, key: media.storageKey }).from(partner)
    .innerJoin(media, eq(media.id, partner.coverMediaId))
    .where(and(eq(partner.status, 'approved'), eq(partner.isListed, true))).orderBy(sql`${partner.ratingAvg} desc nulls last`, asc(partner.businessName));
  const watchCovers = watches.length
    ? await q.select({ id: partner.id, key: media.storageKey }).from(partner).innerJoin(media, eq(media.id, partner.coverMediaId))
      .where(inArray(partner.id, watches.map(w => w.watch.partnerId)))
    : [];
  return {
    searches: searches.map(s => {
      const p = parseSearchParams(s.search.params as Record<string, unknown>);
      const c = cats.find(x => x.slug === p.kategoriya);
      const photo = c?.photo ?? types.find(x => x.slug === p.sabitie[0])?.photo ?? (c ? covers.find(x => x.categoryId === c.id)?.key : covers[0]?.key) ?? null;
      return {
        id: s.search.id, title: s.search.title, summary: s.search.filtersSummary, notify: s.search.notify,
        savedOn: dateAbbr(s.savedOn), results: s.results, fresh: s.fresh, free: s.free, image: thumb(photo),
      };
    }),
    watches: watches.map(w => ({
      id: w.watch.id, partnerName: w.partnerName, href: w.partnerHref, line: w.line, date: dateAbbr(w.date, true), eventTitle: w.eventTitle,
      badge: w.badge, since: `следим от ${dateAbbr(w.watch.createdAt)}`, image: thumb(mediaUrl(watchCovers.find(x => x.id === w.watch.partnerId)?.key)),
    })),
  };
}

// ── Event folders (SPEC §16) ─────────────────────────────────────────────

/** ‹Добави услуга към събитието›: search filtered by the event's type, city, date and guests, attached to the event. */
function addServiceHref(e: ClientEventSummary, citySlug: string | null) {
  return searchHref({ sabitie: [e.eventType.slug], grad: citySlug ? [citySlug] : [], data: e.date, gosti: e.guests ? String(e.guests) : null, sabitieId: e.id });
}

/** ‹Вила Екатерина, с. Панчарево› / ‹Ресторант „Виа Верде“, София›. */
const placeLine = (e: Pick<ClientEventSummary, 'venueName' | 'locality' | 'cityName'>) => [e.venueName, e.locality ?? e.cityName].filter(Boolean).join(', ');

function dateParts(d: DateStr) {
  const [y, m, day] = d.split('-').map(Number);
  const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
  return { day, month: monthName(m).slice(0, 3), year: y, weekday: weekdayName(wd) };
}

async function citySlugs(q: Queryable, eventIds: string[]) {
  if (!eventIds.length) return new Map<string, string>();
  const rows = await q.select({ id: clientEvent.id, slug: city.slug }).from(clientEvent).innerJoin(city, eq(city.id, clientEvent.cityId)).where(inArray(clientEvent.id, eventIds));
  return new Map(rows.map(r => [r.id, r.slug]));
}

/** /akaunt/sabitiya: the client's events, upcoming first (nearest date first), then past ones (latest first). */
export async function eventsView(actor: Actor, q: Queryable = db) {
  assertClient(actor);
  const all = await eventSummaries(q, actor.userId, await now());
  const slugs = await citySlugs(q, all.map(e => e.id));
  const ordered = [...all.filter(e => e.upcoming), ...all.filter(e => !e.upcoming).reverse()];
  return ordered.map(e => ({
    ...e, parts: dateParts(e.date), place: placeLine(e), addHref: e.upcoming ? addServiceHref(e, slugs.get(e.id) ?? null) : null,
  }));
}

export type EventRequestRow = {
  number: string; partnerName: string; line: string; image: string | null; sent: string; amountCents: number | null;
  badge: { text: string; tone: 'pink' | 'primary' | 'danger' | 'neutral' | 'success' }; age: string | null;
  action: { label: 'Плати' | 'Виж' | 'Виж подобни'; href: string; primary: boolean }; off: boolean; href: string;
};

/** ‹Декорация · Коледна украса на залата и масите›; a title that already names the service (‹Фотокабина · 3 часа …›) stands alone. */
const serviceLine = (categoryName: string | null, title: string) => (title.includes(' · ') || !categoryName ? title : `${categoryName} · ${title}`);

const BOOKING_CLOSED_LABEL: Record<string, string> = {
  payment_expired: 'Изтекъл срок за плащане', approval_withdrawn: 'Оттеглено одобрение', cancelled: 'Анулирана',
};

/** /akaunt/sabitiya/[id]: one of the client's events (404 otherwise) with its facts, notes, requests and bookings. */
export async function eventView(actor: Actor, id: string, q: Queryable = db) {
  assertClient(actor);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundError('client_event');
  const at = await now();
  const [sum] = await eventSummaries(q, actor.userId, at, [id]);
  if (!sum) throw new NotFoundError('client_event');
  const [ev] = await q.select().from(clientEvent).where(eq(clientEvent.id, id)).limit(1);
  const slugs = await citySlugs(q, [id]);
  const citySlug = slugs.get(id) ?? null;

  const reqs = await q.select({
    r: request, b: { status: booking.status, paymentDueAt: booking.paymentDueAt, approvedAt: booking.approvedAt },
    partnerName: partner.businessName, coverKey: media.storageKey, categoryName: category.name, categorySlug: category.slug,
  }).from(request).innerJoin(partner, eq(partner.id, request.partnerId)).leftJoin(booking, eq(booking.requestId, request.id))
    .leftJoin(category, eq(category.id, partner.primaryCategoryId)).leftJoin(media, eq(media.id, partner.coverMediaId))
    .where(and(eq(request.clientEventId, id), eq(request.clientId, actor.userId))).orderBy(asc(request.sentAt));
  const CONFIRMED = ['confirmed', 'cancellation_requested', 'completed'];
  const requests: EventRequestRow[] = reqs.filter(x => !x.b?.status || !CONFIRMED.includes(x.b.status)).map(x => {
    const r = x.r;
    const n = encodeURIComponent(r.number);
    const similar = { label: 'Виж подобни' as const, primary: false,
      href: searchHref({ kategoriya: x.categorySlug ?? null, data: r.eventDate, grad: citySlug ? [citySlug] : [], gosti: String(r.guests) }) };
    const view = { label: 'Виж' as const, href: `/akaunt/zayavki/${n}`, primary: false };
    const base = { number: r.number, partnerName: x.partnerName, line: serviceLine(x.categoryName, r.serviceTitle), image: thumb(mediaUrl(x.coverKey)),
      sent: sentOn(r.sentAt), amountCents: r.amountCents, href: `/akaunt/zayavki/${n}` };
    if (x.b?.status === 'awaiting_payment' && x.b.paymentDueAt > at) {
      return { ...base, badge: { text: countdown(at, x.b.paymentDueAt), tone: 'pink' as const }, age: `одобрена ${ago(x.b.approvedAt, at)}`,
        action: { label: 'Плати' as const, href: `/plashtane/${n}`, primary: true }, off: false };
    }
    if (x.b?.status) {
      const label = x.b.status === 'awaiting_payment' ? BOOKING_CLOSED_LABEL.payment_expired : BOOKING_CLOSED_LABEL[x.b.status] ?? 'Анулирана';
      return { ...base, badge: { text: label, tone: 'danger' as const }, age: null, action: x.b.status === 'cancelled' ? view : similar, off: true };
    }
    if (r.status === 'declined') {
      return { ...base, badge: { text: r.declineReason === 'date_taken' ? 'Датата е заета' : 'Отказана', tone: 'danger' as const },
        age: r.declinedAt ? `отказана на ${dateAbbr(r.declinedAt)}` : null, action: similar, off: true };
    }
    if (r.status === 'expired' || r.status === 'withdrawn') {
      return { ...base, badge: { text: 'Изтекла', tone: 'neutral' as const }, age: null, action: similar, off: true };
    }
    if (r.status === 'offer_sent') return { ...base, badge: { text: 'Нова оферта', tone: 'primary' as const }, age: ago(r.answeredAt ?? r.sentAt, at), action: view, off: false };
    if (r.status === 'awaiting_confirmation') return { ...base, badge: { text: 'Избрана оферта', tone: 'primary' as const }, age: ago(r.sentAt, at), action: view, off: false };
    return { ...base, badge: { text: 'Чака отговор', tone: 'primary' as const }, age: ago(r.sentAt, at), action: view, off: false };
  });

  // As on ‹Моите заявки›: approved and waiting for payment, then waiting for an answer, then closed.
  const rank = (r: EventRequestRow) => (r.action.label === 'Плати' ? 0 : r.off ? 2 : 1);
  requests.sort((a, b) => rank(a) - rank(b));

  const bks = await q.select({ b: booking, partnerName: partner.businessName, coverKey: media.storageKey, categoryName: category.name })
    .from(booking).innerJoin(partner, eq(partner.id, booking.partnerId)).leftJoin(category, eq(category.id, partner.primaryCategoryId))
    .leftJoin(media, eq(media.id, partner.coverMediaId))
    .where(and(eq(booking.clientEventId, id), eq(booking.clientId, actor.userId), inArray(booking.status, ['confirmed', 'cancellation_requested', 'completed'])))
    .orderBy(sql`${booking.startTime} asc nulls last`, asc(booking.createdAt));
  const bookings = bks.map(x => ({
    number: x.b.number, partnerName: x.partnerName, line: serviceLine(x.categoryName, x.b.serviceTitle), image: thumb(mediaUrl(x.coverKey)),
    date: date(x.b.eventDate), time: x.b.startTime ? x.b.startTime.slice(0, 5) : null, amountCents: x.b.amountCents,
    badge: x.b.status === 'completed' ? 'Приключила' : x.b.status === 'cancellation_requested' ? 'Искане за анулиране' : 'Потвърдена',
    tone: x.b.status === 'cancellation_requested' ? 'warning' : 'success',
    paidOn: x.b.paidAt ? x.b.paidAt : null, href: `/akaunt/rezervacii/${encodeURIComponent(x.b.number)}`,
  }));

  return {
    ...sum, parts: dateParts(sum.date), place: placeLine(sum), venueName: ev.venueName, placeSmall: ev.locality ?? sum.cityName,
    notes: ev.notes, notesUpdatedAt: ev.notesUpdatedAt, endTime: ev.endTime,
    addHref: sum.upcoming ? addServiceHref(sum, citySlug) : null,
    searchHint: [date(sum.date), sum.cityName, sum.guests ? `${sum.guests} гости` : null].filter(Boolean).join(' · '),
    requests, bookings, today: sofiaDate(at),
  };
}
