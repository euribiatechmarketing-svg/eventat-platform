// Cancellation (SPEC §5 policy engine, §4.7 K7–K12).
//
// quote() is pure: the client cancel page, the admin refund preview, every
// cancellation flow and the emails use the same numbers. The policy tiers are
// ⚙ cancellation.policies (§5.2 as data); a booking uses the version in force
// when it was approved, with the policy and deposit % snapshotted on it (K1).
//
//   K7  cancelByClient()                 confirmed → cancelled (client)
//   K8  requestPartnerCancellation()     confirmed → cancellation_requested
//   K9  completePartnerCancellation()    cancellation_requested → cancelled (partner; full refund, partner 0)
//   K10 declinePartnerCancellation()     cancellation_requested → confirmed
//   K11 cancelByTeam()                   confirmed → cancelled (team; refund chosen by the team)
//   K12 cancelForNonPayment()            confirmed → cancelled (system, deposit mode T10)
//   §5.4 releaseRetained()               job `booking.release_retained` at event_date + 1: L3 of the retained amount
import { and, eq, inArray } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, cancellation, charge, dispute, partnerCancellationRequest,
  type CancellationPolicy, type CancellationReason, type CancelledBy, type RefundReason,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { addDays, daysBetween, date as fmtDate, money, moneyShort, sofiaDate, sofiaInstant, type DateStr } from '@/lib/format';
import { ForbiddenError, SYSTEM, assertCan, type Actor, type AnyActor } from './actor';
import { audit } from './audit';
import { DEFAULT_CANCELLATION_POLICIES, getSetting, type CancellationPolicies } from './settings';
import { adjustLinesForCancellation, releaseBookingFunds } from './payouts';
import { createRefunds, type RefundRow } from './refunds';
import {
  AftercareError, CANCELLATION_REASON_LABEL, POLICY_DEFINITE, POLICY_NAME, bpOf, cancelPending, ctxText, fireDateWatches, loadBookingCtx,
  low, mailClient, mailPartner, mailTeam, paidCents, payingCharge, paymentMethodText, percentOf, refundablePaidCents, routes, schedule, withTx,
  type BookingCtx,
} from './aftercare-shared';

// ── The engine (pure) ─────────────────────────────────────────────────────

export type Initiator = CancelledBy;

/** What quote() needs from a booking (all snapshotted at K1/K5, SPEC §5.1). */
export type QuoteBooking = {
  eventDate: DateStr;
  amountCents: number;
  bookingFeeCents?: number;
  /**
   * Σ succeeded charges − Σ succeeded refunds (§5.1), less refunds still pending
   * at the provider and chargebacks: what a cancellation can still give back.
   */
  paidCents: number;
  cancellationPolicy: CancellationPolicy;
  depositPercent: number;
  /** Snapshot at payment; null before payment (nothing is retained then anyway). */
  commissionBp: number | null;
};

export type CancellationQuote = {
  initiatedBy: Initiator;
  /** daysBetween(sofiaDate(cancel instant), event_date). */
  daysBefore: number;
  policy: CancellationPolicy;
  depositPercent: number;
  totalCents: number;
  paidCents: number;
  depositCents: number;
  /** The §5.2 row that applies. */
  tier: 'none' | 'deposit' | 'total';
  retainedByPolicyCents: number;
  /** Capped by what was paid (deposit schedule, §5.2). */
  retainedCents: number;
  refundCents: number;
  commissionBp: number;
  /** On the retained amount, at the booking's rate (SPEC §6, D11). */
  commissionCents: number;
  /** ‹Получавате› = retained − commission. */
  partnerAmountCents: number;
  /** A client may cancel while days_before ≥ 0 (after the event only a dispute is possible). */
  allowed: boolean;
  /** Free-cancel date of the policy (null for Строга). */
  freeCancelUntil: DateStr | null;
  labels: QuoteLabels;
};

