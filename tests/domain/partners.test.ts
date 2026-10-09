// Partner account (SPEC §4.2 P1–P11, §12.1 onboarding, §12.3 profile, §12.4 metrics).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { runDueJobs } from '@/lib/jobs';
import { addDays, sofiaInstant } from '@/lib/format';
import {
  addPhoto, applyAccountUpdate, approvalQueue, approve, changeBusinessName, checksSummary, confirmDeletion, deactivate, invite, isValidEik,
  nameChangeWindow, onboardingSummary, panelCounts, reactivate, refreshResponsiveness, reject, removePhoto, reorderPhotos, requestDeletion, responsiveness,
  returnApplication, saveDraft, saveStep, setCheck, setListing, slugify, submitApplication, updateProfile, lowestPrice, profileServiceStatuses,
} from '@/lib/domain/partners';
import { partnerPage } from '@/lib/domain/search';
import { expireDeletion } from '@/lib/domain/clients';
import { createAdmin, createBookingRow, createClient, cityId, eventTypeId } from '../helpers/factories';
import { NOW, bells, draftPartner, emails, expectLedgerClean, failure, fillOnboarding, jobsByPrefix, listedPartner, mediaRow, plain } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

describe('identifiers', () => {
  it('validates ЕИК / Булстат checksums (9 and 13 digits) and the 10-digit freelancer Булстат', () => {
    expect(isValidEik('175074752')).toBe(true);
    expect(isValidEik('175074753')).toBe(false);
    expect(isValidEik('207845112')).toBe(false); // the prototype's sample is not a real checksum
    expect(isValidEik('1750747520000')).toBe(false);
    expect(isValidEik('8001010008', 'freelancer')).toBe(true);
    expect(isValidEik('8001010008', 'eood')).toBe(false);
    expect(isValidEik('12345')).toBe(false);
  });
  it('transliterates slugs', () => {
    expect(slugify('Студио Мелодия')).toBe('studio-melodiya');
    expect(slugify('Квартет „Адажио“')).toBe('kvartet-adazhio');
    expect(slugify('Snap360')).toBe('snap360');
  });
});

describe('P1 register', () => {
  it('turns the signed-up user into the owner of a draft partner with consents', async () => {
    const { user, partner, actor } = await draftPartner();
    expect(partner).toMatchObject({ status: 'draft', onboardingStep: 1, businessName: 'Студио Мелодия', phone: '+359881234567', slug: 'studio-melodiya' });
    const [u] = await db.select().from(s.user).where(eq(s.user.id, user.id));
    expect(u.role).toBe('partner');
    const [m] = await db.select().from(s.partnerMember).where(eq(s.partnerMember.userId, user.id));
    expect(m).toMatchObject({ partnerId: partner.id, role: 'owner' });
    const consents = await db.select().from(s.consent).where(eq(s.consent.userId, user.id));
    expect(consents.map(c => c.document).sort()).toEqual(['general_terms', 'privacy']);
    expect(actor.partnerId).toBe(partner.id);
    // A second business with the same name gets its own slug.
    const second = await draftPartner();
    expect(second.partner.slug).toBe('studio-melodiya-2');
  });
  it('needs consent and a phone, and a user can own one partner only', async () => {
    const { register } = await import('@/lib/domain/partners');
    const { user } = await draftPartner();
    expect(await failure(register({ userId: user.id, businessName: 'X', contactName: 'Y', phone: '0881234567', consent: true }))).toContain('already_partner');
    expect(await failure(register({ userId: user.id, businessName: 'X', contactName: 'Y', phone: '0881234567', consent: false }))).toContain('consent_required');
    expect(await failure(register({ userId: user.id, businessName: 'X', contactName: 'Y', phone: '12', consent: true }))).toContain('invalid_phone');
  });
});

