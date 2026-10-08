// Charges (SPEC §4.8) and the payment side of the booking (§7.1–7.4).
//   C1 card checkout / C2 bank transfer (startPayment)
//   C3 succeeded → K5 confirmBooking (first success) or the balance paid; ledger L1
//   C4 failed · C5 expired · C7 the deposit schedule's off-session balance (T9/T10)
//   T18 early release of a charge's partner share under a provider hold limit (§7.4)
// Provider results arrive through lib/payments/apply.ts applyProviderEvent().
// EventAT never holds client money: the provider does; the ledger mirrors it.
import { and, eq, inArray } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import { booking, charge, payoutLine } from '@/db/schema';
import { now } from '@/lib/clock';
import { addDays, date, dateShort, dateTime, money, moneyShort, sofiaDate, sofiaInstant } from '@/lib/format';
import { scheduleJob } from '@/lib/jobs';
import { simulatedProvider } from '@/lib/payments/simulated';
import { stripeProvider } from '@/lib/payments/stripe';
import type { PaymentProvider, ProviderId } from '@/lib/payments/types';
import { SYSTEM, type AnyActor } from './actor';
import { audit } from './audit';
import {
  DAY, LIFECYCLE_JOBS, LifecycleError, assertClientActor, cancelPaymentJobs, cardLabel, completionInstant, createPayoutLine, firstPayoutDay,
  hm, hostsOf, isoWeekday, jobKey, loadBooking, locationOf, mail, packageNameOf, phoneDisplay, releasableCents, releaseToPartner,
  scheduleConfirmedJobs, timeRange, withTx, type BookingWithSnapshots, type ChargeRow,
} from './bookings';
import { commissionCents, commissionRateFor, snapshotCommission, split } from './commission';
import { issueClientInvoice, sendInvoiceEmail } from './invoices';
import { postTransaction } from './ledger';
import { closeFullDate } from './requests';
import { getSettings, type Settings } from './settings';

/** The implementation behind a provider id. A charge keeps the provider it was created with (D5). */
export function providerFor(id: ProviderId): PaymentProvider {
  return id === 'stripe' ? stripeProvider : simulatedProvider;
}

const appUrl = () => (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];
const SUCCEEDED = ['succeeded', 'partially_refunded', 'refunded'] as const;
/** T10: retries after a failed balance charge. */
export const BALANCE_RETRIES = 3;

export type ChargeResult = { applied: boolean; reason?: string; bookingConfirmed?: boolean; duplicate?: boolean };

// ── What is due ──────────────────────────────────────────────────────────

type Due = { kind: 'full' | 'deposit' | 'balance'; amountCents: number; dueAt: Date | null };

/** The amount the client can pay now: the first charge while awaiting payment, or the balance (deposit schedule). */
function dueOf(bw: BookingWithSnapshots, at: Date): Due | null {
  const b = bw.booking;
  if (b.status === 'awaiting_payment') {
    if (at >= b.paymentDueAt) return null;
    return { kind: b.depositPayCents != null ? 'deposit' : 'full', amountCents: b.dueNowCents, dueAt: b.paymentDueAt };
  }
  if (b.status === 'confirmed' && b.balanceCents > 0 && !bw.charges.some(c => c.kind === 'balance' && (SUCCEEDED as readonly string[]).includes(c.status))) {
    return { kind: 'balance', amountCents: b.balanceCents, dueAt: null };
  }
  return null;
}

async function feeFor(q: Queryable, bw: BookingWithSnapshots, amountCents: number, at: Date): Promise<number> {
  const bp = bw.booking.commissionBp
    ?? (await commissionRateFor(q, { partnerId: bw.booking.partnerId, clientId: bw.booking.clientId, at })).bp;
  return commissionCents(amountCents, bp);
}

// ── C1 / C2: ‹Плати› ─────────────────────────────────────────────────────

