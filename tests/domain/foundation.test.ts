// Foundation: reference data, settings, booking numbers, the ledger, actors,
// the test clock and the job registry. Runs on its own database (tests/setup/db.ts).
import { afterEach, describe, expect, it } from 'vitest';
import { and, count, eq, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, now, setTestNow } from '@/lib/clock';
import { sofiaInstant } from '@/lib/format';
import { ForbiddenError, SYSTEM, actorFromUser, can, teamRolesWith } from '@/lib/domain/actor';
import { audit } from '@/lib/domain/audit';
import {
  LedgerError, accountBalance, assertLedgerInvariants, bookingBalances, checkLedgerInvariants, partnerBalances, postTransaction,
  unbalancedTransactions, validateLines,
} from '@/lib/domain/ledger';
import {
  NUMBERS_PER_DATE, NUMBER_LETTERS, NumberError, allocateNumber, formatNumber, isValidNumber, numberDate, reserveNumber,
} from '@/lib/domain/numbers';
import { CATEGORIES, EVENT_TYPES, SVATBA_TIERS, bulgarianHolidays, ensureReferenceData, orthodoxEaster } from '@/lib/domain/reference';
import { SETTING_KEYS, SettingsError, getSetting, getSettings, setSetting, settingDefaults } from '@/lib/domain/settings';
import { JOB_HANDLERS } from '@/lib/jobs/handlers';
import { createAdmin, createBookingRow, createClient, createPartner } from '../helpers/factories';

const NOW = sofiaInstant('2025-08-31', 12, 0);
afterEach(() => setTestNow(null));

const rows = async (table: PgTable) => (await db.select({ n: count() }).from(table))[0].n;

/** The message of a rejection, including the database error drizzle wraps in `cause`. */
async function failure(p: Promise<unknown>): Promise<string> {
  try { await p; } catch (e) {
    const err = e as Error & { cause?: Error };
    return [err.message, err.cause?.message].filter(Boolean).join(' | ');
  }
  throw new Error('expected the promise to reject');
}

