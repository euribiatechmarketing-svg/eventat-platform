import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';

export type Role = 'client' | 'partner' | 'admin';
export type CurrentUser = { id: string; name: string; email: string; role: Role; phone: string | null; emailVerified: boolean; image: string | null };

/** The signed-in user for this request, or null. Cached per request. */
export const currentUser = cache(async (): Promise<CurrentUser | null> => {
  const s = await auth.api.getSession({ headers: await headers() });
  if (!s) return null;
  const u = s.user as typeof s.user & { role?: Role; phone?: string | null };
  return { id: u.id, name: u.name, email: u.email, role: (u.role ?? 'client') as Role, phone: u.phone ?? null, emailVerified: u.emailVerified, image: u.image ?? null };
});

/** Guard for pages and server actions. Guests go to sign-in and come back. */
export async function requireUser(next?: string): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) redirect(`/vhod${next ? `?next=${encodeURIComponent(next)}` : ''}`);
  return u;
}

export async function requireRole(role: Role | Role[], next?: string): Promise<CurrentUser> {
  const u = await requireUser(next);
  const ok = Array.isArray(role) ? role.includes(u.role) : u.role === role;
  if (!ok) redirect(u.role === 'admin' ? '/admin' : u.role === 'partner' ? '/partner' : '/akaunt');
  return u;
}