describe('P3 onboarding steps (§12.1)', () => {
  it('validates step 1 on ‹Продължи› and keeps drafts without validation', async () => {
    const { actor, partner } = await draftPartner();
    const base = {
      businessName: 'Студио Мелодия', legalForm: 'eood', eik: '175074753', primaryCategoryId: (await db.select().from(s.category))[0].id,
      cityId: await cityId('sofia'), radius: 150, experienceBand: 'y5_10', languages: ['Български'], contactName: 'Мартин Стоянов',
      notificationEmail: 'x@example.invalid', phone: '+359881234567', socialHandle: '@studio',
    };
    expect(await failure(saveStep(actor, { step: 1, data: base }))).toContain('invalid_eik');
    expect(await failure(saveStep(actor, { step: 1, data: { ...base, eik: '175074752', notificationEmail: 'nope' } }))).toContain('validation');
    const r = await saveStep(actor, { step: 1, data: { ...base, eik: '175074752' } });
    expect(r.nextStep).toBe(2);
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p).toMatchObject({ onboardingStep: 2, eik: '175074752', serviceRadiusKm: 150, servesNationwide: false });

    await saveDraft(actor, { step: 2, data: { shortDescription: 'Само това' } });
    const [d] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(d.shortDescription).toBe('Само това');
    expect(d.draftSavedAt?.getTime()).toBe(NOW.getTime());
    expect(d.onboardingStep).toBe(2);
    expect(await failure(saveStep(actor, { step: 2, data: { shortDescription: 'x' } }))).toContain('validation');
  });

  it('needs 4–8 gallery photos on step 2, a package on step 3, N ≥ 2 for a daily limit on step 4', async () => {
    const { actor } = await draftPartner();
    await fillOnboarding(actor);
    expect(await failure(saveStep(actor, { step: 4, data: { bookingsPerDayMode: 'limit', maxBookingsPerDate: 1, leadTimeDays: 7, horizonMonths: 24, workingDays: [6, 7] } })))
      .toContain('maxBookingsPerDate');
    expect(await failure(saveStep(actor, { step: 4, data: { bookingsPerDayMode: 'one', leadTimeDays: 5, horizonMonths: 24, workingDays: [6] } }))).toContain('validation');

    const short = await draftPartner();
    const avatar = await mediaRow(short.user.id, 'partner_avatar', { width: 800, height: 800 });
    const cover = await mediaRow(short.user.id, 'partner_cover');
    await addPhoto(short.actor, { mediaId: (await mediaRow(short.user.id, 'gallery')).id });
    const err = await failure(saveStep(short.actor, { step: 2, data: {
      avatarMediaId: avatar.id, coverMediaId: cover.id, shortDescription: 'a', description: 'b', eventTypeIds: [await eventTypeId('svatba')],
    } }));
    expect(err).toContain('step_incomplete');
    expect(err).toContain('gallery');
    // Another user's photo cannot be used.
    const other = await mediaRow(null, 'partner_avatar', { width: 800, height: 800 });
    await db.update(s.media).set({ ownerUserId: (await createClient()).user.id }).where(eq(s.media.id, other.id));
    expect(await failure(saveStep(short.actor, { step: 2, data: {
      avatarMediaId: other.id, coverMediaId: cover.id, shortDescription: 'a', description: 'b', eventTypeIds: [await eventTypeId('svatba')],
    } }))).toContain('media_not_owned');
  });

  it('S5: step 3 makes the valid onboarding services ready; the sidebar shows each step’s meta', async () => {
    const { actor, partner } = await draftPartner();
    await fillOnboarding(actor);
    const svcs = await db.select().from(s.service).where(eq(s.service.partnerId, partner.id));
    expect(svcs.map(x => x.status)).toEqual(['ready', 'ready']);
    const sum = await onboardingSummary(actor);
    expect(sum.steps.map(x => x.done)).toEqual([true, true, true, true, true]);
    expect(sum.steps.map(x => x.meta)).toEqual(['Студио Мелодия · София', 'Представяне и 4 снимки', '1 пакет · 1 по запитване', 'Една резервация на ден', 'Умерена']);
    expect(sum.onboardingStep).toBe(6);
  });
});

