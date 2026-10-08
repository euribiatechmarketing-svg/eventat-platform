// Services and revisions (SPEC §4.4 S1–S10, §12.2).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import * as s from '@/db/schema';
import { advanceTestNow, setTestNow } from '@/lib/clock';
import { setSetting } from '@/lib/domain/settings';
import {
  approveChange, archive, listForPartner, moderationQueue, priceText, publish, remove, reorder, returnRevision, saveDraft, saveOnboarding,
  setToggles, setVisibility, submit, submitChange, type ServiceInput,
} from '@/lib/domain/services';
import { SYSTEM } from '@/lib/domain/actor';
import { categoryId, createAdmin, createClient, eventTypeId } from '../helpers/factories';
import { NOW, draftPartner, emails, expectLedgerClean, failure, listedPartner, mediaRow, plain } from '../helpers/catalogue';

beforeEach(() => setTestNow(NOW));
afterAll(async () => { setTestNow(null); await expectLedgerClean(); });

async function input(o: Partial<ServiceInput> = {}): Promise<ServiceInput> {
  return {
    kind: 'package_fixed', name: 'Пакет „Церемония“', categoryId: await categoryId('dj-i-ozvuchavane'), description: 'Озвучаване на церемонията до 3 часа.',
    priceCents: 42_000, durationLabel: 'До 3 часа', inclusions: ['Микрофон', 'Колони'], eventTypeIds: [await eventTypeId('svatba')], ...o,
  };
}

describe('S1 drafts and §12.2 validation', () => {
  it('saves a draft with only a name; a fixed package may still lack its price', async () => {
    const { actor, partner } = await listedPartner();
    const d = await saveDraft(actor, { name: 'Нов пакет' });
    expect(d).toMatchObject({ status: 'draft', priceCents: null, partnerId: partner.id, categoryId: partner.primaryCategoryId });
    expect(await failure(saveDraft(actor, { name: '' }))).toContain('validation');
    const upd = await saveDraft(actor, { id: d.id, name: 'Нов пакет', priceCents: 50_000, inclusions: ['Едно'] });
    expect(upd.priceCents).toBe(50_000);
    expect(await db.select().from(s.serviceInclusion).where(eq(s.serviceInclusion.serviceId, d.id))).toHaveLength(1);
  });

  it('validates kinds, prices, the visible category and the 5-package limit', async () => {
    const { actor } = await listedPartner();
    expect(await failure(submit(actor, await input({ priceCents: null })))).toContain('price required');
    expect(await failure(submit(actor, await input({ kind: 'on_request', priceCents: 1000 })))).toContain('on_request has no price');
    expect(await failure(submit(actor, await input({ minGuests: 50 })))).toContain('minGuests needs per_guest');
    expect(await failure(submit(actor, await input({ extraHourEnabled: true })))).toContain('extra hour price');
    expect(await failure(submit(actor, await input({ categoryId: await categoryId('transport-za-gosti') })))).toContain('category hidden');
    expect(await failure(submit(actor, await input({ eventTypeIds: [] })))).toContain('validation');
    expect(await failure(submit(actor, await input({ inclusions: Array(13).fill('x') })))).toContain('validation');
    // The factory partner has one package; four more fit, the sixth does not.
    for (let i = 0; i < 4; i++) await submit(actor, await input({ name: `Пакет ${i}` }));
    expect(await failure(submit(actor, await input({ name: 'Шести' })))).toContain('max_packages');
    // On-request services and add-ons do not count.
    await submit(actor, await input({ kind: 'on_request', priceCents: null, name: 'По запитване' }));
    await submit(actor, await input({ kind: 'addon', name: 'Допълнителен час', priceCents: 15_000 }));
  });

  it('only the owner partner edits its services', async () => {
    const a = await listedPartner();
    const b = await listedPartner();
    expect(await failure(archive(b.actor, { serviceId: a.service.id }))).toContain('not_found');
    const { actor: client } = await createClient();
    expect(await failure(saveDraft(client, { name: 'x' }))).toContain('ForbiddenError');
  });
});

