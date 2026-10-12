// Adversarial review of the aftercare modules: each test pins a defect found in
// review (money, guards, timers, copy) and the fix that closes it. Runs on its
// own database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM } from '@/lib/domain/actor';
import { and, asc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { booking, dispute, emailOutbox, payoutBatch, payoutLine, refund } from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { money, sofiaInstant } from '@/lib/format';
import { simulatedProvider } from '@/lib/payments/simulated';
import { bookingBalances } from '@/lib/domain/ledger';
import { schedulePaymentJobs } from '@/lib/domain/bookings';
import { getSettings } from '@/lib/domain/settings';
import { cancelByClient, cancelByTeam } from '@/lib/domain/cancellation';
import { applyChargebackEvent } from '@/lib/domain/chargebacks';
import { decide, openByClient, updateCase } from '@/lib/domain/disputes';
import { prepareBatch, releaseBatch, releaseBookingFunds } from '@/lib/domain/payouts';
import { failedRefunds, recordManualRefund, retryRefund } from '@/lib/domain/refunds';
import { runDueJobs } from '@/lib/jobs';
import { partner as partnerTable, payoutItem } from '@/db/schema';
import { createAdmin, createBookingRow, createClient, createPartner } from '../helpers/factories';
import {
  addCharge, clearJobs, confirmPayoutAccount, emails, expectLedgerHealthy, failure, paidBooking, pendingJobs, reloadBooking, runJobs,
} from '../helpers/aftercare';

const NOW = sofiaInstant('2025-08-31', 12, 0);
const H = 3600_000;
beforeEach(async () => { await clearJobs(); setTestNow(NOW); });
afterEach(() => { setTestNow(null); vi.restoreAllMocks(); });

const refundsOf = (bookingId: string) => db.select().from(refund).where(eq(refund.bookingId, bookingId)).orderBy(asc(refund.createdAt));
const live = (rs: { status: string; amountCents: number }[]) => rs.filter(r => r.status !== 'failed').reduce((s, r) => s + r.amountCents, 0);

describe('failed refunds are retried at most once', () => {
  it('a second retry or a manual refund after a retry would pay the client twice', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { booking: b } = await paidBooking();
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValueOnce({ refundRef: 'sim_re_fail_partial', status: 'failed', reason: 'card_closed' });
    await cancelByTeam(admin, { bookingId: b.id, reason: 'Тест', refundCents: 40_000 });
    await runJobs();
    const [failed] = await refundsOf(b.id);
    expect(failed).toMatchObject({ status: 'failed', amountCents: 40_000 });

    await retryRefund(admin, { refundId: failed.id });
    expect(await failure(retryRefund(admin, { refundId: failed.id }))).toContain('refund_already_retried');
    expect(await failure(recordManualRefund(admin, { refundId: failed.id, note: 'Банков превод' }))).toContain('refund_already_retried');
    await runJobs();
    expect(live(await refundsOf(b.id))).toBe(40_000);
    await expectLedgerHealthy();
  });
});

describe('chargebacks count against what was paid', () => {
  it('a client cancelling after the card network took the money back is not refunded a second time', async () => {
    const { client, booking: b, charge: ch } = await paidBooking();
    await applyChargebackEvent({ type: 'dispute.created', providerChargeRef: ch.providerRef!, amountCents: 145_000, reason: 'fraudulent' });
    const res = await cancelByClient(client.actor, { bookingId: b.id, reason: 'event_cancelled' });
    expect(res.quote).toMatchObject({ paidCents: 0, refundCents: 0 });
    await runJobs();
    expect(live(await refundsOf(b.id))).toBe(0);
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, provider_held: 0 });
    await expectLedgerHealthy();
  });
});

describe('refunds still pending count against what was paid', () => {
  it('the client can cancel while a dispute refund is still with the provider, and gets back only the rest', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b } = await paidBooking();
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'not_as_described', description: 'Три часа вместо четири.' });
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValueOnce({ refundRef: 're_async_dispute', status: 'pending' });
    await decide(admin, { disputeId: d.id, kind: 'partial_refund', refundCents: 40_000, motive: 'по-кратко изпълнение.' });
    await runJobs();
    expect((await refundsOf(b.id))[0]).toMatchObject({ status: 'pending', amountCents: 40_000 });

    const res = await cancelByClient(client.actor, { bookingId: b.id, reason: 'event_cancelled' });
    expect(res.quote).toMatchObject({ paidCents: 105_000, refundCents: 105_000, retainedCents: 0 });
    await runJobs();
    expect(live(await refundsOf(b.id))).toBe(145_000);
    await expectLedgerHealthy();
  });
});