describe('P4 submit', () => {
  it('needs both checkboxes and every step', async () => {
    const { actor } = await draftPartner();
    expect(await failure(submitApplication(actor, { acceptTerms: true, confirmInfo: false }))).toContain('consent_required');
    expect(await failure(submitApplication(actor, { acceptTerms: true, confirmInfo: true }))).toContain('steps_incomplete');
  });

  it('submits: checks, provider account, consents, emails to the partner and to approve_partners', async () => {
    const { admin, moderator, support } = { admin: await createAdmin('admin'), moderator: await createAdmin('moderator'), support: await createAdmin('support') };
    const { actor, partner, user } = await draftPartner();
    await fillOnboarding(actor);
    await submitApplication(actor, { acceptTerms: true, confirmInfo: true });
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p).toMatchObject({ status: 'submitted', provider: 'simulated', providerStatus: 'enabled', providerChargesEnabled: true });
    expect(p.providerAccountRef).toMatch(/^sim_acct_/);
    expect(p.submittedAt?.getTime()).toBe(NOW.getTime());
    const checks = await checksSummary(db, partner.id);
    expect(checks.total).toBe(6);
    expect(Object.fromEntries(checks.checks.map(c => [c.kind, c.state]))).toEqual({
      company: 'waiting', contacts: 'waiting', gallery: 'waiting', services: 'ok', cancellation_policy: 'ok', bank_account: 'waiting',
    });
    expect(plain(checks.checks.find(c => c.kind === 'services')?.detail)).toBe('1 пакет · от 1 450 € до 1 450 €');
    expect(checks.checks.find(c => c.kind === 'cancellation_policy')?.detail).toBe('Умерена · безплатно до 30 дни');
    const consents = await db.select().from(s.consent).where(eq(s.consent.userId, user.id));
    expect(consents.map(c => c.document).sort()).toEqual(['general_terms', 'partner_terms', 'privacy', 'privacy']);
    // Onboarding packages took the partner's event types.
    const [svc] = await db.select().from(s.service).where(and(eq(s.service.partnerId, partner.id), eq(s.service.kind, 'package_fixed')));
    expect((await db.select().from(s.serviceEventType).where(eq(s.serviceEventType.serviceId, svc.id))).length).toBe(2);

    const [mine] = await emails('vendor-application-received', user.id);
    expect(mine.toEmail).toBe('studio.melodia@example.invalid');
    expect(plain(mine.vars)).toMatchObject({ partnerName: 'Студио Мелодия', partnerCategory: 'DJ и озвучаване', city: 'София', packages: 1, onRequest: 1,
      availability: 'Една резервация на ден', policy: 'Умерена · депозит 30%', submittedAt: '31 август 2025, 12:00' });
    expect((await bells(user.id))[0]).toMatchObject({ kind: 'vendor-application-received', title: 'Благодарим, Мартин. Профилът ви е при екипа.' });
    const team = await emails('team-vendor-application');
    const to = team.filter(e => (e.vars as { partnerId: string }).partnerId === partner.id).map(e => e.toUserId);
    expect(to).toContain(admin.user.id);
    expect(to).toContain(moderator.user.id);
    expect(to).not.toContain(support.user.id);
    expect(plain(team.find(e => e.toUserId === admin.user.id)?.vars)).toMatchObject({ stepsDone: 2, stepsTotal: 6, bankPending: false, packages: 1, priceFrom: '1 450,00 €' });
    // Read-only while submitted.
    expect(await failure(saveDraft(actor, { step: 1, data: { businessName: 'Друго' } }))).toContain('wizard_read_only');
    expect(await failure(submitApplication(actor, { acceptTerms: true, confirmInfo: true }))).toContain('partner_status');
  });
});

