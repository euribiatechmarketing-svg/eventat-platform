// npm run db:seed [-- --force]
// The prototype's demo data (DATA-MODEL §3) into DATABASE_URL. Local databases
// only. Refuses a database that already has users unless --force, which first
// truncates every table. Needs ALLOW_TIME_TRAVEL=true for the demo clock
// (now() = Sunday 31 August 2025, 12:00 Sofia).
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// .env.local fills in what the shell has not set (DATABASE_URL, ALLOW_TIME_TRAVEL…).
const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

const force = process.argv.includes('--force');

// Imported after the environment is loaded: db/index.ts reads DATABASE_URL at import time.
const { DEFAULT_URL, isResettableUrl, redact } = await import('./lib/schema-sync');
const url = process.env.DATABASE_URL ?? DEFAULT_URL;
if (!isResettableUrl(url)) {
  console.error(`Refusing to seed a non-local database: ${redact(url)} (staging: set STAGING_DB_HOST to its host)`);
  process.exit(1);
}
if (process.env.ALLOW_TIME_TRAVEL !== 'true') {
  console.warn('ALLOW_TIME_TRAVEL is not "true": the clock offset is stored, but now() stays real time, so the demo countdowns will not match.');
}

const { seedDemo, SeedRefusedError } = await import('./seed/run');
const { DEMO_PASSWORD } = await import('./seed/data');
const { JOB_HANDLERS } = await import('../lib/jobs/handlers');
const { sql } = await import('../db');

try {
  const r = await seedDemo({ force, log: line => console.log(line) });
  const kinds = [...new Set(r.jobs.map(j => j.kind))];
  console.log(`seeded ${redact(url)}: ${r.users.length} users, ${r.jobs.length} pending jobs`);
  const unhandled = kinds.filter(k => !(k in JOB_HANDLERS));
  if (unhandled.length) console.warn(`job kinds without a registered handler yet: ${unhandled.join(', ')}`);
  console.log(`demo logins (password ${DEMO_PASSWORD}): maria.dimitrova@gmail.com · studio.melodia@gmail.com · monika.kovacheva@eventat.bg`);
} catch (e) {
  console.error(e instanceof SeedRefusedError ? e.message : e);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
