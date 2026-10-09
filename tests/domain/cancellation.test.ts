// SPEC §5 cancellation engine and §4.7 K7–K12. Runs on its own database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { cancellation, charge, dateWatch, invoice, partnerCancellationRequest, payoutLine, refund } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { date, money, moneyShort, sofiaInstant } from '@/lib/format';
import { bookingBalances, partnerBalances } from '@/lib/domain/ledger';
import { DEFAULT_CANCELLATION_POLICIES } from '@/lib/domain/settings';
import {
  cancelByClient, cancelByTeam, cancelForNonPayment, clientCancelEligibility, completePartnerCancellation, declinePartnerCancellation,
  freeCancelUntil, policyStrings, quote, quoteBooking, releaseRetained, remainderRefundUntil, requestPartnerCancellation, settingsSummary,
  type QuoteBooking,
} from '@/lib/domain/cancellation';
import { openByClient } from '@/lib/domain/disputes';
import { createAdmin, createClient } from '../helpers/factories';
import {
  bells, clearJobs, emails, expectLedgerHealthy, failure, paidBooking, pendingJobs, reloadBooking, runJobs,
} from '../helpers/aftercare';

const at = (d: string, hh = 12) => sofiaInstant(d, hh, 0);
afterEach(() => setTestNow(null));
beforeEach(async () => { await clearJobs(); });

// Booking 2026-0614-ЕА: 1 450,00 €, Умерена, deposit 30 % = 435,00 €, commission 10 %.
const EA: QuoteBooking = { eventDate: '2026-06-14', amountCents: 145_000, paidCents: 145_000, cancellationPolicy: 'moderate', depositPercent: 30, commissionBp: 1000 };

describe('quote() — the §5.2 table', () => {
  it('reproduces the worked examples of §5.6', () => {
    expect(quote(EA, at('2025-08-31'))).toMatchObject({ daysBefore: 287, refundCents: 145_000, retainedCents: 0, partnerAmountCents: 0, depositCents: 43_500, tier: 'none' });
    expect(quote(EA, at('2026-05-15'))).toMatchObject({ daysBefore: 30, refundCents: 145_000, retainedCents: 0, partnerAmountCents: 0 });
    expect(quote(EA, at('2026-05-16'))).toMatchObject({ daysBefore: 29, refundCents: 101_500, retainedCents: 43_500, commissionCents: 4_350, partnerAmountCents: 39_150, tier: 'deposit' });
    expect(quote(EA, at('2026-06-08'))).toMatchObject({ daysBefore: 6, refundCents: 0, retainedCents: 145_000, commissionCents: 14_500, partnerAmountCents: 130_500, tier: 'total' });
    for (const d of ['2025-08-31', '2026-05-16', '2026-06-14']) {
      expect(quote(EA, at(d), 'partner')).toMatchObject({ refundCents: 145_000, retainedCents: 0, partnerAmountCents: 0, commissionCents: 0 });
    }
  });

  it('uses inclusive boundaries for every policy (D9)', () => {
    const f = { ...EA, cancellationPolicy: 'flexible' as const };
    expect(quote(f, at('2026-06-07')).tier).toBe('none');      // 7 days
    expect(quote(f, at('2026-06-08')).tier).toBe('deposit');   // 6
    expect(quote(f, at('2026-06-13')).tier).toBe('deposit');   // 1
    expect(quote(f, at('2026-06-14')).tier).toBe('total');     // event day
    const s = { ...EA, cancellationPolicy: 'strict' as const };
    expect(quote(s, at('2025-08-31'))).toMatchObject({ tier: 'deposit', retainedCents: 43_500, refundCents: 101_500 });
    expect(quote(s, at('2026-05-31'))).toMatchObject({ tier: 'deposit' });  // 14
    expect(quote(s, at('2026-06-01'))).toMatchObject({ tier: 'total', refundCents: 0 }); // 13
    expect(quote(EA, at('2026-06-08', 0))).toMatchObject({ daysBefore: 6 });  // the Sofia date counts, not the hour
    expect(quote(EA, at('2026-06-07', 23))).toMatchObject({ daysBefore: 7, tier: 'deposit' });
  });

  it('caps what is retained by what was paid (deposit schedule) and refuses the client after the event', () => {
    const dep = { ...EA, paidCents: 43_500 };
    expect(quote(dep, at('2026-03-01'))).toMatchObject({ retainedCents: 0, refundCents: 43_500 });
    expect(quote(dep, at('2026-05-16'))).toMatchObject({ retainedCents: 43_500, refundCents: 0 });
    expect(quote(dep, at('2026-06-08'))).toMatchObject({ retainedByPolicyCents: 145_000, retainedCents: 43_500, refundCents: 0, partnerAmountCents: 39_150 });
    expect(quote(EA, at('2026-06-15')).allowed).toBe(false);
    expect(quote(EA, at('2026-06-14')).allowed).toBe(true);
    expect(quote(EA, at('2026-06-15'), 'team')).toMatchObject({ allowed: true, tier: 'total' });
    expect(quote({ ...EA, paidCents: 0, commissionBp: null }, at('2026-06-08'))).toMatchObject({ retainedCents: 0, refundCents: 0, partnerAmountCents: 0 });
  });

  it('gives the cancel page cells and the full-refund header line', () => {
    const full = quote(EA, at('2025-08-31'));
    expect(full.labels).toEqual({
      policyName: 'Умерена', paid: moneyShort(145_000), refund: moneyShort(145_000), retained: moneyShort(0),
      refundNote: 'пълната сума', retainedNote: 'без удръжки',
      headerSub: 'До събитието остават 287 дни — анулирането е в безплатния срок и сумата се възстановява изцяло.',
    });
    const part = quote(EA, at('2026-05-16'));
    expect(part.labels).toMatchObject({ refundNote: null, retainedNote: null, headerSub: null, retained: moneyShort(43_500) });
  });
});