describe('‹Виж профила като клиент› before approval (journey J4)', () => {
  it('the preview lists the onboarding packages and their from-price, exactly as the profile goes live', async () => {
    const { partner, actor } = await draftPartner();
    await fillOnboarding(actor);
    await submitApplication(actor, { acceptTerms: true, confirmInfo: true });
    const pre = await partnerPage({ slug: partner.slug, preview: true }, { actor });
    expect(pre?.partner.preview).toBe(true);
    expect(pre?.services.map(x => [x.name, x.price?.cents ?? null, x.recommended])).toEqual([['Пакет „Цял ден“', 145_000, true], ['Фирмени събития', null, false]]);
    expect(plain(pre?.partner.fromPrice?.text)).toBe('от 1 450 €');
    expect(await partnerPage({ slug: partner.slug })).toBeNull(); // still not public
    await approve((await createAdmin()).actor, { partnerId: partner.id });
    const live = await partnerPage({ slug: partner.slug });
    expect(live?.partner.preview).toBe(false);
    expect(live?.services.map(x => x.name)).toEqual(pre?.services.map(x => x.name));
    expect(live?.partner.fromPrice).toEqual(pre?.partner.fromPrice);
  });

  it('lists ready services only before approval; the from-price prefers per-event packages shown in the profile', () => {
    expect(profileServiceStatuses('submitted')).toEqual(['ready', 'active']);
    expect(profileServiceStatuses('returned')).toEqual(['ready', 'active']);
    expect(profileServiceStatuses('approved')).toEqual(['active']);
    expect(profileServiceStatuses('deactivated')).toEqual(['active']);
    const svc = (kind: 'package_fixed' | 'on_request', priceCents: number | null, priceUnit: 'per_event' | 'per_guest' = 'per_event', showInProfile = true) =>
      ({ kind, priceCents, priceUnit, showInProfile });
    expect(lowestPrice([svc('package_fixed', 120_000), svc('package_fixed', 80_000), svc('on_request', null)])).toEqual({ cents: 80_000, unit: 'per_event' });
    expect(lowestPrice([svc('package_fixed', 4_500, 'per_guest'), svc('package_fixed', 90_000)])).toEqual({ cents: 90_000, unit: 'per_event' });
    expect(lowestPrice([svc('package_fixed', 4_500, 'per_guest'), svc('package_fixed', 30_000, 'per_event', false)])).toEqual({ cents: 4_500, unit: 'per_guest' });
    expect(lowestPrice([svc('on_request', null)])).toBeNull();
  });
});

describe('P5 / P6 / P7 team decisions', () => {
  async function submitted() {
    const d = await draftPartner();
    await fillOnboarding(d.actor);
    await submitApplication(d.actor, { acceptTerms: true, confirmInfo: true });
    return d;
  }

  it('approves: services published, listed, searchable; only approve_partners may decide', async () => {
    const { partner, user } = await submitted();
    const { actor: support } = await createAdmin('support');
    const { actor: client } = await createClient();
    expect(await failure(approve(support, { partnerId: partner.id }))).toContain('ForbiddenError');
    expect(await failure(approve(client, { partnerId: partner.id }))).toContain('ForbiddenError');
    const { actor: mod } = await createAdmin('moderator');
    expect((await approvalQueue(mod)).some(r => r.p.id === partner.id)).toBe(true);
    setTestNow(sofiaInstant('2025-09-01', 10, 0));
    await approve(mod, { partnerId: partner.id });
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p).toMatchObject({ status: 'approved', approvedBy: mod.userId, minPriceCents: 145_000, minPriceUnit: 'per_event' });
    expect(p.listedAt?.toISOString()).toBe(sofiaInstant('2025-09-01', 10, 0).toISOString());
    expect(p.searchText).toContain('студио мелодия');
    expect(p.searchText).toContain('dj и озвучаване');
    expect(p.searchText).toContain('софия');
    expect(p.searchText).toContain('сватба');
    const svcs = await db.select().from(s.service).where(eq(s.service.partnerId, partner.id));
    expect(svcs.every(x => x.status === 'active' && x.publishedAt)).toBe(true);
    const [dec] = await db.select().from(s.partnerDecision).where(eq(s.partnerDecision.partnerId, partner.id));
    expect(dec.decision).toBe('approved');
    const [mail] = await emails('vendor-application-approved', user.id);
    expect(mail.vars).toMatchObject({ partnerName: 'Студио Мелодия', city: 'София', radiusKm: 150, packages: 1, onRequest: 1, policyName: 'Умерена' });
    expect(await failure(approve(mod, { partnerId: partner.id }))).toContain('partner_status');
    const audit = await db.select().from(s.auditLog).where(and(eq(s.auditLog.entityId, partner.id), eq(s.auditLog.action, 'partner.approved')));
    expect(audit).toHaveLength(1);
  });

  it('returns with a note; the partner fixes step 6 and resubmits', async () => {
    const { partner, actor, user } = await submitted();
    const { actor: admin } = await createAdmin('admin');
    expect(await failure(returnApplication(admin, { partnerId: partner.id, note: ' ' }))).toContain('note_required');
    await returnApplication(admin, { partnerId: partner.id, note: 'Една от снимките е с чужд воден знак.' });
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p).toMatchObject({ status: 'returned', lastDecisionNote: 'Една от снимките е с чужд воден знак.', onboardingStep: 6 });
    expect(plain((await emails('vendor-application-returned', user.id))[0].vars)).toMatchObject({ note: 'Една от снимките е с чужд воден знак.', submittedAt: '31 август 2025, 12:00' });
    expect((await onboardingSummary(actor)).lastDecisionNote).toBe('Една от снимките е с чужд воден знак.');
    advanceTestNow(3600_000);
    await submitApplication(actor, { acceptTerms: true, confirmInfo: true });
    const [again] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(again.status).toBe('submitted');
    expect(again.providerAccountRef).toBe(p.providerAccountRef);
    expect(await emails('vendor-application-received', user.id)).toHaveLength(2);
  });

  it('rejects with the reason', async () => {
    const { partner, user } = await submitted();
    const { actor: admin } = await createAdmin('admin');
    expect(await failure(reject(admin, { partnerId: partner.id, note: '' }))).toContain('note_required');
    await reject(admin, { partnerId: partner.id, note: 'ЕИК не съвпада с Търговския регистър.' });
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p.status).toBe('rejected');
    expect((await emails('vendor-application-rejected', user.id))[0].vars).toMatchObject({ eik: '175074752', reason: 'ЕИК не съвпада с Търговския регистър.' });
  });

  it('team checks drive ‹Проверен›; computed checks cannot be set by hand', async () => {
    const { partner } = await submitted();
    const { actor: admin } = await createAdmin('admin');
    expect(await failure(setCheck(admin, { partnerId: partner.id, kind: 'services' as 'company', state: 'ok' }))).toContain('computed_check');
    await setCheck(admin, { partnerId: partner.id, kind: 'company', state: 'ok', detail: 'ЕИК 175074752 · проверено' });
    let [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p.isVerified).toBe(false);
    await setCheck(admin, { partnerId: partner.id, kind: 'contacts', state: 'ok' });
    [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p.isVerified).toBe(true);
    expect((await checksSummary(db, partner.id)).ok).toBe(4);
    const { actor: acc } = await createAdmin('accounting');
    expect(await failure(setCheck(acc, { partnerId: partner.id, kind: 'gallery', state: 'ok' }))).toContain('ForbiddenError');
  });
});

