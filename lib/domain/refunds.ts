// Refunds (SPEC §4.9 F1–F3), ledger L2 (§7.5) and credit notes (§9 Refunds).
//
//   F1 createRefunds()      pending rows against the booking's charges, newest
//                           first, until the amount is covered; the provider call
//                           happens after commit in the `refund.submit` job
//   F2 refund.succeeded     → ledger L2, charge partially_refunded / refunded,
//                           credit note, `client-refund-sent`
//   F3 refund.failed        → audit only, no client email (D67); the team sees it
//                           in failedRefunds() and can retryRefund() or
//                           recordManualRefund() (manual bank refund)
//
// lib/payments/apply.ts (lifecycle) routes provider refund events to applyRefundEvent().
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, type Queryable, type Tx } from '@/db';
import {
  booking, charge, city, clientInvoiceProfile, invoice, invoiceLine, invoiceSequence, partner, refund, user, type RefundReason,
} from '@/db/schema';
import { now } from '@/lib/clock';
import { date as fmtDate, money, sofiaDate } from '@/lib/format';
import { assertCan, isSystem, SYSTEM, type Actor, type AnyActor } from './actor';
import { audit } from './audit';
import { accountBalance, postTransaction } from './ledger';
import { clawBackReleased, resyncPreparedBatch } from './payouts';
import {
  AftercareError, POLICY_DEFINITE, RECEIVED, chargedBackSql, ctxText, errorText, isFinalAttempt, loadBookingCtx, mailClient, paymentMethodText,
  providerFor, routes, schedule, uncoveredFailedSql, withTx, type BookingRow,
} from './aftercare-shared';

export type RefundRow = typeof refund.$inferSelect;

/** Proportional share, rounded half up: fee × part / whole. */
const proportional = (fee: number, part: number, whole: number) => (whole > 0 ? Math.floor((fee * part + Math.floor(whole / 2)) / whole) : 0);

/**
 * What can still be refunded on each received charge (amount − refunded −
 * pending refunds − what an open or lost chargeback took back), newest first.
 * `lock` takes the charge rows FOR UPDATE so concurrent refunds of the same
 * charge are serialised.
 */
export async function refundableCharges(q: Queryable, bookingId: string, chargeId?: string, opts: { lock?: boolean } = {}) {
  const base = q.select({ charge, chargedBack: sql<number>`${chargedBackSql}::int`.mapWith(Number) }).from(charge)
    .where(and(eq(charge.bookingId, bookingId), inArray(charge.status, RECEIVED), ...(chargeId ? [eq(charge.id, chargeId)] : [])))
    .orderBy(sql`${charge.succeededAt} desc nulls last`, desc(charge.createdAt));
  const charges = opts.lock ? await base.for('update', { of: charge }) : await base;
  const out: { charge: typeof charge.$inferSelect; refundable: number }[] = [];
  for (const { charge: c, chargedBack } of charges) {
    const [p] = await q.select({ s: sql<number>`coalesce(sum(${refund.amountCents}), 0)::int`.mapWith(Number) }).from(refund)
      .where(and(eq(refund.chargeId, c.id), eq(refund.status, 'pending')));
    out.push({ charge: c, refundable: Math.max(0, c.amountCents - c.refundedCents - (p?.s ?? 0) - chargedBack) });
  }
  return out;
}

/**
 * F1: refund `amountCents` against the booking's charges, newest first, with
 * the application fee refunded in proportion. Rows are `pending`; the
 * provider is called by the `refund.submit` job after the transaction commits.
 */
export async function createRefunds(tx: Tx, a: {
  bookingId: string; amountCents: number; reason: RefundReason; actor: AnyActor;
  cancellationId?: string | null; disputeId?: string | null; chargeId?: string;
}): Promise<RefundRow[]> {
  if (!Number.isSafeInteger(a.amountCents) || a.amountCents <= 0) throw new AftercareError('bad_amount');
  const charges = await refundableCharges(tx, a.bookingId, a.chargeId, { lock: true });
  if (charges.reduce((s, c) => s + c.refundable, 0) < a.amountCents) throw new AftercareError('refund_exceeds_paid');
  const at = await now();
  const out: RefundRow[] = [];
  let rem = a.amountCents;
  for (const { charge: c, refundable } of charges) {
    if (rem <= 0) break;
    const take = Math.min(rem, refundable);
    if (take <= 0) continue;
    const [r] = await tx.insert(refund).values({
      bookingId: a.bookingId, chargeId: c.id, reason: a.reason, amountCents: take,
      applicationFeeRefundCents: proportional(c.applicationFeeCents, take, c.amountCents),
      cancellationId: a.cancellationId ?? null, disputeId: a.disputeId ?? null,
      requestedBy: isSystem(a.actor) ? null : a.actor.userId, createdAt: at,
    }).returning();
    await schedule('refund.submit', at, { refundId: r.id }, `refund:${r.id}:submit`, tx);
    await audit(tx, { actor: a.actor, action: 'refund.created', entity: 'refund', entityId: r.id, data: { bookingId: a.bookingId, chargeId: c.id, amountCents: take, reason: a.reason } });
    out.push(r);
    rem -= take;
  }
  return out;
}