describe('policy strings (§5.5)', () => {
  it('generates the dates and lines from the tiers', () => {
    expect(freeCancelUntil('2026-06-14', 'moderate')).toBe('2026-05-15');
    expect(freeCancelUntil('2026-06-14', 'flexible')).toBe('2026-06-07');
    expect(freeCancelUntil('2026-06-14', 'strict')).toBeNull();
    expect(remainderRefundUntil('2026-06-14', 'strict')).toBe('2026-05-31');
    const m = policyStrings('moderate', '2026-06-14');
    expect(m.title).toBe('Умерена политика');
    expect(m.freeCancelLine).toBe(`Безплатно анулиране до ${date('2026-05-15')} — 30 дни преди събитието.`);
    expect(m.policyBox).toBe(`Безплатно анулиране до ${date('2026-05-15')} — 30 дни преди събитието. След това се задържа депозитът.`);
    expect(m.vendorWidget).toBe('Анулиране: умерена политика — безплатно до 30 дни преди събитието.');
    expect(m.checkDetail).toBe('Умерена · безплатно до 30 дни');
    expect(m.description).toBe('Пълно възстановяване до 30 дни; после се задържа депозитът, а в последните 7 дни — цялата сума');
    expect(m.onboarding).toBe('Безплатно анулиране до 30 дни преди събитието. След това се задържа депозитът, а в последните 7 дни — цялата сума.');
    expect(policyStrings('flexible').description).toBe('Пълно възстановяване до 7 дни преди събитието');
    expect(policyStrings('flexible').onboarding).toBe('Безплатно анулиране до 7 дни преди събитието. След това депозитът остава за вас, а в деня на събитието — цялата сума.');
    const s = policyStrings('strict', '2026-06-14');
    expect(s.description).toBe('Депозитът не се връща; остатъкът се възстановява до 14 дни преди събитието');
    expect(s.onboarding).toBe('Депозитът не се връща след потвърждение. Останалата сума се възстановява при анулиране до 14 дни преди събитието.');
    expect([s.freeCancelLine, s.policyBox, s.vendorWidget]).toEqual([null, null, null]);
    expect(settingsSummary(DEFAULT_CANCELLATION_POLICIES)).toBe('Гъвкава (до 7 дни) · Умерена (до 30 дни) · Строга (депозитът не се връща)');
  });
});