export type QuoteLabels = {
  policyName: string;
  /** Cancel page cells ‹Платено› / ‹Връща се› / ‹Задържа се› (running-text money, as the prototype shows). */
  paid: string;
  refund: string;
  retained: string;
  /** ‹пълната сума› when everything paid comes back. */
  refundNote: string | null;
  /** ‹без удръжки› when nothing is retained. */
  retainedNote: string | null;
  /** The cancel page h-sub, defined only for the full-refund case (the other variants are new copy, §5.5). */
  headerSub: string | null;
};

type Tier = CancellationPolicies['moderate']['tiers'][number];

export function daysBefore(at: Date, eventDate: DateStr): number {
  return daysBetween(sofiaDate(at), eventDate);
}

/** The §5.2 row for `days` (boundaries inclusive, D9); after the event the last row (total). */
export function tierFor(tiers: Tier[], days: number): Tier {
  return tiers.find(t => days >= t.minDaysBefore) ?? tiers[tiers.length - 1];
}

const tiersOf = (policy: CancellationPolicy, policies: CancellationPolicies) => policies[policy].tiers;
const noneTier = (tiers: Tier[]) => tiers.find(t => t.retained === 'none') ?? null;
const depositTier = (tiers: Tier[]) => tiers.find(t => t.retained === 'deposit') ?? null;

/** Free-cancel date (§5.5): Гъвкава event − 7, Умерена event − 30, Строга none. */
export function freeCancelUntil(eventDate: DateStr, policy: CancellationPolicy, policies: CancellationPolicies = DEFAULT_CANCELLATION_POLICIES): DateStr | null {
  const t = noneTier(tiersOf(policy, policies));
  return t ? addDays(eventDate, -t.minDaysBefore) : null;
}

/** Строга: ‹остатъкът› is refundable until event − 14 (§5.5). */
export function remainderRefundUntil(eventDate: DateStr, policy: CancellationPolicy, policies: CancellationPolicies = DEFAULT_CANCELLATION_POLICIES): DateStr | null {
  const tiers = tiersOf(policy, policies);
  if (noneTier(tiers)) return null;
  const d = depositTier(tiers);
  return d ? addDays(eventDate, -d.minDaysBefore) : null;
}

/**
 * The cancellation quote (SPEC §5). Pure. `initiatedBy` per §5.3: the client
 * (K7), the team's default (K11) and non-payment (K12) follow §5.2 capped by
 * what was paid; the partner (K9) and a dispute's full refund keep nothing.
 */
export function quote(
  b: QuoteBooking, at: Date, initiatedBy: Initiator = 'client', policies: CancellationPolicies = DEFAULT_CANCELLATION_POLICIES,
): CancellationQuote {
  const total = b.amountCents + (b.bookingFeeCents ?? 0);
  const paid = Math.max(0, b.paidCents);
  const deposit = percentOf(total, b.depositPercent);
  const days = daysBefore(at, b.eventDate);
  const tier = tierFor(tiersOf(b.cancellationPolicy, policies), days);
  const byPolicy = tier.retained === 'none' ? 0 : tier.retained === 'deposit' ? deposit : total;
  const retained = initiatedBy === 'partner' || initiatedBy === 'dispute' ? 0 : Math.min(byPolicy, paid);
  return withAmounts({
    initiatedBy, daysBefore: days, policy: b.cancellationPolicy, depositPercent: b.depositPercent,
    totalCents: total, paidCents: paid, depositCents: deposit, tier: tier.retained, retainedByPolicyCents: byPolicy,
    retainedCents: retained, refundCents: paid - retained, commissionBp: b.commissionBp ?? 0, commissionCents: 0, partnerAmountCents: 0,
    allowed: initiatedBy === 'client' ? days >= 0 : true,
    freeCancelUntil: freeCancelUntil(b.eventDate, b.cancellationPolicy, policies),
    labels: { policyName: '', paid: '', refund: '', retained: '', refundNote: null, retainedNote: null, headerSub: null },
  });
}

