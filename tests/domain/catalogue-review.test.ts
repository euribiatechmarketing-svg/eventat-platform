// Defects found in the adversarial review of the catalogue modules. Each test failed before
// its fix and pins the SPEC rule it violated.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { runDueJobs } from '@/lib/jobs';
import { sofiaInstant } from '@/lib/format';
import { blockDate, check, isDate, unblock } from '@/lib/domain/availability';
import { maskContacts } from '@/lib/domain/catalogue-kit';
import { ensureConversation, getOrCreate } from '@/lib/domain/messaging';
import { confirmDeletion as confirmClientDeletion, requestDeletion as requestClientDeletion } from '@/lib/domain/clients';
import { upload } from '@/lib/domain/media';
import { allocateNumber } from '@/lib/domain/numbers';
import { adminTotals, requestDeletion as requestPartnerDeletion, responsiveness, submitApplication } from '@/lib/domain/partners';
import { watchDate } from '@/lib/domain/saved';
import { parseSearchParams, search } from '@/lib/domain/search';
import { archive, remove, saveDraft, setVisibility, submitChange, type ServiceInput } from '@/lib/domain/services';
import { createAdmin, createBookingRow, createClient, eventTypeId } from '../helpers/factories';
import { NOW, draftPartner, expectLedgerClean, failure, fillOnboarding, jobsByPrefix, listedPartner } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

describe('GET parameters', () => {
  it('an impossible date is not a date (no RangeError on /tarsene?data=2026-13-01)', () => {
    expect(isDate('2026-13-01')).toBe(false);
    expect(isDate('2026-00-10')).toBe(false);
    expect(isDate('2026-02-30')).toBe(false);
    expect(isDate('2026-02-28')).toBe(true);
    expect(parseSearchParams({ data: '2026-13-01', q: 'dj' }).data).toBeNull();
  });
});

describe('D59: service content is moderated', () => {
  it('a published service hidden with S9 cannot be edited through the draft path and re-shown unmoderated', async () => {
    const { actor, service } = await listedPartner();
    await setVisibility(actor, { serviceId: service.id, active: false });
    expect(await failure(saveDraft(actor, { id: service.id, name: service.name, priceCents: 1_000 }))).toContain('use_submit_change');
    // The edit goes through S6 instead: a pending revision, the published content unchanged.
    const base: ServiceInput & { id: string } = {
      id: service.id, kind: 'package_fixed', name: service.name, categoryId: service.categoryId, description: service.description,
      priceCents: 1_000, durationLabel: 'До 10 часа', inclusions: ['DJ за цялото събитие', 'Безжичен микрофон'], eventTypeIds: [await eventTypeId('svatba')],
    };
    const { revision } = await submitChange(actor, base);
    expect(revision?.payload).toEqual({ priceCents: [145_000, 1_000] });
    await setVisibility(actor, { serviceId: service.id, active: true });
    const [live] = await db.select().from(s.service).where(eq(s.service.id, service.id));
    expect(live).toMatchObject({ status: 'active', priceCents: 145_000 });
  });
});

describe('§12.1: while submitted, the wizard is read-only', () => {
  it('a submitted partner cannot remove or archive the packages under review', async () => {
    const { actor, partner } = await draftPartner();
    await fillOnboarding(actor);
    await submitApplication(actor, { acceptTerms: true, confirmInfo: true });
    const [svc] = await db.select().from(s.service).where(and(eq(s.service.partnerId, partner.id), eq(s.service.status, 'ready')));
    expect(await failure(remove(actor, { serviceId: svc.id }))).toContain('wizard_read_only');
    expect(await failure(archive(actor, { serviceId: svc.id }))).toContain('partner_status');
    expect(await failure(setVisibility(actor, { serviceId: svc.id, active: false }))).toContain('partner_status');
    expect((await db.select().from(s.service).where(eq(s.service.id, svc.id)))[0].status).toBe('ready');
  });
});

