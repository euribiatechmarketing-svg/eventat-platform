// Bookings (SPEC §4.7) up to completion: K2 reminder, K3 extension, K4
// withdrawal, T5–T8 payment timers, T11/T12 reminders, T13 completion (L3),
// T14 review invite, view models, and the client event folders (§16).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { date, dateTime, money, sofiaInstant } from '@/lib/format';
import { ForbiddenError } from '@/lib/domain/actor';
import {
  LIFECYCLE_JOBS, addMonths, clientEventReminderJob, clientPayReminderJob, completeBooking, expirePaymentJob, partnerEventReminderJob,
  partnerPayReminderJob, teamPaymentAlertJob, extendPaymentDeadline, firstPayoutDay, freeCancelUntil, getBookingForAdmin, getBookingForClient,
  getBookingForPartner, isoWeekday, markPayoutLineReady, paymentPlan, releaseToPartner, remindClient, reviewInviteJob, withdrawApproval,
} from '@/lib/domain/bookings';
import { startPayment } from '@/lib/domain/charges';
import { getClientEvent, listClientEvents, saveNotes } from '@/lib/domain/events';
import { bookingBalances } from '@/lib/domain/ledger';
import { approveRequest } from '@/lib/domain/requests';
import { DEFAULT_CANCELLATION_POLICIES } from '@/lib/domain/settings';
import { SYSTEM } from '@/lib/domain/actor';
import { applyProviderEvent } from '@/lib/payments/apply';
import { JOB_HANDLERS } from '@/lib/jobs/handlers';
import { createAdmin, createClient, createPartner } from '../helpers/factories';
import { confirmPayoutAccount } from '../helpers/aftercare';
import {
  EVENT, H, NOW, approvedBooking, bell, bookingRow, emails, expectLedgerHealthy, failure, jobs, paidBooking, sendFor, tickAt,
} from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterEach(async () => { await expectLedgerHealthy(); setTestNow(null); });

const DAY = 24 * H;

async function openDispute(bookingId: string, number: string) {
  const [d] = await db.insert(s.dispute).values({
    number, bookingId, openedBy: 'client', reason: 'payment_problem', title: 'Цената за плащане е различна',
    summary: 'одобрената сума е 1 450,00 €, а за плащане излиза друга.', description: 'Описание на клиента.', positionFrom: 'partner',
    teamReplyDueAt: new Date(NOW.getTime() + DAY), positionRequestedAt: NOW, positionDueAt: new Date(NOW.getTime() + 2 * DAY), holdsPayout: true,
  }).returning();
  return d;
}

describe('pure rules', () => {
  it('computes payment plans, free-cancel dates, payout days and calendar helpers', () => {
    expect(paymentPlan(145_000, EVENT, '2025-08-31', { mode: 'full', deposit_percent: null, balance_due_days: 30 }, 30))
      .toEqual({ mode: 'full', dueNowCents: 145_000, depositPayCents: null, balanceCents: 0, balanceDueDate: null });
    expect(paymentPlan(145_000, EVENT, '2025-08-31', { mode: 'deposit_balance', deposit_percent: null, balance_due_days: 30 }, 30))
      .toEqual({ mode: 'deposit_balance', dueNowCents: 43_500, depositPayCents: 43_500, balanceCents: 101_500, balanceDueDate: '2026-05-15' });
    expect(paymentPlan(145_000, '2025-09-20', '2025-08-31', { mode: 'deposit_balance', deposit_percent: 20, balance_due_days: 30 }, 30))
      .toMatchObject({ dueNowCents: 145_000, balanceCents: 0 });
    expect(freeCancelUntil('moderate', DEFAULT_CANCELLATION_POLICIES, EVENT)).toBe('2026-05-15');
    expect(freeCancelUntil('flexible', DEFAULT_CANCELLATION_POLICIES, EVENT)).toBe('2026-06-07');
    expect(freeCancelUntil('strict', DEFAULT_CANCELLATION_POLICIES, EVENT)).toBeNull();
    // SPEC §8 examples
    expect(firstPayoutDay('2026-06-15', [1, 15])).toBe('2026-06-15');
    expect(firstPayoutDay('2026-07-01', [1, 15])).toBe('2026-07-01');
    expect(firstPayoutDay('2025-09-01', [1, 15])).toBe('2025-09-01');
    expect(firstPayoutDay('2026-06-16', [1, 15])).toBe('2026-07-01');
    expect(addMonths('2025-08-31', 6)).toBe('2026-02-28');
    expect(addMonths('2025-08-31', 24)).toBe('2027-08-31');
    expect(isoWeekday('2026-06-14')).toBe(7);
    expect(isoWeekday('2026-06-15')).toBe(1);
  });
});

