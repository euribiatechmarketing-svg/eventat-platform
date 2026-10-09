// SPEC §4.9 refunds F1–F3, ledger L2, credit notes (§9). Runs on its own database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, charge, invoice, invoiceLine, payoutLine, refund } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { money, sofiaInstant } from '@/lib/format';
import { simulatedProvider } from '@/lib/payments/simulated';
import { bookingBalances, partnerBalances, postTransaction } from '@/lib/domain/ledger';
import { cancelByClient, cancelByTeam } from '@/lib/domain/cancellation';
import { releaseBookingFunds } from '@/lib/domain/payouts';
import {
  applyRefundEvent, createRefunds, failedRefunds, nextInvoiceNumber, recordManualRefund, retryRefund,
} from '@/lib/domain/refunds';
import { SYSTEM } from '@/lib/domain/actor';
import { createAdmin } from '../helpers/factories';
import { addCharge, clearJobs, emails, expectLedgerHealthy, failure, paidBooking, runJobs } from '../helpers/aftercare';

const NOW = sofiaInstant('2025-08-31', 12, 0);
beforeEach(async () => { await clearJobs(); setTestNow(NOW); });
afterEach(() => { setTestNow(null); vi.restoreAllMocks(); });

const refundsOf = (bookingId: string) => db.select().from(refund).where(eq(refund.bookingId, bookingId)).orderBy(asc(refund.createdAt));

describe('F1 → F2', () => {
  it('refunds newest charge first with the fee in proportion, and sends one client-refund-sent for the cancellation', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b, charge: deposit } = await paidBooking({ paidCents: 43_500 });
    const balance = await addCharge(b.id, 101_500, { kind: 'balance', succeededAt: new Date(NOW.getTime() - 3600_000) });
    await cancelByTeam(admin, { bookingId: b.id, reason: 'Тест', refundCents: 120_000 });
    const rs = await refundsOf(b.id);
    expect(rs.map(r => [r.chargeId, r.amountCents, r.applicationFeeRefundCents])).toEqual([
      [balance.id, 101_500, 10_150],
      [deposit.id, 18_500, 1_850],
    ]);
    await runJobs();
    expect((await refundsOf(b.id)).every(r => r.status === 'succeeded')).toBe(true);
    const charges = await db.select().from(charge).where(eq(charge.bookingId, b.id)).orderBy(asc(charge.createdAt));
    expect(charges.map(c => [c.status, c.refundedCents])).toEqual([['partially_refunded', 18_500], ['refunded', 101_500]]);
    const sent = await emails('client-refund-sent', client.user.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].vars).toMatchObject({ refund: money(120_000), paid: money(145_000) });
    expect((await bookingBalances(db, b.id)).client_funds).toBe(25_000);
    expect(await failure(db.transaction(tx => createRefunds(tx, { bookingId: b.id, amountCents: 25_001, reason: 'team_cancel', actor: SYSTEM })))).toContain('refund_exceeds_paid');
    await expectLedgerHealthy();
  });

  it('issues a credit note that references the charge’s invoice, next in the partner’s sequence', async () => {
    const { client, partner, booking: b, charge: ch } = await paidBooking();
    const number = await db.transaction(tx => nextInvoiceNumber(tx, partner.partner.id));
    const [inv] = await db.insert(invoice).values({
      type: 'invoice', issuerKey: partner.partner.id, number, partnerId: partner.partner.id, bookingId: b.id, chargeId: ch.id,
      issuerLegalName: 'Студио Мелодия ЕООД', recipientType: 'individual', recipientName: 'Мария Димитрова', issuedOn: '2025-08-12', paidOn: '2025-08-12',
      place: 'София', subtotalCents: 145_000, vatCents: 0, totalCents: 145_000, paymentNote: 'Карта Visa •••• 4242',
    }).returning();
    await db.insert(invoiceLine).values({ invoiceId: inv.id, position: 1, description: 'Пакет „Цял ден“ · DJ и озвучаване', detail: '14 юни 2026 · Вила Екатерина', unitPriceCents: 145_000, totalCents: 145_000 });
    await cancelByClient(client.actor, { bookingId: b.id, reason: 'event_cancelled' });
    await runJobs();
    const [cn] = await db.select().from(invoice).where(and(eq(invoice.bookingId, b.id), eq(invoice.type, 'credit_note')));
    expect(cn).toMatchObject({
      number: '0000000002', creditedInvoiceId: inv.id, issuerLegalName: 'Студио Мелодия ЕООД', recipientName: 'Мария Димитрова',
      totalCents: 145_000, paymentNote: 'Карта Visa •••• 4242',
    });
    const [line] = await db.select().from(invoiceLine).where(eq(invoiceLine.invoiceId, cn.id));
    expect(line).toMatchObject({ description: 'Пакет „Цял ден“ · DJ и озвучаване', totalCents: 145_000 });
  });
});

