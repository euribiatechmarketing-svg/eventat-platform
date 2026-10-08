// Saved searches and date watches (SPEC §4.14, §13.9; T20, T21; D21).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { runDueJobs } from '@/lib/jobs';
import { sofiaInstant } from '@/lib/format';
import { blockDate } from '@/lib/domain/availability';
import { approve } from '@/lib/domain/partners';
import {
  closeWatches, deleteSearch, expireWatch, listSaved, notifyDateFreed, openSearch, removeWatch, saveSearch, savedTexts, scanSavedSearches,
  scheduleSavedSearchScan, setNotify, watchDate, watchDates,
} from '@/lib/domain/saved';
import { parseSearchParams } from '@/lib/domain/search';
import { ensureCatalogueJobs } from '@/lib/jobs/handlers-catalogue';
import { createAdmin, createBookingRow, createClient, cityId, eventTypeId } from '../helpers/factories';
import { NOW, bells, draftPartner, emails, expectLedgerClean, failure, fillOnboarding, jobsByPrefix, listedPartner, plain } from '../helpers/catalogue';
import { submitApplication } from '@/lib/domain/partners';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

const P = (q: Record<string, unknown>) => parseSearchParams(q);
const NAMES = { category: null, pluralNoun: null, types: ['Сватба'], cities: ['София'] };

describe('§13.9 texts', () => {
  it('generates the title, the summary and the inbox line', () => {
    expect(plain(savedTexts(P({ sabitie: 'svatba', grad: 'sofia', data: '2026-06-14', gosti: 120, reyting: 4.5 }), NAMES))).toEqual({
      title: 'Изпълнители за сватба · София · 14 юни 2026 · 120 гости',
      summary: 'Всички услуги · свободни на датата · рейтинг 4,5 и нагоре',
      inboxLine: 'Изпълнители за сватба · София · 120 гости · рейтинг 4,5 и нагоре',
    });
    expect(plain(savedTexts(P({ kategoriya: 'fotografiya', grad: 'sofia', 'cena-do': 1200, reyting: 4.5 }),
      { category: 'Фотография', pluralNoun: null, types: [], cities: ['София'] }))).toMatchObject({
      title: 'Фотография · София', summary: 'Без избрана дата · рейтинг 4,5 и нагоре · до 1 200 €',
    });
    expect(plain(savedTexts(P({ kategoriya: 'ketaring', q: 'Коледно меню', grad: 'sofia', data: '2026-12-19', gosti: 40 }),
      { category: 'Кетъринг', pluralNoun: 'кетъринг фирми', types: [], cities: ['София'] })).summary).toBe('„коледно меню“ · свободни на датата');
  });
});