/** The team's own refund amount (K11: 0 ≤ refund ≤ paid); retained and commission follow. */
export function withRefund(q: CancellationQuote, refundCents: number): CancellationQuote {
  if (!Number.isSafeInteger(refundCents) || refundCents < 0 || refundCents > q.paidCents) throw new AftercareError('bad_refund_amount');
  return withAmounts({ ...q, refundCents, retainedCents: q.paidCents - refundCents });
}

function withAmounts(q: CancellationQuote): CancellationQuote {
  const commission = bpOf(q.retainedCents, q.commissionBp);
  const full = q.refundCents === q.paidCents;
  return {
    ...q,
    commissionCents: commission,
    partnerAmountCents: q.retainedCents - commission,
    labels: {
      policyName: POLICY_NAME[q.policy],
      paid: moneyShort(q.paidCents),
      refund: moneyShort(q.refundCents),
      retained: moneyShort(q.retainedCents),
      refundNote: full && q.paidCents > 0 ? 'пълната сума' : null,
      retainedNote: q.retainedCents === 0 ? 'без удръжки' : null,
      headerSub: q.tier === 'none' && full && q.daysBefore >= 0
        ? `До събитието ${q.daysBefore === 1 ? 'остава 1 ден' : `остават ${q.daysBefore} дни`} — анулирането е в безплатния срок и сумата се възстановява изцяло.`
        : null,
    },
  };
}

export type PolicyStrings = {
  /** ‹Умерена› */
  name: string;
  /** ‹Умерена политика› (cancel page policy box title) */
  title: string;
  /** client/legal.html #cancel (canonical). */
  description: string;
  /** onboarding/policy.html card text. */
  onboarding: string;
  /** Bookings hero: ‹Безплатно анулиране до 15 май 2026 — 30 дни преди събитието.› (needs an event date; null for Строга). */
  freeCancelLine: string | null;
  /** Cancel page box: ‹Безплатно анулиране до {дата} — 30 дни преди събитието. След това се задържа депозитът.› */
  policyBox: string | null;
  /** Vendor widget: ‹Анулиране: умерена политика — безплатно до 30 дни преди събитието.› */
  vendorWidget: string | null;
  /** Profile check / summary: ‹Умерена · безплатно до 30 дни› */
  checkDetail: string | null;
  /** Card line: ‹Умерена — безплатно до 15 май 2026› (needs an event date). */
  shortLine: string | null;
};

/** Every policy string of §5.5, generated from the tiers (D9). Strings the prototype has no copy for are null. */
export function policyStrings(policy: CancellationPolicy, eventDate?: DateStr | null, policies: CancellationPolicies = DEFAULT_CANCELLATION_POLICIES): PolicyStrings {
  const tiers = tiersOf(policy, policies);
  const none = noneTier(tiers), dep = depositTier(tiers);
  const name = POLICY_NAME[policy];
  const free = none && eventDate ? fmtDate(addDays(eventDate, -none.minDaysBefore)) : null;
  const description = {
    flexible: `Пълно възстановяване до ${none?.minDaysBefore ?? 0} дни преди събитието`,
    moderate: `Пълно възстановяване до ${none?.minDaysBefore ?? 0} дни; после се задържа депозитът, а в последните ${dep?.minDaysBefore ?? 0} дни — цялата сума`,
    strict: `Депозитът не се връща; остатъкът се възстановява до ${dep?.minDaysBefore ?? 0} дни преди събитието`,
  }[policy];
  const onboarding = {
    flexible: `Безплатно анулиране до ${none?.minDaysBefore ?? 0} дни преди събитието. След това депозитът остава за вас, а в деня на събитието — цялата сума.`,
    moderate: `Безплатно анулиране до ${none?.minDaysBefore ?? 0} дни преди събитието. След това се задържа депозитът, а в последните ${dep?.minDaysBefore ?? 0} дни — цялата сума.`,
    strict: `Депозитът не се връща след потвърждение. Останалата сума се възстановява при анулиране до ${dep?.minDaysBefore ?? 0} дни преди събитието.`,
  }[policy];
  return {
    name, title: `${name} политика`, description, onboarding,
    freeCancelLine: none && free ? `Безплатно анулиране до ${free} — ${none.minDaysBefore} дни преди събитието.` : null,
    policyBox: none && dep && free ? `Безплатно анулиране до ${free} — ${none.minDaysBefore} дни преди събитието. След това се задържа депозитът.` : null,
    vendorWidget: none ? `Анулиране: ${low(name)} политика — безплатно до ${none.minDaysBefore} дни преди събитието.` : null,
    checkDetail: none ? `${name} · безплатно до ${none.minDaysBefore} дни` : null,
    shortLine: none && free ? `${name} — безплатно до ${free}` : null,
  };
}

