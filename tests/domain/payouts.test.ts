// SPEC §4.10 / §8 payouts: lines, T17 preparation, release (Y5), provider results (Y6–Y8),
// holds, netting (L6), KPIs, partner earnings, reports. Runs on its own database.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { ledgerTransaction, partner as partnerT, payoutBatch, payoutItem, payoutLine } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { date, money, sofiaInstant } from '@/lib/format';
import { simulatedProvider } from '@/lib/payments/simulated';
import { SYSTEM } from '@/lib/domain/actor';
import { bookingBalances, partnerBalances, postTransaction } from '@/lib/domain/ledger';
import { setSetting } from '@/lib/domain/settings';
import {
  accountingCsv, applyPayoutEvent, batchDateFor, batchDetail, batchLabel, batchName, batchReportCsv, ensurePayoutSchedule, listBatches,
  nextBatchPreview, partnerEarnings, payoutDayOnOrAfter, payoutKpis, prepareBatch, releaseBatch, releaseBookingFunds, reportCsv,
  requestAccountingReport, requestBatchReport, submitPayoutItem,
} from '@/lib/domain/payouts';
import { openByClient, decide } from '@/lib/domain/disputes';
import { createAdmin, createPartner } from '../helpers/factories';
import {
  clearJobs, confirmPayoutAccount, emails, expectLedgerHealthy, failure, paidBooking, pendingJobs, runJobs, type Partner,
} from '../helpers/aftercare';

beforeEach(async () => { await clearJobs(); });
afterEach(() => { setTestNow(null); vi.restoreAllMocks(); });

const t = (d: string, hh = 12, mm = 0) => sofiaInstant(d, hh, mm);
const release = (bookingId: string) => db.transaction(tx => releaseBookingFunds({ bookingId }, tx));
const batchOn = async (d: string) => (await db.select().from(payoutBatch).where(eq(payoutBatch.batchDate, d)))[0];
const itemsOf = (batchId: string) => db.select().from(payoutItem).where(eq(payoutItem.batchId, batchId));
const itemFor = async (batchId: string, partnerId: string) =>
  (await db.select().from(payoutItem).where(and(eq(payoutItem.batchId, batchId), eq(payoutItem.partnerId, partnerId))))[0];
const linesOf = (bookingId: string) => db.select().from(payoutLine).where(eq(payoutLine.bookingId, bookingId));

async function payablePartner(opts: Parameters<typeof createPartner>[0] = {}): Promise<Partner> {
  const p = await createPartner(opts);
  await confirmPayoutAccount(p.partner.id, p.partner.legalName ?? undefined);
  return p;
}

describe('batch dates and labels (SPEC §8)', () => {
  it('first 1st/15th on or after the hold date; half-month labels', async () => {
    expect(payoutDayOnOrAfter('2026-06-15')).toBe('2026-06-15'); // event 14.06.2026
    expect(payoutDayOnOrAfter('2026-07-01')).toBe('2026-07-01'); // event 30.06.2026
    expect(payoutDayOnOrAfter('2025-09-01')).toBe('2025-09-01'); // event 31.08.2025
    expect(payoutDayOnOrAfter('2025-12-16')).toBe('2026-01-01');
    expect(payoutDayOnOrAfter('2025-08-02', [1, 10, 20])).toBe('2025-08-10');
    expect(await batchDateFor('2026-06-15')).toBe('2026-06-15');
    expect(batchLabel('2025-08-15')).toBe('Партида август · първа половина');
    expect(batchLabel('2025-08-01')).toBe('Партида юли · втора половина');
    expect(batchLabel('2026-01-01')).toBe('Партида декември · втора половина');
    expect(batchName('2025-08-15')).toBe('август · първа половина');
  });
});

