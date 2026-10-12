// Defence in depth for the read-only finance functions: each one takes the actor and checks the
// permission (or the ownership) itself, instead of trusting the page that calls it (SPEC §1.2, rule 9:
// commission only with view_finance; a partner sees only their own earnings). Runs on its own database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { payoutBatch } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { ForbiddenError, SYSTEM, type Actor } from '@/lib/domain/actor';
import { quoteBooking } from '@/lib/domain/cancellation';
import { openChargebacks } from '@/lib/domain/chargebacks';
import {
  accountingCsv, batchDetail, batchReportCsv, listBatches, nextBatchPreview, partnerEarnings, payoutKpis, prepareBatch,
} from '@/lib/domain/payouts';
import { failedRefunds } from '@/lib/domain/refunds';
import { dashboardMetrics, latestBookings, topCategories } from '@/lib/domain/views-admin-ops';
import { attentionRows, bookingsRegister } from '@/lib/domain/views-admin-money';
import { createAdmin, createClient } from '../helpers/factories';
import { clearJobs, paidBooking } from '../helpers/aftercare';

const NOW = sofiaInstant('2025-08-31', 12, 0);
beforeEach(async () => { await clearJobs(); setTestNow(NOW); });
afterEach(() => setTestNow(null));

/** The call is refused with ForbiddenError (not a not-found or a database error). */
async function refused(p: Promise<unknown>) {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e, 'expected a refusal').toBeInstanceOf(ForbiddenError);
}

describe('read-only finance functions check the actor themselves', () => {
  it('team-only figures: refused to a partner, a client and support; open to view_finance', async () => {
    const { partner, client, booking: b } = await paidBooking();
    const { actor: support } = await createAdmin('support');
    const { actor: moderator } = await createAdmin('moderator');
    const { actor: accounting } = await createAdmin('accounting');
    await prepareBatch('2025-09-01');
    const [batch] = await db.select().from(payoutBatch).where(eq(payoutBatch.batchDate, '2025-09-01'));
    const outsiders: Actor[] = [partner.actor, client.actor, support, moderator];

    for (const a of outsiders) {
      await refused(payoutKpis(a));
      await refused(nextBatchPreview(a));
      await refused(listBatches(a));
      await refused(batchDetail(a, batch.id));
      await refused(batchReportCsv(a, batch.id));
      await refused(accountingCsv(a, { from: '2025-08-01', to: '2025-08-31' }));
      await refused(failedRefunds(a));
      await refused(openChargebacks(a));
    }
    // view_finance (and the system) may.
    for (const a of [accounting, SYSTEM]) {
      expect((await payoutKpis(a)).heldForEvents.bookings).toBeGreaterThan(0);
      expect((await nextBatchPreview(a)).batchDate).toBe('2025-09-01');
      expect(await listBatches(a)).toEqual(expect.any(Array));
      expect((await batchDetail(a, batch.id)).batch.id).toBe(batch.id);
      expect(await batchReportCsv(a, batch.id)).toContain('Партида');
      expect(await accountingCsv(a, { from: '2025-08-01', to: '2025-08-31' })).toContain('Дата');
      expect(await failedRefunds(a)).toEqual([]);
      expect(await openChargebacks(a)).toEqual([]);
    }
    expect(b.partnerId).toBe(partner.partner.id);
  });

  it('partnerEarnings: the partner’s own, or view_finance; never another partner’s', async () => {
    const own = await paidBooking();
    const other = await paidBooking();
    const { actor: support } = await createAdmin('support');
    const { actor: accounting } = await createAdmin('accounting');
    expect((await partnerEarnings(own.partner.actor, own.partner.partner.id)).toBePaidCents).toBeGreaterThan(0);
    await refused(partnerEarnings(other.partner.actor, own.partner.partner.id));
    await refused(partnerEarnings(own.client.actor, own.partner.partner.id));
    await refused(partnerEarnings(support, own.partner.partner.id));
    expect((await partnerEarnings(accounting, own.partner.partner.id)).toBePaidCents).toBeGreaterThan(0);
  });

  it('quoteBooking: the booking’s client, or the team that may cancel; the commission only with view_finance', async () => {
    const { client, partner, booking: b } = await paidBooking();
    const stranger = await createClient();
    const { actor: support } = await createAdmin('support');
    const { actor: moderator } = await createAdmin('moderator');
    const { actor: accounting } = await createAdmin('accounting');
    const { actor: admin } = await createAdmin('admin');

    await refused(quoteBooking(partner.actor, b.id));
    await refused(quoteBooking(support, b.id));
    await refused(quoteBooking(stranger.actor, b.id));

    const mine = await quoteBooking(client.actor, b.id);
    expect(mine.refundCents).toBe(145_000);
    expect(mine).not.toHaveProperty('commissionCents');
    expect(mine).not.toHaveProperty('commissionBp');
    expect(mine).not.toHaveProperty('partnerAmountCents');
    const mod = await quoteBooking(moderator, b.id, { initiatedBy: 'team' });
    expect(mod.refundCents).toBe(145_000);
    expect(mod).not.toHaveProperty('commissionCents');
    expect(await quoteBooking(accounting, b.id, { initiatedBy: 'team' })).toMatchObject({ commissionBp: 1000, refundCents: 145_000 });
    expect(await quoteBooking(admin, b.id, { initiatedBy: 'team' })).toHaveProperty('commissionCents');
    expect(await quoteBooking(SYSTEM, b.id)).toHaveProperty('commissionCents');
  });

  it('the admin dashboard: team only; turnover and commission only with view_finance', async () => {
    const { partner, client } = await paidBooking({ approvedAt: new Date(NOW.getTime() - 48 * 3600_000) });
    const { actor: support } = await createAdmin('support');
    const { actor: accounting } = await createAdmin('accounting');
    for (const a of [partner.actor, client.actor]) {
      await refused(dashboardMetrics(a, 'month'));
      await refused(latestBookings(a, 4));
    }
    const plain = await dashboardMetrics(support, 'month');
    expect(plain.money).toBeNull();
    expect(plain.data).not.toHaveProperty('gmv');
    expect(plain.data).not.toHaveProperty('commission');
    expect(plain.data.bookings).toBeGreaterThan(0);
    const fin = await dashboardMetrics(accounting, 'month');
    expect(fin.money).toMatchObject({ gmv: expect.any(Number), commission: expect.any(Number), months: expect.any(Array) });
    expect(fin.money!.gmv).toBeGreaterThan(0);

    expect((await latestBookings(support, 4)).every(b => b.commissionCents === null)).toBe(true);
    expect((await latestBookings(accounting, 4)).every(b => typeof b.commissionCents === 'number')).toBe(true);
    // The bookings register and its attention card: team only (amounts; the commission column needs view_finance).
    await refused(bookingsRegister(partner.actor, {}));
    await refused(attentionRows(partner.actor));
    await refused(bookingsRegister(client.actor, {}));
    expect((await bookingsRegister(support, {})).commissionCents).toBeNull();
    const period = fin.period;
    await refused(topCategories(partner.actor, period, null));
    expect((await topCategories(support, period, null)).every(c => c.gmv === null && c.bookings > 0)).toBe(true);
    expect((await topCategories(accounting, period, null)).every(c => typeof c.gmv === 'number')).toBe(true);
  });
});
