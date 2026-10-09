import 'server-only';
// Shared plumbing for the wizard's step actions (SCREENS §6, SPEC §4.2 P3):
// every step form posts here with an intent — ‹Продължи…› (next), ‹Назад› (back),
// a step in the rail (goto:N), ‹Запази и продължи по-късно› / ‹Изход› / logo (later)
// or a background save (autosave) — and the step's fields.
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import { setFlash } from '@/lib/flash';
import { now } from '@/lib/clock';
import { requireRole } from '@/lib/session';
import { actorFromUser, type Actor } from '@/lib/domain/actor';
import { DomainError } from '@/lib/domain/catalogue-kit';

export const BASE = '/partner/registratsiya';

export type StepState = {
  /** Form-level message (shown as an alert above the step's cards). */
  error?: string | null;
  /** Field name → message. */
  fields?: Record<string, string>;
  /** Platform time of the last background save (ISO). */
  savedAt?: string;
  /** Step 3: new editors saved in this round, client key → service id. */
  created?: Record<string, string>;
  /** The draft was saved on the way (the top bar shows ‹Запазено току-що›). */
  saved?: boolean;
  /** Changes on every response so the client can react to identical states. */
  at?: number;
};

export type Intent = 'next' | 'back' | 'later' | 'autosave' | 'submit' | { goto: number };

export function readIntent(fd: FormData): Intent {
  const v = String(fd.get('intent') ?? 'next');
  const m = /^goto:([1-6])$/.exec(v);
  if (m) return { goto: Number(m[1]) };
  return (['next', 'back', 'later', 'autosave', 'submit'] as const).find(x => x === v) ?? 'next';
}

/** The signed-in partner (guard partner:wizard; the domain checks the status). */
export async function wizardActor(): Promise<Actor> {
  const user = await requireRole('partner', BASE);
  return actorFromUser(user);
}

// ── Copy for field errors (new copy, kept short) ─────────────────────────
export const REQUIRED = 'Попълнете полето.';
export const CHECK_FORM = 'Попълнете отбелязаните полета.';

/** Map a domain refusal to the page: the wizard is read-only once submitted. */
export function readOnlyRedirect(e: unknown) {
  if (e instanceof DomainError && (e.code === 'wizard_read_only' || e.code === 'partner_status')) redirect(`${BASE}/podadeno`);
}

/** zod issue paths of a DomainError('validation') → field names. */
export function issueFields(e: unknown, message = REQUIRED): Record<string, string> {
  const issues = (e instanceof DomainError ? (e.details?.issues as { path: (string | number)[] }[] | undefined) : undefined) ?? [];
  const out: Record<string, string> = {};
  for (const i of issues) if (i.path?.length) out[String(i.path[0])] = message;
  return out;
}

/** After the step was saved: where the intent leads. Never returns for navigating intents. */
export async function proceed(step: number, intent: Intent): Promise<StepState> {
  revalidatePath(BASE, 'layout');
  if (intent === 'autosave') return { savedAt: (await now()).toISOString(), at: Date.now() };
  if (intent === 'later') {
    await setFlash('Черновата е запазена');
    await auth.api.signOut({ headers: await headers() });
    redirect('/');
  }
  if (typeof intent === 'object') redirect(`${BASE}/${intent.goto}`);
  if (intent === 'back') redirect(`${BASE}/${Math.max(1, step - 1)}`);
  redirect(`${BASE}/${Math.min(6, step + 1)}`);
}

/** Form helpers: trimmed text, '' → undefined. */
export const text = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v.trim() : '';
};
export const opt = (s: string) => (s === '' ? undefined : s);
