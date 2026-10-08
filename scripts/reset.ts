// Drop and recreate the public schema, then migrate. Local/test databases only.
import postgres from 'postgres';
import { execSync } from 'node:child_process';

const url = process.env.DATABASE_URL ?? 'postgres://eventat:eventat@127.0.0.1:54329/eventat';
if (!/127\.0\.0\.1|localhost/.test(url)) { console.error('Refusing to reset a non-local database.'); process.exit(1); }
const sql = postgres(url, { max: 1, onnotice: () => {} });
await sql.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
await sql.end();
execSync('npx tsx scripts/migrate.ts', { stdio: 'inherit', env: process.env });
