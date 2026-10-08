import 'server-only';
// Shared bodies of the messaging and support server actions. Each route's actions.ts
// ('use server') authenticates for its own role and calls these.
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import type { MediaKind } from '@/db/schema';
import { requireRole } from '@/lib/session';
import { actorFromUser, type Actor } from '@/lib/domain/actor';
import { saveDraft, send } from '@/lib/domain/messaging';
import { CLIENT_REASONS, PARTNER_REASONS, openByClient, openByPartner, submitStatement, withdraw } from '@/lib/domain/disputes';
import { setFlash } from '@/lib/flash';
import { plural } from '@/lib/format';
import { upload } from '@/lib/domain/media';
import { getSetting } from '@/lib/domain/settings';
import { ownsConversation } from '@/lib/domain/views-messaging-support';

export type Side = 'client' | 'partner';
export type ActionResult = { ok: true } | { ok: false; error: string };
export type UploadResult = { ok: true; id: string; name: string; mime: string } | { ok: false; error: string };

/** Approved / derived copy for the refusals the domain can return (codes are stable, the UI owns the words). */
const COPY: Record<string, string> = {
  empty_message: 'Напишете съобщение или прикачете файл.',
  message_too_long: 'Съобщението е твърде дълго — до 4 000 знака.',
  upload_type: 'Файлът трябва да е JPG, PNG или PDF.',
  upload_size: 'Файлът е по-голям от 5 MB.',
  too_many_files: 'Може да прикачите до 6 снимки',
  too_many_photos: 'Може да прикачите до 6 снимки',
  description_required: 'Опишете какво се случи.',
  body_required: 'Опишете какво се случи.',
  bad_reason: 'Изберете причина.',
  dispute_open: 'По тази резервация вече има отворен сигнал.',
  dispute_exists: 'По тази резервация вече има сигнал.',
  not_disputable: 'За тази резервация не може да се подаде сигнал.',
  dispute_window_passed: 'Сигнал може да се подаде до 30 дни след събитието.',
  dispute_closed: 'Случаят вече е приключен.',
  not_withdrawable: 'Сигналът вече не може да се оттегли.',
};
const GENERIC = 'Нещо се обърка. Опитайте отново.';

export function errorCopy(e: unknown): string {
  const code = (e as { code?: unknown })?.code;
  if (typeof code === 'string' && COPY[code]) return COPY[code];
  if (e instanceof Error && /^(Неподдържан формат|Файлът е по-голям)/.test(e.message)) return e.message;
  return GENERIC;
}

/** Next's redirect()/notFound() work by throwing; let them through. */
export function rethrowNavigation(e: unknown) {
  const d = (e as { digest?: unknown })?.digest;
  if (typeof d === 'string' && (d.startsWith('NEXT_REDIRECT') || d.startsWith('NEXT_HTTP_ERROR_FALLBACK') || d === 'NEXT_NOT_FOUND')) throw e;
}

export async function actorFor(side: Side, next: string): Promise<Actor> {
  const u = await requireRole(side, next);
  const actor = await actorFromUser(u);
  if (side === 'partner' && !actor.partnerId) throw new Error('partner');
  return actor;
}

const base = (side: Side) => (side === 'client' ? '/akaunt/saobshteniya' : '/partner/saobshteniya');

// ── Messages ─────────────────────────────────────────────────────────────

const sendInput = z.object({
  conversationId: z.uuid(),
  body: z.string().max(4000),
  attachmentId: z.uuid().nullish(),
});

/** ‹Изпрати› → messages.send(): stored masked per SPEC §10, the other side is emailed and belled. */
export async function sendMessage(side: Side, input: unknown): Promise<ActionResult> {
  const parsed = sendInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.some(i => i.code === 'too_big') ? COPY.message_too_long : GENERIC };
  const { conversationId, body, attachmentId } = parsed.data;
  const actor = await actorFor(side, `${base(side)}/${conversationId}`);
  try {
    await send(actor, { conversationId, body, attachmentMediaId: attachmentId ?? null });
  } catch (e) {
    return { ok: false, error: errorCopy(e) };
  }
  revalidatePath(base(side), 'layout');
  return { ok: true };
}

/** Typing → messages.saveDraft() (debounced by the composer). */
export async function saveMessageDraft(side: Side, input: unknown): Promise<ActionResult> {
  const parsed = z.object({ conversationId: z.uuid(), body: z.string().max(4000) }).safeParse(input);
  if (!parsed.success) return { ok: false, error: GENERIC };
  const actor = await actorFor(side, base(side));
  try {
    await saveDraft(actor, parsed.data);
  } catch (e) {
    return { ok: false, error: errorCopy(e) };
  }
  return { ok: true };
}

/** ‹Прикачи файл› → media.upload() (JPG, PNG or PDF, ≤ 5 MB, one per message; SPEC §14). */
export async function uploadMessageFile(side: Side, formData: FormData): Promise<UploadResult> {
  const conversationId = String(formData.get('conversationId') ?? '');
  const file = formData.get('file');
  const actor = await actorFor(side, base(side));
  if (!(file instanceof File) || !file.size) return { ok: false, error: GENERIC };
  if (!z.uuid().safeParse(conversationId).success || !(await ownsConversation(actor, conversationId))) return { ok: false, error: GENERIC };
  return uploadAs(actor, 'message_attachment', file);
}

// ── Support (disputes) ───────────────────────────────────────────────────

