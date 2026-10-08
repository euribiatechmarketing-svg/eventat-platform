// Shared plumbing for the after-confirmation modules (cancellation, refunds,
// disputes, payouts, chargebacks): transactions, the booking context that the
// emails need, email + bell (SPEC §4 bell rule), team recipients (SPEC §11.5),
// job helpers, money rounding (SPEC §0) and the provider of a charge (D5).
// Only the aftercare modules import this file.
import { and, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  availabilityBlock, availabilityOpenDate, booking, category, charge, city, clientEvent, dateWatch, eventType, job, partner,
  partnerMember, refund, teamMember, user, type CancellationPolicy, type DisputeReason, type CancellationReason,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { sendEmail } from '@/lib/email/send';
import { TEMPLATES } from '@/lib/email/templates';
import { addDays, date as fmtDate, sofiaDate, type DateStr } from '@/lib/format';
import { notify } from '@/lib/notify';
import { MAX_JOB_ATTEMPTS, scheduleJob } from '@/lib/jobs';
import { simulatedProvider } from '@/lib/payments/simulated';
import { stripeProvider } from '@/lib/payments/stripe';
import type { PaymentProvider, ProviderId } from '@/lib/payments/types';
import { teamRolesWith, type TeamPermission } from './actor';

// ── Errors ────────────────────────────────────────────────────────────────

/** A rule of SPEC §4/§5/§8 refused the action. `code` is stable; the UI maps it to approved copy. */
export class AftercareError extends Error {
  constructor(public code: string, message?: string) { super(message ?? code); this.name = 'AftercareError'; }
}

// ── Transactions ──────────────────────────────────────────────────────────

/** Run `fn` in the caller's transaction, or in a new one. */
export function withTx<T>(tx: Tx | undefined, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return tx ? fn(tx) : db.transaction(fn);
}

// ── Money (SPEC §0: integer cents, half-up once per computed amount) ─────

/** round_half_up(amount × percent / 100) for non-negative amounts. */
export const percentOf = (amountCents: number, percent: number) => Math.floor((amountCents * percent + 50) / 100);
/** round_half_up(amount × bp / 10 000) for non-negative amounts (SPEC §6). */
export const bpOf = (amountCents: number, bp: number) => Math.floor((amountCents * bp + 5000) / 10_000);

// ── Labels (DATA-MODEL §1; lib/labels.ts does not exist yet) ─────────────

export const POLICY_NAME: Record<CancellationPolicy, string> = { flexible: 'Гъвкава', moderate: 'Умерена', strict: 'Строга' };
/** Running text in emails: „по умерената ви политика“. */
export const POLICY_DEFINITE: Record<CancellationPolicy, string> = { flexible: 'гъвкавата', moderate: 'умерената', strict: 'строгата' };
export const DISPUTE_REASON_LABEL: Record<DisputeReason, string> = {
  no_show: 'Изпълнителят не се яви',
  not_as_described: 'Услугата не беше по описание',
  payment_problem: 'Проблем с плащането',
  client_unresponsive: 'Клиентът не отговаря',
  terms_changed_on_site: 'Промени условията на място',
  other: 'Друго',
};
export const CANCELLATION_REASON_LABEL: Record<CancellationReason, string> = {
  date_change: 'Промяна в датата',
  other_vendor: 'Намерихме друг изпълнител',
  event_cancelled: 'Събитието се отменя',
  other: 'Друга причина',
};
const CARD_BRAND: Record<string, string> = {
  visa: 'Visa', mastercard: 'Mastercard', maestro: 'Maestro', amex: 'American Express', discover: 'Discover', diners: 'Diners Club',
};
export const cardBrandLabel = (b: string | null | undefined) => (b ? CARD_BRAND[b.toLowerCase()] ?? b : null);

export const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** ‹Пакет „Цял ден“› → ‹Цял ден›: the templates wrap the name in Пакет „…“ themselves. */
export function packageNameOf(serviceTitle: string): string {
  const m = /^Пакет\s+„(.+)“$/.exec(serviceTitle.trim());
  return m ? m[1] : serviceTitle;
}

// ── The booking context the emails need ──────────────────────────────────

export type BookingRow = typeof booking.$inferSelect;
export type PartnerRow = typeof partner.$inferSelect;

export type BookingCtx = {
  booking: BookingRow;
  partner: PartnerRow;
  /** The partner's owner user (D52): the bell and toUserId of partner emails. */
  partnerUserId: string | null;
  client: { id: string; name: string; email: string; phone: string | null };
  event: { title: string; hosts: string | null };
  eventType: { name: string; nameDefinite: string; slug: string };
  categoryName: string | null;
  categorySlug: string | null;
  cityName: string | null;
  citySlug: string | null;
};

/** Load a booking with what its emails need. `lock` takes the booking row FOR UPDATE. */
export async function loadBookingCtx(q: Queryable, bookingId: string, opts: { lock?: boolean } = {}): Promise<BookingCtx> {
  const base = q.select().from(booking).where(eq(booking.id, bookingId));
  const [b] = opts.lock ? await base.for('update') : await base;
  if (!b) throw new AftercareError('not_found', `No booking ${bookingId}`);
  const [p] = await q.select().from(partner).where(eq(partner.id, b.partnerId));
  const [owner] = await q.select({ userId: partnerMember.userId }).from(partnerMember)
    .where(eq(partnerMember.partnerId, p.id)).orderBy(partnerMember.createdAt).limit(1);
  const [c] = await q.select({ id: user.id, name: user.name, email: user.email, phone: user.phone }).from(user).where(eq(user.id, b.clientId));
  const [ev] = await q.select({ title: clientEvent.title, hosts: clientEvent.hosts }).from(clientEvent).where(eq(clientEvent.id, b.clientEventId));
  const [et] = await q.select({ name: eventType.name, nameDefinite: eventType.nameDefinite, slug: eventType.slug }).from(eventType)
    .where(eq(eventType.id, b.eventTypeId));
  const [cat] = p.primaryCategoryId
    ? await q.select({ name: category.name, slug: category.slug }).from(category).where(eq(category.id, p.primaryCategoryId))
    : [];
  const cityId = b.cityId ?? p.cityId;
  const [ct] = cityId ? await q.select({ name: city.name, slug: city.slug }).from(city).where(eq(city.id, cityId)) : [];
  return {
    booking: b, partner: p, partnerUserId: owner?.userId ?? null, client: c,
    event: ev ?? { title: et.name, hosts: null }, eventType: et,
    categoryName: cat?.name ?? null, categorySlug: cat?.slug ?? null, cityName: ct?.name ?? null, citySlug: ct?.slug ?? null,
  };
}

/** Formatted pieces shared by many templates. */
export function ctxText(c: BookingCtx) {
  const b = c.booking;
  const hhmm = (t: string | null) => (t ? t.slice(0, 5) : null);
  const start = hhmm(b.startTime), end = hhmm(b.endTime);
  return {
    bookingNo: b.number,
    partnerName: c.partner.businessName,
    partnerLegalName: c.partner.legalName ?? c.partner.businessName,
    partnerCategory: c.categoryName ?? '',
    packageName: packageNameOf(b.serviceTitle),
    serviceName: b.serviceTitle,
    eventType: c.eventType.name,
    eventTypeDefinite: c.eventType.nameDefinite,
    eventDate: fmtDate(b.eventDate),
    clientName: c.client.name,
    hosts: c.event.hosts ?? c.client.name,
    venue: b.venueName ?? b.locality ?? c.cityName ?? '',
    location: [b.venueName, b.locality].filter(Boolean).join(', ') || c.cityName || '',
    timeRange: start && end ? `${start} – ${end}` : start ?? '',
  };
}

/** Production routes (SCREENS §4, §7; numbers URL-encoded, D3). */
export const routes = {
  clientBooking: (n: string) => `/akaunt/rezervacii/${encodeURIComponent(n)}`,
  clientBookings: () => '/akaunt/rezervacii',
  partnerBooking: (n: string) => `/partner/rezervacii/${encodeURIComponent(n)}`,
  clientCase: (n: string) => `/akaunt/poddrazhka/${encodeURIComponent(n)}`,
  partnerCase: (n: string) => `/partner/poddrazhka/${encodeURIComponent(n)}`,
  partnerCalendar: () => '/partner/kalendar',
  partnerEarnings: () => '/partner/prihodi',
  similar: (c: BookingCtx) => {
    const p = new URLSearchParams();
    if (c.categorySlug) p.set('kategoriya', c.categorySlug);
    p.set('data', c.booking.eventDate);
    if (c.citySlug) p.set('grad', c.citySlug);
    return `/tarsene?${p.toString()}`;
  },
};

// ── Email + bell (SPEC §4 bell rule, §11) ─────────────────────────────────

export type MailArgs = {
  key: string;
  to: string;
  toUserId?: string | null;
  vars: Record<string, unknown>;
  dedupeKey: string;
  /** Bell link for client/partner emails (the email's CTA route in production form). */
  href?: string;
};

/**
 * Queue an email in `tx` and, for client and partner emails, add the bell item
 * (title = heading, body = preheader). A repeated dedupeKey adds nothing.
 */
export async function mail(tx: Tx, a: MailArgs): Promise<boolean> {
  const id = await sendEmail({ key: a.key, to: a.to, toUserId: a.toUserId ?? null, vars: a.vars, dedupeKey: a.dedupeKey }, tx);
  if (!id) return false;
  const tpl = TEMPLATES[a.key];
  if (tpl.audience !== 'team' && a.toUserId) {
    const content = tpl.render(a.vars);
    await notify(a.toUserId, { kind: a.key, title: content.heading, body: content.preheader, href: a.href ?? content.cta?.href }, tx);
  }
  return true;
}

export const mailClient = (tx: Tx, c: BookingCtx, key: string, vars: Record<string, unknown>, dedupeKey: string, href?: string) =>
  mail(tx, { key, to: c.client.email, toUserId: c.client.id, vars, dedupeKey, href });

export const mailPartner = (tx: Tx, c: BookingCtx, key: string, vars: Record<string, unknown>, dedupeKey: string, href?: string) =>
  mail(tx, { key, to: c.partner.notificationEmail, toUserId: c.partnerUserId, vars, dedupeKey, href });

/** Active team members holding a permission (SPEC §11.5). */
export async function teamRecipients(q: Queryable, permission: TeamPermission): Promise<{ userId: string; email: string; name: string }[]> {
  return q.select({ userId: user.id, email: user.email, name: user.name }).from(teamMember)
    .innerJoin(user, eq(user.id, teamMember.userId))
    .where(and(eq(teamMember.status, 'active'), inArray(teamMember.role, teamRolesWith(permission)), eq(user.banned, false), sql`${user.deletedAt} is null`));
}

/** One team email per recipient with the permission; dedupe per recipient. */
export async function mailTeam(tx: Tx, permission: TeamPermission, key: string, vars: Record<string, unknown>, dedupeBase: string): Promise<number> {
  let n = 0;
  for (const r of await teamRecipients(tx, permission)) {
    if (await mail(tx, { key, to: r.email, toUserId: r.userId, vars, dedupeKey: `${dedupeBase}:${r.userId}` })) n++;
  }
  return n;
}

// ── Jobs ──────────────────────────────────────────────────────────────────

/**
 * Schedule a job unless one with this dedupe key is pending or done. Unlike
 * scheduleJob() it never re-arms a job that already ran, and it reads the row
 * first, so a handler may call it without touching its own locked job row.
 * A cancelled or failed job is armed again.
 */
export async function scheduleOnce(kind: string, runAt: Date, payload: Record<string, unknown>, dedupeKey: string, tx: Tx): Promise<boolean> {
  const [existing] = await tx.select({ status: job.status }).from(job).where(eq(job.dedupeKey, dedupeKey)).limit(1);
  if (existing && (existing.status === 'pending' || existing.status === 'done')) return false;
  await scheduleJob(kind, runAt, payload, dedupeKey, tx);
  return true;
}

/** (Re)schedule a job: same key = moved. Never call it with the key of the job that is running. */
export const schedule = (kind: string, runAt: Date, payload: Record<string, unknown>, dedupeKey: string, tx: Tx) =>
  scheduleJob(kind, runAt, payload, dedupeKey, tx);

/**
 * Cancel pending jobs by dedupe-key prefix (`booking:<id>:`). Rows locked by a
 * running job are skipped, so a handler may call it with a prefix that also
 * matches its own key (runDueJobs marks that one done).
 */
export async function cancelPending(prefix: string, tx: Tx): Promise<void> {
  await tx.execute(sql`update job set status = 'cancelled' where id in (
    select id from job where status = 'pending' and dedupe_key like ${`${prefix.replace(/[\\%_]/g, m => `\\${m}`)}%`}
    for update skip locked)`);
}

/**
 * Inside a job handler: is this the job's last try before runDueJobs gives it
 * up? A provider call that keeps throwing must then end in a recorded failure
 * (F3 / Y8) instead of a row left pending forever that nobody sees.
 */
export async function isFinalAttempt(dedupeKey: string): Promise<boolean> {
  const [j] = await db.select({ attempts: job.attempts }).from(job).where(eq(job.dedupeKey, dedupeKey)).limit(1);
  // The runner counts the attempt when it claims the job, so the current run is already included.
  return !!j && j.attempts >= MAX_JOB_ATTEMPTS;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e)) || 'error';