describe('T17 → Y5 → Y6 → Y7', () => {
  it('prepares one item per partner, releases on the batch date, pays per item and emails per line', async () => {
    setTestNow(t('2025-09-08'));
    const { actor: admin } = await createAdmin('admin');
    const { actor: accounting, user: accUser } = await createAdmin('accounting');
    const p1 = await payablePartner(), p2 = await payablePartner();
    const a = await paidBooking({ partner: p1, eventDate: '2025-09-10' });
    const b = await paidBooking({ partner: p1, eventDate: '2025-09-12', amountCents: 64_000 });
    const c = await paidBooking({ partner: p2, eventDate: '2025-09-13', amountCents: 56_000 });
    expect(a.booking.batchDate).toBe('2025-09-15');
    expect(await pendingJobs('batch:2025-09-15')).toHaveLength(1);
    expect((await linesOf(a.booking.id))[0]).toMatchObject({ status: 'awaiting_event', amountCents: 130_500, batchDate: '2025-09-15' });

    // T13 (lifecycle) releases each booking after its event.
    setTestNow(t('2025-09-14', 8));
    for (const x of [a, b, c]) expect((await release(x.booking.id)).releasedCents).toBe(x.booking.amountCents);
    expect((await linesOf(a.booking.id))[0]).toMatchObject({ status: 'ready', amountCents: 130_500 });

    setTestNow(t('2025-09-14', 9, 1));
    await runJobs();
    const batch = await batchOn('2025-09-15');
    expect(batch).toMatchObject({ status: 'ready', label: 'Партида септември · първа половина', partnerCount: 2, grossCents: 265_000, commissionCents: 26_500, netCents: 238_500, heldCents: 0 });
    expect((await itemFor(batch.id, p1.partner.id)).amountCents).toBe(188_100);
    expect((await itemFor(batch.id, p2.partner.id)).amountCents).toBe(50_400);
    const [ready] = await emails('team-batch-ready', accUser.id);
    expect(ready.vars).toMatchObject({ batchDate: date('2025-09-15'), partnerCount: 2, total: money(238_500) });
    expect(await pendingJobs('batch:2025-10-01')).toHaveLength(1);
    expect(await prepareBatch('2025-09-15')).toMatchObject({ prepared: false });

    expect(await failure(releaseBatch(admin, { batchId: batch.id }))).toContain('batch_too_early');
    setTestNow(t('2025-09-15', 8));
    expect(await failure(releaseBatch(accounting, { batchId: batch.id }))).toContain('Forbidden');
    expect(await releaseBatch(admin, { batchId: batch.id })).toEqual({ status: 'released', sentItems: 2, paidItems: 0 });
    expect((await batchOn('2025-09-15')).status).toBe('released');
    expect((await linesOf(a.booking.id))[0].status).toBe('in_batch');
    expect(await failure(releaseBatch(admin, { batchId: batch.id }))).toContain('batch_not_ready');

    await runJobs();
    expect(await batchOn('2025-09-15')).toMatchObject({ status: 'paid' });
    const i1 = await itemFor(batch.id, p1.partner.id);
    expect(i1).toMatchObject({ status: 'paid', amountCents: 188_100 });
    expect((await linesOf(b.booking.id))[0].status).toBe('paid');
    expect(await partnerBalances(db, p1.partner.id)).toMatchObject({ partner_payable: 0 });
    expect(await partnerBalances(db, p2.partner.id)).toMatchObject({ partner_payable: 0 });
    const sent = await emails('vendor-payout-sent', p1.user.id);
    expect(sent).toHaveLength(2);
    expect(sent.map(s => s.vars)).toContainEqual(expect.objectContaining({ amount: money(57_600), account: 'BG•• •••• •••• 5272', bankName: 'Postbank' }));
    expect(await emails('vendor-payout-sent', p2.user.id)).toHaveLength(1);
    const [paidMail] = await emails('team-batch-paid', accUser.id);
    expect(paidMail.vars).toMatchObject({ batchName: 'септември · първа половина', partnerCount: 2, total: money(238_500), nextBatchDate: date('2025-10-01') });
    const l4 = await db.select().from(ledgerTransaction).where(and(eq(ledgerTransaction.kind, 'payout'), eq(ledgerTransaction.payoutItemId, i1.id)));
    expect(l4).toHaveLength(1);

    // Idempotent provider results.
    await applyPayoutEvent({ type: 'payout.paid', payoutRef: i1.providerPayoutRef! });
    expect(await db.select().from(ledgerTransaction).where(and(eq(ledgerTransaction.kind, 'payout'), eq(ledgerTransaction.payoutItemId, i1.id)))).toHaveLength(1);
    expect(await emails('vendor-payout-sent', p1.user.id)).toHaveLength(2);
    expect(await applyPayoutEvent({ type: 'payout.paid', payoutRef: 'nope' })).toEqual({ handled: false });
    const payout = vi.spyOn(simulatedProvider, 'payout');
    await submitPayoutItem(i1.id); // the job ran already: the provider is not called again
    expect(payout).not.toHaveBeenCalled();

    const earn = await partnerEarnings(p1.partner.id);
    expect(earn.paidYear).toEqual({ year: 2025, cents: 188_100, count: 2, averageCents: 94_100 });
    expect(earn.toBePaidCents).toBe(0);
    expect(earn.month.bars).toHaveLength(5);
    expect(earn.month).toMatchObject({ month: '2025-09', cents: 0, prevCents: 188_100, deltaPct: -100 });

    const csv = await batchReportCsv(batch.id);
    expect(csv.startsWith('﻿Партида;Дата на партидата;Изпълнител')).toBe(true);
    expect(csv.trim().split('\r\n')).toHaveLength(4);
    expect(csv).toContain('1305,00');
    expect(await failure(requestBatchReport(p1.actor as never, { batchId: batch.id }))).toContain('Forbidden');
    const { reportId } = await requestBatchReport(accounting, { batchId: batch.id });
    expect((await emails('team-batch-report', accUser.id))[0].vars).toMatchObject({ batchName: 'септември · първа половина', partnerCount: 2, total: money(238_500) });
    expect((await reportCsv(accounting, reportId)).filename).toBe('partida-2025-09-15.csv');
    const acc = await requestAccountingReport(accounting, { from: '2025-09-14', to: '2025-09-15' });
    const ledgerCsv = (await reportCsv(accounting, acc.reportId)).csv;
    expect(ledgerCsv).toContain(';payout;');
    expect(ledgerCsv).toContain(';release;');
    expect((await accountingCsv({ from: '2025-09-14', to: '2025-09-15' }))).toBe(ledgerCsv);
    expect((await batchDetail(batch.id)).items.flatMap(i => i.lines)).toHaveLength(3);
    expect((await listBatches()).map(x => x.batchDate)).toContain('2025-09-15');
    await expectLedgerHealthy();
  });
});

