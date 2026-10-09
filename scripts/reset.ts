// Drop and recreate the public schema of DATABASE_URL, then apply the current
// schema: extensions → `drizzle-kit push --force` → db/sql/*.sql (name order).
// Local databases only. Until launch there are no incremental migrations.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_URL, redact, resetDatabase } from './lib/schema-sync';

// Like the seed: .env.local fills in DATABASE_URL when the shell has not set it, so a
// worker in its own worktree resets its own database, never the shared default one.
const envFile = fileURLToPath(new URL('../.env.local', import.meta.url));
if (!process.env.DATABASE_URL && existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.DATABASE_URL ?? DEFAULT_URL;
try {
  const r = await resetDatabase(url);
  console.log(`schema reset: ${r.tables} tables, sql ${r.sqlFiles.join(', ')} — ${redact(url)}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