// ── Payments ──────────────────────────────────────────────────────────────

/** A charge keeps the provider it was created with (D5). */
export function providerFor(id: ProviderId | null | undefined): PaymentProvider {
  return id === 'stripe' ? stripeProvider : simulatedProvider;
}

/** Charge statuses that mean the money arrived (refunds change the status but not that fact). */
export const RECEIVED: ('succeeded' | 'partially_refunded' | 'refunded')[] = ['succeeded', 'partially_refunded', 'refunded'];

// The correlated subqueries below name the outer table explicitly ("charge"."id",
// "refund"."…"): drizzle renders a select-list column unqualified, which inside
// a subquery would bind to the subquery's own table.

/** Σ of a charge's open or lost chargebacks: money the card network took back (SQL, correlated on `charge`). */
export const chargedBackSql = sql<number>`coalesce((select sum(cb.amount_cents) from chargeback cb
  where cb.charge_id = "charge"."id" and cb.status in ('open', 'lost')), 0)`;

/**
 * paid = Σ succeeded charges − Σ succeeded refunds (SPEC §5.1), per charge and
 * never below 0, less what an open or lost chargeback took back: that money is
 * no longer the platform's to refund.
 */
export async function paidCents(q: Queryable, bookingId: string): Promise<number> {
  const [c] = await q.select({
    s: sql<number>`coalesce(sum(greatest(0, "charge"."amount_cents"
      - coalesce((select sum(r.amount_cents) from refund r where r.charge_id = "charge"."id" and r.status = 'succeeded'), 0)
      - ${chargedBackSql})), 0)::int`.mapWith(Number),
  }).from(charge).where(and(eq(charge.bookingId, bookingId), inArray(charge.status, RECEIVED)));
  return c?.s ?? 0;
}