describe('job registry and idempotent handlers', () => {
  it('registers every lifecycle job kind', () => {
    for (const kind of Object.values(LIFECYCLE_JOBS)) expect(JOB_HANDLERS[kind], kind).toBeTypeOf('function');
  });

  it('sends each reminder once however often its handler runs (T5, T6, T7, T11, T12)', async () => {
    const a = await approvedBooking();
    await openDispute(a.bookingId, a.number);
    const { user: adm } = await createAdmin('admin');
    setTestNow(new Date(a.paymentDueAt.getTime() - 3 * H));
    for (let i = 0; i < 2; i++) {
      await clientPayReminderJob({ bookingId: a.bookingId, hours: 6 });
      await partnerPayReminderJob({ bookingId: a.bookingId, hours: 6 });
      await teamPaymentAlertJob({ bookingId: a.bookingId, hours: 4 });
    }
    expect(await emails('client-payment-reminder', a.client.user.id)).toHaveLength(1);
    expect(await emails('vendor-payment-reminder', a.partner.user.id)).toHaveLength(1);
    expect(await emails('team-payment-deadline', adm.id)).toHaveLength(1);

    setTestNow(NOW);
    const p = await paidBooking();
    const ev = (await bookingRow(p.bookingId)).clientEventId;
    setTestNow(sofiaInstant('2026-06-07', 9, 0));
    for (let i = 0; i < 2; i++) {
      await clientEventReminderJob({ clientEventId: ev, days: 7 });
      await partnerEventReminderJob({ bookingId: p.bookingId, days: 7 });
    }
    expect(await emails('client-event-reminder', p.client.user.id)).toHaveLength(1);
    expect(await emails('vendor-event-reminder', p.partner.user.id)).toHaveLength(1);
    // A handler whose booking moved on does nothing.
    await clientPayReminderJob({ bookingId: p.bookingId, hours: 2 });
    expect(await emails('client-payment-reminder', p.client.user.id)).toHaveLength(0);
  });
});

describe('K2 remindClient', () => {
  it('sends the client a reminder with the hours left; only the booking\'s partner, only before the deadline', async () => {
    const { client, partner, number, paymentDueAt } = await approvedBooking();
    setTestNow(new Date(NOW.getTime() + 5 * H + 20 * 60_000));
    await remindClient(partner.actor, { number });
    const [e] = await emails('client-payment-reminder', client.user.id);
    expect(e.vars).toMatchObject({ hoursLeft: 18, requestNo: number, payBy: dateTime(paymentDueAt) });
    expect(e.subject).toBe(`Остават 18 часа да платите заявка № ${number}`);
    expect((await failure(remindClient((await createPartner()).actor, { number }))).code).toBe('not_found');
    expect(await failure(remindClient(client.actor, { number }))).toBeInstanceOf(ForbiddenError);
    setTestNow(new Date(paymentDueAt.getTime() + 60_000));
    expect((await failure(remindClient(partner.actor, { number }))).code).toBe('deadline_passed');
  });
});