export type StartPaymentResult =
  | { kind: 'redirect'; chargeId: string; redirectUrl: string }
  | { kind: 'bank_transfer'; chargeId: string; recipient: string; iban: string; reference: string; amountCents: number; payBy: Date | null };

/**
 * C1 (card): create a charge and the provider's hosted checkout; re-pressing
 * reuses the open checkout. C2 (‹Банков превод›): the provider's transfer
 * instructions (reference = the booking number) and `client-bank-transfer`;
 * the booking stays awaiting payment until the money arrives or T8 fires (D6).
 */
export async function startPayment(actor: AnyActor, input: { number: string; method: 'card' | 'bank_transfer' }, tx?: Tx): Promise<StartPaymentResult> {
  assertClientActor(actor);
  return withTx(tx, async t => {
    const bw = await loadBooking(t, { number: input.number }, { forUpdate: true });
    if (!bw || bw.booking.clientId !== actor.userId) throw new LifecycleError('not_found', `No booking ${input.number}`);
    const b = bw.booking;
    const at = await now();
    const due = dueOf(bw, at);
    if (!due) {
      throw b.status === 'awaiting_payment'
        ? new LifecycleError('deadline_passed', 'The payment deadline has passed')
        : new LifecycleError('invalid_state', 'Nothing is due on this booking');
    }
    const s = await getSettings(at, t);
    if (input.method === 'bank_transfer' && !s['payment.bank_transfer_enabled']) throw new LifecycleError('not_allowed', 'Bank transfer is not offered');

    const open = bw.charges.find(c => c.kind === due.kind && c.method === input.method
      && (input.method === 'card' ? c.status === 'pending' && !!c.checkoutUrl : c.status === 'awaiting_transfer'));
    if (open) return resultOf(open, s, due);

    const providerId = s['payment.provider'];
    const provider = providerFor(providerId);
    const p = bw.parties.partner;
    if (providerId === 'stripe' && (!p.providerAccountRef || !p.providerChargesEnabled)) {
      throw new LifecycleError('provider_not_ready', 'The partner cannot take payments yet');
    }
    const fee = await feeFor(t, bw, due.amountCents, at);

    if (input.method === 'card') {
      const [c] = await t.insert(charge).values({
        bookingId: b.id, kind: due.kind, method: 'card', provider: providerId, amountCents: due.amountCents, applicationFeeCents: fee,
        status: 'pending', dueAt: due.dueAt, createdAt: at, updatedAt: at,
      }).returning();
      const n = encodeURIComponent(b.number);
      const co = await provider.createCheckout({
        chargeId: c.id, amountCents: due.amountCents, applicationFeeCents: fee, partnerAccountRef: p.providerAccountRef ?? '',
        description: `${b.serviceTitle} · ${p.businessName} · ${date(b.eventDate)}`, customerEmail: bw.parties.client.email,
        saveCard: due.kind === 'deposit', successUrl: `${appUrl()}/plashtane/${n}/potvardena`, cancelUrl: `${appUrl()}/plashtane/${n}`,
      });
      const [u] = await t.update(charge).set({ providerRef: co.providerRef, checkoutUrl: co.redirectUrl }).where(eq(charge.id, c.id)).returning();
      await audit(t, { actor, action: 'charge.created', entity: 'charge', entityId: c.id, data: { number: b.number, kind: due.kind, method: 'card', amountCents: due.amountCents, provider: providerId } });
      return resultOf(u, s, due);
    }

    if (providerId !== 'simulated') {
      // The PaymentProvider interface has no bank-transfer instructions call yet (D6: the IBAN must come from the provider).
      throw new LifecycleError('provider_not_ready', 'Bank transfer instructions are not available from the payment provider');
    }
    const demo = s['demo.bank_transfer_details'];
    const [c] = await t.insert(charge).values({
      bookingId: b.id, kind: due.kind, method: 'bank_transfer', provider: providerId, amountCents: due.amountCents, applicationFeeCents: fee,
      status: 'awaiting_transfer', transferIban: demo.iban, transferReference: b.number, dueAt: due.dueAt, createdAt: at, updatedAt: at,
    }).returning();
    await mail(t, {
      key: 'client-bank-transfer', to: bw.parties.client.email, toUserId: b.clientId, dedupeKey: `charge:${c.id}:transfer`,
      vars: {
        requestId: b.number, requestNo: b.number, partnerName: p.businessName, amount: money(due.amountCents),
        recipient: demo.recipient, iban: demo.iban, payBy: due.dueAt ? dateTime(due.dueAt) : '—',
      },
    });
    await audit(t, { actor, action: 'charge.created', entity: 'charge', entityId: c.id, data: { number: b.number, kind: due.kind, method: 'bank_transfer', amountCents: due.amountCents, provider: providerId } });
    return resultOf(c, s, due);
  });
}

