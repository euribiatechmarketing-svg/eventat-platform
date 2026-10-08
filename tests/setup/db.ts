// vitest setupFiles: runs in each test file's worker before the file is
// imported. Clones a fresh database from the template, points DATABASE_URL at
// it before anything imports '@/db', and drops it when the file is done.
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, inject } from 'vitest';

const { serverUrl, template, prefix } = inject('testDb');
const name = `${prefix}_${randomBytes(4).toString('hex')}`;

const admin = postgres(serverUrl, { max: 1, onnotice: () => {} });
await admin.unsafe(`create database ${name} template ${template}`);
await admin.end();

const url = new URL(serverUrl);
url.pathname = `/${name}`;
process.env.DATABASE_URL = url.toString();

afterAll(async () => {
  // db/index.ts parks its pool on globalThis outside production: close it and forget it.
  const g = globalThis as { __eventatSql?: { end: (o?: { timeout?: number }) => Promise<void> }; __eventatDb?: unknown };
  if (g.__eventatSql) await g.__eventatSql.end({ timeout: 5 });
  delete g.__eventatSql;
  delete g.__eventatDb;
  const sql = postgres(serverUrl, { max: 1, onnotice: () => {} });
  try {
    await sql.unsafe(`drop database if exists ${name} with (force)`);
  } finally {
    await sql.end();
  }
});
