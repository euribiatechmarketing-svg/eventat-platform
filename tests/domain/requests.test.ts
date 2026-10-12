// Requests (SPEC §4.5): R1 send, R2 ask for info, R3/R6 approve → booking
// (K1), R4/R5 quotes, R7 decline, T1 reminder, T2/T4 expiry, client withdrawal.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { date, dateTime, money, moneyShort, sofiaInstant } from '@/lib/format';
import { ForbiddenError } from '@/lib/domain/actor';
import {
  approveRequest, askForInfo, cancelPendingRequest, chooseQuoteOffer, confirmOffer, declineRequest, expireRequestJob, getRequestForClient,
  getRequestForPartner, maskContacts, requestReminderJob, sendQuote,
} from '@/lib/domain/requests';
import { startPayment } from '@/lib/domain/charges';
import { applyProviderEvent } from '@/lib/payments/apply';
import { createClient, createPartner } from '../helpers/factories';
import {
  EVENT, H, NOW, approvedBooking, backendPid, bell, bookingRow, emails, expectLedgerHealthy, failure, forceSetting, gate, jobs, lockWaiter, requestRow,
  sendFor, tickAt, type Partner,
} from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterEach(() => setTestNow(null));

async function quoteService(p: Partner) {
  const [svc] = await db.insert(s.service).values({
    partnerId: p.partner.id, kind: 'on_request', name: 'Фирмени събития', categoryId: p.service.categoryId,
    description: 'Озвучаване и парти програма по запитване.', priceCents: null, status: 'active', publishedAt: NOW,
  }).returning();
  return svc;
}