describe('K3 extendPaymentDeadline', () => {
  it('needs admin, or moderator with an open dispute (D39); moves the deadline, the jobs and the open transfer', async () => {
    const { client, partner, number, bookingId, paymentDueAt } = await approvedBooking({ client: { name: 'Технолинк ЕООД' } });
    const transfer = await startPayment(client.actor, { number, method: 'bank_transfer' });
    const { actor: support } = await createAdmin('support');
    const { actor: moderator } = await createAdmin('moderator');
    const { actor: admin } = await createAdmin('admin');
    expect(await failure(extendPaymentDeadline(support, { number }))).toBeInstanceOf(ForbiddenError);
    expect(await failure(extendPaymentDeadline(moderator, { number }))).toBeInstanceOf(ForbiddenError);
    expect(await failure(extendPaymentDeadline(partner.actor, { number }))).toBeInstanceOf(ForbiddenError);

    const { newDueAt } = await extendPaymentDeadline(admin, { number });
    expect(newDueAt.getTime()).toBe(paymentDueAt.getTime() + DAY);
    const b = await bookingRow(bookingId);
    expect(b.paymentExtensions).toBe(1);
    expect(b.paymentDueAt).toEqual(newDueAt);
    const [ext] = await db.select().from(s.paymentExtension).where(eq(s.paymentExtension.bookingId, bookingId));
    expect(ext).toMatchObject({ previousDueAt: paymentDueAt, newDueAt, hours: 24, disputeId: null });
    const js = Object.fromEntries((await jobs(`booking:${bookingId}:`)).map(j => [j.dedupeKey!.split(':').slice(2).join(':'), j]));
    expect(js.payexpire).toMatchObject({ status: 'pending', runAt: newDueAt });
    expect(js['payrem:6'].runAt).toEqual(new Date(newDueAt.getTime() - 6 * H));
    expect((await db.select().from(s.charge).where(eq(s.charge.id, transfer.chargeId)))[0].dueAt).toEqual(newDueAt);
    expect((await emails('client-payment-extended', client.user.id))[0].vars).toMatchObject({ extraHours: 24, newDeadline: dateTime(newDueAt) });
    expect((await emails('vendor-payment-deadline-extended', partner.user.id))[0].vars)
      .toMatchObject({ previousDeadline: dateTime(paymentDueAt), newDeadline: dateTime(newDueAt), clientName: 'Технолинк ЕООД' });

    const d = await openDispute(bookingId, number);
    await extendPaymentDeadline(moderator, { number });
    const exts = await db.select().from(s.paymentExtension).where(eq(s.paymentExtension.bookingId, bookingId));
    expect(exts).toHaveLength(2);
    expect(exts.find(e => e.disputeId)?.disputeId).toBe(d.id);
    expect(await emails('client-payment-extended', client.user.id)).toHaveLength(2);
  });
});