describe('K7 client cancels', () => {
  it('in the free period: full refund, emails, credit note, date watch, nothing for the partner', async () => {
    setTestNow(at('2025-08-31'));
    const { client, partner, booking: b } = await paidBooking();
    const watcher = await createClient();
    const [w] = await db.insert(dateWatch).values({ clientId: watcher.user.id, partnerId: partner.partner.id, date: b.eventDate }).returning();
    expect(await clientCancelEligibility(b.id)).toEqual({ allowed: true, reason: null });
    expect((await quoteBooking(b.id)).refundCents).toBe(145_000);

    const res = await cancelByClient(client.actor, { bookingId: b.id, reason: 'other', reasonText: 'Залата ще осигури собствено озвучаване.' });
    expect(res.quote).toMatchObject({ daysBefore: 287, refundCents: 145_000, retainedCents: 0 });
    expect(await reloadBooking(b.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'client' });
    const [c] = await db.select().from(cancellation).where(eq(cancellation.bookingId, b.id));
    expect(c).toMatchObject({ initiatedBy: 'client', reason: 'other', reasonText: 'Залата ще осигури собствено озвучаване.', refundCents: 145_000, retainedCents: 0, partnerAmountCents: 0, daysBefore: 287 });
    const [r] = await db.select().from(refund).where(eq(refund.bookingId, b.id));
    expect(r).toMatchObject({ status: 'pending', reason: 'client_cancel', amountCents: 145_000, applicationFeeRefundCents: 14_500, cancellationId: c.id });
    expect(await pendingJobs(`refund:${r.id}`)).toHaveLength(1);
    const [line] = await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id));
    expect(line).toMatchObject({ status: 'cancelled', amountCents: 0 });

    const [cc] = await emails('client-cancel-confirmed', client.user.id);
    expect(cc.vars).toMatchObject({ bookingNo: b.number, packageName: 'Цял ден', policyName: 'Умерена', freeCancelUntil: date('2026-05-15'), paid: money(145_000), refund: money(145_000), kept: money(0), cardLast4: '4242' });
    const [vc] = await emails('vendor-client-cancelled', partner.user.id);
    expect(vc.vars).toMatchObject({ policyDefinite: 'умерената', reason: 'Залата ще осигури собствено озвучаване.', partnerAmount: money(0) });
    expect(vc.toEmail).toBe(partner.partner.notificationEmail);
    const freed = await emails('client-date-freed', watcher.user.id);
    expect(freed).toHaveLength(1);
    // The watcher has no event that day: nothing of the cancelled booking (another client's event) is shown.
    expect(freed[0].vars).toMatchObject({ eventType: '', eventDate: date(b.eventDate) });
    expect(freed[0].text).toContain(`Събитие: ${date(b.eventDate)}\n`);
    expect((await db.select().from(dateWatch).where(eq(dateWatch.id, w.id)))[0].status).toBe('notified');
    expect(await bells(client.user.id, 'client-cancel-confirmed')).toHaveLength(1);
    expect(await bells(partner.user.id, 'vendor-client-cancelled')).toHaveLength(1);
    expect(await emails('client-refund-sent', client.user.id)).toHaveLength(0);

    await runJobs();
    const [done] = await db.select().from(refund).where(eq(refund.id, r.id));
    expect(done.status).toBe('succeeded');
    expect((await db.select().from(charge).where(eq(charge.bookingId, b.id)))[0]).toMatchObject({ status: 'refunded', refundedCents: 145_000 });
    const sent = await emails('client-refund-sent', client.user.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('затова се връща цялата сума без удръжки');
    expect((await emails('client-cancel-confirmed', client.user.id))[0].text).toContain('Анулирането е в безплатния срок и сумата се възстановява изцяло.');
    expect(sent[0].vars).toMatchObject({ refund: money(145_000), paid: money(145_000), paymentMethod: 'Visa •••• 4242', policyDefinite: 'умерената' });
    const [cn] = await db.select().from(invoice).where(and(eq(invoice.refundId, r.id), eq(invoice.type, 'credit_note')));
    expect(cn).toMatchObject({ issuerKey: partner.partner.id, totalCents: 145_000, bookingId: b.id });
    const bal = await bookingBalances(db, b.id);
    expect(bal).toMatchObject({ client_funds: 0, provider_held: 0, partner_payable: 0, commission_revenue: 0 });
    await runJobs();
    expect(await emails('client-refund-sent', client.user.id)).toHaveLength(1);
    await expectLedgerHealthy();
  });

  it('late: keeps the deposit, releases it to the partner the day after the event with commission (D11)', async () => {
    setTestNow(at('2026-05-16', 10));
    const { client, partner, booking: b } = await paidBooking();
    const res = await cancelByClient(client.actor, { bookingId: b.id, reason: 'date_change' });
    expect(res.quote).toMatchObject({ daysBefore: 29, refundCents: 101_500, retainedCents: 43_500, partnerAmountCents: 39_150 });
    const [vc] = await emails('vendor-client-cancelled', partner.user.id);
    expect(vc.vars).toMatchObject({ reason: 'Промяна в датата', partnerAmount: money(39_150) });
    // The emails tell the real split: no full refund for the client, a payout for the partner.
    expect(vc.text).not.toContain('няма изплащане');
    expect(vc.text).toContain(`Получавате: ${money(39_150)}`);
    const [cc] = await emails('client-cancel-confirmed', client.user.id);
    expect(cc.text).not.toContain('изцяло');
    expect(cc.text).toContain(`Задържа се: ${money(43_500)}`);
    expect(cc.text).toContain('Възстановяването тръгва автоматично към картата, завършваща на 4242');
    expect(cc.text).not.toContain('Другите ви резервации');   // no other booking on that date
    await runJobs();
    const [rs] = await emails('client-refund-sent', client.user.id);
    expect(rs.vars).toMatchObject({ refund: money(101_500) });
    expect(rs.text).not.toContain('без удръжки');
    expect((await bookingBalances(db, b.id)).client_funds).toBe(43_500);
    const [line] = await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id));
    expect(line).toMatchObject({ status: 'awaiting_event', baseCents: 43_500, commissionCents: 4_350, amountCents: 39_150 });
    const [rel] = await pendingJobs(`booking:${b.id}:release`);
    expect(rel.runAt).toEqual(sofiaInstant('2026-06-15'));

    setTestNow(sofiaInstant('2026-06-15', 0, 1));
    await runJobs();
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, commission_revenue: 4_350, partner_payable: 39_150 });
    expect((await partnerBalances(db, partner.partner.id)).partner_payable).toBe(39_150);
    const [ready] = await db.select().from(payoutLine).where(eq(payoutLine.bookingId, b.id));
    // Released into the 15 June batch T17 already prepared: this partner has no confirmed payout account, so the
    // batch holds it (SPEC §8.3, Y4) until one is confirmed.
    expect(ready).toMatchObject({ status: 'held', holdReason: 'account_check', amountCents: 39_150, batchDate: '2026-06-15' });
    expect(await releaseRetained({ bookingId: b.id })).toBe(0); // idempotent
    await expectLedgerHealthy();
  });

  it('Строга within 14 days: nothing back — the emails promise no refund and give the policy, not a free date', async () => {
    setTestNow(at('2026-06-04'));
    const { client, partner, booking: b } = await paidBooking({ policy: 'strict', commissionBp: 500 });
    const other = await paidBooking({ client, eventDate: b.eventDate });
    const res = await cancelByClient(client.actor, { bookingId: b.id, reason: 'event_cancelled' });
    expect(res.quote).toMatchObject({ daysBefore: 10, tier: 'total', refundCents: 0, retainedCents: 145_000, partnerAmountCents: 137_750 });
    const [cc] = await emails('client-cancel-confirmed', client.user.id);
    expect(cc.vars).toMatchObject({ refund: money(0), kept: money(145_000), freeCancelUntil: '', inFreePeriod: false, refunded: false });
    expect(cc.text).not.toContain('изцяло');
    expect(cc.text).not.toContain('Възстановяването тръгва');
    expect(cc.text).toContain('Политика: Строга — депозитът не се връща; остатъкът се възстановява до 14 дни преди събитието');
    expect(cc.text).toContain(`Другите ви резервации за ${date('2026-06-14').replace(/\s+\d{4}$/, '')} остават непроменени.`);
    const [bell] = await bells(client.user.id, 'client-cancel-confirmed');
    expect(bell.body).toBe(`Анулирахте резервацията си при ${partner.partner.businessName} за ${date('2026-06-14')}.`);
    const [vc] = await emails('vendor-client-cancelled', partner.user.id);
    expect(vc.text).not.toContain('безплатния срок');
    expect(vc.vars).toMatchObject({ partnerAmount: money(137_750) });
    await runJobs();
    expect(await emails('client-refund-sent', client.user.id)).toHaveLength(0);
    expect((await reloadBooking(other.booking.id)).status).toBe('confirmed');
    await expectLedgerHealthy();
  });

  it('refuses other people, wrong states, missing reasons, open disputes and past events', async () => {
    setTestNow(at('2025-08-31'));
    const { client, partner, booking: b } = await paidBooking();
    const stranger = await createClient();
    expect(await failure(cancelByClient(stranger.actor, { bookingId: b.id, reason: 'date_change' }))).toContain('Forbidden');
    expect(await failure(cancelByClient(partner.actor, { bookingId: b.id, reason: 'date_change' }))).toContain('Forbidden');
    expect(await failure(cancelByClient(client.actor, { bookingId: b.id, reason: 'other' }))).toContain('reason_required');

    const unpaid = await paidBooking({ client, status: 'awaiting_payment' });
    expect(await failure(cancelByClient(client.actor, { bookingId: unpaid.booking.id, reason: 'date_change' }))).toContain('not_cancellable');

    await openByClient(client.actor, { bookingId: b.id, reason: 'not_as_described', description: 'Не отговаря на описанието.' });
    expect(await clientCancelEligibility(b.id)).toEqual({ allowed: false, reason: 'dispute_open' });
    expect(await failure(cancelByClient(client.actor, { bookingId: b.id, reason: 'date_change' }))).toContain('dispute_open');

    const past = await paidBooking({ client, eventDate: '2025-08-20' });
    expect(await clientCancelEligibility(past.booking.id)).toEqual({ allowed: false, reason: 'event_passed' });
    expect(await failure(cancelByClient(client.actor, { bookingId: past.booking.id, reason: 'date_change' }))).toContain('event_passed');
    expect((await reloadBooking(past.booking.id)).status).toBe('confirmed');
    await expectLedgerHealthy();
  });
});

