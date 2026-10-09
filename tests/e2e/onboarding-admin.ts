// Test helper for tests/e2e/partner-onboarding.py: the team's decision on an application
// (SPEC §4.2 P5–P7) taken through the domain as the seeded admin Моника Ковачева.
//   npx tsx --conditions=react-server tests/e2e/onboarding-admin.ts approve|return|reject <partner email> [note]
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const [verb, email, note = 'Моля, добавете снимки от ваши събития.'] = process.argv.slice(2);
if (!['approve', 'return', 'reject'].includes(verb) || !email) { console.error('usage: onboarding-admin.ts approve|return|reject <email> [note]'); process.exit(1); }

const { isLocalUrl, DEFAULT_URL } = await import('../../scripts/lib/schema-sync');
if (!isLocalUrl(process.env.DATABASE_URL ?? DEFAULT_URL)) { console.error('Refusing a non-local database'); process.exit(1); }

const { eq } = await import('drizzle-orm');
const { db, sql } = await import('../../db');
const s = await import('../../db/schema');
const { actorFromUser } = await import('../../lib/domain/actor');
const partners = await import('../../lib/domain/partners');

try {
  const [admin] = await db.select().from(s.user).where(eq(s.user.email, 'monika.kovacheva@eventat.bg'));
  const actor = await actorFromUser({ id: admin.id, role: 'admin' });
  const [row] = await db.select({ id: s.partner.id }).from(s.partnerMember)
    .innerJoin(s.user, eq(s.user.id, s.partnerMember.userId)).innerJoin(s.partner, eq(s.partner.id, s.partnerMember.partnerId))
    .where(eq(s.user.email, email.toLowerCase()));
  if (!row) throw new Error(`no partner for ${email}`);
  if (verb === 'approve') await partners.approve(actor, { partnerId: row.id });
  if (verb === 'return') await partners.returnApplication(actor, { partnerId: row.id, note });
  if (verb === 'reject') await partners.reject(actor, { partnerId: row.id, note });
  console.log(verb, row.id);
} finally {
  await sql.end({ timeout: 5 });
}
