// Payments (SPEC §4.8, §7): C1/C2 start, C3 → K5 confirmation (ledger L1,
// commission snapshot §6, invoice §9, R9/O5), C4/C5 failures, duplicates,
// the deposit schedule (T9/T10), the provider hold limit (T18), the other
// provider events and the webhook route.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, count, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { addDays, date, dateShort, money, moneyShort, sofiaInstant } from '@/lib/format';
import { ForbiddenError } from '@/lib/domain/actor';
import { getBookingForPartner } from '@/lib/domain/bookings';
import { getPaymentPage, getTestCheckout, holdLimitJob, startPayment } from '@/lib/domain/charges';
import { bookingBalances } from '@/lib/domain/ledger';
import { approveRequest, sendQuote } from '@/lib/domain/requests';
import { simulatedProvider } from '@/lib/payments/simulated';
import { applyProviderEvent } from '@/lib/payments/apply';
import { createClient, createPartner } from '../helpers/factories';
import {
  EVENT, H, NOW, approvedBooking, bell, bookingRow, emails, expectLedgerHealthy, failure, forceSetting, jobs, paidBooking, requestRow, sendFor, tickAt,
} from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterEach(async () => { await expectLedgerHealthy(); setTestNow(null); });

const DAY = 24 * H;
const succeed = (chargeId: string, extra: Record<string, string> = {}) =>
  applyProviderEvent({ type: 'charge.succeeded', chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242', ...extra });
const chargeRow = async (id: string) => (await db.select().from(s.charge).where(eq(s.charge.id, id)))[0];
const invoicesOf = (bookingId: string) => db.select().from(s.invoice).where(eq(s.invoice.bookingId, bookingId)).orderBy(s.invoice.createdAt);

describe('C1 card checkout and C2 bank transfer', () => {
  it('creates a pending card charge with the provider checkout, and reuses it on a second press', async () => {
    const { client, partner, number, bookingId, paymentDueAt } = await approvedBooking();
    const r = await startPayment(client.actor, { number, method: 'card' });
    expect(r).toMatchObject({ kind: 'redirect', redirectUrl: `/plashtane/test/${r.chargeId}` });
    expect(await chargeRow(r.chargeId)).toMatchObject({
      bookingId, kind: 'full', method: 'card', provider: 'simulated', amountCents: 145_000, applicationFeeCents: 7_250, status: 'pending', dueAt: paymentDueAt,
    });
    expect((await chargeRow(r.chargeId)).providerRef).toMatch(/^sim_pi_/);
    expect((await startPayment(client.actor, { number, method: 'card' })).chargeId).toBe(r.chargeId);
    expect((await failure(startPayment((await createClient()).actor, { number, method: 'card' }))).code).toBe('not_found');
    expect(await failure(startPayment(partner.actor, { number, method: 'card' }))).toBeInstanceOf(ForbiddenError);
    expect(await getPaymentPage(client.actor, number)).toMatchObject({ payable: true, kind: 'full', amountDueCents: 145_000, bankTransferEnabled: true });
    setTestNow(new Date(paymentDueAt.getTime() + 1));
    expect((await failure(startPayment(client.actor, { number, method: 'card' }))).code).toBe('deadline_passed');
  });

  it('gives the bank-transfer instructions once (reference = the number) and honours the switch', async () => {
    const { client, number } = await approvedBooking({ partner: { businessName: 'Студио Мелодия' } });
    const r = await startPayment(client.actor, { number, method: 'bank_transfer' });
    expect(r).toMatchObject({ kind: 'bank_transfer', recipient: 'EventAT', iban: 'BG80 BNBG 9661 1020 3456 78', reference: number, amountCents: 145_000 });
    expect(await chargeRow(r.chargeId)).toMatchObject({ status: 'awaiting_transfer', method: 'bank_transfer', transferReference: number });
    expect((await startPayment(client.actor, { number, method: 'bank_transfer' })).chargeId).toBe(r.chargeId);
    const sent = await emails('client-bank-transfer', client.user.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].vars).toMatchObject({ requestNo: number, amount: money(145_000), iban: 'BG80 BNBG 9661 1020 3456 78', partnerName: 'Студио Мелодия' });
    expect((await getPaymentPage(client.actor, number)).openTransfer).toMatchObject({ chargeId: r.chargeId, reference: number });

    const other = await approvedBooking();
    await forceSetting('payment.bank_transfer_enabled', false);
    expect((await failure(startPayment(other.client.actor, { number: other.number, method: 'bank_transfer' }))).code).toBe('not_allowed');
    await forceSetting('payment.bank_transfer_enabled', true);
  });
});

describe('C3 → K5 confirmation', () => {
  it('confirms the booking: L1, commission snapshot, invoice, payout line, jobs, emails and bells', async () => {
    const client = await createClient({ name: 'Мария Димитрова' });
    const partner = await createPartner({ businessName: 'Студио Мелодия' });
    const a = await approvedBooking({ c: client, p: partner });
    const pay = await startPayment(client.actor, { number: a.number, method: 'card' });
    expect(await succeed(pay.chargeId)).toEqual({ applied: true, bookingConfirmed: true });

    const b = await bookingRow(a.bookingId);
    expect(b).toMatchObject({ status: 'confirmed', paidAt: NOW, commissionBp: 500 });
    expect(await chargeRow(pay.chargeId)).toMatchObject({ status: 'succeeded', succeededAt: NOW, cardBrand: 'visa', cardLast4: '4242', applicationFeeCents: 7_250 });
    expect(await bookingBalances(db, a.bookingId)).toMatchObject({ provider_held: 145_000, client_funds: 145_000, partner_payable: 0 });

    const [inv] = await invoicesOf(a.bookingId);
    expect(inv).toMatchObject({
      type: 'invoice', issuerType: 'partner', issuerKey: partner.partner.id, number: '0000000001', chargeId: pay.chargeId, totalCents: 145_000,
      subtotalCents: 145_000, vatCents: 0, recipientType: 'individual', recipientName: 'Мария Димитрова', place: 'София', issuedOn: '2025-08-31',
      paymentNote: 'Карта Visa •••• 4242', issuerLegalName: 'Студио Мелодия ЕООД',
    });
    const lines = await db.select().from(s.invoiceLine).where(eq(s.invoiceLine.invoiceId, inv.id));
    expect(lines).toMatchObject([{ position: 1, description: 'Пакет „Цял ден“ · DJ и озвучаване', totalCents: 145_000, quantity: 1 }]);
    const [line] = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, a.bookingId));
    expect(line).toMatchObject({ status: 'awaiting_event', baseCents: 145_000, commissionCents: 7_250, amountCents: 137_750, batchDate: '2026-06-15' });

    const js = Object.fromEntries((await jobs(`booking:${a.bookingId}:`)).map(j => [j.dedupeKey!.split(':').slice(2).join(':'), j.status]));
    expect(js).toMatchObject({ payexpire: 'cancelled', 'payrem:6': 'cancelled', 'payrem:2': 'cancelled', vpayrem: 'cancelled', teamalert: 'cancelled', complete: 'pending', reviewinvite: 'pending' });

    const [ce] = await emails('client-booking-confirmed', client.user.id);
    expect(ce.subject).toBe(`Резервацията ви е потвърдена — Студио Мелодия, ${date(EVENT)}`);
    expect(ce.vars).toMatchObject({ paymentMethod: 'Visa •••• 4242', freeCancelUntil: date('2026-05-15'), packageName: 'Цял ден', amount: money(145_000) });
    expect((await emails('client-invoice', client.user.id))[0].vars).toMatchObject({ invoiceNo: '0000000001', partnerLegalName: 'Студио Мелодия ЕООД', amount: money(145_000) });
    const [pe] = await emails('vendor-booking-confirmed', partner.user.id);
    expect(pe.vars).toMatchObject({ clientPhone: '+359 88 800 0000', partnerAmount: money(137_750), payoutDate: date('2026-06-15'), hosts: 'Мария Димитрова' });
    const cb = await bell(client.user.id);
    expect(cb.map(n => n.title)).toEqual(expect.arrayContaining([`Резервацията за ${dateShort(EVENT)} е потвърдена`, 'Фактура № 0000000001']));
    expect(cb.find(n => n.kind === 'client-booking-confirmed')?.body).toBe('Студио Мелодия · Пакет „Цял ден“');
    expect((await bell(partner.user.id))[0]).toMatchObject({
      title: `Плащане получено · ${moneyShort(137_750)}`, body: `Сватба · ${dateShort(EVENT)} · Мария Димитрова`, href: `/partner/rezervacii/${a.number}`,
    });

    // Idempotent: the same provider event again changes nothing.
    expect(await succeed(pay.chargeId)).toEqual({ applied: false, reason: 'already_succeeded' });
    const [{ n }] = await db.select({ n: count() }).from(s.ledgerTransaction).where(eq(s.ledgerTransaction.bookingId, a.bookingId));
    expect(n).toBe(1);
    expect(await invoicesOf(a.bookingId)).toHaveLength(1);
    expect(await emails('client-booking-confirmed', client.user.id)).toHaveLength(1);
    expect((await failure(startPayment(client.actor, { number: a.number, method: 'card' }))).code).toBe('invalid_state');
  });

  it('numbers invoices per partner with no gaps, even when a payment transaction rolls back', async () => {
    const p = await createPartner();
    const one = await paidBooking({ p });
    const two = await paidBooking({ p, request: { eventDate: '2026-06-20' } });
    const q = await paidBooking();
    expect((await invoicesOf(one.bookingId))[0].number).toBe('0000000001');
    expect((await invoicesOf(two.bookingId))[0].number).toBe('0000000002');
    expect((await invoicesOf(q.bookingId))[0].number).toBe('0000000001');

    const three = await approvedBooking({ p, request: { eventDate: '2026-06-21' } });
    const pay = await startPayment(three.client.actor, { number: three.number, method: 'card' });
    await expect(db.transaction(async t => {
      await applyProviderEvent({ type: 'charge.succeeded', chargeId: pay.chargeId, providerRef: '' }, t);
      throw new Error('rollback');
    })).rejects.toThrow('rollback');
    expect((await chargeRow(pay.chargeId)).status).toBe('pending');
    await succeed(pay.chargeId);
    expect((await invoicesOf(three.bookingId))[0].number).toBe('0000000003');
  });

  it('confirms a charge that failed earlier in the same checkout, and records a failure without touching the booking (C4, C5)', async () => {
    const a = await approvedBooking();
    const first = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    expect(await applyProviderEvent({ type: 'charge.failed', chargeId: first.chargeId, reason: 'card_declined' })).toEqual({ applied: true });
    expect(await chargeRow(first.chargeId)).toMatchObject({ status: 'failed', failureReason: 'card_declined' });
    expect((await bookingRow(a.bookingId)).status).toBe('awaiting_payment');
    expect((await getPaymentPage(a.client.actor, a.number)).lastAttemptFailed).toBe(true);
    expect((await applyProviderEvent({ type: 'charge.failed', chargeId: first.chargeId, reason: 'again' })).applied).toBe(false);

    const second = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    expect(second.chargeId).not.toBe(first.chargeId);
    await applyProviderEvent({ type: 'charge.failed', chargeId: second.chargeId, reason: 'expired' });
    expect((await chargeRow(second.chargeId)).status).toBe('expired');

    expect(await succeed(first.chargeId)).toMatchObject({ applied: true, bookingConfirmed: true });
    expect((await bookingRow(a.bookingId)).status).toBe('confirmed');
    expect((await applyProviderEvent({ type: 'charge.succeeded', chargeId: '00000000-0000-0000-0000-000000000000', providerRef: '' })).reason).toBe('unknown_charge');
  });
});

