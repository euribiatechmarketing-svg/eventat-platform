import 'server-only';
import { db, type Tx } from '@/db';
import { notification } from '@/db/schema';

/** Add an item to a user's bell. */
export async function notify(userId: string, n: { kind: string; title: string; body?: string; href?: string }, tx?: Tx) {
  await (tx ?? db).insert(notification).values({ userId, kind: n.kind, title: n.title, body: n.body ?? null, href: n.href ?? null });
}
