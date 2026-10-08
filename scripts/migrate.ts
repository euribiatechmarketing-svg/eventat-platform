// Apply db/migrations to DATABASE_URL (production path, once the init
// migration exists), then re-apply the idempotent custom SQL in db/sql/*.sql.
// Extensions are created first because the schema's indexes need them.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { ROOT, DEFAULT_URL, applySqlFiles, createExtensions, redact } from './lib/schema-sync';

const url = process.env.DATABASE_URL ?? DEFAULT_URL;
const migrationsFolder = join(ROOT, 'db/migrations');
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await createExtensions(sql);
  if (existsSync(join(migrationsFolder, 'meta/_journal.json'))) {
    await migrate(drizzle(sql), { migrationsFolder });
    console.log('migrations applied to', redact(url));
    const files = await applySqlFiles(sql);
    console.log('custom sql applied:', files.join(', '));
  } else {
    console.log('no db/migrations yet: use `npm run db:reset` (push + db/sql) until the init migration is generated');
  }
} catch (e) {
  console.error((e as Error).message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