describe('duplicates and late money (§4.8)', () => {
  it('flags a second payment as a duplicate, holds it and never releases it to the partner', async () => {
    const a = await approvedBooking();
    const transfer = await startPayment(a.client.actor, { number: a.number, method: 'bank_transfer' });
    const card = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    await succeed(card.chargeId);
    expect(await succeed(transfer.chargeId)).toEqual({ applied: true, duplicate: true });
    expect(await chargeRow(transfer.chargeId)).toMatchObject({ status: 'succeeded', isDuplicate: true, cardLast4: null });
    expect((await bookingBalances(db, a.bookingId)).client_funds).toBe(290_000);
    expect(await invoicesOf(a.bookingId)).toHaveLength(1);

    await tickAt(sofiaInstant('2026-06-15', 0, 0));
    expect(await bookingBalances(db, a.bookingId)).toMatchObject({ client_funds: 145_000, partner_payable: 137_750 });
    const [line] = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, a.bookingId));
    expect(line).toMatchObject({ status: 'ready', baseCents: 145_000 });
  });

  it('records money that arrives after the payment window closed as a duplicate on the expired booking', async () => {
    const a = await approvedBooking();
    const transfer = await startPayment(a.client.actor, { number: a.number, method: 'bank_transfer' });
    await tickAt(a.paymentDueAt);
    expect((await bookingRow(a.bookingId)).status).toBe('payment_expired');
    expect((await chargeRow(transfer.chargeId)).status).toBe('expired');
    expect(await succeed(transfer.chargeId)).toEqual({ applied: true, duplicate: true });
    expect((await bookingRow(a.bookingId)).status).toBe('payment_expired');
    const [audit] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, transfer.chargeId), eq(s.auditLog.action, 'charge.duplicate')));
    expect(audit.data).toMatchObject({ bookingStatus: 'payment_expired' });
  });
});