describe('R1 sendRequest', () => {
  it('sends a package request with snapshots, the deadline, the client event, the conversation, T1/T2, emails and bells', async () => {
    const client = await createClient({ name: 'Мария Димитрова', phone: '+359884127730' });
    const partner = await createPartner({ businessName: 'Студио Мелодия' });
    const { number, requestId } = await sendFor(client, partner, { note: 'Първият танц е в 21:00.' });
    expect(number).toMatch(/^2026-0614-[А-Я]{2}$/);

    const r = await requestRow(requestId);
    expect(r).toMatchObject({
      kind: 'package', status: 'pending', amountCents: 145_000, contactPhone: '+359884127730', serviceTitle: 'Пакет „Цял ден“',
      serviceSummary: 'DJ и озвучаване', guests: 120, startTime: '17:00:00', endTime: '02:00:00', note: 'Първият танц е в 21:00.',
    });
    expect(r.responseDueAt.getTime()).toBe(NOW.getTime() + 24 * H);

    const [ev] = await db.select().from(s.clientEvent).where(eq(s.clientEvent.id, r.clientEventId));
    expect(ev).toMatchObject({ title: 'Сватба', date: EVENT, clientId: client.user.id, guests: 120, venueName: 'Вила Екатерина' });
    const [conv] = await db.select().from(s.conversation).where(eq(s.conversation.requestId, r.id));
    expect(conv).toMatchObject({ clientId: client.user.id, partnerId: partner.partner.id, clientEventId: ev.id });

    expect((await jobs(`request:${r.id}:`)).map(j => [j.kind, j.runAt.getTime(), j.status])).toEqual([
      ['request.expire', NOW.getTime() + 24 * H, 'pending'],
      ['request.reminder', NOW.getTime() + 18 * H, 'pending'],
    ]);

    const [cm] = await emails('client-request-sent', client.user.id);
    expect(cm.subject).toBe('Запитването ви до Студио Мелодия е изпратено');
    expect(cm.vars).toMatchObject({ requestNo: number, amount: money(145_000), replyBy: dateTime(r.responseDueAt), packageName: 'Цял ден' });
    const [pm] = await emails('vendor-new-request', partner.user.id);
    expect(pm.toEmail).toBe(partner.partner.notificationEmail);
    // Projected ‹Получавате› at the intro rate (5 %) for a partner with no paid bookings yet (SPEC §6).
    expect(pm.vars).toMatchObject({ partnerAmount: money(137_750), packageName: 'Цял ден', attached: 'бележка', timeRange: '17:00 – около 02:00' });
    expect((await bell(partner.user.id))[0]).toMatchObject({
      title: 'Нова заявка от Мария Димитрова', body: `Сватба · ${date(EVENT)} · отговорете до 24 часа`, href: `/partner/zayavki/${number}`,
    });
    expect((await bell(client.user.id))[0].title).toBe('Запитването е изпратено');
    const [a] = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entity, 'request'), eq(s.auditLog.entityId, r.id)));
    expect(a).toMatchObject({ action: 'request.sent', actorRole: 'client', actorId: client.user.id });

    // D15: a second request of the same type and date joins the same event; ‹sabitie-id› attaches explicitly.
    const other = await createPartner();
    const second = await sendFor(client, other);
    expect((await requestRow(second.requestId)).clientEventId).toBe(ev.id);
    const third = await createPartner();
    const viaEvent = await sendFor(client, third, { eventTypeSlug: 'rozhden-den', clientEventId: ev.id });
    expect((await requestRow(viaEvent.requestId)).clientEventId).toBe(ev.id);
  });

  it('closes the client\'s watch on that partner and date', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const [w] = await db.insert(s.dateWatch).values({ clientId: client.user.id, partnerId: partner.partner.id, date: EVENT }).returning();
    await sendFor(client, partner);
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, w.id)))[0].status).toBe('closed');
  });

  it('enforces the R1 guards', async () => {
    const partner = await createPartner();
    const code = async (p: Promise<unknown>) => (await failure(p)).code;

    const unverified = await createClient();
    await db.update(s.user).set({ emailVerified: false }).where(eq(s.user.id, unverified.user.id));
    expect(await code(sendFor(unverified, partner))).toBe('not_allowed');
    const blocked = await createClient();
    await db.update(s.user).set({ banned: true }).where(eq(s.user.id, blocked.user.id));
    expect(await code(sendFor(blocked, partner))).toBe('not_allowed');
    expect(await code(sendFor(await createClient({ phone: null }), partner))).toBe('validation');

    const client = await createClient();
    expect(await code(sendFor(client, partner, { eventDate: '2025-09-03' }))).toBe('date_unavailable'); // lead time 7 days
    expect(await code(sendFor(client, partner, { eventDate: '2027-09-15' }))).toBe('date_unavailable'); // horizon 24 months
    expect(await code(sendFor(client, partner, { guests: 0 }))).toBe('validation');
    expect(await code(sendFor(client, partner, { note: 'x'.repeat(2_001) }))).toBe('validation');
    expect(await code(sendFor(client, partner, { attachmentMediaIds: ['5f0e4c55-27b5-4a8e-9a6f-2d6e1b3a0f11'] }))).toBe('validation');

    const weekdays = await createPartner();
    await db.update(s.partner).set({ workingDays: [1, 2, 3, 4, 5] }).where(eq(s.partner.id, weekdays.partner.id));
    expect(await code(sendFor(client, weekdays))).toBe('date_unavailable'); // 14 юни 2026 is a Sunday

    const blockedDate = await createPartner();
    await db.insert(s.availabilityBlock).values({ partnerId: blockedDate.partner.id, startDate: '2026-06-10', endDate: '2026-06-20', createdBy: blockedDate.user.id });
    expect(await code(sendFor(client, blockedDate))).toBe('date_unavailable');

    const selected = await createPartner();
    await db.update(s.partner).set({ onlySelectedDates: true }).where(eq(s.partner.id, selected.partner.id));
    expect(await code(sendFor(client, selected))).toBe('date_unavailable');
    await db.insert(s.availabilityOpenDate).values({ partnerId: selected.partner.id, date: EVENT });
    await sendFor(client, selected);

    const small = await createPartner();
    await db.update(s.partner).set({ maxGuests: 100 }).where(eq(s.partner.id, small.partner.id));
    expect(await code(sendFor(client, small))).toBe('validation');

    const paused = await createPartner();
    await db.update(s.partner).set({ acceptingRequests: false }).where(eq(s.partner.id, paused.partner.id));
    expect(await code(sendFor(client, paused))).toBe('not_allowed');
    const archived = await createPartner();
    await db.update(s.service).set({ status: 'archived' }).where(eq(s.service.id, archived.service.id));
    expect(await code(sendFor(client, archived))).toBe('not_allowed');

    await sendFor(client, partner);
    expect(await code(sendFor(client, partner))).toBe('duplicate');
    expect(await failure(sendFor({ ...client, actor: partner.actor }, partner))).toBeInstanceOf(ForbiddenError);
  });

  it('prices per-guest services by the guests (minimum guests respected)', async () => {
    const client = await createClient();
    const caterer = await createPartner({ category: 'ketaring', priceCents: 2_800, priceUnit: 'per_guest' });
    const { requestId } = await sendFor(client, caterer);
    expect((await requestRow(requestId)).amountCents).toBe(2_800 * 120);
    await db.update(s.service).set({ minGuests: 150 }).where(eq(s.service.id, caterer.service.id));
    const other = await createClient();
    const { requestId: r2 } = await sendFor(other, caterer);
    expect((await requestRow(r2)).amountCents).toBe(2_800 * 150);
  });

  it('clamps response_due_at to one hour before the event start (SPEC §3)', async () => {
    const client = await createClient();
    const sameDay = await createPartner();
    await db.update(s.partner).set({ leadTimeDays: 0 }).where(eq(s.partner.id, sameDay.partner.id));
    const { requestId } = await sendFor(client, sameDay, { eventDate: '2025-09-01', startTime: '08:00' });
    const r = await requestRow(requestId);
    expect(r.responseDueAt).toEqual(sofiaInstant('2025-09-01', 7, 0));
    expect((await jobs(`request:${r.id}:reminder`))[0].runAt).toEqual(sofiaInstant('2025-09-01', 1, 0));
    // …and payment_due_at to the event start (K1).
    setTestNow(new Date(NOW.getTime() + H));
    const { paymentDueAt } = await approveRequest(sameDay.actor, { number: r.number });
    expect(paymentDueAt).toEqual(sofiaInstant('2025-09-01', 8, 0));
    // The approval email gives that clamped window (19 h from approval), not the 24 h setting.
    const [ce] = await emails('client-request-approved', client.user.id);
    expect(ce.vars).toMatchObject({ payHours: 19, payBy: dateTime(paymentDueAt) });
    expect(ce.subject).toMatch(/ — платете до 19 часа$/);
    expect(ce.text).toContain('платете в рамките на 19 часа');
    expect(ce.text).not.toContain('24 часа');
  });
});