/** ‹Прикачи файл› / ‹Добавете снимки към сигнала› → media.upload() as dispute evidence (≤ 6 per statement). */
export async function uploadEvidence(side: Side, formData: FormData): Promise<UploadResult> {
  const file = formData.get('file');
  const actor = await actorFor(side, side === 'client' ? '/akaunt/poddrazhka' : '/partner/poddrazhka');
  if (!(file instanceof File) || !file.size) return { ok: false, error: GENERIC };
  return uploadAs(actor, 'dispute_evidence', file);
}

async function uploadAs(actor: Actor, kind: MediaKind, file: File): Promise<UploadResult> {
  try {
    const m = await upload(actor, { kind, file });
    return { ok: true, id: m.id, name: m.originalName ?? file.name, mime: m.mime };
  } catch (e) {
    return { ok: false, error: errorCopy(e) };
  }
}

/** Evidence ids from a form: unique uuids, at most ⚙ uploads.max_photos. */
export async function evidenceIds(formData: FormData): Promise<string[] | null> {
  const ids = [...new Set(formData.getAll('evidence').map(String).filter(Boolean))];
  if (!ids.every(id => z.uuid().safeParse(id).success)) return null;
  if (ids.length > await getSetting('uploads.max_photos')) return null;
  return ids;
}

export const disputeTextInput = z.string().trim().min(1).max(4000);

// ── Support form bodies (X1/X2 open, X6 statement, X9 withdraw) ──────────


export type FormState = { error?: string };
const supportBase = (side: Side) => (side === 'client' ? '/akaunt/poddrazhka' : '/partner/poddrazhka');
const caseHref = (side: Side, number: string) => `${supportBase(side)}/${encodeURIComponent(number)}`;
const NUMBER = /^\d{4}-\d{4}-[\p{L}\d]{1,6}$/u;

/** ‹Изпрати сигнала› → disputes.openByClient() / openByPartner(); toast ‹Сигналът е изпратен — екипът отговаря до 24 часа›. */
export async function openDispute(side: Side, formData: FormData): Promise<FormState> {
  const actor = await actorFor(side, `${supportBase(side)}/nov`);
  const reasons = (side === 'client' ? CLIENT_REASONS : PARTNER_REASONS) as [string, ...string[]];
  const bookingId = z.uuid().safeParse(formData.get('bookingId'));
  if (!bookingId.success) return { error: 'Изберете резервация.' };
  const reason = z.enum(reasons).safeParse(formData.get('reason'));
  if (!reason.success) return { error: COPY.bad_reason };
  const description = z.string().trim().min(1).max(2000).safeParse(formData.get('description') ?? '');
  if (!description.success) return { error: COPY.description_required };
  const evidence = await evidenceIds(formData);
  if (!evidence) return { error: COPY.too_many_files };
  try {
    const input = { bookingId: bookingId.data, reason: reason.data as never, description: description.data, evidenceMediaIds: evidence };
    if (side === 'client') await openByClient(actor, input); else await openByPartner(actor, input);
  } catch (e) {
    rethrowNavigation(e);
    return { error: errorCopy(e) };
  }
  revalidatePath(supportBase(side), 'layout');
  revalidatePath(side === 'client' ? '/akaunt/rezervacii' : '/partner/rezervacii', 'layout');
  const hours = await getSetting('dispute.team_reply_hours');
  await setFlash(`Сигналът е изпратен — екипът отговаря до ${plural(hours, 'час', 'часа')}`);
  redirect(side === 'client' ? '/akaunt/rezervacii' : '/partner/rezervacii');
}

/** ‹Отговори на екипа› / ‹Изпрати позицията› → disputes.submitStatement() → team-dispute-reply. */
export async function sendStatement(side: Side, formData: FormData): Promise<FormState> {
  const disputeId = z.uuid().safeParse(formData.get('disputeId'));
  const number = String(formData.get('number') ?? '');
  const actor = await actorFor(side, supportBase(side));
  if (!disputeId.success || !NUMBER.test(number)) return { error: GENERIC };
  const body = disputeTextInput.safeParse(formData.get('body') ?? '');
  if (!body.success) return { error: COPY.body_required };
  const evidence = await evidenceIds(formData);
  if (!evidence) return { error: COPY.too_many_files };
  try {
    await submitStatement(actor, { disputeId: disputeId.data, body: body.data, evidenceMediaIds: evidence });
  } catch (e) {
    rethrowNavigation(e);
    return { error: errorCopy(e) };
  }
  revalidatePath(supportBase(side), 'layout');
  await setFlash('Съобщението е изпратено');
  redirect(caseHref(side, number));
}

/** X9: the filer withdraws a case that is still collecting (D68: no email; toast only). */
export async function withdrawDispute(side: Side, formData: FormData): Promise<void> {
  const disputeId = z.uuid().safeParse(formData.get('disputeId'));
  const number = String(formData.get('number') ?? '');
  const actor = await actorFor(side, supportBase(side));
  if (!disputeId.success || !NUMBER.test(number)) redirect(supportBase(side));
  try {
    await withdraw(actor, { disputeId: disputeId.data });
  } catch (e) {
    rethrowNavigation(e);
    await setFlash(errorCopy(e), 'error');
    redirect(caseHref(side, number));
  }
  revalidatePath(supportBase(side), 'layout');
  await setFlash('Сигналът е оттеглен');
  redirect(caseHref(side, number));
}