describe('commission snapshot (SPEC §6, D7)', () => {
  it('gives a partner\'s first three paid bookings the intro rate, keeps the slot after a cancellation, and lets intro win over business', async () => {
    const p = await createPartner();
    const dates = ['2026-06-14', '2026-06-20', '2026-06-21', '2026-06-27', '2026-06-28'];
    const paid = [];
    for (const d of dates.slice(0, 3)) paid.push(await paidBooking({ p, request: { eventDate: d } }));
    expect((await Promise.all(paid.map(x => bookingRow(x.bookingId)))).map(b => b.commissionBp)).toEqual([500, 500, 500]);
    await db.update(s.booking).set({ status: 'cancelled', cancelledBy: 'client' }).where(eq(s.booking.id, paid[0].bookingId));

    const fourth = await approvedBooking({ p, request: { eventDate: dates[3] } });
    expect((await getBookingForPartner(p.actor, fourth.number)).money.partnerAmountCents).toBe(130_500); // projected at 10 %
    const pay = await startPayment(fourth.client.actor, { number: fourth.number, method: 'card' });
    expect((await chargeRow(pay.chargeId)).applicationFeeCents).toBe(14_500);
    await succeed(pay.chargeId);
    expect((await bookingRow(fourth.bookingId)).commissionBp).toBe(1_000);

    await forceSetting('commission.business_bp', 800);
    const business = await createClient({ clientType: 'business' });
    const fifth = await paidBooking({ p, c: business, request: { eventDate: dates[4] } });
    expect((await bookingRow(fifth.bookingId)).commissionBp).toBe(800);
    const fresh = await paidBooking({ c: business, request: { eventDate: '2026-07-04' } });
    expect((await bookingRow(fresh.bookingId)).commissionBp).toBe(500);
    await forceSetting('commission.business_bp', 1_000);
  });
});