/**
 * Job `refund.submit`: call the charge's provider (idempotency key = refund id),
 * then apply a synchronous result. A provider call that still throws on the
 * job's last attempt records F3 (failed, on the team's list) rather than
 * leaving the refund pending for good.
 */
export async function submitRefund(refundId: string): Promise<void> {
  const [r] = await db.select().from(refund).where(eq(refund.id, refundId));
  if (!r || r.status !== 'pending' || r.providerRef) return;
  const [c] = await db.select().from(charge).where(eq(charge.id, r.chargeId));
  let res: Awaited<ReturnType<ReturnType<typeof providerFor>['refund']>>;
  try {
    res = await providerFor(c.provider).refund({
      refundId: r.id, providerChargeRef: c.providerRef ?? '', amountCents: r.amountCents, refundApplicationFee: true,
    });
  } catch (e) {
    if (!(await isFinalAttempt(`refund:${refundId}:submit`))) throw e;
    await db.transaction(tx => applyRefundFailed(tx, refundId, errorText(e)));
    return;
  }
  await db.transaction(async tx => {
    const [cur] = await tx.select().from(refund).where(eq(refund.id, refundId)).for('update');
    if (!cur || cur.status !== 'pending') return;
    await tx.update(refund).set({ providerRef: res.refundRef }).where(eq(refund.id, refundId));
    if (res.status === 'succeeded') await applyRefundSucceeded(tx, refundId);
    else if (res.status === 'failed') await applyRefundFailed(tx, refundId, res.reason ?? 'failed');
  });
}

/**
 * Provider refund events (F2 `refund.succeeded`, F3 `refund.failed`) for
 * lib/payments/apply.ts. An unknown ref returns handled: false, so the webhook
 * can answer with an error and be retried once the ref is stored.
 */
export async function applyRefundEvent(
  ev: { type: 'refund.succeeded'; refundRef: string } | { type: 'refund.failed'; refundRef: string; reason: string }, tx?: Tx,
): Promise<{ handled: boolean }> {
  return withTx(tx, async tx => {
    const [r] = await tx.select({ id: refund.id }).from(refund).where(eq(refund.providerRef, ev.refundRef)).limit(1);
    if (!r) return { handled: false };
    if (ev.type === 'refund.succeeded') await applyRefundSucceeded(tx, r.id);
    else await applyRefundFailed(tx, r.id, ev.reason);
    return { handled: true };
  });
}

/**
 * Ledger L2: Dr client_funds R · Cr provider_held R while the booking still
 * holds the money. Beyond that (after a release, SPEC §7.4) the partner's share
 * comes back from partner_payable (unpaid) then partner_receivable, and the
 * commission part is Dr commission_revenue · Cr platform_cash.
 */
export async function postRefundLedger(tx: Tx, r: { id?: string; amountCents: number; chargeId: string }, b: BookingRow, kind: 'refund' | 'adjustment' = 'refund', description?: string) {
  const held = await accountBalance(tx, 'client_funds', { bookingId: b.id });
  const fromHeld = Math.min(r.amountCents, Math.max(0, held));
  const cb = await clawBackReleased(tx, b, r.amountCents - fromHeld);
  const providerOut = fromHeld + cb.payableCents + cb.receivableCents;
  const t = await postTransaction(tx, {
    kind, bookingId: b.id, partnerId: b.partnerId, chargeId: r.chargeId, refundId: r.id ?? null,
    description: description ?? `L2 refund ${b.number}`,
    lines: [
      ...(fromHeld > 0 ? [{ account: 'client_funds' as const, debit: fromHeld }] : []),
      ...(cb.payableCents > 0 ? [{ account: 'partner_payable' as const, debit: cb.payableCents }] : []),
      ...(cb.receivableCents > 0 ? [{ account: 'partner_receivable' as const, debit: cb.receivableCents }] : []),
      ...(providerOut > 0 ? [{ account: 'provider_held' as const, credit: providerOut }] : []),
      ...(cb.commissionCents > 0 ? [
        { account: 'commission_revenue' as const, debit: cb.commissionCents },
        { account: 'platform_cash' as const, credit: cb.commissionCents },
      ] : []),
    ],
  });
  return { transactionId: t.id, fromHeld, clawback: cb };
}

