import 'server-only';
// Guards for the client's requests, bookings and the booking flow (SCREENS §0, §5):
// guests sign in (account pages) or register (booking flow) and come back to
// the same URL; partners and admins go to their own home.
import { notFound, redirect } from 'next/navigation';
import { actorFromUser, type Actor } from '@/lib/domain/actor';
import { LifecycleError } from '@/lib/domain/bookings';
import { currentUser, type CurrentUser } from '@/lib/session';

export async function requireClient(next: string, guest: 'vhod' | 'registratsiya' = 'vhod'): Promise<{ user: CurrentUser; actor: Actor }> {
  const u = await currentUser();
  if (!u) redirect(`/${guest}?next=${encodeURIComponent(next)}`);
  if (u.role !== 'client') redirect(u.role === 'admin' ? '/admin' : '/partner');
  return { user: u, actor: await actorFromUser(u) };
}

/** Rebuild `path?query` from a page's searchParams (for `?next=`). */
export function withQuery(path: string, sp: Record<string, string | string[] | undefined>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (Array.isArray(v)) v.forEach(x => u.append(k, x));
    else if (v != null) u.set(k, v);
  }
  const s = u.toString();
  return s ? `${path}?${s}` : path;
}

/** A read model that throws `not_found` for someone else's record → 404 (SCREENS §0). */
export async function orNotFound<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) {
    if (e instanceof LifecycleError && e.code === 'not_found') notFound();
    if (e instanceof Error && /not.?found/i.test(e.message) && (e as { code?: string }).code === 'not_found') notFound();
    throw e;
  }
}

export const one = (v: string | string[] | undefined): string | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

/** The `[nomer]` route param as stored (`2026-0614-ЕА`), whether or not Next has decoded it. */
export function numberParam(raw: string): string {
  try { return decodeURIComponent(raw); } catch { return raw; }
}