describe('R9 and O5 when a payment fills the date (D64)', () => {
  it('declines the other pending requests and lapses the open offers for that date', async () => {
    const p = await createPartner({ businessName: 'Студио Мелодия' });
    const [a, b, c] = [await createClient(), await createClient(), await createClient()];
    const ra = await sendFor(a, p);
    const rb = await sendFor(b, p);
    const [quote] = await db.insert(s.service).values({
      partnerId: p.partner.id, kind: 'on_request', name: 'Фирмени събития', categoryId: p.service.categoryId, description: 'По запитване.',
      priceCents: null, status: 'active', publishedAt: NOW,
    }).returning();
    const rc = await sendFor(c, p, { serviceId: quote.id });
    const { offerId } = await sendQuote(p.actor, { number: rc.number, title: 'Оферта', amountCents: 90_000 });
    const rcRow = await requestRow(rc.requestId);
    const [br] = await db.insert(s.brief).values({
      clientId: c.user.id, clientEventId: rcRow.clientEventId, eventTypeId: rcRow.eventTypeId, eventDate: EVENT, cityId: p.partner.cityId!,
      guests: 80, contactPhone: '+359888000000', offersDueAt: new Date(NOW.getTime() + DAY),
    }).returning();
    const [inv] = await db.insert(s.briefInvitation).values({ briefId: br.id, partnerId: p.partner.id, status: 'offered', offerDueAt: new Date(NOW.getTime() + DAY) }).returning();
    const [briefOffer] = await db.insert(s.offer).values({ invitationId: inv.id, partnerId: p.partner.id, title: 'Оферта по запитване', amountCents: 80_000 }).returning();

    await approveRequest(p.actor, { number: ra.number });
    const pay = await startPayment(a.actor, { number: ra.number, method: 'card' });
    await succeed(pay.chargeId);

    expect(await requestRow(rb.requestId)).toMatchObject({ status: 'declined', declineReason: 'date_taken' });
    expect((await emails('client-request-declined', b.user.id))[0].vars).toMatchObject({ reason: 'Датата е заета', partnerName: 'Студио Мелодия' });
    expect((await jobs(`request:${rb.requestId}:`)).every(j => j.status === 'cancelled')).toBe(true);
    expect(await requestRow(rc.requestId)).toMatchObject({ status: 'expired' });
    const offers = await db.select().from(s.offer).where(eq(s.offer.partnerId, p.partner.id));
    expect(offers.find(o => o.id === offerId)?.status).toBe('lapsed');
    expect(offers.find(o => o.id === briefOffer.id)?.status).toBe('lapsed');
    expect(await emails('client-request-declined', c.user.id)).toHaveLength(0); // R10: no email
  });
});