function resultOf(c: ChargeRow, s: Settings, due: Due): StartPaymentResult {
  if (c.method === 'card') return { kind: 'redirect', chargeId: c.id, redirectUrl: c.checkoutUrl! };
  return {
    kind: 'bank_transfer', chargeId: c.id, recipient: s['demo.bank_transfer_details'].recipient, iban: c.transferIban ?? '',
    reference: c.transferReference ?? '', amountCents: c.amountCents, payBy: due.dueAt,
  };
}

/** SCREENS names: ‹Плати 1 450 €› and the bank-transfer confirm on /plashtane/[nomer]. */
export const startCheckout = (actor: AnyActor, input: { number: string }, tx?: Tx) => startPayment(actor, { ...input, method: 'card' }, tx);
export const chooseBankTransfer = (actor: AnyActor, input: { number: string }, tx?: Tx) => startPayment(actor, { ...input, method: 'bank_transfer' }, tx);

// ── C3: succeeded ────────────────────────────────────────────────────────

export type ChargeSucceeded = { chargeId: string; providerRef?: string; customerRef?: string; paymentMethodRef?: string; cardBrand?: string; cardLast4?: string };

/**
 * C3 (idempotent: a charge that already succeeded is left alone). Ledger L1
 * for the money the provider now holds, then:
 *   - the first success on a booking awaiting payment → K5 confirmBooking;
 *   - a `balance` charge on a confirmed booking → the balance is paid (invoice, T18);
 *   - anything else (a second payment, money arriving after the booking
 *     expired or was withdrawn) → flagged `is_duplicate` for the team; it is
 *     never released to the partner and is refunded by a dispute decision (§4.8).
 */
