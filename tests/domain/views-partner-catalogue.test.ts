// Partner catalogue & money read models (SCREENS §7) and the writes added with them:
// the earnings report (reports.request('partner_earnings')) and the language setting.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { deactivate, requestDeletion } from '@/lib/domain/partners';
import { submitChange } from '@/lib/domain/services';
import {
  ago, deletionTokenIsOwn, earningsPage, earningsReportCsv, euros, ibanMask, profilePage, requestEarningsReport, serviceEditor, servicesPage, setLocale, settingsPage,
} from '@/lib/domain/views-partner-catalogue';
import { categoryId, createBookingRow, createClient, eventTypeId } from '../helpers/factories';
import { NOW, emails, expectLedgerClean, failure, listedPartner, plain } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

describe('display helpers', () => {
  it('formats ages, whole euros and the IBAN mask', () => {
    expect(ago(new Date(NOW.getTime() - 4 * 86_400_000), NOW)).toBe('преди 4 дни');
    expect(ago(new Date(NOW.getTime() - 220 * 86_400_000), NOW)).toBe('преди 7 месеца');
    expect(ago(NOW, NOW)).toBe('току-що');
    expect(plain(euros(385_200))).toBe('3 852');
    expect(ibanMask('5272')).toBe('BG•• •••• •••• 5272');
  });
});

describe('/partner/uslugi', () => {
  it('lists the own services by tab with the counts', async () => {
    const { actor } = await listedPartner();
    await listedPartner(); // another partner's services never show
    const v = await servicesPage(actor, { tab: 'active' });
    expect(v.items.map(i => i.name)).toEqual(['Пакет „Цял ден“']);
    expect(v.items[0]).toMatchObject({ bookings: 0, inquiries: 0, statusLabel: 'Активна' });
    expect(plain(v.items[0].price)).toBe('1 450 €');
    expect(v.counts).toMatchObject({ active: 1, draft: 0, archived: 0 });
    expect((await servicesPage(actor, { tab: 'draft' })).items).toHaveLength(0);
  });
});

describe('/partner/uslugi/[id]', () => {
  it('shows the pending change in the editor while the live service stays as it is; other partners get nothing', async () => {
    const { actor, service } = await listedPartner();
    const other = await listedPartner();
    expect(await serviceEditor(other.actor, service.id)).toBeNull();
    await submitChange(actor, {
      id: service.id, kind: 'package_fixed', name: service.name, categoryId: await categoryId('dj-i-ozvuchavane'), description: service.description,
      priceCents: 160_000, durationLabel: 'До 10 часа', inclusions: ['DJ за цялото събитие', 'Безжичен микрофон'], eventTypeIds: [await eventTypeId('svatba')],
    });
    const v = (await serviceEditor(actor, service.id))!;
    expect(v.mode).toBe('edit');
    expect(v.statusLabel).toBe('Активна · промените чакат преглед');
    expect(v.values.priceCents).toBe(160_000);
    expect(plain(v.livePrice)).toBe('1 450 €');
    expect(v.revision).toMatchObject({ status: 'pending', type: 'edit' });
  });
});

describe('/partner/profil', () => {
  it('offers the public event types as specialisations (‹Друго› is the free-text tag) and knows a deactivated profile', async () => {
    const pr = await listedPartner();
    const v = await profilePage(pr.actor);
    const drugo = await eventTypeId('drugo');
    expect(v.eventTypes.map(t => t.id)).not.toContain(drugo);
    expect(v.eventTypes.map(t => t.label)).toContain('Сватби');
    expect(v.deactivated).toBe(false);
    await deactivate(pr.actor);
    expect((await profilePage(pr.actor)).deactivated).toBe(true);
  });
});

describe('/partner/prihodi', () => {
  it('shows what the partner receives, never the commission, and sends the report', async () => {
    const pr = await listedPartner({ businessName: 'Студио Мелодия' });
    const { user: client } = await createClient();
    await createBookingRow({ client, partner: pr });
    const v = await earningsPage(pr.actor, { page: 1 });
    expect(v.month.label).toBe('август 2025');
    expect(JSON.stringify(v)).not.toMatch(/commission|Комисиона/i);
    const { reportId } = await requestEarningsReport(pr.actor);
    const [job] = await db.select().from(s.reportJob).where(eq(s.reportJob.id, reportId));
    expect(job).toMatchObject({ kind: 'partner_earnings', status: 'ready', partnerId: pr.partner.id });
    const mail = await emails('vendor-report-ready', pr.user.id);
    expect(mail).toHaveLength(1);
    expect(mail[0].vars).toMatchObject({ partnerName: 'Студио Мелодия', period: 'август 2025' });
    expect((await earningsPage(pr.actor, { page: 1 })).latestReport).toBe(reportId);
    const csv = await earningsReportCsv(pr.actor, reportId);
    expect(csv?.csv).toContain('Получавате');
    // Someone else's report is not theirs to download.
    const other = await listedPartner();
    expect(await earningsReportCsv(other.actor, reportId)).toBeNull();
  });

  it('refuses the report to anyone but a partner', async () => {
    const { actor: client } = await createClient();
    expect(await failure(requestEarningsReport(client))).toContain('ForbiddenError');
  });
});

describe('/partner/nastroyki', () => {
  it('reads the account, the switches and the deletion guard; the language stays Bulgarian until English is enabled', async () => {
    const pr = await listedPartner();
    const v = await settingsPage(pr.actor);
    expect(v).toMatchObject({ status: 'approved', canDelete: true, prefs: { 'partner.new-request': true, 'partner.news': false } });
    const { user: client } = await createClient();
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'confirmed' });
    expect((await settingsPage(pr.actor)).canDelete).toBe(false);
    expect(await failure(setLocale(pr.actor, { locale: 'en' }))).toContain('locale_unavailable');
    await setLocale(pr.actor, { locale: 'bg' });
    const [u] = await db.select({ locale: s.user.locale }).from(s.user).where(eq(s.user.id, pr.user.id));
    expect(u.locale).toBe('bg');
  });
});

describe('/partner/nastroyki/iztrivane', () => {
  it('accepts the deletion link only from the partner who asked for it', async () => {
    const pr = await listedPartner();
    const other = await listedPartner();
    const { token } = await requestDeletion(pr.actor);
    expect(await deletionTokenIsOwn(pr.actor, token)).toBe(true);
    expect(await deletionTokenIsOwn(other.actor, token)).toBe(false);
    expect(await deletionTokenIsOwn(pr.actor, 'wrong')).toBe(false);
  });
});