describe('the provider hold limit: T18 early release (§7.4)', () => {
  it('releases the charge\'s partner share before the limit and completes with nothing left to release', async () => {
    await forceSetting('payment.provider_max_hold_days', 90);
    try {
      const a = await paidBooking();
      const [hl] = await jobs(`charge:${a.chargeId}:holdlimit`);
      expect(hl.runAt).toEqual(new Date(NOW.getTime() + 83 * DAY));
      await tickAt(hl.runAt);
      const lines = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, a.bookingId));
      const early = lines.find(l => l.chargeId === a.chargeId)!;
      expect(early).toMatchObject({ status: 'released_early', baseCents: 145_000, commissionCents: 7_250, amountCents: 137_750, batchDate: '2025-12-01' });
      expect(await bookingBalances(db, a.bookingId)).toMatchObject({ client_funds: 0, partner_payable: 137_750, commission_revenue: 7_250 });
      await holdLimitJob({ chargeId: a.chargeId });
      expect(await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, a.bookingId))).toHaveLength(2);

      await tickAt(sofiaInstant('2026-06-15', 0, 0));
      expect((await bookingRow(a.bookingId)).status).toBe('completed');
      const main = (await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, a.bookingId))).find(l => !l.chargeId)!;
      expect(main).toMatchObject({ status: 'cancelled', baseCents: 0 });
      expect((await bookingBalances(db, a.bookingId)).partner_payable).toBe(137_750);
    } finally {
      await forceSetting('payment.provider_max_hold_days', null);
    }
  });
});

