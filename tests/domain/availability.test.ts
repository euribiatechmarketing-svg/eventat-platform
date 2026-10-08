// Calendar date and requestable dates (SPEC §4.13, §12.6), manual blocks, O5 offer lapse, date watches firing.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import {
  addMonths, blockDate, blockRange, busyPartnerIds, capacityOf, check, dayRange, isoWeekday, monthGrid, setRules, toggleBlock, toggleOpenDate, unblock,
} from '@/lib/domain/availability';
import { allocateNumber } from '@/lib/domain/numbers';
import { createBookingRow, createClient, cityId, eventTypeId } from '../helpers/factories';
import { NOW, emails, expectLedgerClean, failure, listedPartner, plain } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

describe('date helpers', () => {
  it('adds months like PostgreSQL and numbers weekdays ISO', () => {
    expect(addMonths('2025-08-31', 6)).toBe('2026-02-28');
    expect(addMonths('2025-08-31', 24)).toBe('2027-08-31');
    expect(isoWeekday('2025-08-31')).toBe(7);
    expect(isoWeekday('2026-06-15')).toBe(1);
    expect(capacityOf({ bookingsPerDayMode: 'one', maxBookingsPerDate: 5 })).toBe(1);
    expect(capacityOf({ bookingsPerDayMode: 'limit', maxBookingsPerDate: 3 })).toBe(3);
    expect(capacityOf({ bookingsPerDayMode: 'unlimited', maxBookingsPerDate: 1 })).toBe(Infinity);
  });
});

describe('§12.6 requestable dates', () => {
  it('lead time, horizon, working days, blocks and only-selected dates', async () => {
    const pr = await listedPartner();
    const p = pr.partner.id;
    expect(await check(p, '2026-06-14')).toMatchObject({ state: 'free', busy: false, requestable: true, label: 'Свободно' });
    expect(await check(p, '2025-09-06')).toMatchObject({ state: 'closed', busy: true, reason: 'lead_time' });
    expect(await check(p, '2025-09-07')).toMatchObject({ busy: false });
    expect(await check(p, '2027-08-31')).toMatchObject({ busy: false });
    expect(await check(p, '2027-09-01')).toMatchObject({ state: 'closed', reason: 'horizon' });
    await setRules(pr.actor, { workingDays: [6, 7] });
    expect(await check(p, '2026-06-15')).toMatchObject({ state: 'blocked', busy: true, reason: 'not_working_day', chip: 'Блокирана' });
    await setRules(pr.actor, { workingDays: [1, 2, 3, 4, 5, 6, 7], onlySelectedDates: true });
    expect(await check(p, '2026-06-14')).toMatchObject({ state: 'closed', reason: 'not_opened' });
    expect(await toggleOpenDate(pr.actor, { date: '2026-06-14' })).toEqual({ open: true });
    expect(await check(p, '2026-06-14')).toMatchObject({ busy: false });
    expect(await toggleOpenDate(pr.actor, { date: '2026-06-14' })).toEqual({ open: false });
    await setRules(pr.actor, { onlySelectedDates: false });
    await blockRange(pr.actor, { from: '2026-07-01', to: '2026-07-03', reason: 'Отпуска' });
    expect(await check(p, '2026-07-02')).toMatchObject({ state: 'blocked', reason: 'blocked', label: 'Блокирана ръчно' });
  });

  it('capacity: one, limit and unlimited; held and booked states', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    const held = await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'awaiting_payment', approvedAt: new Date('2025-08-31T08:06:00Z') });
    let d = await check(pr.partner.id, '2026-06-14');
    expect(plain(d)).toMatchObject({ state: 'held', busy: true, reason: 'capacity', label: 'Запазена дата (24ч)', chip: 'Запазена до 11:06' });
    expect(d.bookings[0].number).toBe(held.number);
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-21', status: 'confirmed' });
    expect(plain(await check(pr.partner.id, '2026-06-21'))).toMatchObject({ state: 'booked', busy: true, chip: 'Сватба · 120 гости', label: 'Потвърдено събитие' });
    await setRules(pr.actor, { bookingsPerDayMode: 'limit', maxBookingsPerDate: 2 });
    d = await check(pr.partner.id, '2026-06-21');
    expect(d).toMatchObject({ state: 'booked', busy: false });
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-21', status: 'cancellation_requested' });
    expect((await check(pr.partner.id, '2026-06-21')).busy).toBe(true);
    await setRules(pr.actor, { bookingsPerDayMode: 'unlimited' });
    expect((await check(pr.partner.id, '2026-06-21')).busy).toBe(false);
    // Cancelled and expired bookings take no place.
    await setRules(pr.actor, { bookingsPerDayMode: 'one' });
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-28', status: 'payment_expired' });
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-28', status: 'cancelled' });
    expect((await check(pr.partner.id, '2026-06-28')).busy).toBe(false);
  });

  it('the SQL busy test agrees with the day-by-day calendar', async () => {
    const a = await listedPartner();
    const b = await listedPartner();
    const { user: client } = await createClient();
    await createBookingRow({ client, partner: a, eventDate: '2026-06-14', status: 'confirmed' });
    await setRules(b.actor, { workingDays: [1, 2, 3, 4, 5] });
    await blockDate(b.actor, { date: '2026-06-17' });
    for (const d of ['2025-09-01', '2026-06-13', '2026-06-14', '2026-06-15', '2026-06-17', '2027-09-02']) {
      const sqlBusy = await busyPartnerIds([a.partner.id, b.partner.id], d);
      for (const pr of [a, b]) expect(sqlBusy.has(pr.partner.id)).toBe((await check(pr.partner.id, d)).busy);
    }
  });
});

