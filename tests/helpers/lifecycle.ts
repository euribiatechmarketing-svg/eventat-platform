// Helpers for the request → booking → payment → completion tests. They drive
// the real domain functions (no raw rows), so every scenario goes through the
// same transitions, emails, jobs and ledger postings as production.
import { and, asc, desc, eq, like, sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { db } from '@/db';
import { booking, emailOutbox, job, notification, platformSettings, request } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { approveRequest, sendRequest, type SendRequestInput } from '@/lib/domain/requests';
import { startPayment } from '@/lib/domain/charges';
import { checkLedgerInvariants } from '@/lib/domain/ledger';
import type { SettingKey, SettingValue } from '@/lib/domain/settings';
import { applyProviderEvent } from '@/lib/payments/apply';
import { runDueJobs } from '@/lib/jobs';
import { sofiaInstant } from '@/lib/format';
import { createClient, createPartner, type PartnerOpts } from './factories';

/** The prototype's "today": Sunday 31 August 2025, 12:00 Sofia (D4). */
export const NOW = sofiaInstant('2025-08-31', 12, 0);
export const EVENT = '2026-06-14';
export const H = 3_600_000;

export type Client = Awaited<ReturnType<typeof createClient>>;
export type Partner = Awaited<ReturnType<typeof createPartner>>;

/** R1 with the prototype's wedding as defaults (Сватба, 14 юни 2026, 17:00 – 02:00, 120 гости, Вила Екатерина). */
export function sendFor(client: Client, partner: Partner, o: Partial<SendRequestInput> = {}) {
  return sendRequest(client.actor, {
    partnerId: partner.partner.id, serviceId: partner.service.id, eventTypeSlug: 'svatba', eventDate: EVENT,
    startTime: '17:00', endTime: '02:00', guests: 120, venueName: 'Вила Екатерина', locality: 'с. Панчарево', ...o,
  });
}

/** A fresh client and partner with an approved request (booking awaiting payment). */
export async function approvedBooking(o: { partner?: PartnerOpts; client?: Parameters<typeof createClient>[0]; request?: Partial<SendRequestInput>; p?: Partner; c?: Client } = {}) {
  const client = o.c ?? await createClient(o.client);
  const partner = o.p ?? await createPartner(o.partner);
  const { number, requestId } = await sendFor(client, partner, o.request);
  const { bookingId, paymentDueAt } = await approveRequest(partner.actor, { number });
  return { client, partner, number, requestId, bookingId, paymentDueAt };
}

/** …and paid by card through the simulated provider (K5). */
export async function paidBooking(o: Parameters<typeof approvedBooking>[0] = {}) {
  const a = await approvedBooking(o);
  const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
  const r = await applyProviderEvent({ type: 'charge.succeeded', chargeId: pay.chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242' });
  expect(r).toMatchObject({ applied: true, bookingConfirmed: true });
  return { ...a, chargeId: pay.chargeId };
}

export async function bookingRow(id: string) {
  return (await db.select().from(booking).where(eq(booking.id, id)))[0];
}
export async function requestRow(id: string) {
  return (await db.select().from(request).where(eq(request.id, id)))[0];
}

/** Outbox rows of one template (optionally to one user), oldest first. */
export async function emails(key: string, toUserId?: string) {
  const conds = [eq(emailOutbox.templateKey, key)];
  if (toUserId) conds.push(eq(emailOutbox.toUserId, toUserId));
  return db.select().from(emailOutbox).where(and(...conds)).orderBy(asc(emailOutbox.createdAt));
}

/** One user's bell items, newest first. */
export async function bell(userId: string) {
  return db.select().from(notification).where(eq(notification.userId, userId)).orderBy(desc(notification.createdAt));
}

/** Jobs whose dedupe key starts with `prefix`. */
export async function jobs(prefix: string) {
  return db.select().from(job).where(like(job.dedupeKey, `${prefix}%`)).orderBy(asc(job.dedupeKey));
}

/** Move the business clock to `at` and run every due job; no handler may fail. */
export async function tickAt(at: Date) {
  setTestNow(at);
  for (;;) {
    const r = await runDueJobs();
    expect(r.failed).toBe(0);
    if (r.ran === 0) break;
  }
}

/** Write a setting version directly (bypasses setSetting's gates, e.g. the deposit-mode email gate of D5). */
export async function forceSetting<K extends SettingKey>(key: K, value: SettingValue<K>, effectiveFrom = new Date(NOW.getTime() - 24 * H)) {
  await db.insert(platformSettings).values({ key, value: value === null ? sql`'null'::jsonb` : (value as never), effectiveFrom, createdAt: sql`clock_timestamp()` });
}

/** SPEC §7.5 invariants: every transaction balances, no negative client_funds / partner_payable. */
export async function expectLedgerHealthy() {
  expect(await checkLedgerInvariants(db)).toEqual([]);
}

/** The rejection of a promise (to assert on `code`, `name`, `message`). */
export async function failure(p: Promise<unknown>): Promise<Error & { code?: string; cause?: Error }> {
  try { await p; } catch (e) { return e as Error & { code?: string; cause?: Error }; }
  throw new Error('expected the promise to reject');
}