// Runs first, on the untouched database.
describe('ensureReferenceData', () => {
  it('inserts everything on a fresh database and nothing the second time', async () => {
    setTestNow(NOW);
    const first = await db.transaction(tx => ensureReferenceData(tx));
    expect(first).toMatchObject({
      cities: 4, categories: CATEGORIES.length, subtypes: 5, tips: 3, eventTypes: EVENT_TYPES.length,
      tierServices: SVATBA_TIERS.length, settings: SETTING_KEYS.length,
    });
    expect(first.holidays).toBeGreaterThan(40); // 2025–2027

    const counts = async () => ({
      city: await rows(s.city), category: await rows(s.category), subtype: await rows(s.categorySubtype), tip: await rows(s.categoryTip),
      eventType: await rows(s.eventType), tier: await rows(s.eventTypeService), holiday: await rows(s.publicHoliday), settings: await rows(s.platformSettings),
    });
    const before = await counts();
    const second = await db.transaction(tx => ensureReferenceData(tx));
    expect(Object.values(second).every(n => n === 0)).toBe(true);
    expect(await counts()).toEqual(before);
  });

  it('keeps admin edits: a hidden category stays hidden, a changed setting stays changed', async () => {
    await db.update(s.category).set({ isVisible: false }).where(eq(s.category.slug, 'muzikanti'));
    const { actor } = await createAdmin('admin');
    await setSetting('commission.intro_count', 5, actor, sofiaInstant('2025-08-01'));
    await ensureReferenceData(db);
    const [m] = await db.select().from(s.category).where(eq(s.category.slug, 'muzikanti'));
    expect(m.isVisible).toBe(false);
    expect(await getSetting('commission.intro_count', NOW)).toBe(5);
    await db.update(s.category).set({ isVisible: true }).where(eq(s.category.slug, 'muzikanti'));
  });

  it('seeds the DATA-MODEL S2 values', async () => {
    const cats = await db.select().from(s.category).orderBy(s.category.sortOrder);
    expect(cats.filter(c => c.inDirectory).map(c => c.slug)).toEqual([
      'zali-i-lokatsii', 'ketaring', 'dj-i-ozvuchavane', 'fotografiya', 'videozasnemane', 'dekoratsiya', 'fotokabini', 'torti-i-deserti', 'muzikanti',
    ]);
    const ketaring = cats.find(c => c.slug === 'ketaring')!;
    expect(ketaring).toMatchObject({ name: 'Кетъринг', defaultPriceUnit: 'per_guest', pluralNoun: 'кетъринг фирми', tipsHeading: 'Какво да питате кетъринга' });
    expect(cats.find(c => c.slug === 'transport-za-gosti')).toMatchObject({ name: 'Транспорт за гости', isVisible: false, inDirectory: false });

    const [varna] = await db.select().from(s.city).where(eq(s.city.slug, 'varna'));
    expect(varna).toMatchObject({ name: 'Варна', preposition: 'във', lat: 43.20467, lng: 27.91054 });

    const types = await db.select().from(s.eventType).orderBy(s.eventType.sortOrder);
    expect(types.map(t => [t.slug, t.isPublic])).toEqual([
      ['svatba', true], ['rozhden-den', true], ['firmeno-sabitie', true], ['abiturientski-bal', true], ['drugo', false],
    ]);
    expect(types[0]).toMatchObject({ namePluralLower: 'сватби', nameDefinite: 'сватбата', heroPhotoUrl: 'photos/bouquet.jpg' });

    const tiers = await db.select({ tier: s.eventTypeService.tier, slug: s.category.slug, name: s.eventTypeService.displayName })
      .from(s.eventTypeService).innerJoin(s.category, eq(s.category.id, s.eventTypeService.categoryId)).orderBy(s.eventTypeService.sortOrder);
    expect(tiers.filter(t => t.tier === 'required').map(t => t.slug)).toEqual(['zali-i-lokatsii', 'ketaring', 'dj-i-ozvuchavane', 'fotografiya']);
    expect(tiers.filter(t => t.tier === 'common')).toHaveLength(5);
    expect(tiers.filter(t => t.tier === 'extra')).toHaveLength(8);
    expect(tiers.find(t => t.slug === 'transport-za-gosti')?.name).toBe('Транспорт за гостите');

    const subtypes = await db.select({ label: s.categorySubtype.label }).from(s.categorySubtype).orderBy(s.categorySubtype.sortOrder);
    expect(subtypes.map(x => x.label)).toEqual(['Бюфет', 'Сервирано меню', 'Коктейл', 'Барбекю на открито', 'Веган опции']);
  });

  it('computes Bulgarian public holidays with Orthodox Easter and weekend substitutes', async () => {
    expect([2025, 2026, 2027].map(orthodoxEaster)).toEqual(['2025-04-20', '2026-04-12', '2027-05-02']);
    const d2026 = bulgarianHolidays(2026).map(h => h.date);
    expect(d2026).toEqual(expect.arrayContaining([
      '2026-01-01', '2026-03-03', '2026-04-10', '2026-04-11', '2026-04-12', '2026-04-13', '2026-05-01', '2026-05-06',
      '2026-05-24', '2026-05-25', // 24 May is a Sunday → Monday off
      '2026-09-06', '2026-09-07', // Sunday → Monday off
      '2026-09-22', '2026-12-24', '2026-12-25', '2026-12-26', '2026-12-28', // 26 Dec is a Saturday → Monday 28 off
    ]));
    // 1 May 2027 is a Saturday; 2–3 May are Easter, so the day off is Tuesday 4 May.
    expect(bulgarianHolidays(2027).map(h => h.date)).toContain('2027-05-04');
    const [h] = await db.select().from(s.publicHoliday).where(eq(s.publicHoliday.date, '2025-05-26'));
    expect(h?.name).toMatch(/Почивен ден/);
  });
});

