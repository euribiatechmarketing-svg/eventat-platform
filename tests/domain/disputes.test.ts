// SPEC §4.11 disputes X1–X10, decisions and their money effects, T15, T16. Runs on its own database.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { auditLog, booking, cancellation, charge, dispute, disputeAttachment, disputeMessage, job, media, payoutLine, refund } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { date, dateTime, money, moneyShort, sofiaInstant } from '@/lib/format';
import { scheduleJob } from '@/lib/jobs';
import { bookingBalances } from '@/lib/domain/ledger';
import { releaseBookingFunds } from '@/lib/domain/payouts';
import {
  complianceDeadline, decide, getDispute, markComplied, openByClient, openByPartner, openByTeam, openDisputeForBooking, positionDeadline,
  remind, requestInfo, setHoldsPayout, setOptions, submitStatement, withdraw,
} from '@/lib/domain/disputes';
import { createAdmin, createBookingRow, createClient, createPartner } from '../helpers/factories';
import {
  addCharge, bells, clearJobs, emails, expectLedgerHealthy, failure, paidBooking, pendingJobs, reloadBooking, runJobs,
} from '../helpers/aftercare';

const NOW = sofiaInstant('2025-08-31', 12, 0);
const H = 3600_000;
beforeEach(async () => { await clearJobs(); setTestNow(NOW); });
afterEach(() => setTestNow(null));

async function evidence(ownerUserId: string) {
  const [m] = await db.insert(media).values({ ownerUserId, kind: 'dispute_evidence', storageKey: `private/disputes/${ownerUserId}.jpg`, mime: 'image/jpeg', sizeBytes: 1000, originalName: 'snimka.jpg' }).returning();
  return m.id;
}
const lineOf = async (bookingId: string) => (await db.select().from(payoutLine).where(eq(payoutLine.bookingId, bookingId)))[0];

