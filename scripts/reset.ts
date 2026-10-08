// Drop and recreate the public schema of DATABASE_URL, then apply the current
// schema: extensions → `drizzle-kit push --force` → db/sql/*.sql (name order).
// Local databases only. Until launch there are no incremental migrations.
import { DEFAULT_URL, redact, resetDatabase } from './lib/schema-sync';

const url = process.env.DATABASE_URL ?? DEFAULT_URL;
try {
  const r = await resetDatabase(url);
  console.log(`schema reset: ${r.tables} tables, sql ${r.sqlFiles.join(', ')} — ${redact(url)}`);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}