describe('K3 is clamped to the event start like K1 (§3, decision in §17)', () => {
  /** A partner who takes bookings for tomorrow (no lead time). */
  const lastMinutePartner = async () => {
    const p = await createPartner();
    await db.update(s.partner).set({ leadTimeDays: 0 }).where(eq(s.partner.id, p.partner.id));
    return p;
  };

  it('extends only up to the event start, says how long it really added, then refuses', async () => {
    // Event 1 September 2025 at 18:00 = NOW + 30 h; K1 gives NOW + 24 h.
    const { client, partner, number, bookingId, paymentDueAt } = await approvedBooking({ p: await lastMinutePartner(), request: { eventDate: '2025-09-01', startTime: '18:00' } });
    const eventStart = sofiaInstant('2025-09-01', 18, 0);
    expect(paymentDueAt).toEqual(new Date(NOW.getTime() + DAY));
    const { actor: admin } = await createAdmin('admin');

    const r = await extendPaymentDeadline(admin, { number });
    expect(r).toEqual({ newDueAt: eventStart, hours: 6 });
    expect((await bookingRow(bookingId)).paymentDueAt).toEqual(eventStart);
    const [ext] = await db.select().from(s.paymentExtension).where(eq(s.paymentExtension.bookingId, bookingId));
    expect(ext).toMatchObject({ previousDueAt: paymentDueAt, newDueAt: eventStart, hours: 6 });
    const js = Object.fromEntries((await jobs(`booking:${bookingId}:`)).map(j => [j.dedupeKey!.split(':').slice(2).join(':'), j]));
    expect(js.payexpire.runAt).toEqual(eventStart);
    const [ce] = await emails('client-payment-extended', client.user.id);
    expect(ce.vars).toMatchObject({ extraHours: 6, newDeadline: dateTime(eventStart) });
    expect(ce.subject).toContain('удължен с 6 часа');
    expect((await emails('vendor-payment-deadline-extended', partner.user.id))[0].vars).toMatchObject({ extraHours: 6, newDeadline: dateTime(eventStart) });

    // The deadline is the event start: nothing is left to extend.
    expect((await failure(extendPaymentDeadline(admin, { number }))).code).toBe('not_allowed');
    expect(await db.select().from(s.paymentExtension).where(eq(s.paymentExtension.bookingId, bookingId))).toHaveLength(1);
    expect(await emails('client-payment-extended', client.user.id)).toHaveLength(1);
  });

  it('one hour left to give reads ‹1 час›; T7 offers only what the button can still add', async () => {
    // Event 1 September 2025 at 13:00 = NOW + 25 h; K1 gives NOW + 24 h, so ‹Удължи срока› can add 1 h.
    const a = await approvedBooking({ p: await lastMinutePartner(), request: { eventDate: '2025-09-01', startTime: '13:00' } });
    await openDispute(a.bookingId, a.number);
    const { user: adm, actor: admin } = await createAdmin('admin');
    setTestNow(new Date(a.paymentDueAt.getTime() - 4 * H));
    await teamPaymentAlertJob({ bookingId: a.bookingId, hours: 4 });
    const [first] = await emails('team-payment-deadline', adm.id);
    expect(first.vars).toMatchObject({ extraHours: 1 });
    expect(first.text).toContain('Удължете срока с 1 час,');

    const r = await extendPaymentDeadline(admin, { number: a.number });
    expect(r.hours).toBe(1);
    expect((await emails('client-payment-extended', a.client.user.id))[0].subject).toContain('удължен с 1 час —');
    // At the event start now: the alert keeps the facts and drops the advice to extend.
    setTestNow(new Date(r.newDueAt.getTime() - 4 * H));
    await teamPaymentAlertJob({ bookingId: a.bookingId, hours: 4 });
    const [second] = await emails('team-payment-deadline', adm.id).then(es => es.filter(e => e.id !== first.id));
    expect(second.vars).toMatchObject({ extraHours: 0 });
    expect(second.text).not.toContain('Удължете');
    expect(second.html).not.toContain('Удължи срока');
    expect(second.html).toContain('Отвори кейса');
  });
});

describe('K4 withdrawApproval', () => {
  it('releases the date, cancels the jobs, emails the client and notifies date watchers', async () => {
    const { client, partner, number, bookingId } = await approvedBooking({ partner: { businessName: 'Ана Петрова Photography' } });
    const watcher = await createClient();
    await db.insert(s.dateWatch).values({ clientId: watcher.user.id, partnerId: partner.partner.id, date: EVENT, createdAt: new Date(NOW.getTime() - 3 * DAY) });
    expect((await failure(withdrawApproval((await createPartner()).actor, { number }))).code).toBe('not_found');
    expect(await failure(withdrawApproval(client.actor, { number }))).toBeInstanceOf(ForbiddenError);
    await withdrawApproval(partner.actor, { number });
    expect((await bookingRow(bookingId)).status).toBe('approval_withdrawn');
    expect((await jobs(`booking:${bookingId}:`)).every(j => j.status === 'cancelled')).toBe(true);
    expect(await emails('client-approval-withdrawn', client.user.id)).toHaveLength(1);
    const [w] = await db.select().from(s.dateWatch).where(eq(s.dateWatch.clientId, watcher.user.id));
    expect(w.status).toBe('notified');
    const [freed] = await emails('client-date-freed', watcher.user.id);
    expect(freed.vars).toMatchObject({ partnerName: 'Ана Петрова Photography', eventDate: date(EVENT), watchingSince: date('2025-08-28') });
    expect((await failure(withdrawApproval(partner.actor, { number }))).code).toBe('invalid_state');
  });

  it('is refused once the client has started paying', async () => {
    const { client, partner, number } = await approvedBooking();
    await startPayment(client.actor, { number, method: 'card' });
    expect((await failure(withdrawApproval(partner.actor, { number }))).code).toBe('not_allowed');
  });
});