describe('blocks and the calendar month', () => {
  it('merges overlapping periods, refuses past dates, toggles single days (splitting a period)', async () => {
    const pr = await listedPartner();
    await blockRange(pr.actor, { from: '2026-07-01', to: '2026-07-05', reason: 'Отпуска' });
    await blockRange(pr.actor, { from: '2026-07-04', to: '2026-07-10' });
    let blocks = await db.select().from(s.availabilityBlock).where(eq(s.availabilityBlock.partnerId, pr.partner.id));
    expect(blocks.map(b => [b.startDate, b.endDate, b.reason])).toEqual([['2026-07-01', '2026-07-10', 'Отпуска']]);
    expect(await failure(blockDate(pr.actor, { date: '2025-08-30' }))).toContain('date_past');
    expect(await failure(blockRange(pr.actor, { from: '2026-07-10', to: '2026-07-01' }))).toContain('invalid_range');
    expect((await toggleBlock(pr.actor, { date: '2026-07-05' })).blocked).toBe(false);
    blocks = await db.select().from(s.availabilityBlock).where(eq(s.availabilityBlock.partnerId, pr.partner.id)).orderBy(s.availabilityBlock.startDate);
    expect(blocks.map(b => [b.startDate, b.endDate])).toEqual([['2026-07-01', '2026-07-04'], ['2026-07-06', '2026-07-10']]);
    expect((await toggleBlock(pr.actor, { date: '2026-07-20' })).blocked).toBe(true);
    const grid = await monthGrid(pr.actor, { month: '2026-07' });
    expect(grid.days).toHaveLength(31);
    expect(grid.counts).toEqual({ booked: 0, held: 0, blocked: 10 });
    expect(grid.days.find(d => d.date === '2026-07-05')?.state).toBe('free');
    expect(grid.rules).toMatchObject({ onePerDay: true, leadTimeDays: 7 });
    await unblock(pr.actor, { blockId: blocks[0].id });
    expect((await check(pr.partner.id, '2026-07-02')).busy).toBe(false);
    const { actor: client } = await createClient();
    expect(await failure(blockDate(client, { date: '2026-08-01' }))).toContain('ForbiddenError');
  });

  it('a freed date fires its watches (‹Датата е освободена› → client-date-freed), once', async () => {
    const pr = await listedPartner({ businessName: 'Ана Петрова Photography', category: 'fotografiya' });
    const { user: client } = await createClient();
    await blockDate(pr.actor, { date: '2026-06-14' });
    const [w] = await db.insert(s.dateWatch).values({ clientId: client.id, partnerId: pr.partner.id, date: '2026-06-14', createdAt: new Date('2025-08-10T10:00:00Z') }).returning();
    // Another watch on a date that stays busy does not fire.
    await blockDate(pr.actor, { date: '2026-06-20' });
    const [w2] = await db.insert(s.dateWatch).values({ clientId: client.id, partnerId: pr.partner.id, date: '2026-06-21' }).returning();
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-21', status: 'confirmed' });
    const r = await toggleBlock(pr.actor, { date: '2026-06-14' });
    expect(r).toEqual({ blocked: false, watchesNotified: 1 });
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, w.id)))[0].status).toBe('notified');
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, w2.id)))[0].status).toBe('watching');
    const [mail] = await emails('client-date-freed', client.id);
    expect(plain(mail.vars)).toEqual({
      partnerSlug: pr.partner.slug, partnerName: 'Ана Петрова Photography', partnerCategory: 'Фотография', eventType: '—',
      eventDate: '14 юни 2026', watchingSince: '10 август 2025',
    });
    const [bell] = await db.select().from(s.notification).where(eq(s.notification.userId, client.id));
    expect(bell.href).toBe(`/partnyori/${pr.partner.slug}?data=2026-06-14`);
    await blockDate(pr.actor, { date: '2026-06-14' });
    await toggleBlock(pr.actor, { date: '2026-06-14' });
    expect(await emails('client-date-freed', client.id)).toHaveLength(1);
  });

  it('raising capacity frees dates and fires watches', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'confirmed' });
    await db.insert(s.dateWatch).values({ clientId: client.id, partnerId: pr.partner.id, date: '2026-06-14' });
    expect((await setRules(pr.actor, { bookingsPerDayMode: 'limit', maxBookingsPerDate: 2 })).watchesNotified).toBe(1);
    expect(await failure(setRules(pr.actor, { maxBookingsPerDate: 12 }))).toContain('invalid_max_bookings');
    expect(await failure(setRules(pr.actor, { leadTimeDays: 5 }))).toContain('invalid_lead_time');
  });

  it('O5: a manual block lapses the partner’s open offers on those dates (quote request → expired, R10)', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    const [ev] = await db.insert(s.clientEvent).values({ clientId: client.id, eventTypeId: await eventTypeId(), title: 'Сватба', date: '2026-09-12' }).returning();
    const [br] = await db.insert(s.brief).values({
      clientId: client.id, clientEventId: ev.id, eventTypeId: ev.eventTypeId, eventDate: '2026-09-12', cityId: await cityId(), guests: 80,
      contactPhone: '+359888000000', offersDueAt: new Date('2025-09-01T09:00:00Z'),
    }).returning();
    const [inv] = await db.insert(s.briefInvitation).values({ briefId: br.id, partnerId: pr.partner.id, offerDueAt: new Date('2025-09-01T09:00:00Z'), status: 'offered' }).returning();
    const [briefOffer] = await db.insert(s.offer).values({ invitationId: inv.id, partnerId: pr.partner.id, title: 'Оферта', amountCents: 90_000 }).returning();
    const number = await allocateNumber(db, '2026-09-12');
    const [rq] = await db.insert(s.request).values({
      number, kind: 'quote', status: 'offer_sent', clientId: client.id, partnerId: pr.partner.id, clientEventId: ev.id, eventTypeId: ev.eventTypeId,
      eventDate: '2026-09-12', guests: 80, contactPhone: '+359888000000', serviceTitle: 'По запитване', responseDueAt: new Date('2025-09-01T09:00:00Z'),
    }).returning();
    const [quoteOffer] = await db.insert(s.offer).values({ requestId: rq.id, partnerId: pr.partner.id, title: 'Програма', amountCents: 50_000 }).returning();
    const [other] = await db.insert(s.offer).values({ requestId: (await createBookingRow({ client, partner: pr, eventDate: '2026-10-01', status: 'awaiting_payment' })).request.id, partnerId: pr.partner.id, title: 'Друга', amountCents: 1000 }).returning();
    await blockRange(pr.actor, { from: '2026-09-10', to: '2026-09-13' });
    const status = async (id: string) => (await db.select().from(s.offer).where(eq(s.offer.id, id)))[0].status;
    expect(await status(briefOffer.id)).toBe('lapsed');
    expect(await status(quoteOffer.id)).toBe('lapsed');
    expect(await status(other.id)).toBe('sent');
    expect((await db.select().from(s.request).where(eq(s.request.id, rq.id)))[0].status).toBe('expired');
    expect(await dayRange(pr.partner.id, '2026-09-10', '2026-09-11')).toHaveLength(2);
  });
});
