// Fixtures for the aftercare tests (cancellation, refunds, disputes, payouts,
// chargebacks): a booking left the way lifecycle's K5 leaves it — a succeeded
// charge, ledger L1 and the awaiting_event payout line — plus small readers.
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { expect } from 'vitest';
import { db } from '@/db';
import {
  booking, charge, emailOutbox, job, notification, payoutAccount, type BookingStatus, type CancellationPolicy,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { runDueJobs } from '@/lib/jobs';
import { checkLedgerInvariants, postTransaction } from '@/lib/domain/ledger';
import { createPayoutLine } from '@/lib/domain/payouts';
import { bpOf } from '@/lib/domain/aftercare-shared';
import { type DateStr } from '@/lib/format';
import { createBookingRow, createClient, createPartner, type PartnerOpts } from './factories';

export type Client = Awaited<ReturnType<typeof createClient>>;
export type Partner = Awaited<ReturnType<typeof createPartner>>;

/** A received charge on a booking with its L1 posting (Dr provider_held · Cr client_funds). */
export async function addCharge(bookingId: string, amountCents: number, o: {
  kind?: 'full' | 'deposit' | 'balance'; duplicate?: boolean; method?: 'card' | 'bank_transfer'; succeededAt?: Date;
} = {}) {
  const [b] = await db.select().from(booking).where(eq(booking.id, bookingId));
  const at = o.succeededAt ?? (await now());
  const [c] = await db.insert(charge).values({
    bookingId, kind: o.kind ?? 'full', method: o.method ?? 'card', provider: 'simulated',
    amountCents, applicationFeeCents: bpOf(amountCents, b.commissionBp ?? 1000), status: 'succeeded',
    cardBrand: o.method === 'bank_transfer' ? null : 'visa', cardLast4: o.method === 'bank_transfer' ? null : '4242',
    isDuplicate: o.duplicate ?? false, succeededAt: at,
  }).returning();
  await db.update(charge).set({ providerRef: `sim_pi_${c.id}` }).where(eq(charge.id, c.id));
  await db.transaction(tx => postTransaction(tx, {
    kind: 'charge', bookingId, partnerId: b.partnerId, chargeId: c.id, occurredAt: at, description: `L1 ${b.number}`,
    lines: [{ account: 'provider_held', debit: amountCents }, { account: 'client_funds', credit: amountCents }],
  }));
  return { ...c, providerRef: `sim_pi_${c.id}` };
}

/**
 * A confirmed, fully paid booking (default 2026-06-14, 1 450,00 €, Умерена 30 %,
 * commission 10 %): charge + L1 + payout line, as after K5.
 */
export async function paidBooking(o: {
  client?: Client; partner?: Partner; partnerOpts?: PartnerOpts; policy?: CancellationPolicy; depositPercent?: 20 | 30 | 40 | 50;
  eventDate?: DateStr; amountCents?: number; paidCents?: number; status?: BookingStatus; commissionBp?: number; approvedAt?: Date;
  method?: 'card' | 'bank_transfer'; line?: boolean;
} = {}) {
  const client = o.client ?? await createClient();
  const partner = o.partner ?? await createPartner({ policy: o.policy, depositPercent: o.depositPercent, ...o.partnerOpts });
  const row = await createBookingRow({ client: client.user, partner, eventDate: o.eventDate, amountCents: o.amountCents, status: o.status ?? 'confirmed', approvedAt: o.approvedAt });
  const amount = row.booking.amountCents;
  await db.update(booking).set({ commissionBp: o.commissionBp ?? 1000 }).where(eq(booking.id, row.booking.id));
  const ch = await addCharge(row.booking.id, o.paidCents ?? amount, { method: o.method, kind: o.paidCents && o.paidCents < amount ? 'deposit' : 'full', succeededAt: row.booking.paidAt ?? undefined });
  if (o.line !== false) await db.transaction(tx => createPayoutLine(row.booking.id, tx));
  const [b] = await db.select().from(booking).where(eq(booking.id, row.booking.id));
  return { client, partner, booking: b, charge: ch, number: row.number, clientEvent: row.clientEvent, request: row.request };
}

/** A confirmed payout account (‹•••• 5272› at Postbank), so payouts are not held for account_check. */
export async function confirmPayoutAccount(partnerId: string, legalName = 'Test ЕООД') {
  const [a] = await db.insert(payoutAccount).values({
    partnerId, ibanLast4: '5272', holderName: legalName, bankName: 'Postbank', status: 'confirmed', verifiedAt: await now(),
  }).returning();
  return a;
}

export async function reloadBooking(id: string) {
  const [b] = await db.select().from(booking).where(eq(booking.id, id));
  return b;
}

/** Emails queued with a template key, optionally for one user. */
export async function emails(key: string, toUserId?: string) {
  return db.select().from(emailOutbox)
    .where(and(eq(emailOutbox.templateKey, key), ...(toUserId ? [eq(emailOutbox.toUserId, toUserId)] : [])))
    .orderBy(desc(emailOutbox.createdAt));
}

export async function bells(userId: string, kind?: string) {
  return db.select().from(notification).where(and(eq(notification.userId, userId), ...(kind ? [eq(notification.kind, kind)] : [])));
}

export async function pendingJobs(prefix?: string) {
  const rows = await db.select().from(job).where(eq(job.status, 'pending'));
  return prefix ? rows.filter(r => r.dedupeKey?.startsWith(prefix)) : rows;
}

/** Forget every pending job (tests that drive time far ahead do not want other tests' timers). */
export async function clearJobs() {
  await db.update(job).set({ status: 'cancelled' }).where(inArray(job.status, ['pending']));
}

/** Run every due job; a handler that throws fails the test (runDueJobs would only retry it). */
export async function runJobs() {
  const r = await runDueJobs(500);
  if (r.failed) {
    const failed = await db.select().from(job).where(and(eq(job.status, 'pending'), sql`${job.lastError} is not null`));
    throw new Error(`job handler failed: ${failed.map(f => `${f.kind}: ${f.lastError}`).join('; ')}`);
  }
  return r;
}

/** SPEC §7.5 invariants hold, and Σ provider_held equals what the scenario says the provider holds. */
export async function expectLedgerHealthy(providerReportedCents?: number) {
  expect(await checkLedgerInvariants(db, providerReportedCents === undefined ? {} : { providerReportedCents })).toEqual([]);
}

/** The message of a rejection, including a wrapped database error. */
export async function failure(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) {
    const err = e as Error & { cause?: Error; code?: string };
    return [err.name, err.message, err.cause?.message].filter(Boolean).join(' | ');
  }
  throw new Error('expected the promise to reject');
}