describe('T5–T8 payment timers', () => {
  it('reminds 6 h and 2 h before, alerts the team at 4 h only with a dispute, and expires at the deadline', async () => {
    const plain = await approvedBooking();
    const disputed = await approvedBooking({ client: { name: 'Технолинк ЕООД' } });
    const d = await openDispute(disputed.bookingId, disputed.number);
    const { user: adminUser } = await createAdmin('admin');
    const { user: modUser } = await createAdmin('moderator');
    const { user: supportUser } = await createAdmin('support');
    const watcher = await createClient();
    await db.insert(s.dateWatch).values({ clientId: watcher.user.id, partnerId: plain.partner.partner.id, date: EVENT });
    const pending = await startPayment(plain.client.actor, { number: plain.number, method: 'card' });
    const due = plain.paymentDueAt.getTime();

    await tickAt(new Date(due - 6 * H));
    expect((await emails('client-payment-reminder', plain.client.user.id)).map(e => e.vars)).toMatchObject([{ hoursLeft: 6 }]);
    expect(await emails('vendor-payment-reminder', plain.partner.user.id)).toHaveLength(1);
    await tickAt(new Date(due - 4 * H));
    const alerts = async (userId: string) => (await emails('team-payment-deadline', userId))
      .filter(e => (e.vars as { bookingNo: string }).bookingNo === disputed.number);
    expect(await alerts(adminUser.id)).toHaveLength(1);
    expect((await alerts(modUser.id))[0].vars).toMatchObject({ caseId: d.number, hoursLeft: 4, clientShortName: 'Технолинк' });
    expect(await emails('team-payment-deadline', supportUser.id)).toHaveLength(0);
    expect((await emails('team-payment-deadline')).filter(e => (e.vars as { bookingNo: string }).bookingNo === plain.number)).toHaveLength(0);
    expect(await bell(adminUser.id)).toHaveLength(0); // the admin bell is computed, not stored (D54)
    await tickAt(new Date(due - 2 * H));
    expect((await emails('client-payment-reminder', plain.client.user.id)).map(e => (e.vars as { hoursLeft: number }).hoursLeft)).toEqual([6, 2]);

    await tickAt(new Date(due));
    expect((await bookingRow(plain.bookingId)).status).toBe('payment_expired');
    expect((await bookingRow(disputed.bookingId)).status).toBe('payment_expired');
    expect((await db.select().from(s.charge).where(eq(s.charge.id, pending.chargeId)))[0].status).toBe('expired');
    const [exp] = await emails('client-payment-expired', plain.client.user.id);
    expect(exp.text).toContain('в рамките на 24 часа');
    expect((await emails('vendor-hold-expired', plain.partner.user.id))[0].vars).toMatchObject({ expiredAt: dateTime(plain.paymentDueAt) });
    expect(await emails('client-date-freed', watcher.user.id)).toHaveLength(1);
    await expirePaymentJob({ bookingId: plain.bookingId });
    expect(await emails('client-payment-expired', plain.client.user.id)).toHaveLength(1);
  });

  it('follows an extended deadline: nothing at the old one, expiry at the new one', async () => {
    const a = await approvedBooking();
    const { actor: admin } = await createAdmin('admin');
    const { newDueAt } = await extendPaymentDeadline(admin, { number: a.number });
    await tickAt(new Date(a.paymentDueAt.getTime() + 60_000));
    expect((await bookingRow(a.bookingId)).status).toBe('awaiting_payment');
    await tickAt(newDueAt);
    expect((await bookingRow(a.bookingId)).status).toBe('payment_expired');
    // The client had 48 hours (24 + the team's 24), and the email says so.
    const [expired] = await emails('client-payment-expired', a.client.user.id);
    expect(expired.vars).toMatchObject({ hours: 48 });
    expect(expired.text).toContain('в рамките на 48 часа');
    expect((await failure(extendPaymentDeadline(admin, { number: a.number }))).code).toBe('invalid_state');
  });
});