/** Admin settings summary: ‹Гъвкава (до 7 дни) · Умерена (до 30 дни) · Строга (депозитът не се връща)› (D9). */
export function settingsSummary(policies: CancellationPolicies = DEFAULT_CANCELLATION_POLICIES): string {
  return (['flexible', 'moderate', 'strict'] as const).map(p => {
    const none = noneTier(tiersOf(p, policies));
    return none ? `${POLICY_NAME[p]} (до ${none.minDaysBefore} дни)` : `${POLICY_NAME[p]} (депозитът не се връща)`;
  }).join(' · ');
}

// ── Loading a booking's quote ─────────────────────────────────────────────

/** The policy table in force when the booking was approved (the snapshot of §2). */
export const policiesFor = (b: { approvedAt: Date }, q: Queryable = db) => getSetting('cancellation.policies', b.approvedAt, q);

/** quote() for a stored booking: paid from its charges and refunds, tiers as at approval. Used by the cancel page and the admin preview. */
export async function quoteBooking(bookingId: string, opts: { at?: Date; initiatedBy?: Initiator } = {}, q: Queryable = db): Promise<CancellationQuote> {
  const [b] = await q.select().from(booking).where(eq(booking.id, bookingId));
  if (!b) throw new AftercareError('not_found');
  return quote({ ...b, paidCents: await refundablePaidCents(q, b.id) }, opts.at ?? (await now()), opts.initiatedBy ?? 'client', await policiesFor(b, q));
}

const OPEN_DISPUTE = ['collecting', 'awaiting_decision'] as const;
async function hasOpenDispute(q: Queryable, bookingId: string): Promise<boolean> {
  const [d] = await q.select({ id: dispute.id }).from(dispute).where(and(eq(dispute.bookingId, bookingId), inArray(dispute.status, [...OPEN_DISPUTE]))).limit(1);
  return !!d;
}

/** Whether ‹Анулиране› shows for the client (confirmed, days_before ≥ 0, no open dispute) and why not. */
export async function clientCancelEligibility(bookingId: string, q: Queryable = db): Promise<{ allowed: boolean; reason: 'status' | 'event_passed' | 'dispute_open' | null }> {
  const [b] = await q.select().from(booking).where(eq(booking.id, bookingId));
  if (!b || b.status !== 'confirmed') return { allowed: false, reason: 'status' };
  if (daysBefore(await now(), b.eventDate) < 0) return { allowed: false, reason: 'event_passed' };
  if (await hasOpenDispute(q, b.id)) return { allowed: false, reason: 'dispute_open' };
  return { allowed: true, reason: null };
}

// ── The shared transition ─────────────────────────────────────────────────

export type CancelResult = { cancellationId: string; quote: CancellationQuote; refunds: RefundRow[] };

/**
 * → cancelled, in the caller's transaction: the stored quote, the refund (F1),
 * the payout line reduced to the retained amount, pending jobs cancelled,
 * open charges expired, the retained amount's release at event_date + 1 (§5.4,
 * D11), date watches (§4.14) and audit. Emails are the caller's.
 */