describe('batch history', () => {
  it('leaves out a payout day with nothing to pay or hold (T17 prepares it, nobody is in it)', async () => {
    setTestNow(t('2020-01-14', 9));
    const { prepared } = await prepareBatch('2020-01-15');
    expect(prepared).toBe(true);
    const empty = await batchOn('2020-01-15');
    expect(empty.status).toBe('ready');
    expect(await itemsOf(empty.id)).toHaveLength(0);
    expect((await listBatches({ limit: 1000 })).map(x => x.batchDate)).not.toContain('2020-01-15');
  });
});

describe('holds (SPEC §8.3, Y4)', () => {
  it('holds partners without a confirmed account, paused or disabled at the provider, and disputed bookings', async () => {
    setTestNow(t('2025-09-28'));
    const { actor: admin } = await createAdmin('admin');
    const noAccount = await createPartner();
    const paused = await payablePartner();
    await db.update(partnerT).set({ payoutsPaused: true }).where(eq(partnerT.id, paused.partner.id));
    const disabled = await payablePartner();
    await db.update(partnerT).set({ providerPayoutsEnabled: false }).where(eq(partnerT.id, disabled.partner.id));
    const mixed = await payablePartner();
    const bNo = await paidBooking({ partner: noAccount, eventDate: '2025-09-20' });
    const bPaused = await paidBooking({ partner: paused, eventDate: '2025-09-20' });
    const bDisabled = await paidBooking({ partner: disabled, eventDate: '2025-09-20' });
    const bOk = await paidBooking({ partner: mixed, eventDate: '2025-09-21' });
    const bDisputed = await paidBooking({ partner: mixed, eventDate: '2025-09-22', amountCents: 56_000 });
    const d = await openByClient(bDisputed.client.actor, { bookingId: bDisputed.booking.id, reason: 'not_as_described', description: 'x' });
    for (const x of [bNo, bPaused, bDisabled, bOk, bDisputed]) await release(x.booking.id);
    expect((await linesOf(bDisputed.booking.id))[0]).toMatchObject({ status: 'held', holdReason: 'dispute' });

    const { batchId } = await prepareBatch('2025-10-01');
    const batch = await batchOn('2025-10-01');
    expect(batch).toMatchObject({ partnerCount: 1, netCents: 130_500, heldCents: 130_500 * 3 + 50_400 });
    expect(await itemFor(batchId, noAccount.partner.id)).toMatchObject({ status: 'held', holdReason: 'account_check' });
    expect(await itemFor(batchId, paused.partner.id)).toMatchObject({ status: 'held', holdReason: 'account_check' });
    expect(await itemFor(batchId, disabled.partner.id)).toMatchObject({ status: 'held', holdReason: 'provider_disabled' });
    expect(await itemFor(batchId, mixed.partner.id)).toMatchObject({ status: 'ready', amountCents: 130_500 });
    const readyMails = await emails('team-batch-ready');
    expect(readyMails.find(m => (m.vars as { batchDate: string }).batchDate === date('2025-10-01'))?.vars)
      .toMatchObject({ held: { partnerName: mixed.partner.businessName, amount: money(50_400) } });

    // The account is confirmed before the release: the partner joins the release.
    await confirmPayoutAccount(noAccount.partner.id);
    setTestNow(t('2025-10-01', 9));
    await releaseBatch(admin, { batchId });
    await runJobs();
    expect(await itemFor(batchId, noAccount.partner.id)).toMatchObject({ status: 'paid', amountCents: 130_500 });
    expect(await itemFor(batchId, paused.partner.id)).toMatchObject({ status: 'held' });
    expect((await batchOn('2025-10-01')).status).toBe('paid');

    // The dispute ends: the line joins the next batch.
    await decide(admin, { disputeId: d.id, kind: 'no_refund', motive: 'x' });
    expect((await linesOf(bDisputed.booking.id))[0]).toMatchObject({ status: 'ready', batchDate: '2025-10-01', payoutItemId: null });
    const next = await prepareBatch('2025-10-15');
    expect(await itemFor(next.batchId, mixed.partner.id)).toMatchObject({ status: 'ready', amountCents: 50_400 });
    // The held items moved too; the paused partner is still held.
    expect(await itemFor(next.batchId, paused.partner.id)).toMatchObject({ status: 'held' });
    expect((await linesOf(bPaused.booking.id))[0]).toMatchObject({ status: 'held', holdReason: 'account_check' });
    await expectLedgerHealthy();
  });

  it('two-person release (D40): a second, different admin confirms', async () => {
    setTestNow(t('2025-10-10'));
    const { actor: a1 } = await createAdmin('admin');
    const { actor: a2 } = await createAdmin('admin');
    await setSetting('payout.require_second_admin', true, SYSTEM);
    const p = await payablePartner();
    const bk = await paidBooking({ partner: p, eventDate: '2025-10-25' });
    setTestNow(t('2025-10-30'));
    await release(bk.booking.id);
    const { batchId } = await prepareBatch('2025-11-01');
    setTestNow(t('2025-11-01', 9));
    expect(await releaseBatch(a1, { batchId })).toMatchObject({ status: 'awaiting_second_approval' });
    expect((await batchOn('2025-11-01')).status).toBe('ready');
    expect(await failure(releaseBatch(a1, { batchId }))).toContain('second_admin_required');
    expect(await releaseBatch(a2, { batchId })).toMatchObject({ status: 'released', sentItems: 1 });
    expect(await batchOn('2025-11-01')).toMatchObject({ releasedBy: a1.userId, secondApprover: a2.userId });
    await runJobs();
    expect((await batchOn('2025-11-01')).status).toBe('paid');
    await setSetting('payout.require_second_admin', false, SYSTEM);
  });
});