describe('R2 askForInfo and contact masking', () => {
  it('masks phones and e-mails but keeps dates, times, money and booking numbers (SPEC §10)', () => {
    expect(maskContacts('Обадете се на +359 88 412 7730 или 0884127730, пишете на maria.d@gmail.com за детайли'))
      .toBe('Обадете се на ••• или •••, пишете на ••• за детайли');
    expect(maskContacts('088 412 77 30')).toBe('•••');
    const kept = 'Сватбата е на 14.06.2026 от 17:00, цената е 1 450,00 € по заявка 2026-0614-ЕА, 120 гости';
    expect(maskContacts(kept)).toBe(kept);
  });

  it('posts the partner\'s question in the conversation and emails the client; the clock keeps running (D61)', async () => {
    const client = await createClient();
    const partner = await createPartner({ businessName: 'Студио Мелодия' });
    const { number, requestId } = await sendFor(client, partner);
    const before = await requestRow(requestId);
    const { messageId, conversationId } = await askForInfo(partner.actor, { number, body: 'Колко часа е церемонията? Звъннете ми на 0884127730.' });
    const [m] = await db.select().from(s.message).where(eq(s.message.id, messageId));
    expect(m).toMatchObject({ senderRole: 'partner', body: 'Колко часа е церемонията? Звъннете ми на •••.', bodyOriginal: 'Колко часа е церемонията? Звъннете ми на 0884127730.' });
    const [conv] = await db.select().from(s.conversation).where(eq(s.conversation.id, conversationId));
    expect(conv.clientUnreadCount).toBe(1);
    const [e] = await emails('client-new-message', client.user.id);
    expect(e.vars).toMatchObject({ partnerName: 'Студио Мелодия', message: 'Колко часа е церемонията? Звъннете ми на •••.' });
    expect((await bell(client.user.id))[0].href).toBe(`/akaunt/saobshteniya/${conversationId}`);
    const after = await requestRow(requestId);
    expect(after).toMatchObject({ status: 'pending' });
    expect(after.responseDueAt).toEqual(before.responseDueAt);

    expect((await failure(askForInfo((await createPartner()).actor, { number, body: 'x' }))).code).toBe('not_found');
    expect(await failure(askForInfo(client.actor, { number, body: 'x' }))).toBeInstanceOf(ForbiddenError);
    expect((await failure(askForInfo(partner.actor, { number, body: '   ' }))).code).toBe('validation');
  });
});

