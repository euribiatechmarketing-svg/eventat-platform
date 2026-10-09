// Partner operations read models (SCREENS §7): inbox groups, ledger, search, exports, and the small formats.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { reportJob } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { declineRequest } from '@/lib/domain/requests';
import { withdrawApproval } from '@/lib/domain/bookings';
import {
  ago, attachmentsText, bookedChip, bookingsLedger, dashboardView, hhmm, parseDateQuery, partnerReportCsv, partnerSearch, policyLine, rangeText, requestPartnerReport, requestsInbox,
} from '@/lib/domain/views-partner-ops';
import { createClient, createPartner } from '../helpers/factories';
import { NOW, approvedBooking, emails, paidBooking, sendFor } from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterAll(() => setTestNow(null));

describe('formats', () => {
  it('relative ages and countdowns like the prototype', () => {
    expect(ago(sofiaInstant('2025-08-31', 7, 0), NOW)).toBe('преди 5 часа');
    expect(ago(sofiaInstant('2025-08-31', 11, 0), NOW)).toBe('преди 1 час');
    expect(ago(sofiaInstant('2025-08-31', 9, 0), NOW, true)).toBe('преди 3 ч');
    expect(ago(sofiaInstant('2025-08-30', 14, 0), NOW)).toBe('вчера');
    expect(ago(sofiaInstant('2025-08-27', 14, 0), NOW)).toBe('преди 4 дни');
    expect(ago(sofiaInstant('2025-04-15', 9, 0), NOW)).toBe('преди 4 месеца');
    expect(hhmm(NOW, sofiaInstant('2025-09-01', 9, 14))).toBe('21:14');
  });
  it('block ranges, policy lines, attachment counts', () => {
    const sp = (s: string) => s.replace(/\u00a0/g, ' ');
    expect(sp(rangeText('2026-06-17', '2026-06-18'))).toBe('17 – 18 юни 2026');
    expect(sp(rangeText('2026-12-24', '2026-12-24'))).toBe('24 декември 2026');
    expect(sp(rangeText('2026-07-30', '2026-08-02'))).toBe('30 юли – 2 август 2026');
    expect(policyLine('moderate')).toBe('Умерена — безплатно анулиране до 30 дни преди събитието.');
    expect(policyLine('strict')).toMatch(/^Строга — депозитът не се връща; остатъкът се възстановява до 14 дни преди събитието\.$/);
    expect(attachmentsText('Мария Димитрова', 3)).toBe('Мария прикачи три референции към заявката — показват стила и атмосферата, които търси.');
  });
  it('calendar chips are written like the prototype (vendor/calendar.html)', () => {
    expect(bookedChip('Сватба', 120)).toBe('Сватба · 120 гости');
    expect(bookedChip('Абитуриентски бал', 70)).toBe('Бал · 70 гости');
    expect(bookedChip('Рожден ден', 40)).toBe('Рожден ден · 40 г.');
    expect(bookedChip('Фирмено събитие', 250)).toBe('Фирмено · 250 г.');
  });
  it('reads dates typed into the search', () => {
    expect(parseDateQuery('14.06.2026')).toEqual({ day: 14, month: 6, year: 2026 });
    expect(parseDateQuery('2026-06-14')).toEqual({ day: 14, month: 6, year: 2026 });
    expect(parseDateQuery('14 юни')).toEqual({ day: 14, month: 6, year: undefined });
    expect(parseDateQuery('септ. 2026')).toEqual({ day: undefined, month: 9, year: 2026 });
    expect(parseDateQuery('Мария')).toBeNull();
  });
});