describe('S2 / S3 / S4 a new service through moderation', () => {
  it('submits for review, is published by moderate_listings, emails at each step', async () => {
    const { actor, partner, user } = await listedPartner();
    const svc = await submit(actor, await input());
    expect(svc.status).toBe('pending_review');
    const [rev] = await db.select().from(s.serviceRevision).where(eq(s.serviceRevision.serviceId, svc.id));
    expect(rev).toMatchObject({ type: 'new', status: 'pending' });
    expect(rev.payload).toMatchObject({ name: 'Пакет „Церемония“', priceCents: 42_000, inclusions: ['Микрофон', 'Колони'] });
    expect(plain((await emails('vendor-service-submitted', user.id))[0].vars)).toEqual({
      serviceName: 'Пакет „Церемония“', serviceKind: 'Пакет с фиксирана цена', category: 'DJ и озвучаване', price: '420,00 €', duration: 'До 3 часа',
    });
    const { actor: support } = await createAdmin('support');
    expect(await failure(publish(support, { revisionId: rev.id }))).toContain('ForbiddenError');
    const { actor: mod } = await createAdmin('moderator');
    expect((await moderationQueue(mod, { filter: 'novi' })).some(r => r.revision.id === rev.id)).toBe(true);
    expect((await moderationQueue(mod, { filter: 'redakcii' })).some(r => r.revision.id === rev.id)).toBe(false);
    await publish(mod, { revisionId: rev.id });
    const [live] = await db.select().from(s.service).where(eq(s.service.id, svc.id));
    expect(live.status).toBe('active');
    expect(live.publishedAt?.getTime()).toBe(NOW.getTime());
    expect(plain((await emails('vendor-service-published', user.id))[0].vars)).toEqual({
      partnerSlug: partner.slug, partnerName: partner.businessName, serviceName: 'Пакет „Церемония“', price: '420,00 €', duration: 'До 3 часа',
    });
    expect(await failure(publish(mod, { revisionId: rev.id }))).toContain('revision_status');
    const [p] = await db.select().from(s.partner).where(eq(s.partner.id, partner.id));
    expect(p.minPriceCents).toBe(42_000);
  });

  it('returns a new service with a note; the partner resubmits', async () => {
    const { actor, user } = await listedPartner();
    const svc = await submit(actor, await input());
    const [rev] = await db.select().from(s.serviceRevision).where(eq(s.serviceRevision.serviceId, svc.id));
    const { actor: admin } = await createAdmin('admin');
    expect(await failure(returnRevision(admin, { revisionId: rev.id, note: '' }))).toContain('note_required');
    await returnRevision(admin, { revisionId: rev.id, note: 'Корицата е с чужд воден знак.' });
    expect((await db.select().from(s.service).where(eq(s.service.id, svc.id)))[0].status).toBe('returned');
    expect((await emails('vendor-service-returned', user.id))[0].vars).toEqual({ serviceId: svc.id, serviceName: 'Пакет „Церемония“', note: 'Корицата е с чужд воден знак.' });
    const again = await submit(actor, { ...(await input()), id: svc.id, description: 'Поправено описание.' });
    expect(again.status).toBe('pending_review');
    const revs = await db.select().from(s.serviceRevision).where(eq(s.serviceRevision.serviceId, svc.id));
    expect(revs.map(r => r.status).sort()).toEqual(['pending', 'returned']);
    expect((await listForPartner(actor)).items.find(i => i.service.id === svc.id)?.tab).toBe('review');
  });

  it('with ⚙ moderation.manual off a new service goes live at once', async () => {
    const { actor, user } = await listedPartner();
    await setSetting('moderation.manual', false, SYSTEM, NOW);
    try {
      const svc = await submit(actor, await input({ name: 'Без модерация' }));
      expect(svc.status).toBe('active');
      expect((await emails('vendor-service-published', user.id)).length).toBe(1);
      expect(await emails('vendor-service-submitted', user.id)).toHaveLength(0);
    } finally {
      // Same effective instant, written later: the newer row wins.
      await setSetting('moderation.manual', true, SYSTEM, NOW);
    }
  });

  it('a draft partner uses the onboarding editor, not S2', async () => {
    const { actor } = await draftPartner();
    expect(await failure(submit(actor, await input()))).toContain('partner_status');
    const svc = await saveOnboarding(actor, { name: 'Пакет', priceCents: 1000, categoryId: await categoryId(), description: 'x' });
    expect(svc.status).toBe('draft');
    await remove(actor, { serviceId: svc.id });
    expect((await db.select().from(s.service).where(eq(s.service.id, svc.id)))[0].status).toBe('archived');
  });
});

