// Test fixture for tests/e2e/partner-onboarding.py: a partner fresh from sign-up (P1 + P2),
// i.e. a `draft` partner with a verified email, exactly what /registratsiya?as=partner leaves.
// With --complete steps 1–5 are filled in through the domain (P3); with --submitted the
// application is also submitted (P4).
//   npx tsx --conditions=react-server tests/e2e/onboarding-setup.ts <email> [businessName] [contactName] [phone] [--complete|--submitted]
// Prints the partner id. Local databases only.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const args = process.argv.slice(2);
const submitted = args.includes('--submitted');
const complete = submitted || args.includes('--complete');
const [email, businessName = 'Студио Тест', contactName = 'Иван Петров', phone = '+359887001122'] = args.filter(a => !a.startsWith('--'));
if (!email) { console.error('usage: onboarding-setup.ts <email> [businessName] [contactName] [phone] [--complete|--submitted]'); process.exit(1); }

const { isLocalUrl, DEFAULT_URL } = await import('../../scripts/lib/schema-sync');
if (!isLocalUrl(process.env.DATABASE_URL ?? DEFAULT_URL)) { console.error('Refusing a non-local database'); process.exit(1); }

const { eq } = await import('drizzle-orm');
const { hashPassword } = await import('better-auth/crypto');
const { db, sql } = await import('../../db');
const s = await import('../../db/schema');
const partners = await import('../../lib/domain/partners');
const services = await import('../../lib/domain/services');
const { actorFromUser } = await import('../../lib/domain/actor');
const availability = await import('../../lib/domain/availability');
const { photo } = await import('../../scripts/seed/photos');
const { now } = await import('../../lib/clock');

try {
  const at = await now();
  const id = randomUUID();
  await db.insert(s.user).values({ id, name: contactName, email: email.toLowerCase(), emailVerified: true, role: 'client', createdAt: at, updatedAt: at });
  await db.insert(s.account).values({ id: randomUUID(), accountId: id, providerId: 'credential', userId: id, password: await hashPassword('eventat-demo'), createdAt: at, updatedAt: at });
  const p = await partners.register({ userId: id, businessName, contactName, phone, email, consent: true });

  if (complete) {
    const actor = await actorFromUser({ id, role: 'partner' });
    // The demo's photo files, recorded as this partner's uploads.
    const media = async (kind: 'partner_avatar' | 'partner_cover' | 'gallery', name: string) => {
      const ph = photo(name);
      const [m] = await db.insert(s.media).values({
        ownerUserId: id, kind, storageKey: ph.storageKey, mime: 'image/jpeg', sizeBytes: ph.sizeBytes, width: ph.width, height: ph.height, isPublic: true, createdAt: at,
      }).returning({ id: s.media.id });
      return m.id;
    };
    const cat = (await db.select().from(s.category).where(eq(s.category.slug, 'dj-i-ozvuchavane')))[0].id;
    const sofia = (await db.select().from(s.city).where(eq(s.city.slug, 'sofia')))[0].id;
    const types = await db.select().from(s.eventType);
    const type = (slug: string) => types.find(t => t.slug === slug)!.id;
    await partners.saveStep(actor, { step: 1, data: {
      businessName, legalForm: 'eood', eik: '204512384', primaryCategoryId: cat, cityId: sofia, radius: 150, experienceBand: 'gt_10',
      languages: ['Български', 'английски'], contactName, notificationEmail: email, phone, socialHandle: '@studio.test',
    } });
    for (const n of ['v1-dj-mod', 'v1-dj-perf', 'v1-dj-party', 'v1-dj-setup', 'v1-dj-bright']) await partners.addPhoto(actor, { mediaId: await media('gallery', n) });
    await partners.saveStep(actor, { step: 2, data: {
      avatarMediaId: await media('partner_avatar', 'v1-dj-doc'), coverMediaId: await media('partner_cover', 'v1-dj-mod'),
      shortDescription: 'DJ, озвучаване и диско осветление за сватби, рождени дни и фирмени събития в София и страната.',
      description: 'Над 12 години озвучаваме сватби, рождени дни и фирмени събития в София и страната. Работим с професионална техника, съобразяваме плейлиста с вашия вкус и водим събитието спокойно — без излишно шоу. Идваме на оглед на залата преди деня на събитието.',
      eventTypeIds: [type('svatba'), type('rozhden-den'), type('firmeno-sabitie')],
      tags: [{ label: 'Озвучаване', isCustom: false }, { label: 'Диско осветление', isCustom: false }],
    } });
    await services.saveOnboarding(actor, {
      kind: 'package_fixed', name: 'Пакет „Цял ден“', categoryId: cat, description: 'DJ за церемонията и партито, озвучаване и диско осветление.', priceCents: 145000,
      durationLabel: 'До 10 часа', extraHourEnabled: true, extraHourPriceCents: 15000, travelFeeEnabled: true,
      inclusions: ['DJ за церемонията и партито', 'Озвучаване до 250 гости', 'Диско осветление и дим', 'Два безжични микрофона', 'Оглед на залата преди събитието'],
    });
    await services.saveOnboarding(actor, { kind: 'package_fixed', name: 'Пакет „Вечер“', categoryId: cat, description: 'Музика и озвучаване за вечерното парти.', priceCents: 64000, durationLabel: '5 часа' });
    await services.saveOnboarding(actor, { kind: 'on_request', name: 'Фирмени събития', categoryId: cat, description: 'Озвучаване, сцена, техник на място' });
    await partners.saveStep(actor, { step: 3, data: { offersFixedPackages: true, offersOnRequest: true } });
    await partners.saveStep(actor, { step: 4, data: { bookingsPerDayMode: 'one', leadTimeDays: 7, horizonMonths: 24, workingDays: [1, 2, 3, 4, 5, 6, 7] } });
    await availability.blockRange(actor, { from: '2025-09-17', to: '2025-09-18' });
    await partners.saveStep(actor, { step: 5, data: { cancellationPolicy: 'moderate', depositPercent: 30, reschedulePolicy: 'free_if_available' } });
    if (submitted) await partners.submitApplication(actor, { acceptTerms: true, confirmInfo: true });
  }
  console.log(p.id);
} finally {
  await sql.end({ timeout: 5 });
}