export async function onChargeSucceeded(e: ChargeSucceeded, tx?: Tx): Promise<ChargeResult> {
  return withTx(tx, async t => {
    // Lock order everywhere: booking, then its charges (T8 and startPayment do the same).
    const [peek] = await t.select({ bookingId: charge.bookingId }).from(charge).where(eq(charge.id, e.chargeId)).limit(1);
    if (!peek) return { applied: false, reason: 'unknown_charge' };
    const bw = (await loadBooking(t, { id: peek.bookingId }, { forUpdate: true }))!;
    const [c0] = await t.select().from(charge).where(eq(charge.id, e.chargeId)).for('update');
    if ((SUCCEEDED as readonly string[]).includes(c0.status)) return { applied: false, reason: 'already_succeeded' };
    const at = await now();
    const b = bw.booking;
    const card = c0.method === 'card';
    const [c] = await t.update(charge).set({
      status: 'succeeded', succeededAt: at, providerRef: e.providerRef || c0.providerRef, customerRef: e.customerRef ?? c0.customerRef,
      paymentMethodRef: e.paymentMethodRef ?? c0.paymentMethodRef, cardBrand: card ? (e.cardBrand ?? c0.cardBrand) : null,
      cardLast4: card ? (e.cardLast4 ?? c0.cardLast4) : null, failedAt: null, failureReason: null, updatedAt: at,
    }).where(eq(charge.id, c0.id)).returning();
    // L1: Dr provider_held A · Cr client_funds A
    await postTransaction(t, {
      kind: 'charge', bookingId: b.id, partnerId: b.partnerId, chargeId: c.id, occurredAt: at, description: `Charge ${b.number} (${c.kind})`,
      lines: [{ account: 'provider_held', debit: c.amountCents }, { account: 'client_funds', credit: c.amountCents }],
    });
    await audit(t, { actor: SYSTEM, action: 'charge.succeeded', entity: 'charge', entityId: c.id, data: { number: b.number, amountCents: c.amountCents, kind: c.kind } });
    const s = await getSettings(at, t);

    const firstPayment = b.status === 'awaiting_payment' && c.kind !== 'balance'
      && !bw.charges.some(x => x.id !== c.id && (SUCCEEDED as readonly string[]).includes(x.status) && !x.isDuplicate);
    if (firstPayment) {
      await confirmBooking(t, bw, c, at, s);
      return { applied: true, bookingConfirmed: true };
    }
    const balancePaid = c.kind === 'balance' && ['confirmed', 'cancellation_requested', 'completed'].includes(b.status)
      && !bw.charges.some(x => x.id !== c.id && x.kind === 'balance' && (SUCCEEDED as readonly string[]).includes(x.status));
    if (balancePaid) {
      await t.update(charge).set({ applicationFeeCents: commissionCents(c.amountCents, b.commissionBp ?? 0) }).where(eq(charge.id, c.id));
      const inv = await issueClientInvoice(t, c.id);
      await sendInvoiceEmail(t, inv.id, `invoice:${inv.id}:issued`);
      await scheduleHoldLimit(t, c, b.eventDate, s);
      // `client-balance-charged` does not exist yet (D5); deposit mode cannot be switched on until it does.
      await audit(t, { actor: SYSTEM, action: 'booking.balance_paid', entity: 'booking', entityId: b.id, data: { number: b.number, chargeId: c.id } });
      return { applied: true };
    }
    await t.update(charge).set({ isDuplicate: true }).where(eq(charge.id, c.id));
    await audit(t, {
      actor: SYSTEM, action: 'charge.duplicate', entity: 'charge', entityId: c.id,
      data: { number: b.number, bookingStatus: b.status, amountCents: c.amountCents },
    });
    return { applied: true, duplicate: true };
  });
}

/**
 * K5: awaiting_payment → confirmed on the first succeeded charge. Commission
 * snapshot (§6), invoice in the partner's name (§9), payout line (Y1), the
 * phone rule unlocks by status (§10), T5–T8 cancelled, T9 / T11–T14 / T18
 * scheduled, R9 auto-declines and O5 lapses, `client-booking-confirmed`,
 * `client-invoice`, `vendor-booking-confirmed`.
 */