describe('§1.1: the public date check shows no other client’s booking', () => {
  it('availability.check() returns the day’s state only', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    const b = await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'confirmed' });
    const d = await check(pr.partner.id, '2026-06-14');
    expect(d).toMatchObject({ date: '2026-06-14', state: 'booked', busy: true, requestable: false, reason: 'capacity' });
    expect(d).not.toHaveProperty('bookings');
    expect(d).not.toHaveProperty('chip');
    expect(JSON.stringify(d)).not.toContain(b.number);
  });
});

describe('§4.14 date watch: notified → closed when the date passes', () => {
  it('T21 closes a notified watch after its date (and expires a watching one)', async () => {
    const pr = await listedPartner();
    const { actor } = await createClient();
    await blockDate(pr.actor, { date: '2026-06-14' });
    await blockDate(pr.actor, { date: '2026-06-20' });
    const notified = await watchDate(actor, { partnerId: pr.partner.id, date: '2026-06-14' });
    const watching = await watchDate(actor, { partnerId: pr.partner.id, date: '2026-06-20' });
    await unblock(pr.actor, { date: '2026-06-14' });
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, notified.id)))[0].status).toBe('notified');
    setTestNow(sofiaInstant('2026-06-21', 0, 5));
    await runDueJobs();
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, notified.id)))[0].status).toBe('closed');
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, watching.id)))[0].status).toBe('expired');
  });

  it('two simultaneous ‹Уведоми ме› clicks give one watch, not a database error', async () => {
    const pr = await listedPartner();
    const { actor } = await createClient();
    await blockDate(pr.actor, { date: '2026-07-11' });
    const [a, b] = await Promise.all([
      watchDate(actor, { partnerId: pr.partner.id, date: '2026-07-11' }),
      watchDate(actor, { partnerId: pr.partner.id, date: '2026-07-11' }),
    ]);
    expect(a.id).toBe(b.id);
    expect(await jobsByPrefix(`datewatch:${a.id}:`)).toHaveLength(1);
  });
});

