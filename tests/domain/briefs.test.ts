// Open requests (SPEC §4.6 O1, T3) and the client-booking read models.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { create, invitationExpireJob } from '@/lib/domain/briefs';
import { declineRequest } from '@/lib/domain/requests';
import { cancelPageData, clientBookingList, clientRequestList, subtitleOf } from '@/lib/domain/views-client-booking';
import { createClient, createPartner } from '../helpers/factories';
import { EVENT, H, NOW, approvedBooking, emails, paidBooking, sendFor } from '../helpers/lifecycle';

beforeEach(() => setTestNow(NOW));
afterEach(() => setTestNow(null));

const brief = (over: Partial<Parameters<typeof create>[1]> = {}) => ({
  categorySlugs: ['dj-i-ozvuchavane'], eventTypeSlug: 'svatba', eventDate: EVENT, guests: 100, citySlug: 'sofia', budget: 'unknown' as const, ...over,
});

describe('briefs.create (O1)', () => {
  it('invites exactly the partners that fit: category, city, date, guests', async () => {
    const client = await createClient();
    const fits = await createPartner();
    const otherCategory = await createPartner({ category: 'fotografiya' });
    const tooSmall = await createPartner();
    await db.update(s.partner).set({ maxGuests: 50 }).where(eq(s.partner.id, tooSmall.partner.id));
    const busy = await paidBooking();
    const farAway = await createPartner({ city: 'varna' });
    await db.update(s.partner).set({ serviceRadiusKm: 50 }).where(eq(s.partner.id, farAway.partner.id));

    const r = await create(client.actor, brief({ description: 'Градинско парти.' }));
    const invs = await db.select().from(s.briefInvitation).where(eq(s.briefInvitation.briefId, r.briefId));
    const invited = new Set(invs.map(i => i.partnerId));
    expect(invited.has(fits.partner.id)).toBe(true);
    for (const p of [otherCategory, tooSmall, busy.partner, farAway]) expect(invited.has(p.partner.id)).toBe(false);
    expect(r.invited).toBe(invs.length);
    expect(invs.every(i => i.status === 'invited' && i.offerDueAt.getTime() === NOW.getTime() + 24 * H)).toBe(true);

    const [b] = await db.select().from(s.brief).where(eq(s.brief.id, r.briefId));
    expect(b).toMatchObject({ status: 'open', guests: 100, budgetBand: 'unknown', description: 'Градинско парти.' });
    expect(await emails('client-brief-sent', client.user.id)).toHaveLength(1);
    expect((await emails('vendor-new-inquiry')).filter(e => e.toUserId === fits.user.id)).toHaveLength(1);
    const jobs = await db.select().from(s.job).where(eq(s.job.kind, 'brief.invitation_expire'));
    expect(jobs.filter(j => (j.payload as { invitationId: string }).invitationId === invs[0].id)).toHaveLength(1);
  });

  it('needs at least one category and a known city', async () => {
    const client = await createClient();
    await expect(create(client.actor, brief({ categorySlugs: [] }))).rejects.toMatchObject({ code: 'validation' });
    await expect(create(client.actor, brief({ citySlug: 'nowhere' }))).rejects.toMatchObject({ code: 'validation' });
    await expect(create(client.actor, brief({ eventDate: '2025-08-30' }))).rejects.toMatchObject({ code: 'validation' });
  });

  it('T3 lapses an unanswered invitation at its deadline, not before', async () => {
    const client = await createClient();
    await createPartner();
    const r = await create(client.actor, brief());
    const [inv] = await db.select().from(s.briefInvitation).where(eq(s.briefInvitation.briefId, r.briefId));
    await invitationExpireJob({ invitationId: inv.id });
    expect((await db.select().from(s.briefInvitation).where(eq(s.briefInvitation.id, inv.id)))[0].status).toBe('invited');
    setTestNow(new Date(NOW.getTime() + 25 * H));
    await invitationExpireJob({ invitationId: inv.id });
    expect((await db.select().from(s.briefInvitation).where(eq(s.briefInvitation.id, inv.id)))[0].status).toBe('lapsed');
  });
});

describe('client-booking read models', () => {
  it('groups requests and counts the tabs (SPEC §4.5, D78)', async () => {
    const client = await createClient();
    const a = await createPartner();
    const b = await createPartner();
    const c = await createPartner();
    await sendFor(client, a);
    const declined = await sendFor(client, b);
    await declineRequest(b.actor, { number: declined.number, reason: 'date_taken' });
    await approvedBooking({ c: client, p: c, request: { eventDate: '2026-07-04' } });
    const v = await clientRequestList(client.actor, {});
    expect(v.groups.wait.map(r => r.badge)).toEqual([{ tone: 'primary', text: 'Чака отговор' }]);
    expect(v.groups.closed.map(r => r.badge)).toEqual([{ tone: 'danger', text: 'Датата е заета' }]);
    expect(v.groups.pay).toHaveLength(1);
    expect(v.counts).toEqual({ requests: 3, bookings: 0 });
    const only = await clientRequestList(client.actor, { status: 'otkazani' });
    expect([only.groups.pay, only.groups.wait, only.groups.closed].map(g => g.length)).toEqual([0, 0, 1]);
    // Someone else's view never shows them.
    const other = await createClient();
    expect((await clientRequestList(other.actor, {})).counts).toEqual({ requests: 0, bookings: 0 });
  });

  it('bookings: the next confirmed booking is the hero; the cancel page carries the exact quote', async () => {
    const paid = await paidBooking();
    const v = await clientBookingList(paid.client.actor, {});
    expect(v.hero).toMatchObject({ number: paid.number, daysTo: 287, canCancel: true });
    expect(v.counts.bookings).toBe(1);
    const q = await cancelPageData(paid.client.actor, paid.number);
    expect(q.quote).toMatchObject({ paidCents: 145000, refundCents: 145000, retainedCents: 0 });
    expect(q.quote.labels.headerSub).toBe('До събитието остават 287 дни — анулирането е в безплатния срок и сумата се възстановява изцяло.');
    expect(q.cardLast4).toBe('4242');
    const stranger = await createClient();
    await expect(cancelPageData(stranger.actor, paid.number)).rejects.toMatchObject({ code: 'not_found' });
  });

  it('row subtitles name the category once', () => {
    expect(subtitleOf('DJ и озвучаване', 'Пакет „Цял ден“')).toBe('DJ и озвучаване · Пакет „Цял ден“');
    expect(subtitleOf('Фотокабини', 'Фотокабина · 4 часа с оператор и реквизит')).toBe('Фотокабина · 4 часа с оператор и реквизит');
    expect(subtitleOf('Торти и десерти', 'Торта и десерти')).toBe('Торта и десерти');
  });
});
