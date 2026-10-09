// Money: the commission booked is the one the provider took (stripe-fee-frozen-at-checkout). The
// application fee is fixed in the checkout; before the fix K5 re-computed the rate at payment, so a
// checkout opened at the 5 % intro rate and paid after the partner's third booking was booked at
// 10 % while the provider had kept 5 % — the platform's cash fell short of its ledger.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { startPayment } from '@/lib/domain/charges';
import { applyProviderEvent } from '@/lib/payments/apply';
import { createPartner } from '../helpers/factories';
import { NOW, approvedBooking, bookingRow, expectLedgerHealthy, paidBooking } from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterEach(async () => { await expectLedgerHealthy(); setTestNow(null); });

const chargeRow = async (id: string) => (await db.select().from(s.charge).where(eq(s.charge.id, id)))[0];
const succeed = (chargeId: string) => applyProviderEvent({ type: 'charge.succeeded', chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242' });

describe('commission at K5', () => {
  it('two checkouts opened at the intro rate keep it, whatever is paid first', async () => {
    const p = await createPartner();
    await paidBooking({ p });
    await paidBooking({ p, request: { eventDate: '2026-06-20' } });
    // Two clients open checkouts while the partner has 2 paid bookings: both at the intro rate (5 %).
    const a = await approvedBooking({ p, request: { eventDate: '2026-07-04' } });
    const b = await approvedBooking({ p, request: { eventDate: '2026-07-11' } });
    const ca = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    const cb = await startPayment(b.client.actor, { number: b.number, method: 'card' });
    const feeA = (await chargeRow(ca.chargeId)).applicationFeeCents, feeB = (await chargeRow(cb.chargeId)).applicationFeeCents;
    expect([feeA, feeB]).toEqual([7_250, 7_250]);

    await succeed(ca.chargeId); // the third paid booking
    await succeed(cb.chargeId); // the fourth: its checkout already split the money at 5 %
    expect((await bookingRow(b.bookingId)).commissionBp).toBe(500);
    expect((await chargeRow(cb.chargeId)).applicationFeeCents).toBe(feeB);
  });
});