describe('settings', () => {
  it('reads defaults when a key was never written', async () => {
    await db.delete(s.platformSettings).where(eq(s.platformSettings.key, 'payment.extension_hours'));
    expect(await getSetting('payment.extension_hours', NOW)).toBe(24);
    expect(settingDefaults()['payment.schedule']).toEqual({ mode: 'full', deposit_percent: null, balance_due_days: 30 });
  });

  it('applies effective_from: the latest version in force at the instant wins', async () => {
    const { actor } = await createAdmin('admin');
    const jan = sofiaInstant('2026-01-01'), jun = sofiaInstant('2026-06-01');
    await setSetting('commission.standard_bp', 1200, actor, jan);
    await setSetting('commission.standard_bp', 1100, actor, jun);

    expect(await getSetting('commission.standard_bp', sofiaInstant('2025-12-31', 23, 59))).toBe(1000);
    expect(await getSetting('commission.standard_bp', jan)).toBe(1200); // inclusive
    expect(await getSetting('commission.standard_bp', sofiaInstant('2026-03-01'))).toBe(1200);
    expect(await getSetting('commission.standard_bp', sofiaInstant('2026-07-01'))).toBe(1100);
    expect((await getSettings(sofiaInstant('2026-03-01')))['commission.standard_bp']).toBe(1200);

    // Same effective_from: the later write wins.
    await setSetting('commission.standard_bp', 1300, actor, jun);
    expect(await getSetting('commission.standard_bp', jun)).toBe(1300);

    // Default instant = the platform clock.
    setTestNow(sofiaInstant('2026-02-01'));
    expect(await getSetting('commission.standard_bp')).toBe(1200);
    setTestNow(sofiaInstant('2026-08-01'));
    expect(await getSetting('commission.standard_bp')).toBe(1300);
  });

  it('writes an audit row and round-trips JSON values, null included', async () => {
    const { actor } = await createAdmin('admin');
    setTestNow(NOW);
    expect(await getSetting('platform.legal_entity')).toBeNull();
    const entity = { name: 'ЧЕРИ ЕСТЕЙТ ЕООД', eik: '000000000', vat_number: null, address: 'София' };
    await setSetting('platform.legal_entity', entity, actor);
    expect(await getSetting('platform.legal_entity')).toEqual(entity);
    await setSetting('payment.provider_max_hold_days', null, actor);
    expect(await getSetting('payment.provider_max_hold_days')).toBeNull();
    const logs = await db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'settings.changed'), eq(s.auditLog.entityId, 'platform.legal_entity')));
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ actorId: actor.userId, actorRole: 'admin', entity: 'platform_settings' });
  });

  it('validates values, permissions and cross-key rules', async () => {
    const { actor: admin } = await createAdmin('admin');
    const { actor: moderator } = await createAdmin('moderator');
    await expect(setSetting('commission.standard_bp', 1500, moderator)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setSetting('commission.standard_bp', -1, admin)).rejects.toBeInstanceOf(SettingsError);
    await expect(setSetting('reviews.paid_only', false as unknown as true, admin)).rejects.toBeInstanceOf(SettingsError);
    await expect(setSetting('payment.schedule', { mode: 'full', deposit_percent: null, balance_due_days: 10 }, admin)).rejects.toBeInstanceOf(SettingsError);
    // Deposit mode is gated until its emails exist (D5).
    await expect(setSetting('payment.schedule', { mode: 'deposit_balance', deposit_percent: null, balance_due_days: 30 }, admin))
      .rejects.toThrow(/client-balance-charged/);
    // Hold limit: 30 + 1 + 15 > 40.
    await expect(setSetting('payment.provider_max_hold_days', 40, admin)).rejects.toThrow(/provider_max_hold_days/);
    await setSetting('payment.provider_max_hold_days', 90, SYSTEM);
    expect(await getSetting('payment.provider_max_hold_days', await now())).toBe(90);
  });
});