describe('X1–X3 opening', () => {
  it('X1 client: holds the payout, starts the partner’s 48 h, three emails and bells', async () => {
    const { user: adminUser } = await createAdmin('admin');
    const { user: acc } = await createAdmin('accounting');
    const { client, partner, booking: b } = await paidBooking();
    const ev = await evidence(client.user.id);
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'not_as_described', description: 'Обхватът е по-малък от обявения.', evidenceMediaIds: [ev] });
    expect(d).toMatchObject({
      status: 'collecting', openedBy: 'client', number: b.number, holdsPayout: true, heldCents: 145_000, positionFrom: 'partner',
      title: 'Услугата не беше по описание', positionDueAt: new Date(NOW.getTime() + 48 * H), teamReplyDueAt: new Date(NOW.getTime() + 24 * H),
    });
    expect((await reloadBooking(b.id)).payoutHold).toBe(true);
    expect(await lineOf(b.id)).toMatchObject({ status: 'held', holdReason: 'dispute' });
    const [m] = await db.select().from(disputeMessage).where(eq(disputeMessage.disputeId, d.id));
    expect(m).toMatchObject({ party: 'client', kind: 'statement', context: 'причина: „Услугата не беше по описание“' });
    expect(await db.select().from(disputeAttachment).where(eq(disputeAttachment.messageId, m.id))).toHaveLength(1);
    const [co] = await emails('client-dispute-opened', client.user.id);
    expect(co.vars).toMatchObject({ problem: 'Услугата не беше по описание', heldAmount: money(145_000), openedAt: dateTime(NOW) });
    const [vo] = await emails('vendor-ticket-client-opened', partner.user.id);
    expect(vo.vars).toMatchObject({ message: 'Обхватът е по-малък от обявения.', reason: 'Услугата не беше по описание' });
    expect(await emails('team-dispute-new', adminUser.id)).toHaveLength(1);
    expect(await emails('team-dispute-new', acc.id)).toHaveLength(0);
    expect(await bells(client.user.id, 'client-dispute-opened')).toHaveLength(1);
    expect((await bells(partner.user.id, 'vendor-ticket-client-opened'))[0].href).toBe(`/partner/poddrazhka/${encodeURIComponent(b.number)}`);
    expect(await pendingJobs(`dispute:${d.id}:position`)).toHaveLength(1);
    expect((await openDisputeForBooking(b.id))?.id).toBe(d.id);
    await expectLedgerHealthy();
  });

  it('X1 guards: one case per booking, client reasons, own booking, own files, 30 days after the event (D70)', async () => {
    const { client, partner, booking: b } = await paidBooking();
    const stranger = await createClient();
    expect(await failure(openByClient(stranger.actor, { bookingId: b.id, reason: 'no_show', description: 'x' }))).toContain('Forbidden');
    expect(await failure(openByClient(client.actor, { bookingId: b.id, reason: 'client_unresponsive', description: 'x' }))).toContain('bad_reason');
    expect(await failure(openByClient(client.actor, { bookingId: b.id, reason: 'no_show', description: ' ' }))).toContain('description_required');
    expect(await failure(openByClient(client.actor, { bookingId: b.id, reason: 'no_show', description: 'x', evidenceMediaIds: [await evidence(stranger.user.id)] }))).toContain('Forbidden');
    expect(await failure(openByClient(partner.actor, { bookingId: b.id, reason: 'no_show', description: 'x' }))).toContain('Forbidden');
    await openByClient(client.actor, { bookingId: b.id, reason: 'no_show', description: 'Не дойде.' });
    expect(await failure(openByClient(client.actor, { bookingId: b.id, reason: 'no_show', description: 'Пак.' }))).toContain('dispute_open');
    const old = await paidBooking({ client, eventDate: '2025-07-31' });
    expect(await failure(openByClient(client.actor, { bookingId: old.booking.id, reason: 'no_show', description: 'x' }))).toContain('dispute_window_passed');
    const edge = await paidBooking({ client, eventDate: '2025-08-01' });
    await openByClient(client.actor, { bookingId: edge.booking.id, reason: 'no_show', description: 'x' });
  });

  it('X2 partner ‹Клиентът не отговаря›: no payout hold (D13), the client is asked to answer', async () => {
    const { user: adminUser } = await createAdmin('moderator');
    const { client, partner, booking: b } = await paidBooking();
    expect(await failure(openByPartner(partner.actor, { bookingId: b.id, reason: 'no_show', description: 'x' }))).toContain('bad_reason');
    const d = await openByPartner(partner.actor, {
      bookingId: b.id, reason: 'client_unresponsive', description: 'изпълнителят иска да уточни програмата', ask: 'ни дайте контакт с отговорното лице',
    });
    expect(d).toMatchObject({ openedBy: 'partner', holdsPayout: false, heldCents: 0, positionFrom: 'client' });
    expect((await reloadBooking(b.id)).payoutHold).toBe(false);
    expect((await lineOf(b.id)).status).toBe('awaiting_event');
    expect(await emails('vendor-ticket-received', partner.user.id)).toHaveLength(1);
    const [co] = await emails('client-ticket-vendor-opened', client.user.id);
    expect(co.vars).toMatchObject({ reason: 'Клиентът не отговаря', ask: 'ни дайте контакт с отговорното лице', replyBy: dateTime(new Date(NOW.getTime() + 48 * H)) });
    expect(await emails('team-dispute-new', adminUser.id)).toHaveLength(1);

    const other = await paidBooking({ partner });
    const held = await openByPartner(partner.actor, { bookingId: other.booking.id, reason: 'terms_changed_on_site', description: 'Промени условията.' });
    expect(held.holdsPayout).toBe(true);
    expect((await reloadBooking(other.booking.id)).payoutHold).toBe(true);
  });

  it('X3 team: holds the payout, emails nobody (D68), no position timer', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { actor: support } = await createAdmin('support');
    const { client, booking: b } = await paidBooking();
    expect(await failure(openByTeam(support, { bookingId: b.id, title: 'Проверка', description: 'x' }))).toContain('Forbidden');
    const d = await openByTeam(admin, { bookingId: b.id, title: 'Двойно плащане', description: 'Проверка на плащанията.', reason: 'payment_problem' });
    expect(d).toMatchObject({ openedBy: 'team', holdsPayout: true });
    expect((await reloadBooking(b.id)).payoutHold).toBe(true);
    expect(await emails('client-dispute-opened', client.user.id)).toHaveLength(0);
    expect(await pendingJobs(`dispute:${d.id}:`)).toHaveLength(0);
  });
});