describe('S6 / S7 / S8 edits of a live service', () => {
  it('stores a diff, keeps the live version, replaces a pending revision, applies on approval', async () => {
    const { actor, service, user, partner } = await listedPartner();
    const base = { ...(await input()), id: service.id, name: service.name, description: service.description, priceCents: 145_000, durationLabel: 'До 10 часа',
      inclusions: ['DJ за цялото събитие', 'Безжичен микрофон'] };
    expect((await submitChange(actor, base)).revision).toBeNull();
    const first = await submitChange(actor, { ...base, priceCents: 150_000 });
    expect(first.revision?.payload).toEqual({ priceCents: [145_000, 150_000] });
    advanceTestNow(60_000);
    const second = await submitChange(actor, { ...base, priceCents: 155_000, durationLabel: 'До 12 часа' });
    expect(second.revision?.id).toBe(first.revision?.id);
    expect(second.revision?.payload).toEqual({ priceCents: [145_000, 155_000], durationLabel: ['До 10 часа', 'До 12 часа'] });
    expect((await db.select().from(s.service).where(eq(s.service.id, service.id)))[0].priceCents).toBe(145_000);
    expect((await emails('vendor-service-change-submitted', user.id)).length).toBe(2);
    expect((await listForPartner(actor)).items.find(i => i.service.id === service.id)?.statusLabel).toBe('Активна · промените чакат преглед');

    const { actor: mod } = await createAdmin('moderator');
    await approveChange(mod, { revisionId: second.revision!.id });
    const [live] = await db.select().from(s.service).where(eq(s.service.id, service.id));
    expect(live).toMatchObject({ priceCents: 155_000, durationLabel: 'До 12 часа', status: 'active' });
    expect((await emails('vendor-service-change-approved', user.id))[0].vars).toEqual({ partnerSlug: partner.slug, serviceName: service.name });
    expect((await db.select().from(s.partner).where(eq(s.partner.id, partner.id)))[0].minPriceCents).toBe(155_000);
  });

  it('returns an edit with the published and the proposed terms; the toggles apply at once', async () => {
    const { actor, service, user } = await listedPartner({ priceCents: 2800, priceUnit: 'per_guest', category: 'ketaring', serviceName: 'Меню „Градина“' });
    await db.update(s.service).set({ minGuests: 60, durationLabel: null }).where(eq(s.service.id, service.id));
    const base = { ...(await input()), id: service.id, name: 'Меню „Градина“', categoryId: await categoryId('ketaring'), description: service.description,
      priceCents: 2800, priceUnit: 'per_guest' as const, minGuests: 60, durationLabel: null, inclusions: ['DJ за цялото събитие', 'Безжичен микрофон'] };
    const { revision } = await submitChange(actor, { ...base, priceCents: 3200, minGuests: 40, showInProfile: false });
    expect((await db.select().from(s.service).where(eq(s.service.id, service.id)))[0].showInProfile).toBe(false);
    const { actor: admin } = await createAdmin('admin');
    await returnRevision(admin, { revisionId: revision!.id, note: 'Липсва обхват на цената' });
    expect(plain((await emails('vendor-service-change-returned', user.id))[0].vars)).toEqual({
      serviceId: service.id, serviceName: 'Меню „Градина“', category: 'Кетъринг',
      current: '28,00 € на гост · минимум 60 гости', proposed: '32,00 € на гост · минимум 40 гости',
    });
    const [live] = await db.select().from(s.service).where(eq(s.service.id, service.id));
    expect(live).toMatchObject({ priceCents: 2800, minGuests: 60 });
    expect((await listForPartner(actor)).items.find(i => i.service.id === service.id)?.returnedNote).toBe('Липсва обхват на цената');
  });
});

describe('S9 / S10 visibility, archive, order', () => {
  it('hides and shows a published service immediately; never publishes an unpublished draft', async () => {
    const { actor, service, partner } = await listedPartner();
    await setVisibility(actor, { serviceId: service.id, active: false });
    expect((await db.select().from(s.service).where(eq(s.service.id, service.id)))[0].status).toBe('draft');
    expect((await db.select().from(s.partner).where(eq(s.partner.id, partner.id)))[0].minPriceCents).toBeNull();
    await setVisibility(actor, { serviceId: service.id, active: true });
    expect((await db.select().from(s.service).where(eq(s.service.id, service.id)))[0].status).toBe('active');
    const d = await saveDraft(actor, { name: 'Чернова', priceCents: 1000 });
    expect(await failure(setVisibility(actor, { serviceId: d.id, active: true }))).toContain('not_published');
  });

  it('archives (the pending change leaves the queue), toggles and reorders', async () => {
    const { actor, service } = await listedPartner();
    const other = await submit(actor, await input({ name: 'Втори' }));
    const base = { ...(await input()), id: service.id, name: service.name, description: service.description, priceCents: 145_000, durationLabel: 'До 10 часа',
      inclusions: ['DJ за цялото събитие', 'Безжичен микрофон'] };
    await submitChange(actor, { ...base, priceCents: 99_000 });
    await archive(actor, { serviceId: service.id });
    expect((await db.select().from(s.service).where(eq(s.service.id, service.id)))[0].status).toBe('archived');
    expect(await db.select().from(s.serviceRevision).where(and(eq(s.serviceRevision.serviceId, service.id), eq(s.serviceRevision.status, 'pending')))).toHaveLength(0);
    await setToggles(actor, { serviceId: other.id, acceptingRequests: false });
    expect((await db.select().from(s.service).where(eq(s.service.id, other.id)))[0].acceptingRequests).toBe(false);
    await reorder(actor, { serviceIds: [other.id, service.id] });
    expect((await db.select().from(s.service).where(eq(s.service.id, other.id)))[0].sortOrder).toBe(0);
    const cover = await mediaRow((await createClient()).user.id, 'service_cover');
    expect(await failure(saveDraft(actor, { name: 'x', coverMediaId: cover.id }))).toContain('media_not_owned');
  });

  it('prices read ‹По оферта› on request', () => {
    expect(priceText({ kind: 'on_request', priceCents: null, priceUnit: 'per_event' })).toBe('По оферта');
    expect(plain(priceText({ kind: 'package_fixed', priceCents: 2400, priceUnit: 'per_guest' }))).toBe('24,00 € на гост');
  });
});