describe('F3 and the team’s tools', () => {
  it('a failed refund keeps the money held, emails nobody, and can be retried', async () => {
    const { actor: accounting } = await createAdmin('accounting');
    const { actor: moderator } = await createAdmin('moderator');
    const { client, booking: b } = await paidBooking();
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValueOnce({ refundRef: 'sim_re_failed_1', status: 'failed', reason: 'card_closed' });
    await cancelByClient(client.actor, { bookingId: b.id, reason: 'date_change' });
    await runJobs();
    const [r] = await refundsOf(b.id);
    expect(r).toMatchObject({ status: 'failed', failureReason: 'card_closed', providerRef: 'sim_re_failed_1' });
    expect(await emails('client-refund-sent', client.user.id)).toHaveLength(0);
    expect((await bookingBalances(db, b.id)).client_funds).toBe(145_000);
    expect((await db.select().from(auditLog).where(and(eq(auditLog.action, 'refund.failed'), eq(auditLog.entityId, r.id))))).toHaveLength(1);
    expect((await failedRefunds()).map(f => f.refund.id)).toContain(r.id);

    expect(await failure(retryRefund(moderator, { refundId: r.id }))).toContain('Forbidden');
    const again = await retryRefund(accounting, { refundId: r.id });
    expect(again).toMatchObject({ status: 'pending', amountCents: 145_000 });
    await runJobs();
    expect((await refundsOf(b.id)).map(x => x.status)).toEqual(['failed', 'succeeded']);
    expect(await emails('client-refund-sent', client.user.id)).toHaveLength(1);
    expect((await failedRefunds()).map(f => f.refund.id)).not.toContain(r.id);
    expect(await failure(retryRefund(accounting, { refundId: again.id }))).toContain('refund_not_failed');
    await expectLedgerHealthy();
  });

  it('records a manual bank refund for a failed one', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b } = await paidBooking();
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValueOnce({ refundRef: 'sim_re_failed_2', status: 'failed', reason: 'expired_card' });
    await cancelByClient(client.actor, { bookingId: b.id, reason: 'date_change' });
    await runJobs();
    const [r] = await refundsOf(b.id);
    expect(await failure(recordManualRefund(admin, { refundId: r.id, note: ' ' }))).toContain('note_required');
    const manual = await recordManualRefund(admin, { refundId: r.id, note: 'Банков превод към IBAN на клиента' });
    expect(manual).toMatchObject({ status: 'succeeded', providerRef: `manual:${r.id}` });
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, provider_held: 0 });
    expect(await emails('client-refund-sent', client.user.id)).toHaveLength(1);
    await expectLedgerHealthy();
  });

  it('applies asynchronous provider results once, and ignores unknown refs', async () => {
    const { client, booking: b } = await paidBooking();
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValueOnce({ refundRef: 're_async_1', status: 'pending' });
    await cancelByClient(client.actor, { bookingId: b.id, reason: 'other_vendor' });
    await runJobs();
    expect((await refundsOf(b.id))[0]).toMatchObject({ status: 'pending', providerRef: 're_async_1' });
    await runJobs(); // the submit job is done; nothing calls the provider twice
    expect(await applyRefundEvent({ type: 'refund.succeeded', refundRef: 're_async_1' })).toEqual({ handled: true });
    expect(await applyRefundEvent({ type: 'refund.succeeded', refundRef: 're_async_1' })).toEqual({ handled: true });
    expect((await refundsOf(b.id))[0].status).toBe('succeeded');
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, provider_held: 0 });
    expect(await emails('client-refund-sent', client.user.id)).toHaveLength(1);
    expect(await applyRefundEvent({ type: 'refund.failed', refundRef: 'nope', reason: 'x' })).toEqual({ handled: false });

    const other = await paidBooking();
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValueOnce({ refundRef: 're_async_2', status: 'pending' });
    await cancelByClient(other.client.actor, { bookingId: other.booking.id, reason: 'other_vendor' });
    await runJobs();
    await applyRefundEvent({ type: 'refund.failed', refundRef: 're_async_2', reason: 'declined' });
    expect((await refundsOf(other.booking.id))[0]).toMatchObject({ status: 'failed', failureReason: 'declined' });
    await expectLedgerHealthy();
  });
});

