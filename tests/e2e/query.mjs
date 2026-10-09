// Test helper: run one read-only SQL query against DATABASE_URL (.env.local) and print JSON rows.
//   node tests/e2e/query.mjs "select ..."
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
const url = process.env.DATABASE_URL ?? 'postgres://eventat:eventat@127.0.0.1:54329/eventat';
if (!['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) { console.error('Refusing a non-local database'); process.exit(1); }
const sql = postgres(url, { onnotice: () => {} });
try {
  const rows = await sql.begin('read only', tx => tx.unsafe(process.argv[2]));
  console.log(JSON.stringify(rows));
} finally {
  await sql.end({ timeout: 5 });
}