describe('Y8 failures and L6 netting', () => {
  it('a failed transfer pauses the partner, returns the lines, emails the team; a bank return reverses L4', async () => {
    setTestNow(t('2025-11-05'));
    const { actor: admin } = await createAdmin('admin');
    const { user: acc } = await createAdmin('accounting');
    const p = await payablePartner();
    const bk = await paidBooking({ partner: p, eventDate: '2025-11-10' });
    setTestNow(t('2025-11-11'));
    await release(bk.booking.id);
    const { batchId } = await prepareBatch('2025-11-15');
    setTestNow(t('2025-11-15', 9));
    await releaseBatch(admin, { batchId });
    vi.spyOn(simulatedProvider, 'payout').mockResolvedValueOnce({ payoutRef: 'po_fail_1', status: 'failed', reason: 'Сметката е закрита' });
    await runJobs();
    expect(await itemFor(batchId, p.partner.id)).toMatchObject({ status: 'failed', failureReason: 'Сметката е закрита', providerPayoutRef: 'po_fail_1' });
    expect((await batchOn('2025-11-15')).status).toBe('partially_failed');
    expect((await db.select().from(partnerT).where(eq(partnerT.id, p.partner.id)))[0].payoutsPaused).toBe(true);
    expect((await linesOf(bk.booking.id))[0]).toMatchObject({ status: 'ready', payoutItemId: null });
    expect((await partnerBalances(db, p.partner.id)).partner_payable).toBe(130_500);
    expect((await emails('team-transfer-failed', acc.id))[0].vars).toMatchObject({ amount: money(130_500), ibanLast4: '5272', reason: 'Сметката е закрита' });

    const held = await prepareBatch('2025-12-01');
    expect(await itemFor(held.batchId, p.partner.id)).toMatchObject({ status: 'held', holdReason: 'returned' });

    // A new account is confirmed (catalogue B2 unpauses); pending at the provider, then paid, then returned by the bank.
    await db.update(partnerT).set({ payoutsPaused: false }).where(eq(partnerT.id, p.partner.id));
    const next = await prepareBatch('2025-12-15');
    setTestNow(t('2025-12-15', 9));
    await releaseBatch(admin, { batchId: next.batchId });
    vi.spyOn(simulatedProvider, 'payout').mockResolvedValueOnce({ payoutRef: 'po_async_1', status: 'pending' });
    await runJobs();
    expect(await itemFor(next.batchId, p.partner.id)).toMatchObject({ status: 'sent', providerPayoutRef: 'po_async_1' });
    expect((await batchOn('2025-12-15')).status).toBe('released');
    expect(await applyPayoutEvent({ type: 'payout.paid', payoutRef: 'po_async_1' })).toEqual({ handled: true });
    expect((await batchOn('2025-12-15')).status).toBe('paid');
    expect((await partnerBalances(db, p.partner.id)).partner_payable).toBe(0);
    await applyPayoutEvent({ type: 'payout.failed', payoutRef: 'po_async_1', reason: 'Върнат от банката' });
    expect(await itemFor(next.batchId, p.partner.id)).toMatchObject({ status: 'failed' });
    expect((await partnerBalances(db, p.partner.id)).partner_payable).toBe(130_500);
    expect(await db.select().from(ledgerTransaction).where(and(eq(ledgerTransaction.kind, 'payout_reversal'), eq(ledgerTransaction.payoutItemId, (await itemFor(next.batchId, p.partner.id)).id)))).toHaveLength(1);
    expect((await batchOn('2025-12-15')).status).toBe('partially_failed');
    await expectLedgerHealthy();
  });

  it('nets what the partner owes from the next payout (L6)', async () => {
    setTestNow(t('2026-01-05'));
    const { actor: admin } = await createAdmin('admin');
    const p = await payablePartner();
    const bk = await paidBooking({ partner: p, eventDate: '2026-01-10' });
    // The partner owes 100,00 € from an earlier refund after payout (L2 tail).
    await db.transaction(tx => postTransaction(tx, {
      kind: 'adjustment', partnerId: p.partner.id, description: 'test receivable',
      lines: [{ account: 'partner_receivable', debit: 10_000 }, { account: 'provider_held', credit: 10_000 }],
    }));
    setTestNow(t('2026-01-11'));
    await release(bk.booking.id);
    const { batchId } = await prepareBatch('2026-01-15');
    expect(await itemFor(batchId, p.partner.id)).toMatchObject({ amountCents: 120_500 });
    setTestNow(t('2026-01-15', 9));
    await releaseBatch(admin, { batchId });
    const item = await itemFor(batchId, p.partner.id);
    expect(item).toMatchObject({ status: 'sent', amountCents: 120_500 });
    expect(await db.select().from(ledgerTransaction).where(and(eq(ledgerTransaction.kind, 'receivable_netting'), eq(ledgerTransaction.payoutItemId, item.id)))).toHaveLength(1);
    await runJobs();
    expect(await partnerBalances(db, p.partner.id)).toMatchObject({ partner_payable: 0, partner_receivable: 0 });
    await expectLedgerHealthy();
  });

  it('lines that become ready after T17 join at release (events of the day before the batch)', async () => {
    setTestNow(t('2026-01-20'));
    const { actor: admin } = await createAdmin('admin');
    const p = await payablePartner();
    const bk = await paidBooking({ partner: p, eventDate: '2026-01-31' });
    expect(bk.booking.batchDate).toBe('2026-02-01');
    setTestNow(t('2026-01-31', 9, 1));
    await runJobs(); // T17 for 01.02: the event is today, nothing is ready yet
    expect(await batchOn('2026-02-01')).toMatchObject({ status: 'ready', partnerCount: 0 });
    setTestNow(sofiaInstant('2026-02-01', 0, 0));
    await release(bk.booking.id); // T13
    setTestNow(t('2026-02-01', 9));
    expect(await releaseBatch(admin, { batchId: (await batchOn('2026-02-01')).id })).toMatchObject({ sentItems: 1 });
    await runJobs();
    expect(await batchOn('2026-02-01')).toMatchObject({ status: 'paid', partnerCount: 1, netCents: 130_500 });
    expect(await emails('vendor-payout-sent', p.user.id)).toHaveLength(1);
  });
});