describe('a failed dispute refund is not released to the partner', () => {
  it('the partner gets the decided share at completion; the client’s part stays held for the retry', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b } = await paidBooking({ eventDate: '2025-09-05' });
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'not_as_described', description: 'Три часа вместо четири.' });
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValueOnce({ refundRef: 're_dispute_failed', status: 'failed', reason: 'card_closed' });
    await decide(admin, { disputeId: d.id, kind: 'partial_refund', refundCents: 40_000, motive: 'по-кратко изпълнение.' });
    await runJobs();
    const [failed] = await refundsOf(b.id);
    expect(failed.status).toBe('failed');

    setTestNow(sofiaInstant('2025-09-06', 0, 1));
    const r = await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx));
    expect(r).toMatchObject({ releasedCents: 105_000, commissionCents: 10_500 });
    expect((await bookingBalances(db, b.id)).client_funds).toBe(40_000);

    await retryRefund(admin, { refundId: failed.id });
    await runJobs();
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, partner_payable: 94_500, commission_revenue: 10_500 });
    await expectLedgerHealthy();
  });
});

describe('commission is rounded once per booking (SPEC §0, §6)', () => {
  it('an early release (T18) and the final release add up to round_half_up(base × rate)', async () => {
    const { booking: b, charge: deposit } = await paidBooking({ paidCents: 43_510, commissionBp: 500 });
    await addCharge(b.id, 101_490, { kind: 'balance' });
    await db.transaction(tx => releaseBookingFunds({ bookingId: b.id, baseCents: deposit.amountCents, early: { chargeId: deposit.id } }, tx));
    setTestNow(sofiaInstant('2026-06-15', 0, 1));
    await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx));
    const bal = await bookingBalances(db, b.id);
    expect(bal).toMatchObject({ client_funds: 0, commission_revenue: 7_250, partner_payable: 137_750 });
    const lines = await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id));
    expect(lines.reduce((s, l) => s + l.commissionCents, 0)).toBe(7_250);
    await expectLedgerHealthy();
  });
});

describe('no invented copy in the payout team emails', () => {
  it('the rail comes from the batches already on record, never a made-up provider name', async () => {
    await db.insert(payoutBatch).values({ batchDate: '2025-08-15', label: 'Партида август · първа половина', railLabel: 'Обединена банка · SEPA', status: 'paid' });
    const { partner, booking: b } = await paidBooking({ eventDate: '2025-08-30' });
    await confirmPayoutAccount(partner.partner.id);
    setTestNow(sofiaInstant('2025-08-31', 9, 0));
    await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx));
    await prepareBatch('2025-09-01');
    const [ready] = await emails('team-batch-ready');
    expect(ready?.vars).toMatchObject({ bank: 'Обединена банка' });
    const [batch] = await db.select().from(payoutBatch).where(eq(payoutBatch.batchDate, '2025-09-01'));
    expect(batch.railLabel).toBe('Обединена банка · SEPA');
    // A batch seeded `scheduled` without a rail takes the one on record when it is prepared.
    await db.insert(payoutBatch).values({ batchDate: '2025-09-15', label: 'Партида септември · първа половина', status: 'scheduled' });
    await prepareBatch('2025-09-15');
    expect((await db.select().from(payoutBatch).where(eq(payoutBatch.batchDate, '2025-09-15')))[0].railLabel).toBe('Обединена банка · SEPA');
    const all = await db.select().from(emailOutbox);
    expect(all.some(m => JSON.stringify(m.vars).includes('Симулиран') || m.text.includes('Симулиран'))).toBe(false);
  });
});

describe('K16 restore_price keeps the §3 clamp', () => {
  it('the new 24 h window never runs past the event start', async () => {
    const { actor: admin } = await createAdmin('admin');
    const client = await createClient();
    const partner = await createPartner();
    const { booking: b } = await createBookingRow({
      client: client.user, partner, eventDate: '2025-09-01', status: 'awaiting_payment', approvedAt: new Date(NOW.getTime() - 20 * H),
    });
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'payment_problem', description: 'Цената е различна.' });
    await decide(admin, { disputeId: d.id, kind: 'restore_price', motive: 'одобрената цена важи.' });
    expect((await reloadBooking(b.id)).paymentDueAt).toEqual(sofiaInstant('2025-09-01', 0, 0));
  });
});