export async function cancelBookingCore(tx: Tx, ctx: BookingCtx, a: {
  actor: AnyActor; initiatedBy: CancelledBy; quote: CancellationQuote; refundReason: RefundReason;
  reason?: CancellationReason | null; reasonText?: string | null; disputeId?: string | null;
}): Promise<CancelResult> {
  const b = ctx.booking;
  const at = await now();
  const [existing] = await tx.select({ id: cancellation.id }).from(cancellation).where(eq(cancellation.bookingId, b.id));
  if (existing) throw new AftercareError('already_cancelled');
  await tx.update(booking).set({ status: 'cancelled', cancelledAt: at, cancelledBy: a.initiatedBy, updatedAt: at }).where(eq(booking.id, b.id));
  const q = a.quote;
  const [c] = await tx.insert(cancellation).values({
    bookingId: b.id, initiatedBy: a.initiatedBy, reason: a.reason ?? null, reasonText: a.reasonText ?? null,
    daysBefore: q.daysBefore, policy: q.policy, depositPercent: q.depositPercent, totalCents: q.totalCents, paidCents: q.paidCents,
    refundCents: q.refundCents, retainedCents: q.retainedCents, commissionBp: b.commissionBp, partnerAmountCents: q.partnerAmountCents,
    createdBy: 'userId' in a.actor ? a.actor.userId : null, createdAt: at,
  }).returning({ id: cancellation.id });
  const refunds = q.refundCents > 0
    ? await createRefunds(tx, { bookingId: b.id, amountCents: q.refundCents, reason: a.refundReason, actor: a.actor, cancellationId: c.id, disputeId: a.disputeId ?? null })
    : [];
  await adjustLinesForCancellation(tx, { ...b, status: 'cancelled' }, q.retainedCents);
  // Pending timers of the booking (T5–T14, T18) stop; an open checkout or transfer can no longer complete.
  await cancelPending(`booking:${b.id}:`, tx);
  const charges = await tx.select({ id: charge.id }).from(charge).where(eq(charge.bookingId, b.id));
  for (const ch of charges) await cancelPending(`charge:${ch.id}:`, tx);
  await tx.update(charge).set({ status: 'expired', updatedAt: at })
    .where(and(eq(charge.bookingId, b.id), inArray(charge.status, ['pending', 'awaiting_transfer'])));
  await tx.update(partnerCancellationRequest).set({ status: 'completed', decidedBy: 'userId' in a.actor ? a.actor.userId : null, decidedAt: at })
    .where(and(eq(partnerCancellationRequest.bookingId, b.id), eq(partnerCancellationRequest.status, 'pending')));
  if (q.retainedCents > 0) {
    await schedule('booking.release_retained', sofiaInstant(b.holdUntil), { bookingId: b.id }, `booking:${b.id}:release`, tx);
  }
  await fireDateWatches(tx, ctx);
  await audit(tx, {
    actor: a.actor, action: 'booking.cancelled', entity: 'booking', entityId: b.id,
    data: {
      number: b.number, initiatedBy: a.initiatedBy, daysBefore: q.daysBefore, paidCents: q.paidCents, refundCents: q.refundCents,
      retainedCents: q.retainedCents, commissionCents: q.commissionCents, reason: a.reason ?? null, reasonText: a.reasonText ?? null,
    },
  });
  return { cancellationId: c.id, quote: q, refunds };
}

/** Job `booking.release_retained` (§5.4): at event_date + 1 the retained amount is released to the partner (L3). Idempotent. */
export async function releaseRetained(input: { bookingId: string }, tx?: Tx): Promise<number> {
  return withTx(tx, async tx => {
    const [b] = await tx.select().from(booking).where(eq(booking.id, input.bookingId));
    if (!b || b.status !== 'cancelled') return 0;
    const [c] = await tx.select().from(cancellation).where(eq(cancellation.bookingId, b.id));
    if (!c || c.retainedCents <= 0) return 0;
    const r = await releaseBookingFunds({ bookingId: b.id, description: `L3 retained release ${b.number}` }, tx);
    return r.releasedCents;
  });
}

async function lockedCtx(tx: Tx, bookingId: string) {
  return loadBookingCtx(tx, bookingId, { lock: true });
}

