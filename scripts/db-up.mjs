// Local development database: a real PostgreSQL 17 server from the
// embedded-postgres package, kept in .data/pg. Production uses Neon
// (DATABASE_URL); nothing in the app knows the difference.
// Usage: npm run db:up            (foreground; Ctrl+C stops it)
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'node:fs';

const dir = new URL('../.data/pg', import.meta.url).pathname;
const port = Number(process.env.PGPORT_LOCAL || 54329);
const pg = new EmbeddedPostgres({
  databaseDir: dir, user: 'eventat', password: 'eventat', port, persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
});
if (!existsSync(dir + '/PG_VERSION')) await pg.initialise();
await pg.start();
for (const db of ['eventat', 'eventat_test']) {
  try { await pg.createDatabase(db); } catch { /* exists */ }
}
console.log(`postgres ready on ${port} — DATABASE_URL=postgres://eventat:eventat@127.0.0.1:${port}/eventat`);
const stop = async () => { await pg.stop(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
setInterval(() => {}, 1 << 30);