/**
 * A failed refund that no retry or manual refund has replaced yet (same charge,
 * reason, cancellation and decision, created no earlier): the client is still owed it.
 */
export const uncoveredFailedSql = sql<boolean>`("refund"."status" = 'failed' and not exists (
  select 1 from refund r2 where r2.charge_id = "refund"."charge_id" and r2.reason = "refund"."reason" and r2.id <> "refund"."id"
    and r2.created_at >= "refund"."created_at" and r2.status in ('pending', 'succeeded')
    and r2.cancellation_id is not distinct from "refund"."cancellation_id" and r2.dispute_id is not distinct from "refund"."dispute_id"))`;

/** A refund the client is owed or has had: pending, succeeded, or failed and not replaced yet. */
export const owedRefundSql = sql<boolean>`("refund"."status" in ('pending', 'succeeded') or ${uncoveredFailedSql})`;

/** Σ refunds still pending at the provider (the money is still held for the booking). */
export async function pendingRefundCents(q: Queryable, bookingId: string): Promise<number> {
  const [r] = await q.select({ s: sql<number>`coalesce(sum(${refund.amountCents}), 0)::int`.mapWith(Number) }).from(refund)
    .where(and(eq(refund.bookingId, bookingId), eq(refund.status, 'pending')));
  return r?.s ?? 0;
}