describe('K8–K10 partner cancellation through the team', () => {
  it('K8 request → K9 completion: full refund, partner 0,00 €, team emails to resolve_disputes only', async () => {
    setTestNow(at('2025-08-31'));
    const { actor: admin, user: adminUser } = await createAdmin('admin');
    const { user: mod } = await createAdmin('moderator');
    const { user: acc, actor: accounting } = await createAdmin('accounting');
    const { client, partner, booking: b } = await paidBooking();

    const other = await paidBooking();
    expect(await failure(requestPartnerCancellation(partner.actor, { bookingId: other.booking.id }))).toContain('Forbidden');
    expect(await failure(requestPartnerCancellation(client.actor, { bookingId: b.id }))).toContain('Forbidden');

    const { requestId } = await requestPartnerCancellation(partner.actor, { bookingId: b.id });
    expect((await reloadBooking(b.id)).status).toBe('cancellation_requested');
    expect(await emails('vendor-cancel-requested', partner.user.id)).toHaveLength(1);
    expect(await emails('team-vendor-cancel', adminUser.id)).toHaveLength(1);
    expect(await emails('team-vendor-cancel', mod.id)).toHaveLength(1);
    expect(await emails('team-vendor-cancel', acc.id)).toHaveLength(0);
    const [tv] = await emails('team-vendor-cancel', adminUser.id);
    expect(tv.vars).toMatchObject({ bookingNo: b.number, clientPhone: b.contactPhone, paid: money(145_000), partnerPhone: partner.partner.phone });
    expect(await failure(requestPartnerCancellation(partner.actor, { bookingId: b.id }))).toContain('not_cancellable');

    expect(await failure(completePartnerCancellation(accounting, { bookingId: b.id }))).toContain('Forbidden');
    expect(await failure(completePartnerCancellation(partner.actor, { bookingId: b.id }))).toContain('Forbidden');
    const res = await completePartnerCancellation(admin, { bookingId: b.id });
    expect(res.quote).toMatchObject({ refundCents: 145_000, retainedCents: 0, commissionCents: 0, partnerAmountCents: 0 });
    expect(await reloadBooking(b.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'partner' });
    expect((await db.select().from(partnerCancellationRequest).where(eq(partnerCancellationRequest.id, requestId)))[0]).toMatchObject({ status: 'completed', decidedBy: adminUser.id });
    const [cv] = await emails('client-vendor-cancelled', client.user.id);
    expect(cv.vars).toMatchObject({ refund: money(145_000), paymentMethod: 'Visa •••• 4242' });
    const [vcc] = await emails('vendor-cancel-completed', partner.user.id);
    expect(vcc.vars).toMatchObject({ partnerAmount: money(0) });
    const [r] = await db.select().from(refund).where(eq(refund.bookingId, b.id));
    expect(r).toMatchObject({ reason: 'partner_cancel', applicationFeeRefundCents: 14_500 });
    await runJobs();
    const sentK9 = await emails('client-refund-sent', client.user.id);
    expect(sentK9).toHaveLength(1);
    expect(sentK9[0].text).not.toContain('безплатния срок');   // the partner cancelled: no policy period to cite
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, provider_held: 0 });
    expect(await failure(completePartnerCancellation(admin, { bookingId: b.id }))).toContain('no_cancellation_request');
    await expectLedgerHealthy();
  });

  it('K10 the team declines: confirmed again, no email', async () => {
    setTestNow(at('2025-08-31'));
    const { actor: admin } = await createAdmin('moderator');
    const { partner, booking: b } = await paidBooking();
    const { requestId } = await requestPartnerCancellation(partner.actor, { bookingId: b.id });
    await declinePartnerCancellation(admin, { bookingId: b.id });
    expect((await reloadBooking(b.id)).status).toBe('confirmed');
    expect((await db.select().from(partnerCancellationRequest).where(eq(partnerCancellationRequest.id, requestId)))[0].status).toBe('declined');
    expect(await failure(declinePartnerCancellation(admin, { bookingId: b.id }))).toContain('no_cancellation_request');
    // A new request is possible after a decline.
    await requestPartnerCancellation(partner.actor, { bookingId: b.id });
  });

  it('K10 after the event: completion is re-armed, so the booking completes and the funds are released', async () => {
    setTestNow(at('2026-06-10'));
    const { actor: admin } = await createAdmin('moderator');
    const { partner, booking: b } = await paidBooking({ eventDate: '2026-06-14' });
    await requestPartnerCancellation(partner.actor, { bookingId: b.id });
    // T13 fires while the request is open and does nothing.
    setTestNow(at('2026-06-16'));
    await runJobs();
    expect((await reloadBooking(b.id)).status).toBe('cancellation_requested');
    await declinePartnerCancellation(admin, { bookingId: b.id });
    expect((await pendingJobs(`booking:${b.id}:complete`)).length).toBe(1);
    await runJobs();
    expect((await reloadBooking(b.id)).status).toBe('completed');
    await expectLedgerHealthy();
  });
});

