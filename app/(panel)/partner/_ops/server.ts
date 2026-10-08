import 'server-only';
// Helpers shared by the partner operations server actions (requests, bookings, calendar, dashboard).
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/session';
import { actorFromUser, type Actor } from '@/lib/domain/actor';
import { setFlash } from '@/lib/flash';

/** The signed-in partner as a domain Actor (guard: role partner with a partner). */
export async function partnerActor(next = '/partner'): Promise<Actor & { partnerId: string }> {
  const u = await requireRole('partner', next);
  const actor = await actorFromUser(u);
  if (!actor.partnerId) redirect('/registratsiya?as=partner');
  return actor as Actor & { partnerId: string };
}

/** A same-area return path from a form field (never an outside URL). */
export function backTo(v: FormDataEntryValue | null | undefined, fallback: string): string {
  const s = typeof v === 'string' ? v : '';
  return s.startsWith('/partner') && !s.startsWith('//') && !s.includes('\\') ? s : fallback;
}

/** Screen copy for a refused action (domain errors carry a stable `code`). */
export function errorText(e: unknown): string {
  const code = (e as { code?: string } | null)?.code;
  switch (code) {
    case 'date_unavailable':
    case 'full':
      return 'Датата е заета';
    case 'deadline_passed':
      return 'Срокът е изтекъл';
    case 'date_past':
      return 'Датата е минала';
    case 'validation':
    case 'invalid_date':
    case 'invalid_range':
    case 'invalid_month':
    case 'invalid_max_bookings':
      return 'Проверете въведените данни';
    default:
      return 'Действието вече не е възможно';
  }
}

/** Is this a business-rule refusal (shown to the user) rather than a bug? */
export function isRefusal(e: unknown): boolean {
  const n = (e as { name?: string } | null)?.name;
  return n === 'LifecycleError' || n === 'DomainError' || n === 'NotFoundError' || n === 'AftercareError' || n === 'ForbiddenError';
}

/** Flash the refusal and go back; rethrow anything else. */
export async function refuse(e: unknown, back: string): Promise<never> {
  if (!isRefusal(e)) throw e;
  await setFlash(errorText(e), 'error');
  redirect(back);
}
