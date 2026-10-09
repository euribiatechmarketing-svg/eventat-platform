// Admin operations read models and mutations (lib/domain/views-admin-ops.ts): periods, versioned
// settings, the category editor, admin exports, invite acceptance with a password, the admin search.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { invite } from '@/lib/domain/team';
import {
  acceptInviteWithPassword, addCategory, adminClientList, adminPartnerList, adminSearch, clientBadge, periodOf, policiesSummary,
  requestAdminExport, setCategoryVisible, updateSettings,
} from '@/lib/domain/views-admin-ops';
import { DEFAULT_CANCELLATION_POLICIES, getSetting } from '@/lib/domain/settings';
import { createAdmin, createBookingRow, createClient } from '../helpers/factories';
import { NOW, failure, listedPartner } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(() => setTestNow(null));

describe('periods', () => {
  it('names the month, quarter and year with their predecessors', () => {
    expect(periodOf('month', '2025-08-31')).toMatchObject({ from: '2025-08-01', to: '2025-09-01', prevFrom: '2025-07-01', title: 'Август 2025', prevLabel: 'юли' });
    expect(periodOf('month', '2026-01-15')).toMatchObject({ from: '2026-01-01', prevFrom: '2025-12-01', prevLabel: 'декември' });
    expect(periodOf('quarter', '2025-08-31')).toMatchObject({ from: '2025-07-01', to: '2025-10-01', prevFrom: '2025-04-01', title: 'Юли – септември 2025' });
    expect(periodOf('year', '2025-08-31')).toMatchObject({ from: '2025-01-01', to: '2026-01-01', title: '2025', prevLabel: '2024' });
  });

  it('summarises the policy table the way the settings row shows it', () => {
    expect(policiesSummary(DEFAULT_CANCELLATION_POLICIES)).toBe('Гъвкава (до 7 дни) · Умерена (до 30 дни) · Строга (депозитът не се връща)');
  });
});

describe('settings', () => {
  it('writes a new version only for the keys that changed; earlier instants keep the old value', async () => {
    const { actor } = await createAdmin('admin');
    const before = await getSetting('commission.standard_bp');
    const changed = await updateSettings(actor, { values: { 'commission.standard_bp': 1200, 'commission.intro_bp': await getSetting('commission.intro_bp') } });
    expect(changed).toEqual(['commission.standard_bp']);
    expect(await getSetting('commission.standard_bp')).toBe(1200);
    expect(await getSetting('commission.standard_bp', new Date(NOW.getTime() - 1))).toBe(before);
    const audits = await db.select().from(s.auditLog).where(and(eq(s.auditLog.action, 'settings.changed'), eq(s.auditLog.entityId, 'commission.standard_bp')));
    expect(audits.length).toBeGreaterThan(0);
  });

  it('refuses a moderator and an invalid value', async () => {
    const { actor: mod } = await createAdmin('moderator');
    expect(await failure(updateSettings(mod, { values: { 'moderation.manual': false } }))).toContain('ForbiddenError');
    const { actor } = await createAdmin('admin');
    expect(await failure(updateSettings(actor, { values: { 'payment.window_hours': -3 } }))).toContain('validation');
  });
});

describe('categories', () => {
  it('adds a visible directory category with a unique slug and refuses a duplicate name', async () => {
    const { actor } = await createAdmin('admin');
    const c = await addCategory(actor, { name: '  Аниматори  за деца ' });
    expect(c).toMatchObject({ name: 'Аниматори за деца', isVisible: true, inDirectory: true, slug: expect.stringMatching(/^[a-z0-9-]+$/) });
    expect(await failure(addCategory(actor, { name: 'аниматори за деца' }))).toContain('duplicate');
    const { actor: mod } = await createAdmin('moderator');
    expect(await failure(addCategory(mod, { name: 'Цирк' }))).toContain('ForbiddenError');
  });

  it('hides and shows a category', async () => {
    const { actor } = await createAdmin('admin');
    const c = await addCategory(actor, { name: 'Фойерверки' });
    expect((await setCategoryVisible(actor, { categoryId: c.id, visible: false })).isVisible).toBe(false);
    expect((await setCategoryVisible(actor, { categoryId: c.id, visible: true })).isVisible).toBe(true);
  });
});

