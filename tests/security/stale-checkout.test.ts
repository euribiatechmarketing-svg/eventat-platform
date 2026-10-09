// Money: a checkout for an old price cannot confirm the booking (stale-checkout-confirms-old-amount).
// Before the fix a K16 ‹Нова цена› (or T8, a cancellation) expired the charge only in our database;
// the client could still pay the old session for 1 450 € and the booking was confirmed at 1 800 €.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { startPayment } from '@/lib/domain/charges';
import { decide, openByClient } from '@/lib/domain/disputes';
import { applyProviderEvent } from '@/lib/payments/apply';
import { simulatedProvider } from '@/lib/payments/simulated';
import { createAdmin } from '../helpers/factories';
import { H, NOW, approvedBooking, bookingRow, expectLedgerHealthy, tickAt } from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterEach(async () => { await expectLedgerHealthy(); setTestNow(null); vi.restoreAllMocks(); });

const chargeRow = async (id: string) => (await db.select().from(s.charge).where(eq(s.charge.id, id)))[0];
const succeed = (chargeId: string) => applyProviderEvent({ type: 'charge.succeeded', chargeId, providerRef: `pi_${chargeId.slice(0, 8)}`, cardBrand: 'visa', cardLast4: '4242' });

describe('a stale checkout', () => {
  it('paid after a new price: flagged as a duplicate, the booking still waits for the new amount', async () => {
    const { actor: admin } = await createAdmin('admin');
    const a = await approvedBooking();
    const old = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    const d = await openByClient(a.client.actor, { bookingId: a.bookingId, reason: 'payment_problem', description: 'Цената се промени.' });
    await decide(admin, { disputeId: d.id, kind: 'accept_new_price', newAmountCents: 180_000, motive: 'новата цена е приета.' });
    expect(await chargeRow(old.chargeId)).toMatchObject({ status: 'expired' });

    // The provider checkout is closed after commit.
    const expire = vi.spyOn(simulatedProvider, 'expireCheckout');
    await tickAt(new Date(NOW.getTime() + 60_000));
    expect(expire).toHaveBeenCalledWith((await chargeRow(old.chargeId)).providerRef);

    // The client pays the old session anyway (1 450 €).
    expect(await succeed(old.chargeId)).toMatchObject({ applied: true, duplicate: true });
    expect(await bookingRow(a.bookingId)).toMatchObject({ status: 'awaiting_payment', amountCents: 180_000 });
    expect(await chargeRow(old.chargeId)).toMatchObject({ status: 'succeeded', isDuplicate: true });

    // The new amount confirms it.
    const fresh = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    expect((await chargeRow(fresh.chargeId)).amountCents).toBe(180_000);
    expect(await succeed(fresh.chargeId)).toMatchObject({ applied: true, bookingConfirmed: true });
    expect((await bookingRow(a.bookingId)).status).toBe('confirmed');
  });

  it('a declined card retried in the same checkout still confirms (failed → succeeded)', async () => {
    const a = await approvedBooking();
    const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    await applyProviderEvent({ type: 'charge.failed', chargeId: pay.chargeId, reason: 'card_declined' });
    expect(await succeed(pay.chargeId)).toMatchObject({ applied: true, bookingConfirmed: true });
  });

  it('paid after T8 expired the booking: a duplicate, and the checkout was closed', async () => {
    const a = await approvedBooking();
    const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    const expire = vi.spyOn(simulatedProvider, 'expireCheckout');
    await tickAt(new Date(a.paymentDueAt.getTime() + H));
    expect((await bookingRow(a.bookingId)).status).toBe('payment_expired');
    expect(expire).toHaveBeenCalled();
    expect(await succeed(pay.chargeId)).toMatchObject({ applied: true, duplicate: true });
  });
});
