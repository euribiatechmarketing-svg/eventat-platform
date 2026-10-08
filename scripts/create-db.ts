// Create the database named in DATABASE_URL on the local server, if missing.
import postgres from 'postgres';

const url = new URL(process.env.DATABASE_URL ?? 'postgres://eventat:eventat@127.0.0.1:54329/eventat');
const name = url.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(name)) throw new Error(`Bad database name: ${name}`);
const admin = new URL(url); admin.pathname = '/postgres';
const sql = postgres(admin.toString(), { max: 1, onnotice: () => {} });
const exists = await sql`select 1 from pg_database where datname = ${name}`;
if (!exists.length) { await sql.unsafe(`create database ${name}`); console.log('created', name); } else console.log('exists', name);
await sql.end();