describe('after payment: T11/T12 reminders, T13 completion, T14 review invite', () => {
  it('reminds both sides, completes the booking with ledger L3 and a ready payout line, then invites a review once', async () => {
    const client = await createClient({ name: 'Мария Димитрова' });
    const a = await paidBooking({ c: client, partner: { businessName: 'Студио Мелодия' } });
    const b = await paidBooking({ c: client, partner: { businessName: 'Квартет „Адажио“' }, request: { startTime: '16:00' } });
    const booking = await bookingRow(a.bookingId);
    // K13 releases through payouts.releaseBookingFunds, which also restates the batch T17 prepared the day
    // before: a partner without a confirmed payout account would be held there (Y4 account_check).
    await confirmPayoutAccount(a.partner.partner.id);
    expect((await bookingRow(b.bookingId)).clientEventId).toBe(booking.clientEventId);
    const ev = booking.clientEventId;
    expect((await jobs(`event:${ev}:`)).map(j => [j.dedupeKey, j.runAt])).toEqual([
      [`event:${ev}:remind:1`, sofiaInstant('2026-06-13', 9, 0)],
      [`event:${ev}:remind:7`, sofiaInstant('2026-06-07', 9, 0)],
    ]);
    const bj = Object.fromEntries((await jobs(`booking:${a.bookingId}:`)).filter(j => j.status === 'pending').map(j => [j.dedupeKey!.split(':').slice(2).join(':'), j.runAt]));
    expect(bj).toEqual({
      complete: sofiaInstant('2026-06-15', 0, 0), reviewinvite: sofiaInstant('2026-06-15', 10, 0), 'vremind:7': sofiaInstant('2026-06-07', 9, 0),
    });

    await tickAt(sofiaInstant('2026-06-07', 9, 0));
    const [r7] = await emails('client-event-reminder', client.user.id);
    expect(r7.vars).toMatchObject({ daysLeft: 7, eventDate: date(EVENT), guests: 120 });
    expect((r7.vars as { bookings: { partnerName: string; time: string }[] }).bookings).toEqual([
      { partnerName: 'Квартет „Адажио“', service: 'Пакет „Цял ден“', time: '16:00' },
      { partnerName: 'Студио Мелодия', service: 'Пакет „Цял ден“', time: '17:00' },
    ]);
    expect((await emails('vendor-event-reminder', a.partner.user.id))[0].vars).toMatchObject({
      daysLeft: 7, clientPhone: '+359 88 800 0000', hosts: 'Мария Димитрова', partnerAmount: money(137_750), payoutDate: date('2026-06-15'),
    });
    await tickAt(sofiaInstant('2026-06-13', 9, 0));
    expect((await emails('client-event-reminder', client.user.id)).map(e => (e.vars as { daysLeft: number }).daysLeft)).toEqual([7, 1]);

    await tickAt(sofiaInstant('2026-06-15', 0, 0));
    const done = await bookingRow(a.bookingId);
    expect(done).toMatchObject({ status: 'completed', completedAt: sofiaInstant('2026-06-15', 0, 0) });
    expect(await bookingBalances(db, a.bookingId)).toMatchObject({
      client_funds: 0, partner_payable: 137_750, commission_revenue: 7_250, platform_cash: 7_250, provider_held: 137_750,
    });
    const [line] = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, a.bookingId));
    expect(line).toMatchObject({ status: 'ready', baseCents: 145_000, commissionCents: 7_250, amountCents: 137_750, batchDate: '2026-06-15', chargeId: null });
    expect(await completeBooking(a.bookingId)).toBe('skipped');

    await tickAt(sofiaInstant('2026-06-15', 10, 0));
    expect((await bookingRow(a.bookingId)).reviewState).toBe('invited');
    expect(await emails('client-review-invite', client.user.id)).toHaveLength(2); // one per booking
    await reviewInviteJob({ bookingId: a.bookingId });
    expect(await emails('client-review-invite', client.user.id)).toHaveLength(2);
  });

  it('keeps the funds held when an open dispute holds the payout; the decision releases them later', async () => {
    const a = await paidBooking();
    await openDispute(a.bookingId, a.number);
    await tickAt(sofiaInstant('2026-06-15', 0, 0));
    expect((await bookingRow(a.bookingId)).status).toBe('completed');
    expect((await bookingBalances(db, a.bookingId)).client_funds).toBe(145_000);
    const [held] = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, a.bookingId));
    expect(held).toMatchObject({ status: 'held', holdReason: 'dispute' });

    // What the dispute module does on a decision (e.g. no_refund): L3 for what is left, then the line joins the next batch.
    const at = sofiaInstant('2026-06-20', 12, 0);
    setTestNow(at);
    await db.transaction(async t => {
      const sp = await releaseToPartner(t, { bookingId: a.bookingId, actor: SYSTEM });
      await markPayoutLineReady(t, { bookingId: a.bookingId, split: sp, at });
    });
    const [ready] = await db.select().from(s.payoutLine).where(eq(s.payoutLine.bookingId, a.bookingId));
    expect(ready).toMatchObject({ status: 'ready', amountCents: 137_750, batchDate: '2026-07-01', holdReason: null });
    expect((await bookingBalances(db, a.bookingId)).client_funds).toBe(0);
  });
});