/** The quote a cancellation runs on: what can still be refunded (pending refunds and chargebacks excluded), tiers as at approval. */
export async function quoteFor(tx: Tx, ctx: BookingCtx, initiatedBy: Initiator): Promise<CancellationQuote> {
  return quote({ ...ctx.booking, paidCents: await refundablePaidCents(tx, ctx.booking.id) }, await now(), initiatedBy, await policiesFor(ctx.booking, tx));
}

/** The date shown after „безплатно до“: the free-cancel date, or for Строга the date until which the remainder comes back. */
function freeUntilText(ctx: BookingCtx, policies: CancellationPolicies): string {
  const b = ctx.booking;
  const d = freeCancelUntil(b.eventDate, b.cancellationPolicy, policies) ?? remainderRefundUntil(b.eventDate, b.cancellationPolicy, policies);
  return d ? fmtDate(d) : '';
}

// ── K7: the client cancels ────────────────────────────────────────────────

/**
 * K7 ‹Анулирай резервацията› (/akaunt/rezervacii/[nomer]/anulirane): confirmed,
 * days_before ≥ 0, no open dispute. Refund per §5.2; the retained amount stays
 * held until event_date + 1. `client-cancel-confirmed`, `vendor-client-cancelled`;
 * `client-refund-sent` follows when the refund succeeds.
 */
export async function cancelByClient(actor: Actor, input: { bookingId: string; reason: CancellationReason; reasonText?: string | null }, tx?: Tx): Promise<CancelResult> {
  if (actor.role !== 'client') throw new ForbiddenError('client');
  const reasonText = input.reasonText?.trim() || null;
  if (input.reason === 'other' && !reasonText) throw new AftercareError('reason_required');
  return withTx(tx, async tx => {
    const ctx = await lockedCtx(tx, input.bookingId);
    const b = ctx.booking;
    if (b.clientId !== actor.userId) throw new ForbiddenError('own_booking');
    if (b.status !== 'confirmed') throw new AftercareError('not_cancellable');
    if (await hasOpenDispute(tx, b.id)) throw new AftercareError('dispute_open');
    const q = await quoteFor(tx, ctx, 'client');
    if (!q.allowed) throw new AftercareError('event_passed');
    const res = await cancelBookingCore(tx, ctx, { actor, initiatedBy: 'client', quote: q, refundReason: 'client_cancel', reason: input.reason, reasonText });
    const t = ctxText(ctx);
    const policies = await policiesFor(b, tx);
    const paying = await payingCharge(tx, b.id);
    await mailClient(tx, ctx, 'client-cancel-confirmed', {
      bookingNo: t.bookingNo, partnerName: t.partnerName, packageName: t.packageName, eventType: t.eventType, eventDate: t.eventDate,
      policyName: POLICY_NAME[b.cancellationPolicy], freeCancelUntil: freeUntilText(ctx, policies),
      paid: money(q.paidCents), refund: money(q.refundCents), kept: money(q.retainedCents), cardLast4: paying?.cardLast4 ?? '',
    }, `booking:${b.id}:cancel-confirmed`, routes.clientBookings());
    await mailPartner(tx, ctx, 'vendor-client-cancelled', {
      bookingNo: t.bookingNo, clientName: t.clientName, eventType: t.eventType, hosts: t.hosts, eventDate: t.eventDate, packageName: t.packageName,
      policyDefinite: POLICY_DEFINITE[b.cancellationPolicy], freeCancelUntil: freeUntilText(ctx, policies),
      reason: reasonText ?? CANCELLATION_REASON_LABEL[input.reason], partnerAmount: money(q.partnerAmountCents),
    }, `booking:${b.id}:client-cancelled`, routes.partnerCalendar());
    return res;
  });
}

// ── K8–K10: the partner asks, the team completes or declines ─────────────