describe('X4–X7 collecting', () => {
  it('T15: no position in 48 h → awaiting_decision and team-dispute-deadline, once', async () => {
    const { user: adminUser, actor: admin } = await createAdmin('admin');
    const c = await paidBooking();
    const d = await openByClient(c.client.actor, { bookingId: c.booking.id, reason: 'no_show', description: 'Не дойде.' });
    await setOptions(admin, { disputeId: d.id, options: [{ kind: 'cancel_full_refund', label: 'Анулирай с пълно възстановяване' }, { kind: 'no_refund', label: 'Без възстановяване' }] });
    setTestNow(new Date(NOW.getTime() + 47 * H));
    await runJobs();
    expect((await db.select().from(dispute).where(eq(dispute.id, d.id)))[0].status).toBe('collecting');
    setTestNow(new Date(NOW.getTime() + 48 * H + 60_000));
    await runJobs();
    expect((await db.select().from(dispute).where(eq(dispute.id, d.id)))[0].status).toBe('awaiting_decision');
    const dl = await emails('team-dispute-deadline', adminUser.id);
    expect(dl).toHaveLength(1);
    expect(dl[0].vars).toMatchObject({ silentName: c.partner.partner.businessName, options: 'Възможностите са: анулирай с пълно възстановяване, без възстановяване.' });
    expect(await positionDeadline({ disputeId: d.id })).toBe(false);
    await runJobs();
    expect(await emails('team-dispute-deadline', adminUser.id)).toHaveLength(1);
  });

  it('X6: the other side’s position → awaiting_decision, team-dispute-reply, T15 cancelled', async () => {
    const { user: adminUser } = await createAdmin('admin');
    const { client, partner, booking: b } = await paidBooking();
    const stranger = await createClient();
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'not_as_described', description: 'Не е по описание.' });
    expect(await failure(submitStatement(stranger.actor, { disputeId: d.id, body: 'x' }))).toContain('Forbidden');
    const ev = await evidence(partner.user.id);
    await submitStatement(partner.actor, { disputeId: d.id, body: 'Осигурихме всичко по описанието.', evidenceMediaIds: [ev] });
    expect((await db.select().from(dispute).where(eq(dispute.id, d.id)))[0].status).toBe('awaiting_decision');
    const [rep] = await emails('team-dispute-reply', adminUser.id);
    expect(rep.vars).toMatchObject({ responderName: partner.partner.businessName, openerName: client.user.name, photoCount: 1, summary: 'Осигурихме всичко по описанието.' });
    expect(await pendingJobs(`dispute:${d.id}:position`)).toHaveLength(0);
    setTestNow(new Date(NOW.getTime() + 49 * H));
    await runJobs();
    expect(await emails('team-dispute-deadline', adminUser.id)).toHaveLength(0);
    await submitStatement(client.actor, { disputeId: d.id, body: 'Допълвам.' });
    expect(await emails('team-dispute-reply', adminUser.id)).toHaveLength(1);
  });

  it('X4 questions to both sides, X5 reminders; the answers are marked as answers', async () => {
    const { actor: admin } = await createAdmin('moderator');
    const { actor: support } = await createAdmin('support');
    const { client, partner, booking: b } = await paidBooking();
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'other', description: 'Друго.' });
    expect(await failure(requestInfo(support, { disputeId: d.id, question: 'Какво?' }))).toContain('Forbidden');
    expect(await failure(requestInfo(admin, { disputeId: d.id, question: ' ' }))).toContain('question_required');
    await requestInfo(admin, { disputeId: d.id, question: 'Имате ли снимки от монтажа?' });
    expect((await emails('client-dispute-info-request', client.user.id))[0].vars).toMatchObject({ topic: 'Друго' });
    expect(await emails('vendor-ticket-info-request', partner.user.id)).toHaveLength(1);
    await submitStatement(client.actor, { disputeId: d.id, body: 'Да, прилагам.' });
    const msgs = await db.select().from(disputeMessage).where(and(eq(disputeMessage.disputeId, d.id), eq(disputeMessage.party, 'client')));
    expect(msgs.map(m => m.context)).toContain('в отговор на запитване от екипа');
    await remind(admin, { disputeId: d.id, side: 'partner' });
    expect(await emails('vendor-ticket-reminder', partner.user.id)).toHaveLength(1);
    expect(await failure(remind(admin, { disputeId: d.id, side: 'client' }))).toContain('need_required');
    await remind(admin, { disputeId: d.id, side: 'client', need: 'Изпълнителят иска само контакт с отговорното лице.' });
    expect((await emails('client-ticket-reminder', client.user.id))[0].vars).toMatchObject({ need: 'Изпълнителят иска само контакт с отговорното лице.' });
    const seen = await getDispute(partner.actor, d.id);
    expect(seen.options).toEqual([]);
    expect(seen.messages.every(m => m.recipients !== 'client')).toBe(true);
    expect(await failure(getDispute((await createClient()).actor, d.id))).toContain('Forbidden');
  });

  it('D13 toggle and X9 withdrawal return the payout to its schedule', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, partner, booking: b } = await paidBooking();
    const d = await openByPartner(partner.actor, { bookingId: b.id, reason: 'client_unresponsive', description: 'Не отговаря.' });
    await setHoldsPayout(admin, { disputeId: d.id, holdsPayout: true });
    expect((await reloadBooking(b.id)).payoutHold).toBe(true);
    expect((await lineOf(b.id)).status).toBe('held');
    expect(await failure(withdraw(client.actor, { disputeId: d.id }))).toContain('Forbidden');
    await withdraw(partner.actor, { disputeId: d.id });
    expect((await db.select().from(dispute).where(eq(dispute.id, d.id)))[0]).toMatchObject({ status: 'withdrawn' });
    expect((await reloadBooking(b.id)).payoutHold).toBe(false);
    expect((await lineOf(b.id)).status).toBe('awaiting_event');
    expect(await pendingJobs(`dispute:${d.id}:`)).toHaveLength(0);
    expect(await failure(withdraw(partner.actor, { disputeId: d.id }))).toContain('not_withdrawable');
  });
});