/** F2: refund succeeded — L2, charge totals, credit note, `client-refund-sent`. Idempotent. */
export async function applyRefundSucceeded(tx: Tx, refundId: string): Promise<boolean> {
  const [r] = await tx.select().from(refund).where(eq(refund.id, refundId)).for('update');
  if (!r || r.status !== 'pending') return false;
  const at = await now();
  await tx.update(refund).set({ status: 'succeeded', succeededAt: at }).where(eq(refund.id, r.id));
  const [c] = await tx.select().from(charge).where(eq(charge.id, r.chargeId)).for('update');
  const refunded = c.refundedCents + r.amountCents;
  await tx.update(charge).set({ refundedCents: refunded, status: refunded >= c.amountCents ? 'refunded' : 'partially_refunded', updatedAt: at })
    .where(eq(charge.id, c.id));
  const [b] = await tx.select().from(booking).where(eq(booking.id, r.bookingId));
  await postRefundLedger(tx, r, b);
  await issueCreditNote(tx, r, b);
  await audit(tx, { actor: SYSTEM, action: 'refund.succeeded', entity: 'refund', entityId: r.id, data: { bookingId: b.id, amountCents: r.amountCents } });
  await sendRefundEmail(tx, r);
  // A pending refund kept the booking out of a prepared batch; settled, the batch shows what is paid.
  await resyncPreparedBatch(tx, b.id);
  return true;
}

/** F3: refund failed — the money stays held; team attention list + audit, no client email (D67). Idempotent. */
export async function applyRefundFailed(tx: Tx, refundId: string, reason: string): Promise<boolean> {
  const [r] = await tx.select().from(refund).where(eq(refund.id, refundId)).for('update');
  if (!r || r.status !== 'pending') return false;
  await tx.update(refund).set({ status: 'failed', failureReason: reason }).where(eq(refund.id, r.id));
  await audit(tx, { actor: SYSTEM, action: 'refund.failed', entity: 'refund', entityId: r.id, data: { bookingId: r.bookingId, amountCents: r.amountCents, reason } });
  await resyncPreparedBatch(tx, r.bookingId);
  return true;
}

/** One `client-refund-sent` per refund group (one cancellation, one dispute decision, or the single refund), once nothing in it is pending. */
async function sendRefundEmail(tx: Tx, r: RefundRow): Promise<void> {
  const groupKey = r.cancellationId ? `c:${r.cancellationId}` : r.disputeId && r.reason === 'dispute_decision' ? `d:${r.disputeId}` : `r:${r.id}`;
  const cond = r.cancellationId ? eq(refund.cancellationId, r.cancellationId)
    : r.disputeId && r.reason === 'dispute_decision' ? and(eq(refund.disputeId, r.disputeId), eq(refund.reason, 'dispute_decision'))
      : eq(refund.id, r.id);
  const group = await tx.select().from(refund).where(and(eq(refund.bookingId, r.bookingId), cond));
  if (group.some(g => g.status === 'pending')) return;
  const total = group.filter(g => g.status === 'succeeded').reduce((s, g) => s + g.amountCents, 0);
  if (total <= 0) return;
  const ctx = await loadBookingCtx(tx, r.bookingId);
  const t = ctxText(ctx);
  const [c] = await tx.select().from(charge).where(eq(charge.id, r.chargeId));
  const [paid] = await tx.select({ s: sql<number>`coalesce(sum(${charge.amountCents}), 0)::int`.mapWith(Number) }).from(charge)
    .where(and(eq(charge.bookingId, r.bookingId), inArray(charge.status, RECEIVED)));
  await mailClient(tx, ctx, 'client-refund-sent', {
    bookingNo: t.bookingNo, partnerName: t.partnerName, packageName: t.packageName, eventDate: t.eventDate,
    paid: money(paid.s), paidOn: ctx.booking.paidAt ? fmtDate(sofiaDate(ctx.booking.paidAt)) : '',
    refund: money(total), cardLast4: c.cardLast4 ?? '', paymentMethod: paymentMethodText(c),
    policyDefinite: POLICY_DEFINITE[ctx.booking.cancellationPolicy],
    // A dispute decision (partial refund, duplicate charge, cancel with full refund) is no in-period cancellation.
    ...(r.disputeId ? { decision: true, cancelled: ctx.booking.status === 'cancelled' } : {}),
  }, `refund-sent:${r.bookingId}:${groupKey}`, routes.clientBookings());
}