describe('exports and lists', () => {
  it('records an export request per list; partner exports need approve_partners', async () => {
    const { actor } = await createAdmin('admin');
    const job = await requestAdminExport(actor, { kind: 'admin_clients', params: { tab: 'biznes' } });
    expect(job).toMatchObject({ kind: 'admin_clients', status: 'requested', requestedBy: actor.userId });
    const { actor: support } = await createAdmin('support');
    expect(await failure(requestAdminExport(support, { kind: 'admin_partners' }))).toContain('ForbiddenError');
    expect(await failure(adminPartnerList(support, { tab: 'chakat' }))).toContain('ForbiddenError');
  });

  it('filters ‹Наскоро одобрени› with the queue: a search shows no unrelated partners', async () => {
    const { actor } = await createAdmin('admin');
    const a = await listedPartner({ businessName: 'Звездна Сцена Тест' });
    await listedPartner({ businessName: 'Друга Фирма Тест' });
    const all = await adminPartnerList(actor, { tab: 'chakat' });
    expect(all.recent.length).toBeGreaterThan(1);
    const found = await adminPartnerList(actor, { tab: 'chakat', q: 'звездна сцена' });
    expect(found.recent.map(r => r.id)).toEqual([a.partner.id]);
    expect((await adminPartnerList(actor, { tab: 'chakat', q: 'няма такъв изпълнител' })).recent).toEqual([]);
  });

  it('flags clients as Блокиран > Отворен спор > Активен and filters the business tab', async () => {
    expect(clientBadge({ banned: true, openDisputes: 1 }).label).toBe('Блокиран');
    expect(clientBadge({ banned: false, openDisputes: 1 }).label).toBe('Отворен спор');
    expect(clientBadge({ banned: false, openDisputes: 0 }).label).toBe('Активен');
    const { actor } = await createAdmin('support');
    const biz = await createClient({ name: 'Фирма Тест ООД', clientType: 'business' });
    const list = await adminClientList(actor, { tab: 'biznes' });
    expect(list.rows.map(r => r.id)).toContain(biz.user.id);
    expect(list.rows.every(r => r.typeLabel === 'Бизнес клиент')).toBe(true);
  });
});

describe('invite acceptance with a password', () => {
  it('creates the account in the invited role and burns the link', async () => {
    const { actor: owner } = await createAdmin('admin', { name: 'Моника Ковачева' });
    const { token } = await invite(owner, { email: 'nov.chlen@eventat.bg', role: 'support' });
    expect(await failure(acceptInviteWithPassword({ token, name: 'Нов Член', password: 'kratka' }))).toContain('password_short');
    const r = await acceptInviteWithPassword({ token, name: 'Нов Член', password: 'dalga-parola-1' });
    const [u] = await db.select().from(s.user).where(eq(s.user.id, r.userId));
    expect(u).toMatchObject({ email: 'nov.chlen@eventat.bg', role: 'admin', emailVerified: true });
    const [acc] = await db.select().from(s.account).where(eq(s.account.userId, r.userId));
    expect(acc.providerId).toBe('credential');
    expect(acc.password).not.toContain('dalga-parola-1');
    expect((await db.select().from(s.teamMember).where(eq(s.teamMember.userId, r.userId)))[0].role).toBe('support');
    expect(await failure(acceptInviteWithPassword({ token, name: 'Нов Член', password: 'dalga-parola-1' }))).toContain('invalid_token');
  });

  it('refuses an expired link', async () => {
    const { actor: owner } = await createAdmin('admin');
    const { token } = await invite(owner, { email: 'kasno@eventat.bg', role: 'moderator' });
    advanceTestNow(8 * 86_400_000);
    expect(await failure(acceptInviteWithPassword({ token, name: 'Късно', password: 'dalga-parola-1' }))).toContain('invalid_token');
  });
});

describe('admin search', () => {
  it('opens an exact booking number and otherwise lists matching clients and bookings', async () => {
    const { actor } = await createAdmin('support');
    const { user: client } = await createClient({ name: 'Здравка Търсенова' });
    const b = await createBookingRow({ client, partner: await listedPartner(), status: 'confirmed' });
    expect((await adminSearch(actor, b.number.toLowerCase())).exact).toBe(b.number);
    const r = await adminSearch(actor, 'търсенова');
    expect(r.exact).toBeNull();
    expect(r.clients.map(c => c.id)).toContain(client.id);
    expect(r.partners).toEqual([]); // support has no approve_partners
  });
});