describe('§12.3 profile, listing flags, name', () => {
  it('updates the profile at once and re-indexes it for search', async () => {
    const { actor, partner } = await listedPartner();
    await updateProfile(actor, { description: 'Ново описание за вас.', cityId: await cityId('varna'), radius: 'nationwide', maxGuests: 300 });
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p).toMatchObject({ description: 'Ново описание за вас.', servesNationwide: true, serviceRadiusKm: null, maxGuests: 300 });
    expect(p.searchText).toContain('варна');
    const { actor: client } = await createClient();
    expect(await failure(updateProfile(client, { description: 'x' }))).toContain('ForbiddenError');
  });

  it('stamps listed_at when the partner re-enters the base set', async () => {
    const { actor, partner } = await listedPartner();
    await setListing(actor, { acceptingRequests: false });
    advanceTestNow(86_400_000);
    await setListing(actor, { acceptingRequests: true });
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p.acceptingRequests).toBe(true);
    expect(p.listedAt?.getTime()).toBe(NOW.getTime() + 86_400_000);
  });

  it('changes the business name at most once per month (D83)', async () => {
    const { actor, partner } = await listedPartner({ businessName: 'Старо име' });
    await changeBusinessName(actor, { businessName: 'Ново име' });
    let [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p.businessName).toBe('Ново име');
    expect(p.searchText).toContain('ново име');
    expect(await nameChangeWindow(p)).toEqual({ lastChangedOn: '2025-08-31', nextFrom: '2025-09-30', allowed: false });
    expect(await failure(changeBusinessName(actor, { businessName: 'Трето' }))).toContain('name_change_too_soon');
    setTestNow(sofiaInstant('2025-09-30', 9, 0));
    await changeBusinessName(actor, { businessName: 'Трето' });
    [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p.businessName).toBe('Трето');
    expect(p.slug).toBe(partner.slug);
  });

  it('gallery: up to 8 photos, at least 4 on a live profile, ordered', async () => {
    const { actor, partner, user } = await listedPartner({ photos: 4 });
    const photos = await db.select().from(s.partnerPhoto).where(eq(s.partnerPhoto.partnerId, partner.id));
    expect(await failure(removePhoto(actor, { photoId: photos[0].id }))).toContain('gallery_min');
    for (let i = 0; i < 4; i++) await addPhoto(actor, { mediaId: (await mediaRow(user.id, 'gallery')).id });
    expect(await failure(addPhoto(actor, { mediaId: (await mediaRow(user.id, 'gallery')).id }))).toContain('gallery_full');
    await removePhoto(actor, { photoId: photos[0].id });
    const now7 = await db.select().from(s.partnerPhoto).where(eq(s.partnerPhoto.partnerId, partner.id)).orderBy(s.partnerPhoto.position);
    expect(now7.map(p => p.position)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    await reorderPhotos(actor, { photoIds: [...now7].reverse().map(p => p.id) });
    const after = await db.select().from(s.partnerPhoto).where(eq(s.partnerPhoto.partnerId, partner.id)).orderBy(s.partnerPhoto.position);
    expect(after[0].id).toBe(now7[6].id);
  });
});

