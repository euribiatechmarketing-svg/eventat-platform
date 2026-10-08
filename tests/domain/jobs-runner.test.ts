// The job runner against the lifecycle's deadline jobs (SPEC §3): a handler
// must never wait on a business row while its own job row stays locked, or a
// payment or an extension that touches that job at the same moment hangs
// both sides for good (PostgreSQL cannot see a cycle through an idle runner).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { extendPaymentDeadline } from '@/lib/domain/bookings';
import { startPayment } from '@/lib/domain/charges';
import { runDueJobs } from '@/lib/jobs';
import { applyProviderEvent } from '@/lib/payments/apply';
import { createAdmin } from '../helpers/factories';
import {
  H, NOW, approvedBooking, backendPid, bookingRow, emails, expectLedgerHealthy, gate, jobs, lockWaiter, tickAt, timeoutAfter,
} from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterEach(async () => { await expectLedgerHealthy(); setTestNow(null); });

/** A transaction that takes the booking row first and finishes with `then` once the gate opens. */
function holdingBooking<T>(bookingId: string, then: (t: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>) {
  const locked = gate(), go = gate();
  let pid = 0;
  const done = db.transaction(async t => {
    await t.select({ id: s.booking.id }).from(s.booking).where(eq(s.booking.id, bookingId)).for('update');
    pid = await backendPid(t);
    locked.open();
    await go.passed;
    return then(t);
  });
  return { locked: locked.passed.then(() => pid), go: go.open, done };
}

describe('the runner never holds a job row while its handler waits', () => {
  it('confirms a payment that lands while T8 is expiring the booking (no hang)', async () => {
    const a = await approvedBooking();
    const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    setTestNow(new Date(a.paymentDueAt.getTime() + 1_000));

    // The provider's success is being applied and holds the booking…
    const webhook = holdingBooking(a.bookingId, t =>
      applyProviderEvent({ type: 'charge.succeeded', chargeId: pay.chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242' }, t));
    const holder = await webhook.locked;
    // …while the tick claims T8, whose handler now waits for that booking.
    const tick = runDueJobs();
    await lockWaiter(holder);
    webhook.go();

    const r = await Promise.race([Promise.all([webhook.done, tick]), timeoutAfter(8_000)]);
    expect(r).not.toBe('timeout');
    const [applied, ran] = r as [Awaited<typeof webhook.done>, Awaited<typeof tick>];
    expect(applied).toMatchObject({ applied: true, bookingConfirmed: true });
    expect(ran.failed).toBe(0);
    expect((await bookingRow(a.bookingId)).status).toBe('confirmed');
    expect(await emails('client-payment-expired', a.client.user.id)).toHaveLength(0);
    // The payment cancelled T8 while it ran; the cancellation stands.
    expect((await jobs(`booking:${a.bookingId}:payexpire`))[0].status).toBe('cancelled');
  }, 20_000);

  it('keeps an extension made while T8 runs: the booking expires at the new deadline (no hang)', async () => {
    const a = await approvedBooking();
    const { actor: admin } = await createAdmin('admin');
    setTestNow(new Date(a.paymentDueAt.getTime() + 1_000));

    const extension = holdingBooking(a.bookingId, t => extendPaymentDeadline(admin, { number: a.number }, t));
    const holder = await extension.locked;
    const tick = runDueJobs();
    await lockWaiter(holder);
    extension.go();

    const r = await Promise.race([Promise.all([extension.done, tick]), timeoutAfter(8_000)]);
    expect(r).not.toBe('timeout');
    const newDue = new Date(a.paymentDueAt.getTime() + 24 * H);
    expect(await bookingRow(a.bookingId)).toMatchObject({ status: 'awaiting_payment', paymentDueAt: newDue });
    // T8 was moved while it ran; the move stands instead of the run being recorded as done.
    expect((await jobs(`booking:${a.bookingId}:payexpire`))[0]).toMatchObject({ status: 'pending', runAt: newDue });

    await tickAt(new Date(newDue.getTime() - 1));
    expect((await bookingRow(a.bookingId)).status).toBe('awaiting_payment');
    await tickAt(newDue);
    expect((await bookingRow(a.bookingId)).status).toBe('payment_expired');
  }, 20_000);

  it('runs a due job once, and a job whose run dies is picked up again after its lease', async () => {
    const a = await approvedBooking();
    setTestNow(new Date(a.paymentDueAt.getTime() + 1_000));
    // Simulate a runner that claimed T8 and died: the lease moved run_at ahead, status still pending.
    const [t8] = await jobs(`booking:${a.bookingId}:payexpire`);
    await db.update(s.job).set({ runAt: new Date(a.paymentDueAt.getTime() + 5 * 60_000), attempts: 1 }).where(eq(s.job.id, t8.id));
    await tickAt(new Date(a.paymentDueAt.getTime() + 60_000));
    expect((await bookingRow(a.bookingId)).status).toBe('awaiting_payment');
    await tickAt(new Date(a.paymentDueAt.getTime() + 5 * 60_000));
    expect((await bookingRow(a.bookingId)).status).toBe('payment_expired');
    expect((await jobs(`booking:${a.bookingId}:payexpire`))[0]).toMatchObject({ status: 'done', attempts: 2 });
    expect(await emails('client-payment-expired', a.client.user.id)).toHaveLength(1);
  });
});