/**
 * K8 ‹Анулиране› (/partner/rezervacii/[nomer]): event in the future →
 * cancellation_requested; `vendor-cancel-requested`, `team-vendor-cancel`
 * (resolve_disputes). The client keeps seeing ‹Потвърдена› until the team acts.
 */
export async function requestPartnerCancellation(actor: Actor, input: { bookingId: string }, tx?: Tx): Promise<{ requestId: string }> {
  if (actor.role !== 'partner' || !actor.partnerId) throw new ForbiddenError('partner');
  return withTx(tx, async tx => {
    const ctx = await lockedCtx(tx, input.bookingId);
    const b = ctx.booking;
    if (b.partnerId !== actor.partnerId) throw new ForbiddenError('own_booking');
    if (b.status !== 'confirmed') throw new AftercareError('not_cancellable');
    const at = await now();
    if (daysBefore(at, b.eventDate) < 0) throw new AftercareError('event_passed');
    const [r] = await tx.insert(partnerCancellationRequest).values({ bookingId: b.id, requestedBy: actor.userId, requestedAt: at })
      .returning({ id: partnerCancellationRequest.id });
    await tx.update(booking).set({ status: 'cancellation_requested', updatedAt: at }).where(eq(booking.id, b.id));
    const t = ctxText(ctx);
    await mailPartner(tx, ctx, 'vendor-cancel-requested', {
      bookingId: t.bookingNo, bookingNo: t.bookingNo, clientName: t.clientName, eventType: t.eventType, hosts: t.hosts, eventDate: t.eventDate,
      packageName: t.packageName,
    }, `pcr:${r.id}:requested`, routes.partnerBooking(b.number));
    const paid = await paidCents(tx, b.id);
    await mailTeam(tx, 'resolve_disputes', 'team-vendor-cancel', {
      bookingId: t.bookingNo, bookingNo: t.bookingNo, partnerName: t.partnerName, contactName: ctx.partner.contactName, partnerPhone: ctx.partner.phone,
      clientName: t.clientName, clientPhone: b.contactPhone, eventType: t.eventType, eventTypeDefinite: t.eventTypeDefinite, eventDate: t.eventDate,
      timeRange: t.timeRange, location: t.location, packageName: t.packageName, paid: money(paid),
      paidOn: b.paidAt ? fmtDate(sofiaDate(b.paidAt)) : '',
    }, `pcr:${r.id}:team`);
    await audit(tx, { actor, action: 'booking.cancellation_requested', entity: 'booking', entityId: b.id, data: { number: b.number, requestId: r.id } });
    return { requestId: r.id };
  });
}

async function vendorCancelledEmails(tx: Tx, ctx: BookingCtx, q: CancellationQuote, dedupe: string) {
  const t = ctxText(ctx);
  const paying = await payingCharge(tx, ctx.booking.id);
  await mailClient(tx, ctx, 'client-vendor-cancelled', {
    bookingNo: t.bookingNo, partnerName: t.partnerName, packageName: t.packageName, eventType: t.eventType, eventDate: t.eventDate,
    refund: money(q.refundCents), cardLast4: paying?.cardLast4 ?? '', paymentMethod: paymentMethodText(paying),
  }, `${dedupe}:client`, routes.similar(ctx));
  await mailPartner(tx, ctx, 'vendor-cancel-completed', {
    bookingNo: t.bookingNo, clientName: t.clientName, eventType: t.eventType, hosts: t.hosts, eventDate: t.eventDate,
    partnerAmount: money(q.partnerAmountCents),
  }, `${dedupe}:partner`, routes.partnerCalendar());
}

/**
 * K9 ‹Анулирай резервацията› on /admin/rezervacii/[nomer] for a partner's
 * request (D10, D66): full refund of everything paid, the partner receives
 * 0,00 € and commission 0; `client-vendor-cancelled`, `vendor-cancel-completed`.
 */