export async function confirmBooking(t: Tx, bw: BookingWithSnapshots, c: ChargeRow, at: Date, s: Settings): Promise<void> {
  const b0 = bw.booking;
  const bp = await snapshotCommission(t, b0, at);
  await t.update(charge).set({ applicationFeeCents: commissionCents(c.amountCents, bp) }).where(eq(charge.id, c.id));
  const [b] = await t.update(booking).set({ status: 'confirmed', paidAt: at, updatedAt: at }).where(eq(booking.id, b0.id)).returning();
  await createPayoutLine(t, b, bp, at);
  await cancelPaymentJobs(t, b.id);
  await scheduleConfirmedJobs(t, b, s, at);
  if (b.balanceCents > 0 && b.balanceDueDate) {
    await scheduleJob(LIFECYCLE_JOBS.balanceCharge, sofiaInstant(b.balanceDueDate, 10, 0), { bookingId: b.id }, jobKey.balanceCharge(b.id), t); // T9
  }
  await scheduleHoldLimit(t, c, b.eventDate, s);

  const inv = await issueClientInvoice(t, c.id);
  const p = bw.parties;
  const partnerAmount = split(b.amountCents, bp).partnerAmountCents;
  const free = b.freeCancelUntil ? date(b.freeCancelUntil) : '—';
  const hosts = await hostsOf(t, b.clientEventId, p.client.name);
  const weekday = WEEKDAYS[isoWeekday(b.eventDate) % 7];
  const location = locationOf(b, p.cityName);
  await mail(t, {
    key: 'client-booking-confirmed', to: p.client.email, toUserId: b.clientId, dedupeKey: `booking:${b.id}:confirmed`,
    vars: {
      bookingId: b.number, bookingNo: b.number, partnerName: p.partner.businessName, partnerCategory: p.partnerCategory,
      packageName: packageNameOf(b.serviceTitle), packageSummary: b.serviceSummary ?? p.partnerCategory,
      eventDate: date(b.eventDate), eventWeekday: weekday, eventTime: hm(b.startTime), location, guests: b.guests,
      amount: money(c.amountCents), paymentMethod: c.method === 'card' ? cardLabel(c.cardBrand, c.cardLast4) || 'Карта' : 'Банков превод',
      phone: phoneDisplay(b.contactPhone), freeCancelUntil: free,
    },
    // D54: ‹Резервацията за {14 юни} е потвърдена› / ‹{Партньор} · {Пакет}›
    bell: { title: `Резервацията за ${dateShort(b.eventDate)} е потвърдена`, body: `${p.partner.businessName} · ${b.serviceTitle}` },
  });
  await sendInvoiceEmail(t, inv.id, `invoice:${inv.id}:issued`);
  if (p.partnerUserId) {
    await mail(t, {
      key: 'vendor-booking-confirmed', to: p.partner.notificationEmail, toUserId: p.partnerUserId, dedupeKey: `booking:${b.id}:confirmed:partner`,
      vars: {
        bookingId: b.number, bookingNo: b.number, clientName: p.client.name, clientPhone: phoneDisplay(b.contactPhone),
        eventType: p.eventType.name, eventTypeDefinite: p.eventType.nameDefinite, hosts, eventDate: date(b.eventDate), eventWeekday: weekday,
        timeRange: timeRange(b.startTime, b.endTime), location, guests: b.guests, packageName: packageNameOf(b.serviceTitle),
        partnerAmount: money(partnerAmount), payoutDate: date(b.batchDate), freeCancelUntil: free,
      },
      // D54: ‹Плащане получено · {Получавате}› / ‹{Тип} · {14 юни} · {Домакини}›
      bell: { title: `Плащане получено · ${moneyShort(partnerAmount)}`, body: `${p.eventType.name} · ${dateShort(b.eventDate)} · ${hosts}` },
    });
  }
  await audit(t, {
    actor: SYSTEM, action: 'booking.confirmed', entity: 'booking', entityId: b.id,
    data: { number: b.number, chargeId: c.id, commissionBp: bp, invoice: inv.number },
  });
  await closeFullDate(t, { partnerId: b.partnerId, date: b.eventDate, exceptRequestId: b.requestId }); // R9, O5
}

/** T18 at succeeded_at + (provider_max_hold_days − 7) days, when that is before the event is over (§7.4). */
async function scheduleHoldLimit(t: Tx, c: ChargeRow, eventDate: string, s: Settings) {
  const max = s['payment.provider_max_hold_days'];
  if (max == null || !c.succeededAt) return;
  const at = new Date(c.succeededAt.getTime() + (max - 7) * DAY);
  if (at < completionInstant(eventDate)) await scheduleJob(LIFECYCLE_JOBS.holdLimit, at, { chargeId: c.id }, jobKey.holdLimit(c.id), t);
}

// ── C4 / C5: failed or expired ───────────────────────────────────────────

export type ChargeFailed = { chargeId: string; providerRef?: string; reason: string };

