// Money: K13 (and T18) never release what the client is still owed (k13-release-ignores-owed-refunds).
// Before the fix K13 released every held euro: a dispute refund whose provider call failed (F3,
// "stays held for the client") went to the partner instead, and a later retry pulled it from a
// connected balance that had already been paid out.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { decide, openByClient } from '@/lib/domain/disputes';
import { bookingBalances } from '@/lib/domain/ledger';
import { prepareBatch } from '@/lib/domain/payouts';
import { simulatedProvider } from '@/lib/payments/simulated';
import { createAdmin } from '../helpers/factories';
import { confirmPayoutAccount } from '../helpers/aftercare';
import { NOW, bookingRow, expectLedgerHealthy, paidBooking, tickAt } from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterEach(async () => { await expectLedgerHealthy(); setTestNow(null); vi.restoreAllMocks(); });

const refunds = (bookingId: string) => db.select().from(s.refund).where(eq(s.refund.bookingId, bookingId));
const mainLine = async (bookingId: string) =>
  (await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, bookingId))).find(l => !l.chargeId)!;

describe('K13 with a failed refund', () => {
  it('a dispute refund that failed before the event stays held for the client; the partner gets the rest', async () => {
    const { actor: admin } = await createAdmin('admin');
    const a = await paidBooking();
    await confirmPayoutAccount(a.partner.partner.id);
    const d = await openByClient(a.client.actor, { bookingId: a.bookingId, reason: 'not_as_described', description: 'Обхватът е по-малък.' });
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValue({ refundRef: 're_failed_owed', status: 'failed', reason: 'card_closed' });
    await decide(admin, { disputeId: d.id, kind: 'partial_refund', refundCents: 30_000, motive: 'услугата беше непълна.' });
    await tickAt(new Date(NOW.getTime() + 60_000)); // refund.submit → F3 failed
    expect((await refunds(a.bookingId))[0]).toMatchObject({ status: 'failed', amountCents: 30_000 });

    await tickAt(sofiaInstant('2026-06-15', 0, 0)); // K13
    expect((await bookingRow(a.bookingId)).status).toBe('completed');
    // 300 € of the 1 450 € stay held for the client; the partner's line carries 1 150 €.
    expect((await bookingBalances(db, a.bookingId)).client_funds).toBe(30_000);
    expect(await mainLine(a.bookingId)).toMatchObject({ baseCents: 115_000 });
  });

  it('a refund that failed after the release keeps the line out of the batch', async () => {
    const { actor: admin } = await createAdmin('admin');
    const a = await paidBooking();
    await confirmPayoutAccount(a.partner.partner.id);
    await tickAt(sofiaInstant('2026-06-15', 0, 0)); // K13: released in full
    expect((await bookingBalances(db, a.bookingId)).client_funds).toBe(0);
    const d = await openByClient(a.client.actor, { bookingId: a.bookingId, reason: 'not_as_described', description: 'Обхватът е по-малък.' });
    vi.spyOn(simulatedProvider, 'refund').mockResolvedValue({ refundRef: 're_failed_late', status: 'failed', reason: 'card_closed' });
    await decide(admin, { disputeId: d.id, kind: 'partial_refund', refundCents: 30_000, motive: 'услугата беше непълна.' });
    await tickAt(sofiaInstant('2026-06-15', 0, 1)); // refund.submit → F3 failed
    expect((await refunds(a.bookingId))[0].status).toBe('failed');

    const { batchId } = await prepareBatch('2026-07-01');
    const line = await mainLine(a.bookingId);
    const [item] = line.payoutItemId ? await db.select().from(s.payoutItem).where(and(eq(s.payoutItem.id, line.payoutItemId), eq(s.payoutItem.batchId, batchId))) : [];
    expect(item?.status ?? 'none').not.toBe('ready');
  });
});
