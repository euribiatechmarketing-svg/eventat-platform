import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// One connection pool per process. In dev, Next.js hot reload re-imports
// modules, so the pool is parked on globalThis instead of re-created.
const url = process.env.DATABASE_URL ?? 'postgres://eventat:eventat@127.0.0.1:54329/eventat';

type G = { __eventatSql?: postgres.Sql; __eventatDb?: PostgresJsDatabase<typeof schema> };
const g = globalThis as G;

export const sql =
  g.__eventatSql ??
  postgres(url, {
    max: process.env.VERCEL ? 3 : 10,
    prepare: false, // required by Neon's pooled (pgbouncer) endpoint
    onnotice: () => {},
  });

export const db = g.__eventatDb ?? drizzle(sql, { schema, casing: 'snake_case' });

if (process.env.NODE_ENV !== 'production') { g.__eventatSql = sql; g.__eventatDb = db; }

export type DB = typeof db;
/** A transaction handle has the same query API as db. */
export type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
export { schema };