describe('R3 approveRequest → K1 booking', () => {
  it('creates the booking with its snapshots, moves the jobs and sends both emails', async () => {
    const { client, partner, number, requestId, bookingId } = await approvedBooking({
      client: { name: 'Мария Димитрова' }, partner: { businessName: 'Студио Мелодия' },
    });
    const b = await bookingRow(bookingId);
    const due = NOW.getTime() + 24 * H;
    expect(b).toMatchObject({
      number, status: 'awaiting_payment', amountCents: 145_000, paymentMode: 'full', dueNowCents: 145_000, depositPayCents: null, balanceCents: 0,
      cancellationPolicy: 'moderate', depositPercent: 30, freeCancelUntil: '2026-05-15', holdUntil: '2026-06-15', batchDate: '2026-06-15',
      inclusions: ['DJ за цялото събитие', 'Безжичен микрофон'], commissionBp: null, contactPhone: '+359888000000', guests: 120,
      serviceTitle: 'Пакет „Цял ден“', venueName: 'Вила Екатерина',
    });
    expect(b.paymentDueAt.getTime()).toBe(due);
    expect(await requestRow(requestId)).toMatchObject({ status: 'approved', amountCents: 145_000 });
    expect((await jobs(`request:${requestId}:`)).every(j => j.status === 'cancelled')).toBe(true);
    expect((await jobs(`booking:${bookingId}:`)).map(j => [j.dedupeKey!.split(':').slice(2).join(':'), j.kind, j.runAt.getTime()])).toEqual([
      ['payexpire', 'booking.payment_expire', due],
      ['payrem:2', 'booking.client_pay_reminder', due - 2 * H],
      ['payrem:6', 'booking.client_pay_reminder', due - 6 * H],
      ['teamalert', 'booking.team_payment_alert', due - 4 * H],
      ['vpayrem', 'booking.partner_pay_reminder', due - 6 * H],
    ]);
    const [ce] = await emails('client-request-approved', client.user.id);
    expect(ce.subject).toBe('Студио Мелодия одобри заявката ви — платете до 24 часа');
    expect(ce.vars).toMatchObject({ bookingId: number, amount: money(145_000), payBy: dateTime(b.paymentDueAt), payHours: 24 });
    expect((await bell(client.user.id))[0]).toMatchObject({
      title: 'Студио Мелодия одобри заявката ви', body: `Платете до ${dateTime(b.paymentDueAt)}, за да запазите датата`, href: `/plashtane/${number}`,
    });
    const [pe] = await emails('vendor-request-approved', partner.user.id);
    expect(pe.vars).toMatchObject({ partnerAmount: money(137_750), clientName: 'Мария Димитрова' });
    const [conv] = await db.select().from(s.conversation).where(eq(s.conversation.requestId, requestId));
    expect(conv.bookingId).toBe(bookingId);
    expect(await db.select().from(s.auditLog).where(and(eq(s.auditLog.entity, 'booking'), eq(s.auditLog.entityId, bookingId)))).toHaveLength(1);

    expect((await failure(approveRequest(partner.actor, { number }))).code).toBe('invalid_state');
  });

  it('refuses approval after the deadline, by another partner, by a client, and with stripe before charges_enabled (D62)', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const { number } = await sendFor(client, partner);
    expect((await failure(approveRequest((await createPartner()).actor, { number }))).code).toBe('not_found');
    expect(await failure(approveRequest(client.actor, { number }))).toBeInstanceOf(ForbiddenError);

    await forceSetting('payment.provider', 'stripe');
    await db.update(s.partner).set({ providerChargesEnabled: false }).where(eq(s.partner.id, partner.partner.id));
    expect((await failure(approveRequest(partner.actor, { number }))).code).toBe('provider_not_ready');
    await forceSetting('payment.provider', 'simulated');
    await db.update(s.partner).set({ providerChargesEnabled: true }).where(eq(s.partner.id, partner.partner.id));

    setTestNow(new Date(NOW.getTime() + 24 * H + 60_000));
    expect((await failure(approveRequest(partner.actor, { number }))).code).toBe('deadline_passed');
  });

  it('counts held dates against capacity, and two simultaneous approvals cannot overbook', async () => {
    const partner = await createPartner();
    const [a, b] = [await createClient(), await createClient()];
    const ra = await sendFor(a, partner);
    const rb = await sendFor(b, partner);
    await approveRequest(partner.actor, { number: ra.number });
    expect((await failure(approveRequest(partner.actor, { number: rb.number }))).code).toBe('date_unavailable');

    const two = await createPartner();
    await db.update(s.partner).set({ bookingsPerDayMode: 'limit', maxBookingsPerDate: 2 }).where(eq(s.partner.id, two.partner.id));
    const x = await sendFor(a, two);
    const y = await sendFor(b, two);
    await approveRequest(two.actor, { number: x.number });
    await approveRequest(two.actor, { number: y.number });

    const race = await createPartner();
    const c1 = await sendFor(await createClient(), race);
    const c2 = await sendFor(await createClient(), race);
    const results = await Promise.allSettled([approveRequest(race.actor, { number: c1.number }), approveRequest(race.actor, { number: c2.number })]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.find(r => r.status === 'rejected') as PromiseRejectedResult;
    expect(rejected.reason.code).toBe('date_unavailable');
  });
});