describe('L2 after the money was released (SPEC §7.4/§7.5)', () => {
  it('takes the partner’s unpaid share first, then a receivable, with the commission part from platform cash', async () => {
    const { partner, booking: b } = await paidBooking({ eventDate: '2025-08-20' });
    await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx));
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, partner_payable: 130_500, commission_revenue: 14_500 });

    await db.transaction(tx => createRefunds(tx, { bookingId: b.id, amountCents: 30_000, reason: 'dispute_decision', actor: SYSTEM }));
    await runJobs();
    let line = (await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id)))[0];
    // The 1 September batch was prepared (T17) while the refund was pending; once it settles the batch is drawn
    // again and this partner, without a confirmed payout account, is held there (SPEC §8.3, Y4).
    expect(line).toMatchObject({ baseCents: 115_000, commissionCents: 11_500, amountCents: 103_500, status: 'held', holdReason: 'account_check' });
    expect(await bookingBalances(db, b.id)).toMatchObject({ partner_payable: 103_500, commission_revenue: 11_500, client_funds: 0 });

    // Paid out (L4), then another refund: the partner now owes it.
    await db.transaction(async tx => {
      await postTransaction(tx, { kind: 'payout', partnerId: partner.partner.id, lines: [{ account: 'partner_payable', debit: 103_500 }, { account: 'provider_held', credit: 103_500 }] });
      await tx.update(payoutLine).set({ status: 'paid', paidAt: NOW }).where(eq(payoutLine.id, line.id));
    });
    await db.transaction(tx => createRefunds(tx, { bookingId: b.id, amountCents: 20_000, reason: 'dispute_decision', actor: SYSTEM }));
    await runJobs();
    const pb = await partnerBalances(db, partner.partner.id);
    expect(pb).toMatchObject({ partner_payable: 0, partner_receivable: 18_000 });
    expect((await bookingBalances(db, b.id)).commission_revenue).toBe(9_500);
    line = (await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id)))[0];
    expect(line.status).toBe('paid');
    await expectLedgerHealthy();
  });
});

describe('§7.4 early release (T18), then a refund', () => {
  it('a refund beyond the funds still held reverses the partner’s early share and the commission', async () => {
    const { client, partner, booking: b, charge: ch } = await paidBooking();
    const early = await db.transaction(tx => releaseBookingFunds({ bookingId: b.id, baseCents: ch.amountCents, early: { chargeId: ch.id } }, tx));
    expect(early).toMatchObject({ releasedCents: 145_000, commissionCents: 14_500 });
    const lines = await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id));
    // Due in the 1 September batch T17 already prepared; the partner has no confirmed payout account, so it is held there (SPEC §8.3).
    expect(lines.find(l => l.chargeId === ch.id)).toMatchObject({ status: 'held', holdReason: 'account_check', amountCents: 130_500, batchDate: '2025-09-01' });
    expect((await partnerBalances(db, partner.partner.id)).partner_payable).toBe(130_500);

    await cancelByClient(client.actor, { bookingId: b.id, reason: 'event_cancelled' });
    await runJobs();
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, provider_held: 0, platform_cash: 0, commission_revenue: 0, partner_payable: 0 });
    expect((await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id))).every(l => l.status === 'cancelled')).toBe(true);
    await expectLedgerHealthy();
  });
});

