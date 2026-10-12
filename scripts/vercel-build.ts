// Vercel build entry (package.json "vercel-build"). Before `next build`:
//  1. applies the database migrations (idempotent) when DATABASE_URL is set — prefers Neon's direct
//     (unpooled) connection for DDL;
//  2. on a STAGING deployment only (STAGING_SEED=true), loads the prototype demo data once, when the
//     database has no users yet. Production never sets STAGING_SEED, and the seed refuses to run with a
//     real email transport, so demo addresses can never be mailed.
// No credentials pass through a person's laptop: Vercel already holds them.
import { execSync } from 'node:child_process';
import postgres from 'postgres';

const env = { ...process.env };
const url = env.DATABASE_URL_UNPOOLED || env.POSTGRES_URL_NON_POOLING || env.DATABASE_URL;
const run = (cmd: string, extra: Record<string, string> = {}) => execSync(cmd, { stdio: 'inherit', env: { ...env, ...extra } });

if (!url) {
  console.log('vercel-build: no DATABASE_URL — skipping migrations');
} else {
  run('npx tsx scripts/migrate.ts', { DATABASE_URL: url });
  if (env.STAGING_SEED === 'true') {
    if ((env.EMAIL_TRANSPORT ?? 'outbox') !== 'outbox' && !env.EMAIL_ALLOWLIST?.trim())
      throw new Error('STAGING_SEED needs EMAIL_TRANSPORT=outbox, or EMAIL_ALLOWLIST so demo addresses get no mail');
    const sql = postgres(url, { max: 1, onnotice: () => {} });
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from "user"`;
    await sql.end();
    if (n === 0) {
      console.log('vercel-build: empty staging database — loading the demo data');
      // The seed itself sends nothing; it runs with the outbox transport whatever the deployment uses.
      run('npx tsx --conditions=react-server scripts/seed.ts', { DATABASE_URL: url, STAGING_DB_HOST: new URL(url).hostname, EMAIL_TRANSPORT: 'outbox' });
    } else {
      console.log(`vercel-build: staging database already has ${n} users — keeping its data`);
    }
  }
}
run('npx next build');