describe('P8 / P9 deactivation', () => {
  it('deactivates with the upcoming count and comes back', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'confirmed' });
    await deactivate(pr.actor);
    let [p] = await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id));
    expect(p.status).toBe('deactivated');
    expect((await emails('vendor-deactivated', pr.user.id))[0].vars).toMatchObject({ upcomingCount: 1, partnerCategory: 'DJ и озвучаване' });
    expect(await failure(deactivate(pr.actor))).toContain('partner_status');
    advanceTestNow(3600_000);
    await reactivate(pr.actor);
    [p] = await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id));
    expect(p.status).toBe('approved');
    expect(p.listedAt?.getTime()).toBe(NOW.getTime() + 3600_000);
  });
});

describe('P10 deletion', () => {
  it('is refused with an upcoming booking (D56)', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'confirmed' });
    expect(await failure(requestDeletion(pr.actor))).toContain('has_upcoming_bookings');
  });

  it('emails a 24 h link; confirming anonymises the partner and the user', async () => {
    const pr = await listedPartner();
    const sess = await db.insert(s.session).values({ id: `s_${pr.user.id}`, token: `t_${pr.user.id}`, userId: pr.user.id, expiresAt: new Date('2030-01-01') }).returning();
    expect(sess).toHaveLength(1);
    const { token } = await requestDeletion(pr.actor);
    const [mail] = await emails('vendor-delete-confirm', pr.user.id);
    expect((mail.vars as { url: string }).url).toBe(`/partner/nastroyki/iztrivane?token=${token}`);
    expect(await jobsByPrefix('deletion:')).not.toHaveLength(0);
    expect(await failure(confirmDeletion({ token: 'wrong' }))).toContain('invalid_token');
    await confirmDeletion({ token });
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id));
    expect(p).toMatchObject({ status: 'deleted', businessName: 'Изтрит профил', isListed: false, slug: `deleted-${pr.partner.id}` });
    const [svc] = await db.select().from(s.service).where(eq(s.service.partnerId, pr.partner.id));
    expect(svc.status).toBe('archived');
    const [u] = await db.select().from(s.user).where(eq(s.user.id, pr.user.id));
    expect(u).toMatchObject({ name: 'Изтрит профил', email: `deleted+${pr.user.id}@eventat.invalid`, phone: null });
    expect(await db.select().from(s.session).where(eq(s.session.userId, pr.user.id))).toHaveLength(0);
    expect(await failure(confirmDeletion({ token }))).toContain('invalid_token');
  });

  it('T24: an unused link expires after 24 h (idempotent)', async () => {
    const pr = await listedPartner();
    const { token } = await requestDeletion(pr.actor);
    const [req] = await db.select().from(s.accountDeletionRequest).where(eq(s.accountDeletionRequest.userId, pr.user.id));
    advanceTestNow(23 * 3600_000);
    await runDueJobs();
    expect((await db.select().from(s.accountDeletionRequest).where(eq(s.accountDeletionRequest.id, req.id)))[0].status).toBe('requested');
    advanceTestNow(2 * 3600_000);
    await runDueJobs();
    expect((await db.select().from(s.accountDeletionRequest).where(eq(s.accountDeletionRequest.id, req.id)))[0].status).toBe('expired');
    expect(await expireDeletion({ requestId: req.id })).toBe(false);
    expect(await failure(confirmDeletion({ token }))).toContain('invalid_token');
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id));
    expect(p.status).toBe('approved');
  });
});