describe('R7 declineRequest', () => {
  it('declines with ‹Датата е заета› or a written reason and cancels the jobs', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const { number, requestId } = await sendFor(client, partner);
    await declineRequest(partner.actor, { number, reason: 'date_taken' });
    expect(await requestRow(requestId)).toMatchObject({ status: 'declined', declineReason: 'date_taken', declineText: null });
    expect((await jobs(`request:${requestId}:`)).every(j => j.status === 'cancelled')).toBe(true);
    const [e] = await emails('client-request-declined', client.user.id);
    expect(e.vars).toMatchObject({ reason: 'Датата е заета', requestNo: number });
    expect((await failure(declineRequest(partner.actor, { number, reason: 'date_taken' }))).code).toBe('invalid_state');

    const other = await createPartner();
    const r2 = await sendFor(client, other);
    expect((await failure(declineRequest(other.actor, { number: r2.number, reason: 'other' }))).code).toBe('validation');
    expect(await failure(declineRequest(client.actor, { number: r2.number, reason: 'date_taken' }))).toBeInstanceOf(ForbiddenError);
    await declineRequest(other.actor, { number: r2.number, reason: 'other', text: 'Нямаме свободен екип за този ден.' });
    expect(await requestRow(r2.requestId)).toMatchObject({ declineReason: 'other', declineText: 'Нямаме свободен екип за този ден.' });
    expect((await emails('client-request-declined', client.user.id))[1].vars).toMatchObject({ reason: 'Нямаме свободен екип за този ден.' });
  });

  it('‹Друга причина›: the email does not claim the date is taken (the client screen’s wording)', async () => {
    const client = await createClient();
    const partner = await createPartner({ businessName: 'Ана Петрова Photography' });
    const r = await sendFor(client, partner);
    await declineRequest(partner.actor, { number: r.number, reason: 'date_taken' });
    const [taken] = await emails('client-request-declined', client.user.id);
    expect(taken.text).toContain('отказа заявката ви, защото датата');
    expect(taken.text).toContain('Можете и да следите датата');

    const other = await createPartner({ businessName: 'Ана Петрова Photography' });
    const r2 = await sendFor(client, other);
    await declineRequest(other.actor, { number: r2.number, reason: 'other', text: 'Нямаме свободен екип за този ден.' });
    const [m] = (await emails('client-request-declined', client.user.id)).filter(e => e.id !== taken.id);
    expect(m.text).not.toMatch(/заета|ако се освободи/);
    expect(m.text).toContain('Ана Петрова Photography отказа заявката ви. Не дължите нищо — плащате само за одобрени заявки.');
    expect(m.text).toContain('Вижте подобни изпълнители, които са свободни на тази дата.');
    expect(m.text).toMatch(/Причина\W+Нямаме свободен екип за този ден\./);
    expect(m.subject).toBe(`Ана Петрова Photography отказа заявката ви за ${date(EVENT)}`);
    expect(m.html).not.toContain('Нямаме свободен екип за този ден. и не дължите');
    expect(m.html).toContain('Не дължите нищо — вижте подобни изпълнители.');
  });
});

