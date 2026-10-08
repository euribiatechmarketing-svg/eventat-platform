import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { notification } from '@/db/schema';
import type { BellItem } from '@/components/ui/Bell';

export async function bellItems(userId: string): Promise<BellItem[]> {
  const rows = await db.select().from(notification).where(eq(notification.userId, userId)).orderBy(desc(notification.createdAt)).limit(8);
  return rows.map(r => ({ id: r.id, title: r.title, body: r.body, href: r.href, unread: !r.readAt }));
}