/**
 * Money held for the booking that must still go back to the client: refunds
 * pending at the provider plus failed ones the team has not retried or paid by
 * hand yet (F3, D67). Never released to the partner.
 */
export async function outstandingRefundCents(q: Queryable, bookingId: string): Promise<number> {
  const [r] = await q.select({ s: sql<number>`coalesce(sum(${refund.amountCents}), 0)::int`.mapWith(Number) }).from(refund)
    .where(and(eq(refund.bookingId, bookingId), sql`(${refund.status} = 'pending' or ${uncoveredFailedSql})`));
  return r?.s ?? 0;
}

/**
 * What a new refund or a cancellation quote may still give back: paid less the
 * refunds already on their way (pending at the provider). Refunds never exceed
 * what was paid.
 */
export async function refundablePaidCents(q: Queryable, bookingId: string): Promise<number> {
  return Math.max(0, (await paidCents(q, bookingId)) - (await pendingRefundCents(q, bookingId)));
}

/** The latest received charge: what ‹Карта Visa •••• 4242› and „картата, завършваща на …“ show. */
export async function payingCharge(q: Queryable, bookingId: string) {
  const [c] = await q.select().from(charge).where(and(eq(charge.bookingId, bookingId), inArray(charge.status, RECEIVED)))
    .orderBy(desc(charge.succeededAt), desc(charge.createdAt)).limit(1);
  return c ?? null;
}