describe('§12.4 responsiveness', () => {
  async function req(pr: Awaited<ReturnType<typeof listedPartner>>, clientId: string, o: {
    kind: 'package' | 'quote' | 'brief'; status: 'pending' | 'approved' | 'declined' | 'expired' | 'offer_sent' | 'awaiting_confirmation';
    date: string; sentAt: Date; due: Date; answeredAt?: Date | null; expiredAt?: Date | null;
  }) {
    const etId = await eventTypeId('svatba');
    const [ev] = await db.insert(s.clientEvent).values({ clientId, eventTypeId: etId, title: 'Сватба', date: o.date, guests: 80 }).returning();
    const [r] = await db.insert(s.request).values({
      number: await allocateNumber(db, o.date), kind: o.kind, status: o.status, clientId, partnerId: pr.partner.id, serviceId: pr.service.id,
      clientEventId: ev.id, eventTypeId: etId, eventDate: o.date, guests: 80, contactPhone: '+359888000000', serviceTitle: pr.service.name,
      sentAt: o.sentAt, responseDueAt: o.due, answeredAt: o.answeredAt ?? null, expiredAt: o.expiredAt ?? null,
    }).returning();
    return r;
  }
  const h = (n: number) => new Date(NOW.getTime() + n * 3600_000);

  it('a request still inside its 24 h is not held against the partner', async () => {
    const pr = await listedPartner();
    const { user } = await createClient();
    await req(pr, user.id, { kind: 'package', status: 'pending', date: '2026-07-04', sentAt: h(-1), due: h(23) });
    expect(await responsiveness(pr.partner.id)).toBeNull();
  });

  it('R8 lapses count against it (T2 and T4, brief requests included); an offer that lapsed later (R10) does not', async () => {
    const pr = await listedPartner();
    const { user } = await createClient();
    // Answered in time (approved).
    await req(pr, user.id, { kind: 'package', status: 'approved', date: '2026-07-04', sentAt: h(-50), due: h(-26), answeredAt: h(-40) });
    // A quote answered with an offer in time; the offer lapsed afterwards (R10) → still answered.
    const q = await req(pr, user.id, { kind: 'quote', status: 'expired', date: '2026-07-05', sentAt: h(-50), due: h(-26), answeredAt: h(-30), expiredAt: h(-5) });
    await db.insert(s.offer).values({ requestId: q.id, partnerId: pr.partner.id, title: 'Оферта', amountCents: 90_000, status: 'lapsed', sentAt: h(-30) });
    // A chosen brief offer the partner never confirmed (T4 → R8) → unanswered. The lifecycle's T4
    // also lapses the chosen offer; it was chosen, so this is not an R10 lapse.
    const b = await req(pr, user.id, { kind: 'brief', status: 'expired', date: '2026-07-06', sentAt: h(-30), due: h(-6), expiredAt: h(-6) });
    await db.insert(s.offer).values({ requestId: b.id, partnerId: pr.partner.id, title: 'Оферта', amountCents: 90_000, status: 'lapsed', sentAt: h(-40), chosenAt: h(-30) });
    // In flight → not counted.
    await req(pr, user.id, { kind: 'package', status: 'pending', date: '2026-07-07', sentAt: h(-2), due: h(22) });
    expect(await responsiveness(pr.partner.id)).toBe(67);
  });

  it('D44 ‹Отговаря до 24 часа›: a T4 lapse excludes the partner, an R10 offer lapse does not', async () => {
    const t4 = await listedPartner({ businessName: 'Неотзивчив' });
    const r10 = await listedPartner({ businessName: 'Отзивчив' });
    const { user } = await createClient();
    const a = await req(t4, user.id, { kind: 'quote', status: 'expired', date: '2026-07-04', sentAt: h(-80), due: h(-30), answeredAt: h(-70), expiredAt: h(-30) });
    await db.insert(s.offer).values({ requestId: a.id, partnerId: t4.partner.id, title: 'Оферта', amountCents: 90_000, status: 'lapsed', sentAt: h(-70), chosenAt: h(-54) });
    const b = await req(r10, user.id, { kind: 'quote', status: 'expired', date: '2026-07-05', sentAt: h(-80), due: h(-56), answeredAt: h(-70), expiredAt: h(-10) });
    await db.insert(s.offer).values({ requestId: b.id, partnerId: r10.partner.id, title: 'Оферта', amountCents: 90_000, status: 'lapsed', sentAt: h(-70) });
    const names = (await search(parseSearchParams({ otgovor24: '1' }))).cards.map(c => c.name);
    expect(names).toContain('Отзивчив');
    expect(names).not.toContain('Неотзивчив');
  });
});

describe('§3 timers are cancelled on every exit path', () => {
  it('T24: confirming the deletion, or asking again, cancels the pending expiry', async () => {
    const { actor, user } = await createClient();
    const first = await requestClientDeletion(actor);
    advanceTestNow(60_000);
    const second = await requestClientDeletion(actor);
    const reqs = await db.select().from(s.accountDeletionRequest).where(eq(s.accountDeletionRequest.userId, user.id));
    const old = reqs.find(r => r.status === 'expired')!;
    expect((await jobsByPrefix(`deletion:${old.id}:`))[0].status).toBe('cancelled');
    await confirmClientDeletion({ token: second.token });
    const cur = reqs.find(r => r.id !== old.id)!;
    expect((await jobsByPrefix(`deletion:${cur.id}:`))[0].status).toBe('cancelled');
    expect(first.token).not.toBe(second.token);
  });
});

