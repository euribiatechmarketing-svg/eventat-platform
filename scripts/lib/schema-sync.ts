// Dev/test schema sync, shared by scripts/reset.ts, scripts/migrate.ts and the
// vitest global setup. Until launch there are no incremental migrations: a
// database gets the current schema from `drizzle-kit push --force`, then the
// custom SQL in db/sql/*.sql (triggers, exclusion constraints — everything
// Drizzle can't express), in file-name order. Extensions are created first
// because the schema's indexes need them (gin_trgm_ops).
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SQL_DIR = join(ROOT, 'db/sql');
export const DEFAULT_URL = 'postgres://eventat:eventat@127.0.0.1:54329/eventat';
export const EXTENSIONS = ['citext', 'pgcrypto', 'btree_gist', 'pg_trgm'] as const;

type Sql = postgres.Sql;
const connect = (url: string): Sql => postgres(url, { max: 1, onnotice: () => {} });

export const redact = (url: string) => url.replace(/:[^:@/]+@/, ':***@');
export const isLocalUrl = (url: string) => ['127.0.0.1', 'localhost', '[::1]', '::1'].includes(new URL(url).hostname);
/**
 * A database the destructive scripts (reset, seed) may touch: this machine, or the one staging host named
 * explicitly in STAGING_DB_HOST (docs/DEPLOY.md, demo/staging). Production never sets it.
 */
export const isResettableUrl = (url: string) =>
  isLocalUrl(url) || (!!process.env.STAGING_DB_HOST && new URL(url).hostname === process.env.STAGING_DB_HOST);

/** The URL of another database on the same server (e.g. 'postgres' for admin work). */
export function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.toString();
}

export function databaseName(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

export async function createExtensions(sql: Sql) {
  for (const e of EXTENSIONS) await sql.unsafe(`create extension if not exists ${e}`);
}

/** `drizzle-kit push --force` against `url`. drizzle-kit swallows SQL errors (exit 0), so its output is checked too. */
export function pushSchema(url: string) {
  const bin = join(ROOT, 'node_modules/drizzle-kit/bin.cjs');
  const r = spawnSync(process.execPath, [bin, 'push', '--force'], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, DATABASE_URL: url, FORCE_COLOR: '0' },
  });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0 || /error|exception/i.test(r.stderr ?? '')) {
    throw new Error(`drizzle-kit push failed for ${redact(url)}:\n${out}`);
  }
}

/** Run every db/sql/*.sql file in name order. Each file is idempotent. */
export async function applySqlFiles(sql: Sql): Promise<string[]> {
  const files = readdirSync(SQL_DIR).filter(f => f.endsWith('.sql')).sort();
  for (const f of files) {
    try { await sql.unsafe(readFileSync(join(SQL_DIR, f), 'utf8')); }
    catch (e) { throw new Error(`db/sql/${f}: ${(e as Error).message}`); }
  }
  return files;
}

/** Every table of the Drizzle schema exists (catches a push that stopped half-way). */
export async function verifySchema(sql: Sql) {
  const expected = Object.values(schema).filter(v => is(v, PgTable)).map(t => getTableName(t as PgTable));
  const rows = await sql<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = 'public'`;
  const have = new Set(rows.map(r => r.table_name));
  const missing = expected.filter(t => !have.has(t));
  if (missing.length) throw new Error(`Schema push incomplete; missing tables: ${missing.join(', ')}`);
  return expected.length;
}

/** Extensions → push → db/sql → verify, on an empty (or freshly dropped) public schema. */
export async function syncSchema(url: string): Promise<{ tables: number; sqlFiles: string[] }> {
  const sql = connect(url);
  try {
    await createExtensions(sql);
    pushSchema(url);
    const sqlFiles = await applySqlFiles(sql);
    const tables = await verifySchema(sql);
    return { tables, sqlFiles };
  } finally {
    await sql.end();
  }
}

/** Drop everything in `url` and apply the current schema. Local databases only. */
export async function resetDatabase(url: string) {
  if (!isResettableUrl(url)) throw new Error(`Refusing to reset a non-local database: ${redact(url)} (staging: set STAGING_DB_HOST to its host)`);
  const sql = connect(url);
  try {
    await sql.unsafe('drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;');
  } finally {
    await sql.end();
  }
  return syncSchema(url);
}

/** Create a database if it does not exist (connects to the server's `postgres` database). */
export async function ensureDatabase(url: string) {
  const name = databaseName(url);
  if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Bad database name: ${name}`);
  const admin = connect(withDatabase(url, 'postgres'));
  try {
    const exists = await admin`select 1 from pg_database where datname = ${name}`;
    if (!exists.length) await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }
}