describe('requests inbox, ledger, search', () => {
  it('groups requests by what the partner has to do, and filters them', async () => {
    const partner = await createPartner();
    const a = await createClient({ name: 'Ана Петрова' });
    const b = await createClient({ name: 'Борис Иванов' });
    const fresh = await sendFor(a, partner, { eventDate: '2026-07-04' });
    const late = await sendFor(b, partner, { eventDate: '2026-07-11' });
    await declineRequest(partner.actor, { number: late.number, reason: 'date_taken' });
    const pay = await approvedBooking({ p: partner, request: { eventDate: '2026-07-18' } });

    const all = await requestsInbox(partner.actor, { tab: 'vsichki', filter: 'vsichki' });
    expect(all.counts).toMatchObject({ new: 1, pay: 1, declined: 1 });
    expect(all.groups.new.map(r => r.number)).toEqual([fresh.number]);
    expect(all.groups.new[0]).toMatchObject({ clientName: 'Ана Петрова', initials: 'АП', badge: { label: 'Нова' }, priceNote: 'по пакет' });
    expect(all.groups.pay[0]).toMatchObject({ number: pay.number, badge: { label: 'Чака плащане' } });
    expect(all.groups.declined[0]).toMatchObject({ number: late.number, badge: { label: 'Отказана' } });

    const onlyNew = await requestsInbox(partner.actor, { tab: 'vsichki', filter: 'novi' });
    expect(onlyNew.groups.pay).toHaveLength(0);
    // 24 h to answer and to pay: nothing is inside the 6 h window yet…
    expect((await requestsInbox(partner.actor, { tab: 'vsichki', filter: 'iztichasht' })).groups.new).toHaveLength(0);
    // …19 h later both are.
    setTestNow(new Date(NOW.getTime() + 19 * 3_600_000));
    const soon = await requestsInbox(partner.actor, { tab: 'vsichki', filter: 'iztichasht' });
    expect(soon.groups.new).toHaveLength(1);
    expect(soon.groups.pay).toHaveLength(1);

    // Another partner sees none of it.
    const other = await createPartner();
    expect((await requestsInbox(other.actor, { tab: 'vsichki', filter: 'vsichki' })).counts).toMatchObject({ new: 0, pay: 0 });
  });

  it('ledger by month with what the partner receives, never the commission', async () => {
    const paid = await paidBooking();
    const v = await bookingsLedger(paid.partner.actor, { tab: 'predstoyashti', period: null });
    expect(v.counts.upcoming).toBe(1);
    expect(v.months[0]).toMatchObject({ title: 'Юни 2026', summary: '1 събитие · 1 450 € оборот' });
    const row = v.months[0].rows[0];
    expect(row).toMatchObject({ number: paid.number, status: 'confirmed', amountCents: 145000 });
    expect(row.partnerCents).toBeGreaterThan(0);
    expect(row.partnerCents).toBeLessThan(145000);
    expect((await bookingsLedger(paid.partner.actor, { tab: 'predstoyashti', period: 'mesec' })).months).toHaveLength(0);
    const dash = await dashboardView(paid.partner.actor, {});
    expect(dash.counts).toMatchObject({ newRequests: 0, awaitingPayment: 0, upcomingEvents: 1 });
    expect(dash.events[0]).toMatchObject({ number: paid.number, title: 'Сватба · ' + paid.client.user.name });
  });

  it('search finds by client, date and number; a booked request is listed once', async () => {
    const paid = await paidBooking();
    const s1 = await partnerSearch(paid.partner.actor, { q: paid.client.user.name.split(' ')[0] });
    expect(s1.requests).toHaveLength(0);
    expect(s1.bookings.map(b => b.number)).toEqual([paid.number]);
    expect((await partnerSearch(paid.partner.actor, { q: '14.06.2026' })).bookings).toHaveLength(1);
    expect((await partnerSearch(paid.partner.actor, { q: '15 юни' })).bookings).toHaveLength(0);
    expect((await partnerSearch(paid.partner.actor, { q: paid.number })).bookings).toHaveLength(1);
    const other = await createPartner();
    expect((await partnerSearch(other.actor, { q: paid.number })).bookings).toHaveLength(0);
  });

  it('a withdrawn approval closes the request under ‹Отказани›', async () => {
    const pay = await approvedBooking({ request: { eventDate: '2026-07-25' } });
    await withdrawApproval(pay.partner.actor, { number: pay.number });
    const v = await requestsInbox(pay.partner.actor, { tab: 'otkazani', filter: 'vsichki' });
    expect(v.groups.declined.map(r => r.number)).toEqual([pay.number]);
    expect(v.groups.declined[0].badge).toMatchObject({ label: 'Оттеглено одобрение' });
    expect(v.counts.pay).toBe(0);
  });

  it('the exported file holds the view it was asked from, for its own partner only', async () => {
    const paid = await paidBooking();
    const { reportId } = await requestPartnerReport(paid.partner.actor, { kind: 'partner_bookings', params: { tab: 'predstoyashti', period: null } });
    const f = await partnerReportCsv(paid.partner.actor, reportId);
    const lines = f!.csv.replace(/^\ufeff/, '').trim().split('\r\n');
    expect(f!.filename).toBe('rezervacii-2025-08-31.csv');
    expect(lines[0]).toBe('Дата;№;Събитие;Услуга;Гости;Сума;Получавате;Статус');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(paid.number);
    expect(lines[1]).toContain(';1450,00;');
    const other = await createPartner();
    expect(await partnerReportCsv(other.actor, reportId)).toBeNull();
    const { reportId: rq } = await requestPartnerReport(paid.partner.actor, { kind: 'partner_requests', params: { tab: 'vsichki', filtar: 'vsichki' } });
    expect((await partnerReportCsv(paid.partner.actor, rq))!.csv).toContain('№;Клиент;Събитие;Услуга;Дата;Гости;Локация;Сума;Статус;Получена');
  });

  it('‹Експорт› records the report and emails the partner', async () => {
    const partner = await createPartner();
    const { reportId } = await requestPartnerReport(partner.actor, { kind: 'partner_bookings', params: { tab: 'predstoyashti' } });
    const [r] = await db.select().from(reportJob).where(and(eq(reportJob.id, reportId), eq(reportJob.partnerId, partner.partner.id)));
    expect(r).toMatchObject({ kind: 'partner_bookings', status: 'ready' });
    expect(await emails('vendor-report-ready', partner.user.id)).toHaveLength(1);
  });
});