describe('the deposit schedule: T9 balance charge and T10 retries (§7.2)', () => {
  it('charges a deposit, then the balance off-session with the saved card', async () => {
    await forceSetting('payment.schedule', { mode: 'deposit_balance', deposit_percent: null, balance_due_days: 30 });
    try {
      const a = await approvedBooking();
      expect(await bookingRow(a.bookingId)).toMatchObject({
        paymentMode: 'deposit_balance', dueNowCents: 43_500, depositPayCents: 43_500, balanceCents: 101_500, balanceDueDate: '2026-05-15',
      });
      const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
      expect(await chargeRow(pay.chargeId)).toMatchObject({ kind: 'deposit', amountCents: 43_500, applicationFeeCents: 2_175 });
      await succeed(pay.chargeId, { customerRef: 'cus_test', paymentMethodRef: 'pm_test' });
      expect((await bookingRow(a.bookingId)).status).toBe('confirmed');
      const [t9] = await jobs(`booking:${a.bookingId}:balance`);
      expect(t9).toMatchObject({ kind: 'booking.balance_charge', runAt: sofiaInstant('2026-05-15', 10, 0) });

      await tickAt(sofiaInstant('2026-05-15', 10, 0));
      const balance = (await db.select().from(s.charge).where(and(eq(s.charge.bookingId, a.bookingId), eq(s.charge.kind, 'balance'))));
      expect(balance).toMatchObject([{ status: 'succeeded', amountCents: 101_500, applicationFeeCents: 5_075, cardLast4: '4242' }]);
      expect((await invoicesOf(a.bookingId)).map(i => [i.number, i.totalCents])).toEqual([['0000000001', 43_500], ['0000000002', 101_500]]);
      expect((await bookingBalances(db, a.bookingId)).client_funds).toBe(145_000);
      expect((await failure(startPayment(a.client.actor, { number: a.number, method: 'card' }))).code).toBe('invalid_state');

      setTestNow(NOW);
      const near = await approvedBooking({ request: { eventDate: '2025-09-20' } });
      expect(await bookingRow(near.bookingId)).toMatchObject({ dueNowCents: 145_000, balanceCents: 0, depositPayCents: null });
    } finally {
      await forceSetting('payment.schedule', { mode: 'full', deposit_percent: null, balance_due_days: 30 });
    }
  });

  it('retries a failed balance every 24 h, three times, then reaches the last check seven days before the event', async () => {
    await forceSetting('payment.schedule', { mode: 'deposit_balance', deposit_percent: 20, balance_due_days: 30 });
    const original = simulatedProvider.chargeOffSession;
    simulatedProvider.chargeOffSession = async ({ chargeId }) => ({ providerRef: `sim_pi_${chargeId.slice(0, 8)}`, status: 'failed', reason: 'card_declined' });
    try {
      const a = await approvedBooking({ request: { eventDate: '2026-06-20' } });
      const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
      expect((await chargeRow(pay.chargeId)).amountCents).toBe(29_000);
      await succeed(pay.chargeId, { customerRef: 'cus_test', paymentMethodRef: 'pm_test' });
      const t9 = sofiaInstant('2026-05-21', 10, 0);
      await tickAt(t9);
      for (let n = 1; n <= 3; n++) {
        const [retry] = await jobs(`booking:${a.bookingId}:balanceretry:${n}`);
        expect(retry).toMatchObject({ status: 'pending', runAt: new Date(t9.getTime() + n * DAY) });
        await tickAt(retry.runAt);
      }
      const failed = await db.select().from(s.charge).where(and(eq(s.charge.bookingId, a.bookingId), eq(s.charge.kind, 'balance')));
      expect(failed.map(c => c.status)).toEqual(['failed', 'failed', 'failed', 'failed']);
      const [last] = await jobs(`booking:${a.bookingId}:balancedefault`);
      expect(last.runAt).toEqual(sofiaInstant(addDays('2026-06-20', -7), 10, 0));
      await tickAt(last.runAt);
      const [audit] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, a.bookingId), eq(s.auditLog.action, 'booking.balance_defaulted')));
      expect(audit.data).toMatchObject({ balanceCents: 116_000 });
    } finally {
      simulatedProvider.chargeOffSession = original;
      await forceSetting('payment.schedule', { mode: 'full', deposit_percent: null, balance_due_days: 30 });
    }
  });
});

