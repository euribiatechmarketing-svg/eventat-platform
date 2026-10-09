// Read models of the partner sign-up wizard (SCREENS §6, SPEC §12.1).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { setTestNow } from '@/lib/clock';
import { blockDate } from '@/lib/domain/availability';
import { returnApplication, saveStep, submitApplication } from '@/lib/domain/partners';
import {
  pendingStatus, policyDays, policyLine, stepAvailability, stepReview, stepServices, wizardChrome,
} from '@/lib/domain/views-partner-onboarding';
import { DEFAULT_CANCELLATION_POLICIES } from '@/lib/domain/settings';
import { createAdmin } from '../helpers/factories';
import { NOW, draftPartner, expectLedgerClean, fillOnboarding } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

describe('wizardChrome', () => {
  it('a fresh draft: only step 1 is reachable, defaults are not "done" until passed', async () => {
    const { actor } = await draftPartner();
    const c = await wizardChrome(actor);
    expect(c.status).toBe('draft');
    expect(c.steps.map(s => s.done)).toEqual([false, false, false, false, false, false]);
    expect(c.steps.map(s => s.reachable)).toEqual([true, false, false, false, false, false]);
    expect(c.firstOpen).toBe(1);
    expect(c.steps[3].meta).toBe('Колко резервации на ден');
    expect(c.draftSavedAt).toBeNull();
  });

  it('done steps carry their meta (§12.1) and open the next step', async () => {
    const { actor } = await draftPartner();
    await fillOnboarding(actor);
    const c = await wizardChrome(actor);
    expect(c.steps.slice(0, 5).every(s => s.done)).toBe(true);
    expect(c.steps.every(s => s.reachable)).toBe(true);
    expect(c.steps.map(s => s.meta).slice(0, 5)).toEqual([
      'Студио Мелодия · София', 'Представяне и 4 снимки', '1 пакет · 1 по запитване', 'Една резервация на ден', 'Умерена',
    ]);
    expect(c.firstOpen).toBe(6);
  });

  it('a returned application has passed every step and carries the team note', async () => {
    const { actor, partner } = await draftPartner();
    await fillOnboarding(actor);
    await submitApplication(actor, { acceptTerms: true, confirmInfo: true });
    const admin = await createAdmin('admin');
    await returnApplication(admin.actor, { partnerId: partner.id, note: 'Добавете още снимки.' });
    const c = await wizardChrome(actor);
    expect(c.status).toBe('returned');
    expect(c.lastDecisionNote).toBe('Добавете още снимки.');
    expect(c.steps.slice(0, 5).every(s => s.done)).toBe(true);
  });
});

describe('step read models', () => {
  it('services: first fixed package first, completeness, partner city', async () => {
    const { actor } = await draftPartner();
    await fillOnboarding(actor);
    const d = await stepServices(actor);
    expect(d.services.map(s => [s.name, s.kind, s.complete])).toEqual([
      ['Пакет „Цял ден“', 'package_fixed', true], ['Фирмени събития', 'on_request', true],
    ]);
    expect(d.cityName).toBe('София');
    expect(d.maxPackages).toBe(5);
  });

  it('availability: Monday-first month grid with manual blocks; out-of-range months fall back', async () => {
    const { actor } = await draftPartner();
    await saveStep(actor, { step: 1, data: {} }).catch(() => {});
    await blockDate(actor, { date: '2025-09-17' });
    const d = await stepAvailability(actor, '2025-09');
    expect(d.calendar.title).toBe('Септември 2025');
    expect(d.calendar.cells[0]).toMatchObject({ date: '2025-09-01', out: false });
    expect(d.calendar.cells.length % 7).toBe(0);
    expect(d.calendar.cells.find(c => c.date === '2025-09-17')?.blocked).toBe(true);
    expect(d.calendar.prev).toBe('2025-08');
    // Default: the month of today + lead time (7 days) → September 2025.
    expect((await stepAvailability(actor, undefined)).calendar.month).toBe('2025-09');
    expect((await stepAvailability(actor, '2019-01')).calendar.month).toBe('2025-09');
    expect((await stepAvailability(actor, 'nonsense')).calendar.month).toBe('2025-09');
  });

  it('review and pending reflect the stored application', async () => {
    const { actor } = await draftPartner();
    await fillOnboarding(actor);
    await blockDate(actor, { date: '2026-06-17' });
    await blockDate(actor, { date: '2026-06-18' });
    const r = await stepReview(actor);
    expect(r.blocks).toBe('17 и 18\u00a0юни 2026');
    expect(r.policy).toBe('Умерена · безплатно анулиране до 30 дни преди събитието');
    expect(r.workingDays).toBe('Всички дни от седмицата');
    expect(r.packages).toBe(1);
    expect(r.onRequest).toBe(1);
    await submitApplication(actor, { acceptTerms: true, confirmInfo: true });
    const p = await pendingStatus(actor);
    expect(p).toMatchObject({ status: 'submitted', firstName: 'Мартин', slaHours: 48, supportEmail: 'help@eventat.bg' });
    expect(p.submittedAt).toBeInstanceOf(Date);
  });
});

describe('policy strings', () => {
  it('come from ⚙ cancellation.policies', () => {
    expect(policyDays(DEFAULT_CANCELLATION_POLICIES)).toEqual({ flexibleFree: 7, moderateFree: 30, moderateDeposit: 7, strictRemainder: 14 });
    expect(policyLine('flexible', DEFAULT_CANCELLATION_POLICIES)).toBe('Гъвкава · безплатно анулиране до 7 дни преди събитието');
    expect(policyLine('strict', DEFAULT_CANCELLATION_POLICIES)).toBe('Строга · депозитът не се връща');
  });
});
