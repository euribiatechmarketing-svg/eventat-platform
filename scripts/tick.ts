// npm run tick — one cron tick by hand: run every job due at the platform clock's "now", then
// deliver the queued emails. Production runs the same through Vercel Cron → /api/cron/tick.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// .env.local fills in what the shell has not set (DATABASE_URL, ALLOW_TIME_TRAVEL…), as for the seed.
const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);

// Imported after the environment is loaded: db/index.ts reads DATABASE_URL at import time.
const { runDueJobs } = await import('../lib/jobs');
const { deliverQueued } = await import('../lib/email/send');
const { purgeUnlinkedMedia } = await import('../lib/domain/media');
const { pruneThrottle } = await import('../lib/domain/throttle');
const { sql } = await import('../db');

try {
  const jobs = await runDueJobs();
  const emails = await deliverQueued();
  const purged = await purgeUnlinkedMedia();
  await pruneThrottle();
  console.log(`tick: ${jobs.ran} job(s) ran, ${jobs.failed} failed; ${emails} email(s) delivered; ${purged} unlinked upload(s) removed`);
} finally {
  await sql.end({ timeout: 5 });
}