describe('booking numbers', () => {
  const RE = /^\d{4}-\d{4}-[АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЮЯ]{2}$/;

  it('allocates YYYY-MMDD-XX from the event date, unique per date', async () => {
    const got = new Set<string>();
    for (let i = 0; i < 150; i++) {
      const n = await allocateNumber(db, '2026-06-14');
      expect(n).toMatch(RE);
      expect(n.startsWith('2026-0614-')).toBe(true);
      expect(numberDate(n)).toBe('2026-06-14');
      expect(isValidNumber(n)).toBe(true);
      got.add(n);
    }
    expect(got.size).toBe(150);
    // The year comes from the event date (D2).
    expect(await allocateNumber(db, '2025-04-24')).toMatch(/^2025-0424-/);
  });

  it('stays unique under concurrent allocation', async () => {
    const ns = await Promise.all(Array.from({ length: 25 }, () => db.transaction(tx => allocateNumber(tx, '2026-12-19'))));
    expect(new Set(ns).size).toBe(25);
  });

  it('falls back to the free combinations and fails only when the date is full', async () => {
    const date = '2027-01-09';
    const all = [...NUMBER_LETTERS].flatMap(a => [...NUMBER_LETTERS].map(b => formatNumber(date, a + b)));
    expect(all).toHaveLength(NUMBERS_PER_DATE);
    const last = all[400];
    await db.insert(s.bookingNumber).values(all.filter(n => n !== last).map(number => ({ number, eventDate: date })));
    expect(await allocateNumber(db, date, { rand: () => 0 })).toBe(last);
    await expect(allocateNumber(db, date)).rejects.toBeInstanceOf(NumberError);
  });

  it('reserves seed numbers and rejects malformed or taken ones', async () => {
    expect(await reserveNumber(db, '2025-0509-СВ')).toBe('2025-0509-СВ');
    await expect(reserveNumber(db, '2025-0509-СВ')).rejects.toThrow(/taken/);
    await expect(reserveNumber(db, '2025-0509-CB')).rejects.toBeInstanceOf(NumberError); // Latin letters
    await expect(reserveNumber(db, '2026-0231-АБ')).rejects.toBeInstanceOf(NumberError); // no such date
    await expect(allocateNumber(db, '2026-02-30')).rejects.toBeInstanceOf(NumberError);
  });

  it('is guarded by the database too', async () => {
    expect(await failure(db.insert(s.bookingNumber).values({ number: '2026-0614-ЙЪ', eventDate: '2026-06-14' }))).toMatch(/booking_number_format_check/);
    expect(await failure(db.insert(s.bookingNumber).values({ number: '2026-0615-АБ', eventDate: '2026-06-14' }))).toMatch(/booking_number_date_check/);
  });
});