// ── Credit notes (SPEC §9, D41) ───────────────────────────────────────────

/** The next number of an issuer's gap-free sequence, ‹0000000412› (UPDATE … RETURNING in the caller's transaction). */
export async function nextInvoiceNumber(tx: Tx, issuerKey: string): Promise<string> {
  const [s] = await tx.insert(invoiceSequence).values({ issuerKey, lastNumber: 1 })
    .onConflictDoUpdate({ target: invoiceSequence.issuerKey, set: { lastNumber: sql`${invoiceSequence.lastNumber} + 1` } })
    .returning({ n: invoiceSequence.lastNumber });
  return String(s.n).padStart(10, '0');
}

/** A credit note in the partner's name for a succeeded refund, referencing the charge's invoice (Bulgarian practice, D41). */
export async function issueCreditNote(tx: Tx, r: RefundRow, b: BookingRow): Promise<string> {
  const [existing] = await tx.select({ id: invoice.id }).from(invoice).where(and(eq(invoice.refundId, r.id), eq(invoice.type, 'credit_note')));
  if (existing) return existing.id;
  const byCharge = await tx.select().from(invoice).where(and(eq(invoice.chargeId, r.chargeId), eq(invoice.type, 'invoice')))
    .orderBy(asc(invoice.createdAt)).limit(1);
  const [credited] = byCharge.length ? byCharge
    : await tx.select().from(invoice).where(and(eq(invoice.bookingId, b.id), eq(invoice.type, 'invoice'))).orderBy(asc(invoice.createdAt)).limit(1);
  const [p] = await tx.select().from(partner).where(eq(partner.id, b.partnerId));
  const [pc] = p.cityId ? await tx.select({ name: city.name }).from(city).where(eq(city.id, p.cityId)) : [];
  const [c] = await tx.select().from(charge).where(eq(charge.id, r.chargeId));
  let recipient: Pick<typeof invoice.$inferInsert, 'recipientType' | 'recipientName' | 'recipientCompany' | 'recipientEik' | 'recipientMol' | 'recipientAddress' | 'recipientEmail' | 'recipientPhone'>;
  if (credited) {
    recipient = {
      recipientType: credited.recipientType, recipientName: credited.recipientName, recipientCompany: credited.recipientCompany,
      recipientEik: credited.recipientEik, recipientMol: credited.recipientMol, recipientAddress: credited.recipientAddress,
      recipientEmail: credited.recipientEmail, recipientPhone: credited.recipientPhone,
    };
  } else {
    const [u] = await tx.select().from(user).where(eq(user.id, b.clientId));
    const [ip] = await tx.select().from(clientInvoiceProfile).where(eq(clientInvoiceProfile.userId, b.clientId));
    recipient = {
      recipientType: ip?.recipientType ?? 'individual', recipientName: ip?.name ?? u.name, recipientCompany: ip?.companyName ?? null,
      recipientEik: ip?.eik ?? null, recipientMol: ip?.mol ?? null, recipientAddress: ip?.address ?? null, recipientEmail: u.email, recipientPhone: u.phone,
    };
  }
  const vat = credited && credited.totalCents > 0 ? proportional(credited.vatCents, r.amountCents, credited.totalCents) : 0;
  const today = sofiaDate(await now());
  const [cn] = await tx.insert(invoice).values({
    type: 'credit_note', issuerType: 'partner', issuerKey: p.id, number: await nextInvoiceNumber(tx, p.id),
    partnerId: p.id, bookingId: b.id, chargeId: r.chargeId, refundId: r.id, creditedInvoiceId: credited?.id ?? null,
    issuerLegalName: credited?.issuerLegalName ?? p.legalName ?? p.businessName, issuerEik: credited?.issuerEik ?? p.eik,
    issuerVatNumber: credited?.issuerVatNumber ?? p.vatNumber, issuerAddress: credited?.issuerAddress ?? p.registeredAddress,
    issuerManager: credited?.issuerManager ?? p.managerName, issuerEmail: credited?.issuerEmail ?? p.notificationEmail,
    issuerCity: credited?.issuerCity ?? pc?.name ?? null,
    ...recipient,
    issuedOn: today, paidOn: today, place: credited?.place ?? pc?.name ?? '',
    subtotalCents: r.amountCents - vat, vatCents: vat, totalCents: r.amountCents,
    paymentNote: credited?.paymentNote ?? (paymentMethodText(c) || null),
  }).returning({ id: invoice.id });
  const [srcLine] = credited
    ? await tx.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, credited.id)).orderBy(asc(invoiceLine.position)).limit(1)
    : [];
  const ctx = await loadBookingCtx(tx, b.id);
  const t = ctxText(ctx);
  await tx.insert(invoiceLine).values({
    invoiceId: cn.id, position: 1,
    description: srcLine?.description ?? [b.serviceTitle, t.partnerCategory].filter(Boolean).join(' · '),
    detail: srcLine?.detail ?? [t.eventDate, t.location, `${b.guests} гости`].filter(Boolean).join(' · '),
    quantity: 1, unitPriceCents: r.amountCents, totalCents: r.amountCents, vatRateBp: srcLine?.vatRateBp ?? 0,
  });
  return cn.id;
}