describe('T1 reminder and T2 expiry', () => {
  it('reminds the partner 6 h before the deadline, once', async () => {
    const client = await createClient({ name: 'Мария Димитрова' });
    const partner = await createPartner();
    const { requestId } = await sendFor(client, partner);
    await tickAt(new Date(NOW.getTime() + 18 * H));
    const sent = await emails('vendor-request-reminder', partner.user.id);
    expect(sent).toHaveLength(1);
    expect(sent[0].vars).toMatchObject({ hoursLeft: 6, clientName: 'Мария Димитрова', partnerAmount: money(137_750) });
    await requestReminderJob({ requestId });
    expect(await emails('vendor-request-reminder', partner.user.id)).toHaveLength(1);
  });

  it('expires an unanswered request at the deadline and tells both sides; a second run changes nothing', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const { number, requestId } = await sendFor(client, partner);
    await tickAt(new Date(NOW.getTime() + 24 * H));
    const r = await requestRow(requestId);
    expect(r.status).toBe('expired');
    expect(r.expiredAt).toEqual(new Date(NOW.getTime() + 24 * H));
    expect(await emails('client-request-expired', client.user.id)).toHaveLength(1);
    expect(await emails('vendor-request-expired', partner.user.id)).toHaveLength(1);
    expect((await bell(partner.user.id))[0].title).toBe('Заявката изтече');
    await expireRequestJob({ requestId });
    expect(await emails('client-request-expired', client.user.id)).toHaveLength(1);
    expect((await failure(approveRequest(partner.actor, { number }))).code).toBe('invalid_state');
  });
});

describe('quotes: R4 offer, R5 choice, R6 confirmation, T4 lapse', () => {
  it('runs a quote request from inquiry to booking', async () => {
    const client = await createClient({ name: 'Технолинк ЕООД' });
    const partner = await createPartner({ businessName: 'Студио Мелодия' });
    const svc = await quoteService(partner);
    const { number, requestId } = await sendFor(client, partner, { serviceId: svc.id, eventTypeSlug: 'firmeno-sabitie', guests: 250 });
    expect(await requestRow(requestId)).toMatchObject({ kind: 'quote', amountCents: null });
    expect((await emails('client-request-sent', client.user.id))[0].vars).toMatchObject({ amount: 'По оферта' });
    expect((await emails('vendor-new-inquiry', partner.user.id))[0].vars).toMatchObject({ serviceName: 'Фирмени събития', need: 'DJ и озвучаване' });
    expect((await failure(approveRequest(partner.actor, { number }))).code).toBe('invalid_state');

    const { offerId } = await sendQuote(partner.actor, { number, title: 'Парти програма, 5 часа', amountCents: 210_000 });
    expect(await requestRow(requestId)).toMatchObject({ status: 'offer_sent', offerId });
    expect((await jobs(`request:${requestId}:`)).map(j => [j.dedupeKey!.split(':')[2], j.status])).toEqual([
      ['expire', 'cancelled'], ['offerlapse', 'pending'], ['reminder', 'cancelled'],
    ]);
    expect((await bell(client.user.id))[0]).toMatchObject({ title: 'Студио Мелодия отговори на запитването', body: `Парти програма, 5 часа · ${moneyShort(210_000)}` });

    expect((await failure(chooseQuoteOffer((await createClient()).actor, { number }))).code).toBe('not_found');
    setTestNow(new Date(NOW.getTime() + 2 * H));
    await chooseQuoteOffer(client.actor, { number });
    const chosen = await requestRow(requestId);
    expect(chosen).toMatchObject({ status: 'awaiting_confirmation' });
    expect(chosen.responseDueAt.getTime()).toBe(NOW.getTime() + 26 * H);
    expect((await jobs(`request:${requestId}:expire`))[0]).toMatchObject({ status: 'pending', runAt: chosen.responseDueAt });
    expect((await emails('vendor-offer-chosen', partner.user.id))[0].vars).toMatchObject({ partnerAmount: money(199_500), offerTitle: 'Парти програма, 5 часа' });

    const { bookingId } = await confirmOffer(partner.actor, { number });
    expect(await bookingRow(bookingId)).toMatchObject({ amountCents: 210_000, dueNowCents: 210_000, status: 'awaiting_payment' });
    expect(await requestRow(requestId)).toMatchObject({ status: 'approved', amountCents: 210_000 });
  });

  it('expires a chosen offer the partner does not confirm in 24 h (T4, D23)', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const svc = await quoteService(partner);
    const { number, requestId } = await sendFor(client, partner, { serviceId: svc.id });
    const { offerId } = await sendQuote(partner.actor, { number, title: 'Оферта', amountCents: 50_000 });
    await chooseQuoteOffer(client.actor, { number });
    await tickAt(new Date(NOW.getTime() + 24 * H));
    expect(await requestRow(requestId)).toMatchObject({ status: 'expired' });
    expect((await db.select().from(s.offer).where(eq(s.offer.id, offerId)))[0].status).toBe('lapsed');
    expect(await emails('vendor-request-expired', partner.user.id)).toHaveLength(1);
  });
});