describe('view models', () => {
  it('apply the phone rule, hide commission from clients and partners, and show it to finance only', async () => {
    const a = await approvedBooking({ client: { phone: '+359884127730' } });
    const before = await getBookingForPartner(a.partner.actor, a.number);
    expect(before.client.phone).toBeNull();
    expect(before.money.partnerAmountCents).toBe(137_750);
    expect(before.payable).toBe(true);
    expect(await failure(getBookingForPartner(a.client.actor, a.number))).toBeInstanceOf(ForbiddenError);
    expect((await failure(getBookingForPartner((await createPartner()).actor, a.number))).code).toBe('not_found');

    const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });
    await applyProviderEvent({ type: 'charge.succeeded', chargeId: pay.chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242' });
    const after = await getBookingForPartner(a.partner.actor, a.number);
    expect(after).toMatchObject({ status: 'confirmed', client: { phone: '+359884127730' }, money: { partnerAmountCents: 137_750, paidByClientCents: 145_000, payoutDate: '2026-06-15', payoutLineStatus: 'awaiting_event' } });
    expect(JSON.stringify(after)).not.toMatch(/commission/i);

    const mine = await getBookingForClient(a.client.actor, a.number);
    expect(mine).toMatchObject({ card: { label: 'Visa •••• 4242' }, canCancel: true, canReview: false, money: { paidCents: 145_000, totalCents: 145_000 } });
    expect(mine.invoices.map(i => i.number)).toEqual(['0000000001']);
    expect(JSON.stringify(mine)).not.toMatch(/commission/i);
    expect((await failure(getBookingForClient((await createClient()).actor, a.number))).code).toBe('not_found');

    const { actor: support } = await createAdmin('support');
    const { actor: accounting } = await createAdmin('accounting');
    const sv = await getBookingForAdmin(support, a.number);
    expect(sv.money.commission).toBeNull();
    expect(sv.money.ledger).toBeNull();
    expect(sv.client.phone).toBe('+359884127730');
    const fv = await getBookingForAdmin(accounting, a.number);
    expect(fv.money.commission).toEqual({ bp: 500, projected: false, commissionCents: 7_250, partnerAmountCents: 137_750 });
    expect(fv.money.ledger).toMatchObject({ client_funds: 145_000, provider_held: 145_000 });
    expect(fv.timeline.map(t => t.action)).toEqual(expect.arrayContaining(['request.sent', 'request.approved', 'booking.created', 'booking.confirmed']));
    expect(await failure(getBookingForAdmin(a.client.actor, a.number))).toBeInstanceOf(ForbiddenError);
  });

  it('keeps commission out of the admin timeline for team members without view_finance (SPEC §1.2)', async () => {
    const a = await paidBooking();
    await tickAt(sofiaInstant('2026-06-15', 0, 0)); // K13 posts the release with its commission split
    const { actor: support } = await createAdmin('support');
    const { actor: moderator } = await createAdmin('moderator');
    const { actor: accounting } = await createAdmin('accounting');
    for (const viewer of [support, moderator]) {
      const v = await getBookingForAdmin(viewer, a.number);
      expect(v.timeline.map(t => t.action)).toEqual(expect.arrayContaining(['booking.confirmed', 'booking.funds_released']));
      expect(JSON.stringify(v.timeline)).not.toMatch(/commission|partnerAmount/i);
      expect(v.timeline.find(t => t.action === 'booking.funds_released')?.data).toMatchObject({ number: a.number, baseCents: 145_000 });
    }
    const f = await getBookingForAdmin(accounting, a.number);
    expect(f.timeline.find(t => t.action === 'booking.confirmed')?.data).toMatchObject({ commissionBp: 500 });
    expect(f.timeline.find(t => t.action === 'booking.funds_released')?.data).toMatchObject({ commissionCents: 7_250, partnerCents: 137_750 });
  });
});

