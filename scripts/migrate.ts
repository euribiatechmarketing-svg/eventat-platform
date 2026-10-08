// Apply db/migrations to DATABASE_URL.
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

const url = process.env.DATABASE_URL ?? 'postgres://eventat:eventat@127.0.0.1:54329/eventat';
const sql = postgres(url, { max: 1, onnotice: () => {} });
await migrate(drizzle(sql), { migrationsFolder: './db/migrations' });
await sql.end();
console.log('migrations applied to', url.replace(/:[^:@/]+@/, ':***@'));