/** C4 (C5 when the provider reports the checkout expired). The booking stays awaiting payment. Idempotent. */
export async function onChargeFailed(e: ChargeFailed, tx?: Tx): Promise<ChargeResult> {
  return withTx(tx, async t => {
    const [c] = await t.select().from(charge).where(eq(charge.id, e.chargeId)).for('update');
    if (!c) return { applied: false, reason: 'unknown_charge' };
    if (!['pending', 'awaiting_transfer'].includes(c.status)) return { applied: false, reason: `charge is ${c.status}` };
    const at = await now();
    const expired = e.reason === 'expired';
    await t.update(charge).set({
      status: expired ? 'expired' : 'failed', failedAt: at, failureReason: e.reason, providerRef: e.providerRef ?? c.providerRef, updatedAt: at,
    }).where(eq(charge.id, c.id));
    await audit(t, { actor: SYSTEM, action: expired ? 'charge.expired' : 'charge.failed', entity: 'charge', entityId: c.id, data: { reason: e.reason, kind: c.kind } });
    return { applied: true };
  });
}

// ── T9 / T10: the balance (deposit schedule, §7.2) ───────────────────────

/**
 * One off-session attempt to charge the balance with the card saved at the
 * deposit. Success applies C3 at once; a failure (or a needed authentication)
 * schedules the next T10 retry in 24 h, up to 3 times, and then the last check
 * at 10:00 seven days before the event.
 */
async function attemptBalance(bookingId: string, attempt: number): Promise<'paid' | 'failed' | 'skipped'> {
  return db.transaction(async t => {
    const bw = await loadBooking(t, { id: bookingId }, { forUpdate: true });
    if (!bw) return 'skipped';
    const b = bw.booking;
    const at = await now();
    if (b.status !== 'confirmed' || b.balanceCents <= 0) return 'skipped';
    if (bw.charges.some(c => c.kind === 'balance' && ((SUCCEEDED as readonly string[]).includes(c.status) || c.status === 'pending'))) return 'skipped';
    const saved = bw.charges.find(c => c.kind !== 'balance' && (SUCCEEDED as readonly string[]).includes(c.status) && c.customerRef && c.paymentMethodRef);
    const s = await getSettings(at, t);
    const [c] = await t.insert(charge).values({
      bookingId: b.id, kind: 'balance', method: 'card', provider: saved?.provider ?? s['payment.provider'], amountCents: b.balanceCents,
      applicationFeeCents: commissionCents(b.balanceCents, b.commissionBp ?? 0), status: 'pending', createdAt: at, updatedAt: at,
    }).returning();
    await audit(t, { actor: SYSTEM, action: 'charge.created', entity: 'charge', entityId: c.id, data: { number: b.number, kind: 'balance', attempt } });
    const r = saved
      ? await providerFor(saved.provider).chargeOffSession({
        chargeId: c.id, amountCents: c.amountCents, applicationFeeCents: c.applicationFeeCents, partnerAccountRef: bw.parties.partner.providerAccountRef ?? '',
        description: `${b.serviceTitle} · ${bw.parties.partner.businessName} · ${date(b.eventDate)}`, customerRef: saved.customerRef!, paymentMethodRef: saved.paymentMethodRef!,
      })
      : { providerRef: '', status: 'failed' as const, reason: 'no saved card' };
    if (r.status === 'succeeded') {
      await onChargeSucceeded({ chargeId: c.id, providerRef: r.providerRef || undefined, cardBrand: saved?.cardBrand ?? undefined, cardLast4: saved?.cardLast4 ?? undefined }, t);
      return 'paid';
    }
    await onChargeFailed({ chargeId: c.id, providerRef: r.providerRef || undefined, reason: r.reason ?? r.status }, t);
    // `client-balance-failed` does not exist yet (D5).
    const finalCheck = sofiaInstant(addDays(b.eventDate, -7), 10, 0);
    const next = new Date(at.getTime() + DAY);
    if (attempt < BALANCE_RETRIES && next < finalCheck) {
      await scheduleJob(LIFECYCLE_JOBS.balanceDefault, next, { bookingId: b.id, attempt: attempt + 1 }, jobKey.balanceRetry(b.id, attempt + 1), t);
    } else {
      await scheduleJob(LIFECYCLE_JOBS.balanceDefault, finalCheck > at ? finalCheck : next, { bookingId: b.id, final: true }, `booking:${b.id}:balancedefault`, t);
    }
    return 'failed';
  });
}