describe('the deposit schedule when the client is paying the balance at T9 (§7.2)', () => {
  it('does not charge twice, retries, and still reaches the last check seven days before the event (T10)', async () => {
    await forceSetting('payment.schedule', { mode: 'deposit_balance', deposit_percent: null, balance_due_days: 30 });
    try {
      const a = await approvedBooking();
      const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
      await succeed(pay.chargeId, { customerRef: 'cus_test', paymentMethodRef: 'pm_test' });
      const last = sofiaInstant('2026-06-07', 10, 0);
      expect((await jobs(`booking:${a.bookingId}:balancedefault`))[0]).toMatchObject({ status: 'pending', runAt: last });

      setTestNow(sofiaInstant('2026-05-14', 12, 0));
      const open = await startPayment(a.client.actor, { number: a.number, method: 'card' }); // balance checkout, never finished
      expect((await chargeRow(open.chargeId))).toMatchObject({ kind: 'balance', status: 'pending' });
      const t9 = sofiaInstant('2026-05-15', 10, 0);
      await tickAt(t9);
      const balance = () => db.select().from(s.charge).where(and(eq(s.charge.bookingId, a.bookingId), eq(s.charge.kind, 'balance')));
      expect(await balance()).toHaveLength(1);
      for (let n = 1; n <= 3; n++) {
        const [retry] = await jobs(`booking:${a.bookingId}:balanceretry:${n}`);
        expect(retry).toMatchObject({ status: 'pending', runAt: new Date(t9.getTime() + n * DAY) });
        await tickAt(retry.runAt);
      }
      expect(await balance()).toHaveLength(1);
      await tickAt(last);
      const [audit] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, a.bookingId), eq(s.auditLog.action, 'booking.balance_defaulted')));
      expect(audit?.data).toMatchObject({ balanceCents: 101_500 });
    } finally {
      await forceSetting('payment.schedule', { mode: 'full', deposit_percent: null, balance_due_days: 30 });
    }
  });
});

describe('bank transfer availability (D6)', () => {
  it('is offered only while the provider can issue transfer instructions', async () => {
    const a = await approvedBooking();
    expect((await getPaymentPage(a.client.actor, a.number)).bankTransferEnabled).toBe(true);
    await forceSetting('payment.provider', 'stripe');
    try {
      expect((await getPaymentPage(a.client.actor, a.number)).bankTransferEnabled).toBe(false);
    } finally {
      await forceSetting('payment.provider', 'simulated');
    }
  });
});

describe('other provider events, the simulated checkout guard and the webhook route', () => {
  it('applies account.updated (P11) and records events other modules handle', async () => {
    const p = await createPartner();
    await db.update(s.partner).set({ providerAccountRef: `acct_${p.partner.id.slice(0, 8)}` }).where(eq(s.partner.id, p.partner.id));
    const r = await applyProviderEvent({ type: 'account.updated', accountRef: `acct_${p.partner.id.slice(0, 8)}`, status: { chargesEnabled: true, payoutsEnabled: false, requirementsDue: ['external_account'] } });
    expect(r).toEqual({ applied: true });
    const [row] = await db.select().from(s.partner).where(eq(s.partner.id, p.partner.id));
    expect(row).toMatchObject({ providerChargesEnabled: true, providerPayoutsEnabled: false, providerRequirements: ['external_account'], providerStatus: 'restricted' });
    expect((await applyProviderEvent({ type: 'account.updated', accountRef: 'acct_unknown', status: { chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] } })).applied).toBe(false);
    expect(await applyProviderEvent({ type: 'refund.succeeded', refundRef: 're_1' })).toEqual({ applied: false, reason: 'unhandled' });
    const [a] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'provider.event_unhandled'));
    expect(a.entityId).toBe('refund.succeeded');
  });

  it('opens the test checkout only for the owner, only with the simulated provider', async () => {
    const a = await approvedBooking();
    const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    expect(await getTestCheckout(a.client.actor, pay.chargeId)).toMatchObject({ number: a.number, amountCents: 145_000, method: 'card', status: 'pending' });
    expect(await getTestCheckout((await createClient()).actor, pay.chargeId)).toBeNull();
    expect(await getTestCheckout(a.client.actor, 'not-a-uuid')).toBeNull();
    expect(await failure(getTestCheckout(a.partner.actor, pay.chargeId))).toBeInstanceOf(ForbiddenError);
    await forceSetting('payment.provider', 'stripe');
    expect(await getTestCheckout(a.client.actor, pay.chargeId)).toBeNull();
    await forceSetting('payment.provider', 'simulated');
  });

  it('answers the webhook with 200 when there is nothing to apply', async () => {
    const { POST } = await import('@/app/api/webhooks/stripe/route');
    const res = await POST(new Request('http://localhost/api/webhooks/stripe', { method: 'POST', body: '{}' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: 0 });
  });
});
