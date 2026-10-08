// vitest globalSetup: (re)build the template database once per run from the
// current schema — extensions, `drizzle-kit push --force`, db/sql/*.sql —
// then hand its name to tests/setup/db.ts, which clones one database per
// test file from it.
//
// Template name: $TEST_TEMPLATE_DB, else `<database of DATABASE_URL>_tpl`
// (`eventat_tpl` when DATABASE_URL is unset or names `eventat`). Workers
// with their own DATABASE_URL therefore never rebuild each other's template.
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import type { TestProject } from 'vitest/node';
import { DEFAULT_URL, databaseName, isLocalUrl, redact, syncSchema, withDatabase } from '../../scripts/lib/schema-sync';

declare module 'vitest' {
  export interface ProvidedContext {
    testDb: { serverUrl: string; template: string; prefix: string };
  }
}

export default async function setup(project: TestProject) {
  const base = process.env.DATABASE_URL ?? DEFAULT_URL;
  if (!isLocalUrl(base)) throw new Error(`Tests only run against a local PostgreSQL server, not ${redact(base)}`);
  const baseName = databaseName(base) || 'eventat';
  const template = process.env.TEST_TEMPLATE_DB ?? `${baseName}_tpl`;
  if (!/^[a-z0-9_]+$/.test(template)) throw new Error(`Bad template database name: ${template}`);
  const prefix = `${baseName}_t_${randomBytes(3).toString('hex')}`;
  const serverUrl = withDatabase(base, 'postgres');

  // Runs that share a template serialise: the rebuild takes an exclusive
  // advisory lock, and each run then holds a shared one until it ends, so
  // nobody drops a template another run is still cloning from.
  const lock = postgres(serverUrl, { max: 1, onnotice: () => {}, idle_timeout: 0, max_lifetime: 24 * 3600 });
  await lock`select pg_advisory_lock(hashtext(${template}))`;
  try {
    await lock.unsafe(`drop database if exists ${template} with (force)`);
    await lock.unsafe(`create database ${template}`);
    await syncSchema(withDatabase(base, template));
    await lock`select pg_advisory_lock_shared(hashtext(${template}))`;
  } finally {
    await lock`select pg_advisory_unlock(hashtext(${template}))`;
  }

  project.provide('testDb', { serverUrl, template, prefix });

  return async () => {
    try {
      // Drop any per-file database a crashed worker left behind in this run.
      const left = await lock<{ datname: string }[]>`select datname from pg_database where datname like ${`${prefix}_%`}`;
      for (const { datname } of left) await lock.unsafe(`drop database if exists ${datname} with (force)`);
    } finally {
      await lock.end(); // releases the shared lock
    }
  };
}