describe('K11 the team cancels directly', () => {
  it('defaults to the client quote, accepts the team’s own refund, needs a reason', async () => {
    setTestNow(at('2026-05-20'));
    const { actor: admin } = await createAdmin('admin');
    const { client, partner, booking: b } = await paidBooking();
    expect(await failure(cancelByTeam(admin, { bookingId: b.id, reason: '  ' }))).toContain('reason_required');
    expect(await failure(cancelByTeam(admin, { bookingId: b.id, reason: 'x', refundCents: 145_001 }))).toContain('bad_refund_amount');
    expect(await failure(cancelByTeam(partner.actor, { bookingId: b.id, reason: 'x' }))).toContain('Forbidden');
    const res = await cancelByTeam(admin, { bookingId: b.id, reason: 'Залата затвори.', refundCents: 50_000 });
    expect(res.quote).toMatchObject({ refundCents: 50_000, retainedCents: 95_000, commissionCents: 9_500, partnerAmountCents: 85_500 });
    expect(await reloadBooking(b.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'team' });
    const [c] = await db.select().from(cancellation).where(eq(cancellation.bookingId, b.id));
    expect(c).toMatchObject({ initiatedBy: 'team', reasonText: 'Залата затвори.', retainedCents: 95_000 });
    expect(await emails('client-vendor-cancelled', client.user.id)).toHaveLength(1);
    expect(await emails('vendor-cancel-completed', partner.user.id)).toHaveLength(1);
    await runJobs();
    expect((await bookingBalances(db, b.id)).client_funds).toBe(95_000);

    const d = await paidBooking();
    const def = await cancelByTeam(admin, { bookingId: d.booking.id, reason: 'По решение на екипа.' });
    expect(def.quote).toMatchObject({ daysBefore: 25, refundCents: 101_500, retainedCents: 43_500 });
    await expectLedgerHealthy();
  });
});

