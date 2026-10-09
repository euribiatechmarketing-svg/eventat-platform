import 'server-only';
// Helpers shared by the admin money screens' pages and server actions.
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser, can, type Actor, type TeamPermission } from '@/lib/domain/actor';
import { isRefusal, refusalText } from '@/lib/domain/views-admin-money';
import { setFlash } from '@/lib/flash';
import { deliverQueued } from '@/lib/email/send';

/** The signed-in team member as a domain Actor; without the permission → the admin home. */
export async function adminActor(next: string, permission?: TeamPermission): Promise<Actor> {
  const u = await requireRole('admin', next);
  const actor = await actorFromUser(u);
  if (!actor.teamRole) redirect('/');
  if (permission && !can(actor, permission)) redirect('/admin');
  return actor;
}

/** A same-area return path from a form field (never an outside URL). */
export function backTo(v: FormDataEntryValue | null | undefined, fallback: string): string {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/admin') && !s.startsWith('//') && !s.includes('\\') ? s : fallback;
}

/** Flash the refusal and go back; rethrow anything else (bugs surface). */
export async function refuse(e: unknown, back: string): Promise<never> {
  if (!isRefusal(e)) throw e;
  await setFlash(refusalText(e), 'error');
  redirect(back);
}

export const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v : '');
export const bookingPath = (n: string) => `/admin/rezervacii/${encodeURIComponent(n)}`;
export const casePath = (n: string) => `/admin/sporove/${encodeURIComponent(n)}`;
/** Booking / dispute numbers: YYYY-MMDD-XX (Cyrillic letters, D2). */
export const NUMBER_RE = /^\d{4}-\d{4}-[А-ЯA-Z]{2}$/;

/** Emails queued by the action's transaction go out now (the cron tick retries anything left). */
export async function deliverNow(): Promise<void> {
  await deliverQueued(25).catch(() => 0);
}