describe('queries (SPEC §8.1, §8.2)', () => {
  it('KPIs and the next-batch projection', async () => {
    setTestNow(t('2026-02-20'));
    await ensurePayoutSchedule();
    expect(await pendingJobs('batch:2026-03-01')).toHaveLength(1);
    const before = await payoutKpis();
    const p = await payablePartner();
    const future = await paidBooking({ partner: p, eventDate: '2026-04-10' });
    const past = await paidBooking({ partner: p, eventDate: '2026-02-18' });
    await release(past.booking.id);
    const after = await payoutKpis();
    expect(after.heldForEvents.cents - before.heldForEvents.cents).toBe(145_000);
    expect(after.heldForEvents.bookings - before.heldForEvents.bookings).toBe(1);
    const preview = await nextBatchPreview();
    expect(preview).toMatchObject({ batchDate: '2026-03-01', label: 'Партида февруари · втора половина', status: 'scheduled' });
    expect(preview.netCents).toBeGreaterThanOrEqual(130_500);
    expect(after.nextBatch.batchDate).toBe('2026-03-01');
    const earn = await partnerEarnings(p.partner.id);
    expect(earn.toBePaidCents).toBe(261_000);
    expect(await bookingBalances(db, future.booking.id)).toMatchObject({ client_funds: 145_000 });
  });
});