describe('ledger', () => {
  async function fixture() {
    const { user: client } = await createClient();
    const p = await createPartner();
    const { booking } = await createBookingRow({ client, partner: p });
    return { bookingId: booking.id, partnerId: p.partner.id };
  }

  it('validates lines before writing anything', () => {
    expect(() => validateLines([{ account: 'provider_held', debit: 100 }])).toThrow(LedgerError);
    expect(() => validateLines([{ account: 'provider_held', debit: 100 }, { account: 'client_funds', credit: 90 }])).toThrow(/Unbalanced/);
    expect(() => validateLines([{ account: 'provider_held', debit: 100, credit: 100 }, { account: 'client_funds', credit: 100 }])).toThrow(/exactly one/);
    expect(() => validateLines([{ account: 'provider_held', debit: 10.5 }, { account: 'client_funds', credit: 10.5 }])).toThrow(/integer/);
    expect(() => validateLines([{ account: 'provider_held', debit: -5 }, { account: 'client_funds', credit: -5 }])).toThrow(/positive/);
    expect(validateLines([{ account: 'provider_held', debit: 145_000 }, { account: 'client_funds', credit: 145_000 }])).toEqual({ debit: 145_000, credit: 145_000 });
  });

  it('posts L1 charge and L3 release; balances per booking and partner', async () => {
    const { bookingId, partnerId } = await fixture();
    await db.transaction(async tx => {
      await postTransaction(tx, { kind: 'charge', bookingId, partnerId, description: 'L1', lines: [
        { account: 'provider_held', debit: 145_000 }, { account: 'client_funds', credit: 145_000 },
      ] });
    });
    expect((await bookingBalances(db, bookingId)).client_funds).toBe(145_000);
    expect(await accountBalance(db, 'provider_held', { bookingId })).toBe(145_000);

    await db.transaction(async tx => {
      await postTransaction(tx, { kind: 'release', bookingId, partnerId, description: 'L3', lines: [
        { account: 'client_funds', debit: 145_000 },
        { account: 'partner_payable', credit: 130_500 },
        { account: 'commission_revenue', credit: 14_500 },
        { account: 'platform_cash', debit: 14_500 },
        { account: 'provider_held', credit: 14_500 },
      ] });
    });
    const b = await bookingBalances(db, bookingId);
    expect(b).toMatchObject({ client_funds: 0, partner_payable: 130_500, commission_revenue: 14_500, platform_cash: 14_500, provider_held: 130_500 });
    expect((await partnerBalances(db, partnerId)).partner_payable).toBe(130_500);
    expect(await checkLedgerInvariants(db, { providerReportedCents: await accountBalance(db, 'provider_held') })).toEqual([]);
    await assertLedgerInvariants(db);
  });

  it('rejects an unbalanced posting in code, writing nothing', async () => {
    const { bookingId } = await fixture();
    const before = await rows(s.ledgerEntry);
    await expect(db.transaction(tx => postTransaction(tx, { kind: 'charge', bookingId, lines: [
      { account: 'provider_held', debit: 100_00 }, { account: 'client_funds', credit: 99_00 },
    ] }))).rejects.toBeInstanceOf(LedgerError);
    expect(await rows(s.ledgerEntry)).toBe(before);
  });

  it('rejects a posting that would make client_funds or partner_payable negative', async () => {
    const { bookingId, partnerId } = await fixture();
    await expect(db.transaction(tx => postTransaction(tx, { kind: 'refund', bookingId, partnerId, lines: [
      { account: 'client_funds', debit: 5_000 }, { account: 'provider_held', credit: 5_000 },
    ] }))).rejects.toThrow(/client_funds would go negative/);
    await expect(db.transaction(tx => postTransaction(tx, { kind: 'payout', bookingId, partnerId, lines: [
      { account: 'partner_payable', debit: 5_000 }, { account: 'provider_held', credit: 5_000 },
    ] }))).rejects.toThrow(/partner_payable would go negative/);
  });

  it('rejects an unbalanced transaction at COMMIT through the database trigger', async () => {
    const { bookingId } = await fixture();
    const before = await rows(s.ledgerTransaction);
    await expect(db.transaction(async tx => {
      const [t] = await tx.insert(s.ledgerTransaction).values({ kind: 'adjustment', bookingId, occurredAt: NOW, description: 'raw' }).returning();
      await tx.insert(s.ledgerEntry).values([
        { transactionId: t.id, account: 'provider_held', bookingId, debitCents: 10_000 },
        { transactionId: t.id, account: 'client_funds', bookingId, creditCents: 9_000 },
      ]);
    })).rejects.toThrow(/unbalanced/);
    // A transaction without entries is rejected too.
    await expect(db.transaction(async tx => {
      await tx.insert(s.ledgerTransaction).values({ kind: 'adjustment', occurredAt: NOW, description: 'empty' });
    })).rejects.toThrow(/at least two/);
    expect(await rows(s.ledgerTransaction)).toBe(before);
    expect(await unbalancedTransactions(db)).toEqual([]);
  });

  it('keeps the ledger append-only and one-sided per line', async () => {
    const { bookingId } = await fixture();
    const { id } = await db.transaction(tx => postTransaction(tx, { kind: 'charge', bookingId, lines: [
      { account: 'provider_held', debit: 1_000 }, { account: 'client_funds', credit: 1_000 },
    ] }));
    expect(await failure(db.update(s.ledgerEntry).set({ debitCents: 2_000 }).where(eq(s.ledgerEntry.transactionId, id)))).toMatch(/append-only/);
    expect(await failure(db.delete(s.ledgerTransaction).where(eq(s.ledgerTransaction.id, id)))).toMatch(/append-only/);
    await expect(db.transaction(async tx => {
      const [t] = await tx.insert(s.ledgerTransaction).values({ kind: 'adjustment', occurredAt: NOW, description: 'both sides' }).returning();
      await tx.insert(s.ledgerEntry).values([
        { transactionId: t.id, account: 'provider_held', debitCents: 500, creditCents: 500 },
        { transactionId: t.id, account: 'client_funds', creditCents: 0, debitCents: 0 },
      ]);
    })).rejects.toThrow();
    expect(await failure(db.transaction(async tx => {
      const [t] = await tx.insert(s.ledgerTransaction).values({ kind: 'adjustment', occurredAt: NOW, description: 'both sides' }).returning();
      await tx.insert(s.ledgerEntry).values([
        { transactionId: t.id, account: 'provider_held', debitCents: 500, creditCents: 500 },
        { transactionId: t.id, account: 'client_funds', creditCents: 500 },
      ]);
    }))).toMatch(/ledger_entry_one_side_check/);
  });
});