describe('R10: an offer nobody chose lapses once the event date has passed (O5, D22)', () => {
  it('moves the quote request to expired and the offer to lapsed the day after the event, without emails', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const svc = await quoteService(partner);
    const { number, requestId } = await sendFor(client, partner, { serviceId: svc.id, eventDate: '2025-09-20' });
    const { offerId } = await sendQuote(partner.actor, { number, title: 'Оферта', amountCents: 50_000 });
    await tickAt(sofiaInstant('2025-09-20', 23, 59));
    expect(await requestRow(requestId)).toMatchObject({ status: 'offer_sent' });
    await tickAt(sofiaInstant('2025-09-21', 0, 0));
    expect(await requestRow(requestId)).toMatchObject({ status: 'expired' });
    expect((await db.select().from(s.offer).where(eq(s.offer.id, offerId)))[0].status).toBe('lapsed');
    expect(await emails('client-request-expired', client.user.id)).toHaveLength(0);
    expect(await emails('vendor-request-expired', partner.user.id)).toHaveLength(0);
  });

  it('leaves a chosen offer to its own 24 h confirmation clock (T4)', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const svc = await quoteService(partner);
    const { number, requestId } = await sendFor(client, partner, { serviceId: svc.id });
    await sendQuote(partner.actor, { number, title: 'Оферта', amountCents: 50_000 });
    await chooseQuoteOffer(client.actor, { number });
    expect((await jobs(`request:${requestId}:offerlapse`))[0].status).toBe('cancelled');
  });
});