/** ‹Visa •••• 4242› or ‹Банков превод›. */
export function paymentMethodText(c: { method: string; cardBrand: string | null; cardLast4: string | null } | null): string {
  if (!c) return '';
  if (c.method === 'bank_transfer') return 'Банков превод';
  const brand = cardBrandLabel(c.cardBrand);
  return [brand, c.cardLast4 ? `•••• ${c.cardLast4}` : null].filter(Boolean).join(' ');
}

// ── Dates freed (SPEC §4.14 Notify, §12.6) ────────────────────────────────

/**
 * Is the partner's date requestable again (SPEC §12.6)? Private stand-in for the
 * catalogue module's availability check, used only to decide whether the
 * date watches fire after a cancellation.
 */
export async function dateIsFree(q: Queryable, partnerId: string, d: DateStr, today: DateStr): Promise<boolean> {
  const [p] = await q.select().from(partner).where(eq(partner.id, partnerId));
  if (!p) return false;
  if (d < addDays(today, p.leadTimeDays)) return false;
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCMonth(horizon.getUTCMonth() + p.horizonMonths);
  if (d > horizon.toISOString().slice(0, 10)) return false;
  const iso = ((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  if (!p.workingDays.includes(iso)) return false;
  const [blk] = await q.select({ id: availabilityBlock.id }).from(availabilityBlock)
    .where(and(eq(availabilityBlock.partnerId, partnerId), lte(availabilityBlock.startDate, d), gte(availabilityBlock.endDate, d))).limit(1);
  if (blk) return false;
  if (p.onlySelectedDates) {
    const [open] = await q.select({ d: availabilityOpenDate.date }).from(availabilityOpenDate)
      .where(and(eq(availabilityOpenDate.partnerId, partnerId), eq(availabilityOpenDate.date, d))).limit(1);
    if (!open) return false;
  }
  const capacity = p.bookingsPerDayMode === 'one' ? 1 : p.bookingsPerDayMode === 'limit' ? p.maxBookingsPerDate : Infinity;
  const [n] = await q.select({ n: sql<number>`count(*)::int`.mapWith(Number) }).from(booking)
    .where(and(eq(booking.partnerId, partnerId), eq(booking.eventDate, d), inArray(booking.status, ['awaiting_payment', 'confirmed', 'cancellation_requested'])));
  return (n?.n ?? 0) < capacity;
}

/**
 * The partner's date stopped being busy: every `watching` watch → `notified`,
 * `client-date-freed` at once (D21). No-op while the date is still busy.
 */
export async function fireDateWatches(tx: Tx, c: BookingCtx): Promise<number> {
  const d = c.booking.eventDate;
  const today = sofiaDate(await now());
  if (!(await dateIsFree(tx, c.partner.id, d, today))) return 0;
  const watches = await tx.select().from(dateWatch)
    .where(and(eq(dateWatch.partnerId, c.partner.id), eq(dateWatch.date, d), eq(dateWatch.status, 'watching'))).for('update');
  const at = await now();
  for (const w of watches) {
    await tx.update(dateWatch).set({ status: 'notified', notifiedAt: at }).where(eq(dateWatch.id, w.id));
    const [u] = await tx.select({ id: user.id, email: user.email }).from(user).where(eq(user.id, w.clientId));
    let evName = c.eventType.name;
    if (w.clientEventId) {
      const [ev] = await tx.select({ name: eventType.name }).from(clientEvent).innerJoin(eventType, eq(eventType.id, clientEvent.eventTypeId))
        .where(eq(clientEvent.id, w.clientEventId));
      if (ev) evName = ev.name;
    }
    await mail(tx, {
      key: 'client-date-freed', to: u.email, toUserId: u.id, dedupeKey: `datewatch:${w.id}:freed`,
      href: `/partnyori/${c.partner.slug}?data=${d}`,
      vars: {
        partnerSlug: c.partner.slug, partnerName: c.partner.businessName, partnerCategory: c.categoryName ?? '',
        eventType: evName, eventDate: fmtDate(d), watchingSince: fmtDate(sofiaDate(w.createdAt)),
      },
    });
  }
  return watches.length;
}