describe('P10 / D56: no deletion while a booking can still be paid', () => {
  it('an awaiting-payment booking blocks ‹Изтрий›', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'awaiting_payment', approvedAt: new Date(NOW.getTime() - 3600_000) });
    expect(await failure(requestPartnerDeletion(pr.actor))).toContain('has_upcoming_bookings');
  });
});

describe('§14 uploads', () => {
  it('the bytes must be what the declared type says', async () => {
    const { actor } = await createClient();
    const fake = new File([Buffer.from('<html><script>alert(1)</script></html>')], 'photo.png', { type: 'image/png' });
    expect(await failure(upload(actor, { kind: 'review_photo', file: fake }))).toContain('upload_type');
    const pdf = new File([Buffer.from('GIF89a……')], 'proof.pdf', { type: 'application/pdf' });
    const pr = await listedPartner();
    expect(await failure(upload(pr.actor, { kind: 'bank_proof', file: pdf }))).toContain('upload_type');
  });
});

describe('§10 masking cannot be dodged by dressing a phone as money or a date', () => {
  it('masks a phone followed by a currency or written as an impossible date', () => {
    expect(maskContacts('Обадете се на 0888123456 лв')).toBe('Обадете се на ••• лв');
    expect(maskContacts('Звънни 0888123456€')).toBe('Звънни •••€');
    expect(maskContacts('или 08.88.1234')).toBe('или •••');
    // Real money, dates and numbers still pass untouched.
    expect(maskContacts('цена 1 450,00 €, 640 €, 28,00 € на гост, 145000 € общо, на 14.06.2026 и 2026-06-14, № 2026-0614-ЕА'))
      .toBe('цена 1 450,00 €, 640 €, 28,00 € на гост, 145000 € общо, на 14.06.2026 и 2026-06-14, № 2026-0614-ЕА');
  });
});

describe('§1.2: money columns need view_finance', () => {
  it('a partner’s turnover (adminTotals) is not shown to a moderator', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'confirmed' });
    const { actor: moderator } = await createAdmin('moderator');
    const { actor: accounting } = await createAdmin('accounting');
    expect(await failure(adminTotals(moderator, pr.partner.id))).toContain('view_finance');
    expect(await failure(adminTotals(pr.actor, pr.partner.id))).toContain('view_finance');
    expect(await adminTotals(accounting, pr.partner.id)).toEqual({ bookings: 1, turnoverCents: 145_000 });
  });
});

describe('§4.16 the conversation’s context link is the latest request', () => {
  it('opening an older request’s thread does not move the link back to it', async () => {
    const pr = await listedPartner();
    const cl = await createClient();
    const etId = await eventTypeId('svatba');
    const [ev] = await db.insert(s.clientEvent).values({ clientId: cl.user.id, eventTypeId: etId, title: 'Сватба', date: '2026-06-14', guests: 120 }).returning();
    const mk = async (status: 'declined' | 'pending', sentAt: Date) => (await db.insert(s.request).values({
      number: await allocateNumber(db, '2026-06-14'), kind: 'package', status, clientId: cl.user.id, partnerId: pr.partner.id, serviceId: pr.service.id,
      clientEventId: ev.id, eventTypeId: etId, eventDate: '2026-06-14', guests: 120, contactPhone: '+359888000000', serviceTitle: pr.service.name,
      sentAt, responseDueAt: new Date(sentAt.getTime() + 24 * 3600_000),
    }).returning())[0];
    const older = await mk('declined', new Date(NOW.getTime() - 5 * 86_400_000));
    const newer = await mk('pending', new Date(NOW.getTime() - 3600_000));
    await ensureConversation({ clientId: cl.user.id, partnerId: pr.partner.id, clientEventId: ev.id, requestId: older.id });
    expect((await ensureConversation({ clientId: cl.user.id, partnerId: pr.partner.id, clientEventId: ev.id, requestId: newer.id })).requestId).toBe(newer.id);
    const c = await getOrCreate(cl.actor, { number: older.number });
    expect(c.requestId).toBe(newer.id);
  });
});