describe('X8 decisions', () => {
  it('partial refund after the event: the held release waits, then the partner gets the rest less commission', async () => {
    const { actor: admin, user: adminUser } = await createAdmin('admin');
    const { actor: support } = await createAdmin('support');
    const { client, partner, booking: b } = await paidBooking({ eventDate: '2025-09-05' });
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'not_as_described', description: 'Три часа вместо четири.' });
    setTestNow(sofiaInstant('2025-09-06', 0, 1));
    expect(await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx))).toMatchObject({ held: true, releasedCents: 0 });
    expect(await failure(decide(support, { disputeId: d.id, kind: 'no_refund', motive: 'x' }))).toContain('Forbidden');
    expect(await failure(decide(admin, { disputeId: d.id, kind: 'partial_refund', motive: ' ' }))).toContain('motive_required');
    expect(await failure(decide(admin, { disputeId: d.id, kind: 'partial_refund', motive: 'x', refundCents: 145_001 }))).toContain('bad_refund_amount');

    const res = await decide(admin, { disputeId: d.id, kind: 'partial_refund', refundPercent: 30, motive: 'услугата беше 3 часа вместо 4.' });
    expect(res).toMatchObject({ status: 'resolved', decisionKind: 'partial_refund', refundCents: 43_500, partnerKeepsCents: 101_500, decisionTitle: `Върни разликата — ${moneyShort(43_500)}` });
    const [r] = await db.select().from(refund).where(eq(refund.bookingId, b.id));
    expect(r).toMatchObject({ reason: 'dispute_decision', disputeId: d.id, amountCents: 43_500 });
    expect((await reloadBooking(b.id)).payoutHold).toBe(false);
    expect(await lineOf(b.id)).toMatchObject({ status: 'ready', baseCents: 101_500, commissionCents: 10_150, amountCents: 91_350 });
    const [cd] = await emails('client-dispute-decision', client.user.id);
    expect(cd.vars).toMatchObject({ heldAmount: money(101_500), heldUntil: date('2025-09-06'), motive: 'услугата беше 3 часа вместо 4.' });
    const [vd] = await emails('vendor-ticket-decision', partner.user.id);
    expect(vd.vars).toMatchObject({ refunded: money(43_500), partnerAmount: money(91_350), decidedBy: adminUser.name, payoutLine: 'Изплащането по резервацията продължава по обичайния график — на 1-во или 15-то число.' });
    // The partner's email leads with the decision, not with the client's own statement.
    expect(vd.vars).toMatchObject({ account: `Върни разликата — ${moneyShort(43_500)}` });
    await runJobs();
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, partner_payable: 91_350, commission_revenue: 10_150, provider_held: 91_350 });
    const sent = await emails('client-refund-sent', client.user.id);
    expect(sent).toHaveLength(1);
    // The booking stands: the refund email does not call it cancelled or speak of a free cancellation period.
    expect(sent[0].text).toContain(`Върнахме ${money(43_500)} по резервацията при`);
    expect(sent[0].text).not.toMatch(/анулира|безплатния срок/);
    expect(await failure(decide(admin, { disputeId: d.id, kind: 'no_refund', motive: 'x' }))).toContain('dispute_closed');
    expect(await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx))).toMatchObject({ releasedCents: 0 });
    await expectLedgerHealthy();
  });

  it('partial refund before the event: the line projects what the partner keeps, and K13 releases exactly that', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b } = await paidBooking({ eventDate: '2025-09-20' });
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'not_as_described', description: 'Менюто е друго.' });
    await decide(admin, { disputeId: d.id, kind: 'partial_refund', refundCents: 45_000, motive: 'x' });
    // ‹Получавате› on the partner's booking page and ‹За изплащане› read this line until the event.
    expect(await lineOf(b.id)).toMatchObject({ status: 'awaiting_event', readyAt: null, baseCents: 100_000, commissionCents: 10_000, amountCents: 90_000 });
    await runJobs(); // the refund settles
    expect(await lineOf(b.id)).toMatchObject({ status: 'awaiting_event', amountCents: 90_000 });
    setTestNow(sofiaInstant('2025-09-21', 0, 1));
    expect(await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx))).toMatchObject({ releasedCents: 100_000, commissionCents: 10_000 });
    expect(await lineOf(b.id)).toMatchObject({ status: 'ready', baseCents: 100_000, commissionCents: 10_000, amountCents: 90_000 });
    await expectLedgerHealthy();
  });

  it('partial refund of everything paid before the event: no payout is left to project', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b } = await paidBooking({ eventDate: '2025-09-20' });
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'no_show', description: 'Отказаха.' });
    await decide(admin, { disputeId: d.id, kind: 'partial_refund', refundCents: 145_000, motive: 'x' });
    expect(await lineOf(b.id)).toMatchObject({ status: 'cancelled', amountCents: 0 });
    await runJobs();
    setTestNow(sofiaInstant('2025-09-21', 0, 1));
    expect(await db.transaction(tx => releaseBookingFunds({ bookingId: b.id }, tx))).toMatchObject({ releasedCents: 0 });
    await expectLedgerHealthy();
  });

  it('cancel with full refund (K15) from a composed option', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, partner, booking: b } = await paidBooking();
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'no_show', description: 'Не дойде.' });
    await setOptions(admin, { disputeId: d.id, options: [{ kind: 'cancel_full_refund', label: 'Анулирай с пълно възстановяване', description: 'Резервацията се анулира и сумата се връща изцяло.' }] });
    const [opt] = (await getDispute(admin, d.id)).options;
    const res = await decide(admin, { disputeId: d.id, optionId: opt.id, motive: 'изпълнителят не се яви.' });
    expect(res).toMatchObject({ decisionKind: 'cancel_full_refund', refundCents: 145_000, partnerKeepsCents: 0, decisionTitle: 'Анулирай с пълно възстановяване' });
    expect(await reloadBooking(b.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'dispute', payoutHold: false });
    expect((await db.select().from(cancellation).where(eq(cancellation.bookingId, b.id)))[0]).toMatchObject({ initiatedBy: 'dispute', refundCents: 145_000 });
    expect((await emails('vendor-ticket-decision', partner.user.id))[0].vars).toMatchObject({ payoutLine: 'По тази резервация няма изплащане.', partnerAmount: money(0) });
    expect((await emails('client-dispute-decision', client.user.id))[0].vars).toMatchObject({ decision: 'Резервацията се анулира и сумата се връща изцяло.' });
    await runJobs();
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, provider_held: 0 });
    expect((await lineOf(b.id)).status).toBe('cancelled');
    const [sent] = await emails('client-refund-sent', client.user.id);
    expect(sent.text).toContain('по анулираната резервация при');
    expect(sent.text).not.toContain('безплатния срок');
    await expectLedgerHealthy();
  });

  it('enforce_terms with a compliance deadline: T16 falls back to cancel + full refund unless marked complied', async () => {
    const { actor: admin } = await createAdmin('admin');
    const a = await paidBooking();
    const da = await openByClient(a.client.actor, { bookingId: a.booking.id, reason: 'not_as_described', description: 'x' });
    expect(await failure(decide(admin, { disputeId: da.id, kind: 'enforce_terms', motive: 'x' }))).toContain('title_required');
    const due = new Date(NOW.getTime() + 72 * H);
    const res = await decide(admin, { disputeId: da.id, kind: 'enforce_terms', title: 'Задължи изпълнителя да потвърди монтажа', motive: 'договореното е 13:00–16:00.', complianceDueAt: due });
    expect(res).toMatchObject({ fallback: 'cancel_full_refund', complianceDueAt: due, partnerKeepsCents: 145_000 });
    expect((await reloadBooking(a.booking.id)).payoutHold).toBe(false);
    expect(await pendingJobs(`dispute:${da.id}:compliance`)).toHaveLength(1);

    const c = await paidBooking();
    const dc = await openByClient(c.client.actor, { bookingId: c.booking.id, reason: 'not_as_described', description: 'x' });
    await decide(admin, { disputeId: dc.id, kind: 'enforce_terms', title: 'Задължи', motive: 'x', complianceDueAt: due });
    await markComplied(admin, { disputeId: dc.id });
    expect(await pendingJobs(`dispute:${dc.id}:compliance`)).toHaveLength(0);

    setTestNow(new Date(due.getTime() + 60_000));
    await runJobs();
    expect(await reloadBooking(a.booking.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'dispute' });
    expect((await db.select().from(refund).where(eq(refund.bookingId, a.booking.id)))[0]).toMatchObject({ status: 'succeeded', amountCents: 145_000, reason: 'dispute_decision' });
    expect(await db.select().from(auditLog).where(and(eq(auditLog.action, 'dispute.fallback_applied'), eq(auditLog.entityId, da.id)))).toHaveLength(1);
    expect(await complianceDeadline({ disputeId: da.id })).toBe(false);
    expect((await reloadBooking(c.booking.id)).status).toBe('confirmed');
    expect(await emails('client-refund-sent', a.client.user.id)).toHaveLength(1);
    await expectLedgerHealthy();
  });

  it('awaiting payment: restore_price (new 24 h window, timers move), accept_new_price, cancel_unpaid (K16, K15)', async () => {
    const { actor: admin } = await createAdmin('admin');
    const client = await createClient();
    const partner = await createPartner();
    const unpaid = async () => {
      const r = await createBookingRow({ client: client.user, partner, status: 'awaiting_payment' });
      await db.update(booking).set({ amountCents: 160_000, dueNowCents: 160_000 }).where(eq(booking.id, r.booking.id));
      return r;
    };
    const one = await unpaid();
    const oldDue = one.booking.paymentDueAt;
    await scheduleJob('noop', new Date(oldDue.getTime() - 6 * H), {}, `booking:${one.booking.id}:payrem:6`);
    const d1 = await openByClient(client.actor, { bookingId: one.booking.id, reason: 'payment_problem', description: 'Цената е различна.' });
    expect(d1.heldCents).toBe(0);
    await decide(admin, { disputeId: d1.id, kind: 'restore_price', motive: 'одобрената сума е 1 450 €.' });
    const b1 = await reloadBooking(one.booking.id);
    expect(b1).toMatchObject({ amountCents: 145_000, dueNowCents: 145_000, paymentDueAt: new Date(NOW.getTime() + 24 * H), status: 'awaiting_payment' });
    const [moved] = await db.select().from(job).where(eq(job.dedupeKey, `booking:${one.booking.id}:payrem:6`));
    expect(moved.runAt).toEqual(new Date(NOW.getTime() + 18 * H));

    const two = await unpaid();
    const d2 = await openByClient(client.actor, { bookingId: two.booking.id, reason: 'payment_problem', description: 'x' });
    expect(await failure(decide(admin, { disputeId: d2.id, kind: 'accept_new_price', motive: 'x' }))).toContain('bad_amount');
    await decide(admin, { disputeId: d2.id, kind: 'accept_new_price', newAmountCents: 170_000, motive: 'новата цена е приета.' });
    expect(await reloadBooking(two.booking.id)).toMatchObject({ amountCents: 170_000, dueNowCents: 170_000, paymentDueAt: two.booking.paymentDueAt });

    const three = await unpaid();
    const d3 = await openByClient(client.actor, { bookingId: three.booking.id, reason: 'payment_problem', description: 'x' });
    await decide(admin, { disputeId: d3.id, kind: 'cancel_unpaid', motive: 'без такси.' });
    expect(await reloadBooking(three.booking.id)).toMatchObject({ status: 'cancelled', cancelledBy: 'dispute' });
    expect(await db.select().from(refund).where(eq(refund.bookingId, three.booking.id))).toHaveLength(0);

    const paid = await paidBooking();
    const d4 = await openByClient(paid.client.actor, { bookingId: paid.booking.id, reason: 'payment_problem', description: 'x' });
    expect(await failure(decide(admin, { disputeId: d4.id, kind: 'restore_price', motive: 'x' }))).toContain('not_awaiting_payment');
    expect(await failure(decide(admin, { disputeId: d4.id, kind: 'cancel_unpaid', motive: 'x' }))).toContain('not_awaiting_payment');
  });

  it('refund_duplicate refunds the second payment in full and leaves the booking alone', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b } = await paidBooking();
    const dup = await addCharge(b.id, 145_000, { duplicate: true });
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'payment_problem', description: 'Платих два пъти.' });
    expect(d.heldCents).toBe(290_000);
    await decide(admin, { disputeId: d.id, kind: 'refund_duplicate', motive: 'второто плащане е двойно.' });
    const [r] = await db.select().from(refund).where(eq(refund.bookingId, b.id));
    expect(r).toMatchObject({ chargeId: dup.id, amountCents: 145_000, reason: 'duplicate_charge', disputeId: d.id });
    await runJobs();
    expect((await db.select().from(charge).where(eq(charge.id, dup.id)))[0].status).toBe('refunded');
    expect(await reloadBooking(b.id)).toMatchObject({ status: 'confirmed', payoutHold: false });
    expect((await bookingBalances(db, b.id)).client_funds).toBe(145_000);
    expect(await emails('client-refund-sent', client.user.id)).toHaveLength(1);
    const plain = await paidBooking();
    const dp = await openByClient(plain.client.actor, { bookingId: plain.booking.id, reason: 'payment_problem', description: 'x' });
    expect(await failure(decide(admin, { disputeId: dp.id, kind: 'refund_duplicate', motive: 'x' }))).toContain('no_duplicate_charge');
    await expectLedgerHealthy();
  });

  it('no_refund after the event releases everything held to the partner', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { client, booking: b } = await paidBooking({ eventDate: '2025-08-25' });
    const d = await openByClient(client.actor, { bookingId: b.id, reason: 'not_as_described', description: 'x' });
    await decide(admin, { disputeId: d.id, kind: 'no_refund', motive: 'политиката е приета при плащането.' });
    expect(await bookingBalances(db, b.id)).toMatchObject({ client_funds: 0, partner_payable: 130_500, commission_revenue: 14_500 });
    expect(await lineOf(b.id)).toMatchObject({ status: 'ready', amountCents: 130_500, batchDate: '2025-09-01' });
    await expectLedgerHealthy();
  });
});