describe('a payment filling the date while the partner acts on another request for it (R9, D64)', () => {
  it('keeps the partner\'s own decline reason when the decline is in flight', async () => {
    const partner = await createPartner();
    const r = await sendFor(await createClient(), partner);
    const a = await approvedBooking({ p: partner }); // holds the date (capacity 1); r stays pending
    const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });

    const locked = gate(), go = gate();
    let holder = 0;
    const declining = db.transaction(async t => {
      await t.select({ id: s.request.id }).from(s.request).where(eq(s.request.id, r.requestId)).for('update');
      holder = await backendPid(t);
      locked.open();
      await go.passed;
      await declineRequest(partner.actor, { number: r.number, reason: 'other', text: 'Не работим тогава' }, t);
    });
    await locked.passed;
    const paying = applyProviderEvent({ type: 'charge.succeeded', chargeId: pay.chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242' });
    await lockWaiter(holder);
    go.open();
    await Promise.all([declining, paying]);

    expect((await bookingRow(a.bookingId)).status).toBe('confirmed');
    expect(await requestRow(r.requestId)).toMatchObject({ status: 'declined', declineReason: 'other', declineText: 'Не работим тогава' });
    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, r.requestId), eq(s.auditLog.action, 'request.declined')));
    expect(audits).toHaveLength(1);
  });

  it('does not deadlock with an approval of another request for that date', async () => {
    const partner = await createPartner();
    const r = await sendFor(await createClient(), partner);
    const a = await approvedBooking({ p: partner });
    const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });

    // The payment holds the partner row (K5 snapshots the commission under it)…
    const locked = gate(), go = gate();
    let holder = 0;
    const paying = db.transaction(async t => {
      await t.select({ id: s.partner.id }).from(s.partner).where(eq(s.partner.id, partner.partner.id)).for('update');
      holder = await backendPid(t);
      locked.open();
      await go.passed;
      return applyProviderEvent({ type: 'charge.succeeded', chargeId: pay.chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242' }, t);
    });
    await locked.passed;
    // …while the partner approves the other pending request for the same date.
    const approving = approveRequest(partner.actor, { number: r.number }).then(() => null, (e: Error & { code?: string }) => e);
    await lockWaiter(holder);
    go.open();
    const [paid, refused] = await Promise.all([paying, approving]);

    expect(paid).toMatchObject({ applied: true, bookingConfirmed: true });
    expect(refused?.code).toBe('invalid_state'); // R9 declined it first; no deadlock error on either side
    expect(await requestRow(r.requestId)).toMatchObject({ status: 'declined', declineReason: 'date_taken' });
  });

  it('does not deadlock with the client choosing a quote offer for that date (R5 vs O5)', async () => {
    const partner = await createPartner();
    const quoteClient = await createClient();
    const svc = await quoteService(partner);
    const q = await sendFor(quoteClient, partner, { serviceId: svc.id });
    const { offerId } = await sendQuote(partner.actor, { number: q.number, title: 'Оферта', amountCents: 50_000 });
    const a = await approvedBooking({ p: partner });
    const pay = await startPayment(a.client.actor, { number: a.number, method: 'card' });

    // The client's choice holds the quote request…
    const locked = gate(), go = gate();
    let holder = 0;
    const choosing = db.transaction(async t => {
      await t.select({ id: s.request.id }).from(s.request).where(eq(s.request.id, q.requestId)).for('update');
      holder = await backendPid(t);
      locked.open();
      await go.passed;
      await chooseQuoteOffer(quoteClient.actor, { number: q.number }, t);
    });
    await locked.passed;
    // …while a payment fills the date and lapses the open offers for it.
    const paying = applyProviderEvent({ type: 'charge.succeeded', chargeId: pay.chargeId, providerRef: '', cardBrand: 'visa', cardLast4: '4242' });
    await lockWaiter(holder);
    go.open();
    const [, paid] = await Promise.all([choosing, paying]);

    expect(paid).toMatchObject({ applied: true, bookingConfirmed: true });
    expect(await requestRow(q.requestId)).toMatchObject({ status: 'awaiting_confirmation' });
    expect((await db.select().from(s.offer).where(eq(s.offer.id, offerId)))[0].status).toBe('chosen');
  });
});

describe('client withdrawal of an unanswered request', () => {
  it('withdraws, cancels the jobs and frees the date for a new request', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const { number, requestId } = await sendFor(client, partner);
    expect((await failure(cancelPendingRequest((await createClient()).actor, { number }))).code).toBe('not_found');
    expect(await failure(cancelPendingRequest(partner.actor, { number }))).toBeInstanceOf(ForbiddenError);
    await cancelPendingRequest(client.actor, { number });
    expect(await requestRow(requestId)).toMatchObject({ status: 'withdrawn' });
    expect((await jobs(`request:${requestId}:`)).every(j => j.status === 'cancelled')).toBe(true);
    expect((await failure(cancelPendingRequest(client.actor, { number }))).code).toBe('invalid_state');
    const again = await sendFor(client, partner);
    expect(again.number).not.toBe(number);
  });
});

describe('request view models', () => {
  it('shows the partner the projected amount and no phone before payment; others get 404', async () => {
    const client = await createClient();
    const partner = await createPartner();
    const { number } = await sendFor(client, partner);
    const v = await getRequestForPartner(partner.actor, number);
    expect(v).toMatchObject({ number, status: 'pending', partnerAmountCents: 137_750, client: { phone: null }, date: { free: true } });
    expect((await failure(getRequestForPartner((await createPartner()).actor, number))).code).toBe('not_found');
    expect((await getRequestForClient(client.actor, number)).partner.name).toBe(partner.partner.businessName);
    expect((await failure(getRequestForClient((await createClient()).actor, number))).code).toBe('not_found');
    await expectLedgerHealthy();
  });
});