/** T9: the balance is charged off-session at 10:00 on event_date − balance_due_days. */
export async function balanceChargeJob(p: Record<string, unknown>): Promise<void> {
  await attemptBalance(String(p.bookingId), 0);
}

/**
 * T10: a retry (`attempt` 1–3), or the last check (`final`) at 10:00 seven days
 * before the event. If the balance is still unpaid then, the booking is
 * cancelled for non-payment (K12, a client cancellation on that date limited
 * to what was paid, §5.4) — that cancellation belongs to the cancellation module.
 */
export async function balanceDefaultJob(p: Record<string, unknown>): Promise<void> {
  const bookingId = String(p.bookingId);
  if (!p.final) {
    await attemptBalance(bookingId, Number(p.attempt) || 1);
    return;
  }
  await db.transaction(async t => {
    const bw = await loadBooking(t, { id: bookingId });
    if (!bw || bw.booking.status !== 'confirmed' || bw.booking.balanceCents <= 0) return;
    if (bw.charges.some(c => c.kind === 'balance' && (SUCCEEDED as readonly string[]).includes(c.status))) return;
    await audit(t, { actor: SYSTEM, action: 'booking.balance_defaulted', entity: 'booking', entityId: bookingId, data: { number: bw.booking.number, balanceCents: bw.booking.balanceCents } });
  });
}

// ── T18: early release under the provider's hold limit (§7.4) ────────────

/**
 * T18: if the booking is still confirmed, the event is in the future and the
 * charge's money is still held, release that charge's partner share now
 * (ledger L3, kind early_release) as a `released_early` payout line for the
 * next batch. Idempotent per charge.
 */
export async function holdLimitJob(p: Record<string, unknown>): Promise<void> {
  await db.transaction(async t => {
    const [peek] = await t.select({ bookingId: charge.bookingId }).from(charge).where(eq(charge.id, String(p.chargeId))).limit(1);
    if (!peek) return;
    const [b] = await t.select().from(booking).where(eq(booking.id, peek.bookingId)).for('update');
    const [c] = await t.select().from(charge).where(eq(charge.id, String(p.chargeId))).for('update');
    if (!(SUCCEEDED as readonly string[]).includes(c.status) || c.isDuplicate) return;
    const at = await now();
    const today = sofiaDate(at);
    if (!b || b.status !== 'confirmed' || b.eventDate <= today) return;
    const [done] = await t.select({ id: payoutLine.id }).from(payoutLine).where(eq(payoutLine.chargeId, c.id)).limit(1);
    if (done) return;
    const base = Math.min(c.amountCents - c.refundedCents, await releasableCents(t, b.id));
    if (base <= 0) return;
    const sp = await releaseToPartner(t, { bookingId: b.id, actor: SYSTEM, amountCents: base, kind: 'early_release', chargeId: c.id, description: `T18 early release ${b.number}` });
    const s = await getSettings(at, t);
    await t.insert(payoutLine).values({
      bookingId: b.id, chargeId: c.id, partnerId: b.partnerId, batchDate: firstPayoutDay(addDays(today, 1), s['payout.days']),
      baseCents: sp.baseCents, commissionCents: sp.commissionCents, amountCents: sp.partnerAmountCents, status: 'released_early', readyAt: at, createdAt: at,
    });
  });
}

// ── Read models ──────────────────────────────────────────────────────────

export type PaymentPageView = {
  number: string; status: string; payable: boolean; kind: Due['kind'] | null; amountDueCents: number;
  amountCents: number; bookingFeeCents: number; paymentMode: string; dueNowCents: number; balanceCents: number; balanceDueDate: string | null;
  paymentDueAt: Date; eventDate: string; serviceTitle: string;
  partner: { slug: string; name: string; category: string; cityName: string | null };
  policy: { policy: string; depositPercent: number; freeCancelUntil: string | null };
  bankTransferEnabled: boolean;
  openTransfer: { chargeId: string; recipient: string; iban: string; reference: string; amountCents: number } | null;
  /** The latest attempt failed (the page shows the failure; new copy). */
  lastAttemptFailed: boolean;
};