describe('saved searches', () => {
  it('saves, switches the alerts, opens (resetting seen_at) and deletes — owner only', async () => {
    const { actor } = await createClient();
    const { actor: other } = await createClient();
    const saved = await saveSearch(actor, { params: P({ sabitie: 'svatba', grad: 'sofia', reyting: '4.5' }) });
    expect(saved).toMatchObject({ notify: true, title: 'Изпълнители за сватба · София', filtersSummary: 'Всички услуги · Без избрана дата · рейтинг 4,5 и нагоре' });
    expect(saved.params).toEqual({ sabitie: 'svatba', grad: 'sofia', reyting: '4.5' });
    expect((await setNotify(actor, { id: saved.id, notify: false })).notify).toBe(false);
    expect(await failure(setNotify(other, { id: saved.id, notify: true }))).toContain('not_found');
    advanceTestNow(3600_000);
    expect((await setNotify(actor, { id: saved.id, notify: true })).lastAlertedAt?.getTime()).toBe(NOW.getTime() + 3600_000);
    expect(await openSearch(actor, { id: saved.id })).toEqual({ href: '/tarsene?sabitie=svatba&grad=sofia&reyting=4.5' });
    expect((await db.select().from(s.savedSearch).where(eq(s.savedSearch.id, saved.id)))[0].seenAt?.getTime()).toBe(NOW.getTime() + 3600_000);
    const { actor: partner } = await listedPartner();
    expect(await failure(saveSearch(partner, { params: P({}) }))).toContain('ForbiddenError');
    await deleteSearch(actor, { id: saved.id });
    expect(await db.select().from(s.savedSearch).where(eq(s.savedSearch.id, saved.id))).toHaveLength(0);
  });

  it('lists live counts: results with the noun, ‹N нови …›, ‹N свободни на …› (D79)', async () => {
    const { actor } = await createClient();
    const a = await listedPartner({ category: 'ketaring', priceCents: 2800, priceUnit: 'per_guest' });
    const b = await listedPartner({ category: 'ketaring', priceCents: 3000, priceUnit: 'per_guest' });
    await blockDate(b.actor, { date: '2026-12-19' });
    const withDate = await saveSearch(actor, { params: P({ kategoriya: 'ketaring', data: '2026-12-19' }) });
    const noDate = await saveSearch(actor, { params: P({ sabitie: 'svatba' }) });
    // A partner listed after the search was seen counts as new.
    advanceTestNow(3600_000);
    const c = await listedPartner({ category: 'ketaring' });
    await db.update(s.partner).set({ listedAt: new Date(NOW.getTime() + 3600_000) }).where(eq(s.partner.id, c.partner.id));
    const list = await listSaved(actor);
    const row = list.searches.find(x => x.search.id === withDate.id)!;
    expect(plain(row)).toMatchObject({ results: '3 кетъринг фирми', fresh: '1 нови от вчера', free: '2 свободни на 19 декември' });
    const row2 = list.searches.find(x => x.search.id === noDate.id)!;
    expect(row2.free).toBe('последна проверка днес');
    advanceTestNow(3 * 86_400_000);
    expect((await listSaved(actor)).searches.find(x => x.search.id === withDate.id)?.fresh).toBe('1 нови тази седмица');
    await openSearch(actor, { id: withDate.id });
    expect((await listSaved(actor)).searches.find(x => x.search.id === withDate.id)?.fresh).toBe('Без нови');
    void a;
  });

  it('T20 scan: alerts once for partners listed since the last alert, then schedules tomorrow', async () => {
    const { user, actor } = await createClient();
    const saved = await saveSearch(actor, { params: P({ kategoriya: 'muzikanti', grad: 'sofia' }) });
    const off = await saveSearch(actor, { params: P({ kategoriya: 'muzikanti' }) });
    await setNotify(actor, { id: off.id, notify: false });
    expect(await scheduleSavedSearchScan()).toBe('2025-09-01');
    await ensureCatalogueJobs();
    expect((await jobsByPrefix('savedsearch:'))[0]).toMatchObject({ kind: 'savedsearch.scan', runAt: sofiaInstant('2025-09-01', 8, 0) });

    // A new musician is approved during the night.
    setTestNow(sofiaInstant('2025-09-01', 2, 0));
    const { actor: admin } = await createAdmin('admin');
    const d = await draftPartner({ businessName: 'Квартет „Адажио“' });
    await fillOnboarding(d.actor);
    await db.update(s.partner).set({ primaryCategoryId: (await db.select().from(s.category).where(eq(s.category.slug, 'muzikanti')))[0].id }).where(eq(s.partner.id, d.partner.id));
    await submitApplication(d.actor, { acceptTerms: true, confirmInfo: true });
    await approve(admin, { partnerId: d.partner.id });

    setTestNow(sofiaInstant('2025-09-01', 8, 0));
    await runDueJobs();
    const alerts = await emails('client-saved-search-alert', user.id);
    expect(alerts).toHaveLength(1);
    expect(plain(alerts[0].vars)).toMatchObject({ newCount: 1, search: 'Музиканти · София', totalCount: 1, filters: 'Без избрана дата', summary: 'Музиканти · София' });
    expect((await bells(user.id))[0]).toMatchObject({ kind: 'client-saved-search-alert', href: '/tarsene?kategoriya=muzikanti&grad=sofia' });
    expect((await db.select().from(s.savedSearch).where(eq(s.savedSearch.id, saved.id)))[0].lastAlertedAt?.getTime()).toBe(sofiaInstant('2025-09-01', 8, 0).getTime());
    // Idempotent: the same day again sends nothing new; the next day is scheduled.
    await scanSavedSearches({ date: '2025-09-01' });
    expect(await emails('client-saved-search-alert', user.id)).toHaveLength(1);
    const next = (await jobsByPrefix('savedsearch:')).find(j => j.dedupeKey === 'savedsearch:2025-09-02');
    expect(next).toMatchObject({ status: 'pending', runAt: sofiaInstant('2025-09-02', 8, 0) });
    setTestNow(sofiaInstant('2025-09-02', 8, 0));
    await runDueJobs();
    expect(await emails('client-saved-search-alert', user.id)).toHaveLength(1);
  });
});