describe('K16 restore_price re-arms the payment reminders for the new deadline', () => {
  it('T5–T7 that already ran for the old deadline run again before the new one', async () => {
    const { actor: admin } = await createAdmin('admin');
    const client = await createClient();
    const partner = await createPartner();
    const approvedAt = new Date(NOW.getTime() - 20 * H);
    const { booking: b } = await createBookingRow({ client: client.user, partner, status: 'awaiting_payment', approvedAt });
    await db.update(booking).set({ amountCents: 160_000, dueNowCents: 160_000 }).where(eq(booking.id, b.id));
    // K1 at approval: T5 at −6 h / −2 h, T6 at −6 h, T7 at −4 h, T8 at the deadline (NOW + 4 h).
    await db.transaction(async t => schedulePaymentJobs(t, b, await getSettings(approvedAt, t), approvedAt));
    await runJobs();
    expect(await emails('client-payment-reminder', client.user.id)).toHaveLength(1);
    expect(await emails('vendor-payment-reminder')).toHaveLength(1);

    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'payment_problem', description: 'Цената е различна.' });
    await decide(admin, { disputeId: d.id, kind: 'restore_price', motive: 'одобрената цена важи.' });
    const due = new Date(NOW.getTime() + 24 * H);
    expect((await reloadBooking(b.id)).paymentDueAt).toEqual(due);
    const at = async (key: string) => (await pendingJobs(key))[0]?.runAt ?? null;
    expect(await at(`booking:${b.id}:payrem:6`)).toEqual(new Date(due.getTime() - 6 * H));
    expect(await at(`booking:${b.id}:payrem:2`)).toEqual(new Date(due.getTime() - 2 * H));
    expect(await at(`booking:${b.id}:vpayrem`)).toEqual(new Date(due.getTime() - 6 * H));
    expect(await at(`booking:${b.id}:teamalert`)).toEqual(new Date(due.getTime() - 4 * H));
    expect(await at(`booking:${b.id}:payexpire`)).toEqual(due);

    setTestNow(new Date(due.getTime() - 6 * H));
    await runJobs();
    const client6 = await emails('client-payment-reminder', client.user.id);
    expect(client6).toHaveLength(2);
    expect(client6[0].vars).toMatchObject({ hoursLeft: 6, amount: money(145_000) });
    expect(await emails('vendor-payment-reminder')).toHaveLength(2);
    setTestNow(new Date(due.getTime() - 2 * H));
    await runJobs();
    expect(await emails('client-payment-reminder', client.user.id)).toHaveLength(3);
  });
});

describe('X2: the team may change the position deadline', () => {
  it('moves position_due_at and the T15 timer', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b } = await paidBooking();
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'no_show', description: 'Не дойде.' });
    const later = new Date(NOW.getTime() + 72 * H);
    await updateCase(admin, { disputeId: d.id, positionDueAt: later });
    const [row] = await db.select().from(dispute).where(eq(dispute.id, d.id));
    expect(row.positionDueAt).toEqual(later);
    const [t15] = await pendingJobs(`dispute:${d.id}:position`);
    expect(t15.runAt).toEqual(later);
    expect(await failure(updateCase(admin, { disputeId: d.id, positionDueAt: new Date(NOW.getTime() - H) }))).toContain('bad_position_date');
  });
});

describe('a provider call that keeps throwing ends in F3 / Y8, never stuck', () => {
  it('refund.submit: after the last attempt the refund is failed and on the team’s list', async () => {
    const { booking: b, client } = await paidBooking();
    vi.spyOn(simulatedProvider, 'refund').mockRejectedValue(new Error('charge_disputed'));
    await cancelByClient(client.actor, { bookingId: b.id, reason: 'date_change' });
    for (let i = 0; i < 6; i++) { await runDueJobs(50); advanceTestNow(10 * 60_000); }
    const [r] = await refundsOf(b.id);
    expect(r).toMatchObject({ status: 'failed' });
    expect(r.failureReason).toContain('charge_disputed');
    expect((await failedRefunds(SYSTEM)).map(f => f.refund.id)).toContain(r.id);
    expect((await bookingBalances(db, b.id)).client_funds).toBe(145_000);
    await expectLedgerHealthy();
  });

  it('payout.submit: after the last attempt the item is failed (Y8) and the partner paused', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { partner: p, booking: b } = await paidBooking({ eventDate: '2025-09-10' });
    await confirmPayoutAccount(p.partner.id);
    setTestNow(sofiaInstant('2025-09-11', 8, 0));
    await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx));
    const { batchId } = await prepareBatch('2025-09-15');
    setTestNow(sofiaInstant('2025-09-15', 9, 0));
    vi.spyOn(simulatedProvider, 'payout').mockRejectedValue(new Error('account_closed'));
    await releaseBatch(admin, { batchId });
    for (let i = 0; i < 6; i++) { await runDueJobs(50); advanceTestNow(10 * 60_000); }
    const [item] = await db.select().from(payoutItem).where(and(eq(payoutItem.batchId, batchId), eq(payoutItem.partnerId, p.partner.id)));
    expect(item.status).toBe('failed');
    expect((await db.select().from(partnerTable).where(eq(partnerTable.id, p.partner.id)))[0].payoutsPaused).toBe(true);
    const failedMails = (await emails('team-transfer-failed')).filter(m => (m.vars as { partnerName?: string }).partnerName === p.partner.businessName);
    expect(failedMails.length).toBeGreaterThan(0);
    expect(failedMails.every(m => (m.vars as { reason?: string }).reason === 'account_closed')).toBe(true);
    await expectLedgerHealthy();
  });
});