// ── The team's tools for failed refunds ───────────────────────────────────

/** Failed refunds not yet covered by a later refund of the same charge, reason, cancellation and decision (admin attention list, D67). */
export async function failedRefunds(q: Queryable = db) {
  return q.select({ refund, number: booking.number }).from(refund).innerJoin(booking, eq(booking.id, refund.bookingId))
    .where(uncoveredFailedSql)
    .orderBy(desc(refund.createdAt));
}

/**
 * A failed refund the team may act on once: retried or paid by hand already
 * (a later pending or succeeded refund replaces it) → `refund_already_retried`,
 * so the client is never paid twice.
 */
async function failedRefund(tx: Tx, refundId: string): Promise<RefundRow> {
  const [r] = await tx.select().from(refund).where(eq(refund.id, refundId)).for('update');
  if (!r) throw new AftercareError('not_found');
  if (r.status !== 'failed') throw new AftercareError('refund_not_failed');
  const [open] = await tx.select({ open: uncoveredFailedSql }).from(refund).where(eq(refund.id, r.id));
  if (!open?.open) throw new AftercareError('refund_already_retried');
  return r;
}

/** Try a failed refund again through the provider (view_finance). */
export async function retryRefund(actor: Actor, input: { refundId: string }, tx?: Tx): Promise<RefundRow> {
  assertCan(actor, 'view_finance');
  return withTx(tx, async tx => {
    const r = await failedRefund(tx, input.refundId);
    const [n] = await createRefunds(tx, {
      bookingId: r.bookingId, amountCents: r.amountCents, reason: r.reason, actor, chargeId: r.chargeId,
      cancellationId: r.cancellationId, disputeId: r.disputeId,
    });
    await audit(tx, { actor, action: 'refund.retried', entity: 'refund', entityId: r.id, data: { newRefundId: n.id } });
    return n;
  });
}

/**
 * Manual bank refund path for a failed refund (view_finance): the team paid the
 * client back outside the provider's refund API; record it as a succeeded
 * refund so L2, the credit note and `client-refund-sent` follow.
 */
export async function recordManualRefund(actor: Actor, input: { refundId: string; note: string }, tx?: Tx): Promise<RefundRow> {
  assertCan(actor, 'view_finance');
  if (!input.note.trim()) throw new AftercareError('note_required');
  return withTx(tx, async tx => {
    const r = await failedRefund(tx, input.refundId);
    const [n] = await tx.insert(refund).values({
      bookingId: r.bookingId, chargeId: r.chargeId, reason: r.reason, amountCents: r.amountCents, applicationFeeRefundCents: r.applicationFeeRefundCents,
      cancellationId: r.cancellationId, disputeId: r.disputeId, requestedBy: actor.userId, providerRef: `manual:${r.id}`, createdAt: await now(),
    }).returning();
    await applyRefundSucceeded(tx, n.id);
    await audit(tx, { actor, action: 'refund.manual', entity: 'refund', entityId: n.id, data: { failedRefundId: r.id, note: input.note } });
    const [done] = await tx.select().from(refund).where(eq(refund.id, n.id));
    return done;
  });
}