describe('date watches', () => {
  it('watches a busy date only, once per client, partner and date; the stop control removes it', async () => {
    const pr = await listedPartner();
    const { actor, user } = await createClient();
    expect(await failure(watchDate(actor, { partnerId: pr.partner.id, date: '2026-06-14' }))).toContain('date_free');
    await blockDate(pr.actor, { date: '2026-06-14' });
    const w = await watchDate(actor, { partnerId: pr.partner.id, date: '2026-06-14' });
    expect((await watchDate(actor, { partnerId: pr.partner.id, date: '2026-06-14' })).id).toBe(w.id);
    expect(await failure(watchDate(actor, { partnerId: pr.partner.id, date: '2025-08-01' }))).toContain('date_past');
    expect((await jobsByPrefix(`datewatch:${w.id}`))[0]).toMatchObject({ kind: 'datewatch.expire', runAt: sofiaInstant('2026-06-15', 0, 0) });
    const list = await listSaved(actor);
    expect(plain(list.watches[0])).toMatchObject({ line: 'DJ и озвучаване · щом 14 юни се освободи, ви известяваме веднага', badge: 'Датата е заета', since: 'следим от 31 август' });
    const { actor: other } = await createClient();
    expect(await failure(removeWatch(other, { id: w.id }))).toContain('not_found');
    expect((await removeWatch(actor, { id: w.id })).status).toBe('removed');
    expect((await jobsByPrefix(`datewatch:${w.id}`))[0].status).toBe('cancelled');
    void user;
  });

  it('T21: a watch still watching after its date expires (idempotent)', async () => {
    const pr = await listedPartner();
    const { actor } = await createClient();
    await blockDate(pr.actor, { date: '2025-09-10' });
    const w = await watchDate(actor, { partnerId: pr.partner.id, date: '2025-09-10' });
    setTestNow(sofiaInstant('2025-09-10', 23, 0));
    await runDueJobs();
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, w.id)))[0].status).toBe('watching');
    setTestNow(sofiaInstant('2025-09-11', 0, 1));
    await runDueJobs();
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, w.id)))[0].status).toBe('expired');
    expect(await expireWatch({ watchId: w.id })).toBe(false);
  });

  it('notifies when the date frees up (K4/K6/K7/K9/K11 call notifyDateFreed); closes on a new request', async () => {
    const pr = await listedPartner({ businessName: 'Snap360', category: 'fotokabini' });
    const { user, actor } = await createClient();
    const [ev] = await db.insert(s.clientEvent).values({ clientId: user.id, eventTypeId: await eventTypeId(), title: 'Коледно парти', date: '2026-12-19', cityId: await cityId() }).returning();
    const { user: other } = await createClient();
    const b = await createBookingRow({ client: other, partner: pr, eventDate: '2026-12-19', status: 'awaiting_payment' });
    const w = await watchDate(actor, { partnerId: pr.partner.id, date: '2026-12-19', clientEventId: ev.id });
    expect(await notifyDateFreed(pr.partner.id, '2026-12-19')).toBe(0); // still held
    await db.update(s.booking).set({ status: 'payment_expired' }).where(eq(s.booking.id, b.booking.id));
    expect(await notifyDateFreed(pr.partner.id, '2026-12-19')).toBe(1);
    expect(await notifyDateFreed(pr.partner.id, '2026-12-19')).toBe(0);
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, w.id)))[0].status).toBe('notified');
    expect(plain((await emails('client-date-freed', user.id))[0].vars)).toMatchObject({ partnerName: 'Snap360', partnerCategory: 'Фотокабини', eventType: 'Коледно парти', eventDate: '19 декември 2026' });
    expect((await jobsByPrefix(`datewatch:${w.id}`))[0].status).toBe('cancelled');
    expect(await closeWatches({ clientId: user.id, partnerId: pr.partner.id, date: '2026-12-19' })).toBe(1);
    expect((await db.select().from(s.dateWatch).where(eq(s.dateWatch.id, w.id)))[0].status).toBe('closed');
  });

  it('zero state ‹Уведоми ме при свободна дата›: watches every matching partner busy on the date', async () => {
    const a = await listedPartner({ category: 'torti-i-deserti' });
    const b = await listedPartner({ category: 'torti-i-deserti' });
    const c = await listedPartner({ category: 'torti-i-deserti' });
    await blockDate(a.actor, { date: '2026-05-30' });
    await blockDate(b.actor, { date: '2026-05-30' });
    const { actor, user } = await createClient();
    expect(await failure(watchDates(actor, { params: P({ kategoriya: 'torti-i-deserti' }) }))).toContain('date_required');
    expect(await watchDates(actor, { params: P({ kategoriya: 'torti-i-deserti', data: '2026-05-30' }) })).toEqual({ created: 2 });
    expect(await watchDates(actor, { params: P({ kategoriya: 'torti-i-deserti', data: '2026-05-30' }) })).toEqual({ created: 0 });
    const rows = await db.select().from(s.dateWatch).where(and(eq(s.dateWatch.clientId, user.id), eq(s.dateWatch.status, 'watching')));
    expect(rows.map(r => r.partnerId).sort()).toEqual([a.partner.id, b.partner.id].sort());
    void c;
  });
});