describe('actors, audit, clock, jobs', () => {
  it('applies the SPEC §1.2 permission matrix', async () => {
    const roles = { admin: await createAdmin('admin'), moderator: await createAdmin('moderator'), support: await createAdmin('support'), accounting: await createAdmin('accounting') };
    expect(can(roles.admin.actor, 'release_payouts')).toBe(true);
    expect(can(roles.moderator.actor, 'approve_partners')).toBe(true);
    expect(can(roles.moderator.actor, 'view_finance')).toBe(false);
    expect(can(roles.support.actor, 'message_users')).toBe(true);
    expect(can(roles.support.actor, 'resolve_disputes')).toBe(false);
    expect(can(roles.accounting.actor, 'view_finance')).toBe(true);
    expect(can(roles.accounting.actor, 'confirm_payout_account')).toBe(true);
    expect(can(roles.moderator.actor, 'cancel_booking')).toBe(true);
    // D39: moderators may extend a deadline / block a client only while a dispute is open.
    expect(can(roles.moderator.actor, 'extend_payment_deadline')).toBe(false);
    expect(can(roles.moderator.actor, 'extend_payment_deadline', { disputeOpen: true })).toBe(true);
    expect(can(roles.admin.actor, 'block_client')).toBe(true);
    expect(teamRolesWith('resolve_disputes')).toEqual(['admin', 'moderator']);

    const { user: c, actor: clientActor } = await createClient();
    expect(can(clientActor, 'message_users')).toBe(false);
    expect(can(SYSTEM, 'view_finance')).toBe(false);
    expect(await actorFromUser({ id: c.id, role: 'client' })).toEqual({ userId: c.id, role: 'client' });

    const p = await createPartner();
    expect(await actorFromUser({ id: p.user.id, role: 'partner' })).toEqual({ userId: p.user.id, role: 'partner', partnerId: p.partner.id });
    expect(await actorFromUser({ id: roles.support.user.id, role: 'admin' })).toMatchObject({ teamRole: 'support' });
    await db.update(s.teamMember).set({ status: 'removed' }).where(eq(s.teamMember.userId, roles.support.user.id));
    const removed = await actorFromUser({ id: roles.support.user.id, role: 'admin' });
    expect(removed.teamRole).toBeNull();
    expect(can(removed, 'message_users')).toBe(false);
  });

  it('writes audit rows at business time, system actor included', async () => {
    setTestNow(NOW);
    await audit(db, { actor: SYSTEM, action: 'booking.completed', entity: 'booking', entityId: 'x', data: { a: 1 } });
    const [r] = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'booking.completed'));
    expect(r).toMatchObject({ actorId: null, actorRole: 'system', entity: 'booking', entityId: 'x', data: { a: 1 } });
    expect(r.createdAt.toISOString()).toBe(NOW.toISOString());
  });

  it('freezes and advances the test clock', async () => {
    setTestNow(NOW);
    expect((await now()).toISOString()).toBe(NOW.toISOString());
    advanceTestNow(3600_000);
    expect((await now()).getTime()).toBe(NOW.getTime() + 3600_000);
    setTestNow(null);
    expect(Math.abs((await now()).getTime() - Date.now())).toBeLessThan(5_000);
  });

  it('builds the job registry from the module files', () => {
    expect(typeof JOB_HANDLERS.noop).toBe('function');
  });

  it('factories create coherent records', async () => {
    const p = await createPartner({ category: 'ketaring', priceCents: 2_800, priceUnit: 'per_guest' });
    expect(p.partner).toMatchObject({ status: 'approved', isListed: true, acceptingRequests: true, providerChargesEnabled: true });
    expect(p.service).toMatchObject({ status: 'active', kind: 'package_fixed', priceCents: 2_800, priceUnit: 'per_guest' });
    const [m] = await db.select().from(s.partnerMember).where(eq(s.partnerMember.partnerId, p.partner.id));
    expect(m.userId).toBe(p.user.id);
    const { user: c } = await createClient();
    const { booking, number } = await createBookingRow({ client: c, partner: p, eventDate: '2026-06-30' });
    expect(number).toMatch(/^2026-0630-/);
    expect(booking).toMatchObject({ status: 'confirmed', holdUntil: '2026-07-01', batchDate: '2026-07-01', amountCents: 2_800 });
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.booking).where(eq(s.booking.number, number));
    expect(n).toBe(1);
  });
});