describe('P11 provider account', () => {
  it('applies account.updated idempotently', async () => {
    const pr = await listedPartner();
    await db.update(s.partner).set({ provider: 'stripe', providerAccountRef: `acct_${pr.partner.id.slice(0, 8)}`, providerStatus: 'pending', providerChargesEnabled: false })
      .where(eq(s.partner.id, pr.partner.id));
    const ref = `acct_${pr.partner.id.slice(0, 8)}`;
    expect(await applyAccountUpdate({ accountRef: ref, status: { chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] } })).toBe('enabled');
    expect(await applyAccountUpdate({ accountRef: ref, status: { chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] } })).toBe('enabled');
    expect(await applyAccountUpdate({ accountRef: ref, status: { chargesEnabled: false, payoutsEnabled: true, requirementsDue: ['external_account'] } })).toBe('restricted');
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id));
    expect(p).toMatchObject({ providerChargesEnabled: false, providerRequirements: ['external_account'] });
    expect(await applyAccountUpdate({ accountRef: 'acct_unknown', status: { chargesEnabled: true, payoutsEnabled: true, requirementsDue: [] } })).toBeNull();
  });
});

describe('‹Покани изпълнител›', () => {
  it('needs approve_partners and sends vendor-invite', async () => {
    const { actor: mod, user } = await createAdmin('moderator', { name: 'Моника Ковачева' });
    const { actor: support } = await createAdmin('support');
    expect(await failure(invite(support, { email: 'new@example.invalid' }))).toContain('ForbiddenError');
    expect(await failure(invite(mod, { email: 'not-an-email' }))).toContain('invalid_email');
    const row = await invite(mod, { email: 'New.Partner@example.invalid' });
    expect(row).toMatchObject({ email: 'new.partner@example.invalid', invitedBy: user.id });
    const [mail] = (await emails('vendor-invite')).filter(e => e.toEmail === 'new.partner@example.invalid');
    expect(mail.vars).toEqual({ inviterName: 'Моника Ковачева' });
  });
});

describe('§12.5 panel counts', () => {
  it('counts pending requests and open invitations, awaiting payment, upcoming events', async () => {
    const pr = await listedPartner();
    const { user: client } = await createClient();
    const a = await createBookingRow({ client, partner: pr, eventDate: '2026-06-14', status: 'awaiting_payment' });
    await createBookingRow({ client, partner: pr, eventDate: '2026-06-21', status: 'confirmed' });
    await createBookingRow({ client, partner: pr, eventDate: '2025-06-21', status: 'confirmed' });
    await db.update(s.request).set({ status: 'pending' }).where(eq(s.request.id, a.request.id));
    expect(await panelCounts(pr.actor)).toEqual({ newRequests: 1, awaitingPayment: 1, upcomingEvents: 1 });
  });
});

describe('§12.4 responsiveness', () => {
  it('is the share of requests answered before their deadline in 180 days; hidden without any', async () => {
    const pr = await listedPartner();
    expect(await responsiveness(pr.partner.id)).toBeNull();
    const { user: client } = await createClient();
    const a = await createBookingRow({ client, partner: pr, eventDate: '2026-06-14' });
    const b = await createBookingRow({ client, partner: pr, eventDate: '2026-06-21' });
    await db.update(s.request).set({ sentAt: sofiaInstant('2025-08-01'), answeredAt: sofiaInstant('2025-08-01', 5), responseDueAt: sofiaInstant('2025-08-02') }).where(eq(s.request.id, a.request.id));
    await db.update(s.request).set({ status: 'expired', sentAt: sofiaInstant('2025-08-10'), answeredAt: null, responseDueAt: sofiaInstant('2025-08-11') }).where(eq(s.request.id, b.request.id));
    expect(await responsiveness(pr.partner.id)).toBe(50);
    await refreshResponsiveness();
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, pr.partner.id));
    expect(p.responsivenessPct).toBe(50);
    expect(addDays('2025-08-31', 1)).toBe('2025-09-01');
  });
});