/** /plashtane/[nomer]: the client's own booking with what is due now. */
export async function getPaymentPage(actor: AnyActor, number: string, q: Queryable = db): Promise<PaymentPageView> {
  assertClientActor(actor);
  const bw = await loadBooking(q, { number });
  if (!bw || bw.booking.clientId !== actor.userId) throw new LifecycleError('not_found', `No booking ${number}`);
  const at = await now();
  const s = await getSettings(at, q);
  const b = bw.booking;
  const due = dueOf(bw, at);
  const transfer = due ? bw.charges.find(c => c.kind === due.kind && c.status === 'awaiting_transfer') : undefined;
  const latest = bw.charges[0];
  return {
    number: b.number, status: b.status, payable: !!due, kind: due?.kind ?? null, amountDueCents: due?.amountCents ?? 0,
    amountCents: b.amountCents, bookingFeeCents: b.bookingFeeCents, paymentMode: b.paymentMode, dueNowCents: b.dueNowCents,
    balanceCents: b.balanceCents, balanceDueDate: b.balanceDueDate, paymentDueAt: b.paymentDueAt, eventDate: b.eventDate, serviceTitle: b.serviceTitle,
    partner: { slug: bw.parties.partner.slug, name: bw.parties.partner.businessName, category: bw.parties.partnerCategory, cityName: bw.parties.cityName },
    policy: { policy: b.cancellationPolicy, depositPercent: b.depositPercent, freeCancelUntil: b.freeCancelUntil },
    bankTransferEnabled: s['payment.bank_transfer_enabled'],
    openTransfer: transfer ? {
      chargeId: transfer.id, recipient: s['demo.bank_transfer_details'].recipient, iban: transfer.transferIban ?? '',
      reference: transfer.transferReference ?? b.number, amountCents: transfer.amountCents,
    } : null,
    lastAttemptFailed: !!latest && latest.status === 'failed' && !!due,
  };
}

export type TestCheckoutView = {
  chargeId: string; number: string; amountCents: number; method: 'card' | 'bank_transfer'; status: ChargeRow['status'];
  description: string; partnerName: string; bookingStatus: string;
};

/**
 * The simulated provider's checkout (/plashtane/test/[chargeId]): only while ⚙
 * payment.provider is `simulated`, only for a simulated charge, only for the
 * client who owns it. Returns null otherwise (the page answers 404).
 */
export async function getTestCheckout(actor: AnyActor, chargeId: string, q: Queryable = db): Promise<TestCheckoutView | null> {
  assertClientActor(actor);
  if (!/^[0-9a-f-]{36}$/i.test(chargeId)) return null;
  if ((await getSettings(await now(), q))['payment.provider'] !== 'simulated') return null;
  const [c] = await q.select().from(charge).where(eq(charge.id, chargeId)).limit(1);
  if (!c || c.provider !== 'simulated') return null;
  const bw = await loadBooking(q, { id: c.bookingId });
  if (!bw || bw.booking.clientId !== actor.userId) return null;
  const b = bw.booking;
  return {
    chargeId: c.id, number: b.number, amountCents: c.amountCents, method: c.method, status: c.status,
    description: `${b.serviceTitle} · ${date(b.eventDate)}`, partnerName: bw.parties.partner.businessName, bookingStatus: b.status,
  };
}

/** Charges of a booking that are still open (pending checkout or awaiting transfer). */
export async function openCharges(q: Queryable, bookingId: string) {
  return q.select().from(charge).where(and(eq(charge.bookingId, bookingId), inArray(charge.status, ['pending', 'awaiting_transfer'])));
}