describe('client events (SPEC §16)', () => {
  it('summarises requests, bookings and money per event, and keeps private notes', async () => {
    const client = await createClient();
    const paid = await paidBooking({ c: client });
    const other = await createPartner();
    const pending = await sendFor(client, other);
    const [ev] = await listClientEvents(client.actor);
    expect(ev).toMatchObject({
      title: 'Сватба', date: EVENT, upcoming: true, requestsCount: 1, bookingsCount: 1, awaitingPaymentCount: 0, paidCents: 145_000, pendingCents: 145_000,
    });
    await approveRequest(other.actor, { number: pending.number });
    const [ev2] = await listClientEvents(client.actor);
    expect(ev2).toMatchObject({ requestsCount: 1, bookingsCount: 1, awaitingPaymentCount: 1, pendingCents: 145_000 });

    const detail = await getClientEvent(client.actor, ev.id);
    expect(detail.bookings.map(b => b.number)).toEqual([paid.number]);
    expect(detail.requests.map(r => r.number)).toEqual([pending.number]);
    expect((await failure(getClientEvent((await createClient()).actor, ev.id))).code).toBe('not_found');

    await saveNotes(client.actor, { eventId: ev.id, notes: 'Цветовете: бяло и пудра.' });
    expect((await getClientEvent(client.actor, ev.id)).notes).toBe('Цветовете: бяло и пудра.');
    expect((await failure(saveNotes((await createClient()).actor, { eventId: ev.id, notes: 'x' }))).code).toBe('not_found');
    expect((await failure(saveNotes(client.actor, { eventId: ev.id, notes: 'x'.repeat(4_001) }))).code).toBe('validation');
    expect(await failure(listClientEvents(paid.partner.actor))).toBeInstanceOf(ForbiddenError);

    setTestNow(sofiaInstant('2026-06-15', 12, 0));
    expect((await listClientEvents(client.actor))[0].upcoming).toBe(false);
    const lines = await db.select().from(s.payoutLine).where(and(eq(s.payoutLine.bookingId, paid.bookingId), isNull(s.payoutLine.chargeId)));
    expect(lines).toHaveLength(1);
  });
});
