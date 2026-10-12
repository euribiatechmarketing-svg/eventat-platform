// Chargebacks (provider dispute.created): the money leaves at once, the partner's payouts freeze,
// a receivable is netted later; the team records won/lost. Runs on its own database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SYSTEM } from '@/lib/domain/actor';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { booking, chargeback, ledgerTransaction, payoutLine } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { bookingBalances, partnerBalances, postTransaction } from '@/lib/domain/ledger';
import { prepareBatch, releaseBatch, releaseBookingFunds } from '@/lib/domain/payouts';
import { applyChargebackEvent, openChargebacks, partnerHasOpenChargeback, resolveChargeback } from '@/lib/domain/chargebacks';
import { createAdmin, createPartner } from '../helpers/factories';
import { clearJobs, confirmPayoutAccount, expectLedgerHealthy, failure, paidBooking, reloadBooking, runJobs } from '../helpers/aftercare';

const t = (d: string, hh = 12) => sofiaInstant(d, hh, 0);
beforeEach(async () => { await clearJobs(); });
afterEach(() => setTestNow(null));
const release = (bookingId: string) => db.transaction(tx => releaseBookingFunds({ bookingId }, tx));

describe('chargebacks', () => {
  it('before the event: takes the held money, freezes the partner, and a won case restores everything', async () => {
    setTestNow(t('2025-08-31'));
    const { actor: accounting } = await createAdmin('accounting');
    const { actor: moderator } = await createAdmin('moderator');
    const { actor: admin } = await createAdmin('admin');
    const p = await createPartner();
    await confirmPayoutAccount(p.partner.id);
    const disputed = await paidBooking({ partner: p });
    const other = await paidBooking({ partner: p, eventDate: '2025-08-25' });
    await release(other.booking.id);

    expect(await applyChargebackEvent({ type: 'dispute.created', providerChargeRef: 'pi_unknown', amountCents: 100, reason: 'fraudulent' })).toEqual({ handled: false });
    const ev = { type: 'dispute.created' as const, providerChargeRef: disputed.charge.providerRef, amountCents: 145_000, reason: 'fraudulent' };
    const first = await applyChargebackEvent(ev);
    expect(first.handled).toBe(true);
    expect(await applyChargebackEvent(ev)).toEqual(first);
    expect(await db.select().from(chargeback).where(eq(chargeback.chargeId, disputed.charge.id))).toHaveLength(1);
    expect(await bookingBalances(db, disputed.booking.id)).toMatchObject({ client_funds: 0, provider_held: 0 });
    expect((await reloadBooking(disputed.booking.id)).payoutHold).toBe(true);
    expect(await partnerHasOpenChargeback(p.partner.id)).toBe(true);
    expect((await openChargebacks(SYSTEM)).map(c => c.id)).toContain(first.chargebackId);

    // The partner's other payout is frozen while the chargeback is open.
    const frozen = await prepareBatch('2025-09-01');
    const items = await db.select().from(payoutLine).where(eq(payoutLine.bookingId, other.booking.id));
    expect(items[0]).toMatchObject({ status: 'held', holdReason: 'dispute' });
    void frozen;

    expect(await failure(resolveChargeback(moderator, { chargebackId: first.chargebackId!, outcome: 'won' }))).toContain('Forbidden');
    await resolveChargeback(accounting, { chargebackId: first.chargebackId!, outcome: 'won', note: 'Доказателствата приети.' });
    expect(await bookingBalances(db, disputed.booking.id)).toMatchObject({ client_funds: 145_000, provider_held: 145_000 });
    expect((await reloadBooking(disputed.booking.id)).payoutHold).toBe(false);
    expect(await partnerHasOpenChargeback(p.partner.id)).toBe(false);
    expect(await failure(resolveChargeback(accounting, { chargebackId: first.chargebackId!, outcome: 'lost' }))).toContain('chargeback_closed');

    const next = await prepareBatch('2025-09-15');
    const [line] = await db.select().from(payoutLine).where(eq(payoutLine.bookingId, other.booking.id));
    expect(line).toMatchObject({ status: 'ready' });
    setTestNow(t('2025-09-15', 9));
    await releaseBatch(admin, { batchId: next.batchId });
    await runJobs();
    expect((await db.select().from(payoutLine).where(eq(payoutLine.bookingId, other.booking.id)))[0].status).toBe('paid');
    await expectLedgerHealthy();
  });

  it('after the payout: the partner owes the share (receivable) and the commission comes back; lost keeps it owed', async () => {
    setTestNow(t('2025-10-01'));
    const { actor: accounting } = await createAdmin('accounting');
    const p = await createPartner();
    const bk = await paidBooking({ partner: p, eventDate: '2025-09-20' });
    await release(bk.booking.id);
    // Paid out (L4).
    await db.transaction(async tx => {
      await postTransaction(tx, { kind: 'payout', partnerId: p.partner.id, lines: [{ account: 'partner_payable', debit: 130_500 }, { account: 'provider_held', credit: 130_500 }] });
      await tx.update(payoutLine).set({ status: 'paid', paidAt: t('2025-10-01') }).where(eq(payoutLine.bookingId, bk.booking.id));
    });
    const r = await applyChargebackEvent({ type: 'dispute.created', providerChargeRef: bk.charge.providerRef, amountCents: 145_000, reason: 'product_not_received' });
    expect(await partnerBalances(db, p.partner.id)).toMatchObject({ partner_payable: 0, partner_receivable: 130_500 });
    expect((await bookingBalances(db, bk.booking.id)).commission_revenue).toBe(0);
    const [cb] = await db.select().from(chargeback).where(eq(chargeback.id, r.chargebackId!));
    const [txn] = await db.select().from(ledgerTransaction).where(eq(ledgerTransaction.id, cb.ledgerTransactionId!));
    expect(txn.kind).toBe('adjustment');
    await resolveChargeback(accounting, { chargebackId: cb.id, outcome: 'lost' });
    expect((await partnerBalances(db, p.partner.id)).partner_receivable).toBe(130_500);
    expect(await db.select().from(ledgerTransaction).where(and(eq(ledgerTransaction.kind, 'adjustment'), eq(ledgerTransaction.chargeId, bk.charge.id)))).toHaveLength(1);
    expect((await reloadBooking(bk.booking.id)).payoutHold).toBe(false);
    void booking;
    await expectLedgerHealthy();
  });
});