describe('K12 cancelled for non-payment', () => {
  it('computes a client cancellation capped by the paid deposit, and is idempotent', async () => {
    setTestNow(at('2026-06-07', 10));
    const { booking: b } = await paidBooking({ paidCents: 43_500 });
    const res = await cancelForNonPayment({ bookingId: b.id });
    expect(res!.quote).toMatchObject({ daysBefore: 7, paidCents: 43_500, retainedCents: 43_500, refundCents: 0, partnerAmountCents: 39_150 });
    expect(await reloadBooking(b.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'non_payment' });
    expect(await db.select().from(refund).where(eq(refund.bookingId, b.id))).toHaveLength(0);
    expect(await cancelForNonPayment({ bookingId: b.id })).toBeNull();
    setTestNow(sofiaInstant('2026-06-15', 0, 5));
    await runJobs();
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, partner_payable: 39_150, commission_revenue: 4_350 });
    await expectLedgerHealthy();
  });
});

describe('open cases block direct cancellation (K9, K11)', () => {
  it('sends the team to the dispute decision instead', async () => {
    setTestNow(at('2025-08-31'));
    const { actor: admin } = await createAdmin('admin');
    const { client, partner, booking: b } = await paidBooking();
    await requestPartnerCancellation(partner.actor, { bookingId: b.id });
    await openByClient(client.actor, { bookingId: b.id, reason: 'other', description: 'Изпълнителят иска да анулира.' });
    expect(await failure(completePartnerCancellation(admin, { bookingId: b.id }))).toContain('dispute_open');
    expect(await failure(cancelByTeam(admin, { bookingId: b.id, reason: 'x' }))).toContain('dispute_open');
    expect((await reloadBooking(b.id)).status).toBe('cancellation_requested');
  });
});

