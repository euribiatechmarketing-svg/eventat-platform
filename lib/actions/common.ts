'use server';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { and, eq, isNull } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/db';
import { notification } from '@/db/schema';
import { currentUser } from '@/lib/session';
import { now } from '@/lib/clock';

export async function signOutAction() {
  await auth.api.signOut({ headers: await headers() });
  redirect('/');
}

export async function markNotificationsRead() {
  const u = await currentUser();
  if (!u) return;
  await db.update(notification).set({ readAt: await now() }).where(and(eq(notification.userId, u.id), isNull(notification.readAt)));
}