export async function completePartnerCancellation(actor: Actor, input: { bookingId: string }, tx?: Tx): Promise<CancelResult> {
  assertCan(actor, 'cancel_booking');
  return withTx(tx, async tx => {
    const ctx = await lockedCtx(tx, input.bookingId);
    if (ctx.booking.status !== 'cancellation_requested') throw new AftercareError('no_cancellation_request');
    // An open case holds the money; the team cancels through its decision instead (K15).
    if (await hasOpenDispute(tx, ctx.booking.id)) throw new AftercareError('dispute_open');
    const q = await quoteFor(tx, ctx, 'partner');
    const res = await cancelBookingCore(tx, ctx, { actor, initiatedBy: 'partner', quote: q, refundReason: 'partner_cancel' });
    await vendorCancelledEmails(tx, ctx, q, `booking:${ctx.booking.id}:partner-cancel`);
    return res;
  });
}

/** K10: the team declines the partner's request → confirmed again; no email in the prototype (D66). */
export async function declinePartnerCancellation(actor: Actor, input: { bookingId: string }, tx?: Tx): Promise<void> {
  assertCan(actor, 'cancel_booking');
  return withTx(tx, async tx => {
    const ctx = await lockedCtx(tx, input.bookingId);
    if (ctx.booking.status !== 'cancellation_requested') throw new AftercareError('no_cancellation_request');
    const at = await now();
    await tx.update(partnerCancellationRequest).set({ status: 'declined', decidedBy: actor.userId, decidedAt: at })
      .where(and(eq(partnerCancellationRequest.bookingId, ctx.booking.id), eq(partnerCancellationRequest.status, 'pending')));
    await tx.update(booking).set({ status: 'confirmed', updatedAt: at }).where(eq(booking.id, ctx.booking.id));
    await audit(tx, { actor, action: 'booking.cancellation_declined', entity: 'booking', entityId: ctx.booking.id, data: { number: ctx.booking.number } });
  });
}

// ── K11: the team cancels directly ────────────────────────────────────────

/**
 * K11 (D66): reason required; the refund defaults to the §5 quote as if the
 * client cancelled now and the team may change it (0 ≤ refund ≤ paid).
 * Emails as K9. A pending partner request is completed by it.
 */
export async function cancelByTeam(actor: Actor, input: { bookingId: string; reason: string; refundCents?: number }, tx?: Tx): Promise<CancelResult> {
  assertCan(actor, 'cancel_booking');
  const reason = input.reason?.trim();
  if (!reason) throw new AftercareError('reason_required');
  return withTx(tx, async tx => {
    const ctx = await lockedCtx(tx, input.bookingId);
    const b = ctx.booking;
    if (b.status !== 'confirmed' && b.status !== 'cancellation_requested') throw new AftercareError('not_cancellable');
    if (await hasOpenDispute(tx, b.id)) throw new AftercareError('dispute_open');
    let q = await quoteFor(tx, ctx, 'team');
    if (input.refundCents !== undefined) q = withRefund(q, input.refundCents);
    const res = await cancelBookingCore(tx, ctx, { actor, initiatedBy: 'team', quote: q, refundReason: 'team_cancel', reasonText: reason });
    await vendorCancelledEmails(tx, ctx, q, `booking:${b.id}:team-cancel`);
    return res;
  });
}

// ── K12: cancelled for non-payment (deposit mode) ─────────────────────────

/**
 * K12, called by lifecycle's T10 (`booking.balance_default`) when the balance
 * is still unpaid at event_date − 7: computed as a client cancellation on that
 * date, capped by what was paid (§5.4). The emails need new keys (D5), so none
 * are sent; audit only.
 */
export async function cancelForNonPayment(input: { bookingId: string }, tx?: Tx): Promise<CancelResult | null> {
  return withTx(tx, async tx => {
    const ctx = await lockedCtx(tx, input.bookingId);
    if (ctx.booking.status !== 'confirmed') return null;
    const q = await quoteFor(tx, ctx, 'non_payment');
    return cancelBookingCore(tx, ctx, { actor: SYSTEM, initiatedBy: 'non_payment', quote: q, refundReason: 'client_cancel' });
  });
}
