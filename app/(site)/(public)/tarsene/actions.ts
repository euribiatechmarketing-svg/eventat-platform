'use server';
// Search actions (SCREENS §2 /tarsene, /kategorii/[slug], /partnyori/[slug]): the suggestion
// panel, the search history, ‹Запази търсенето›, ‹Уведоми ме› and ‹Уведоми ме при свободна дата›.
import { z } from 'zod';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { db } from '@/db';
import { actorFromUser } from '@/lib/domain/actor';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { parseSearchParams, recordQuery, suggest } from '@/lib/domain/search';
import { saveSearch, watchDate, watchDates } from '@/lib/domain/saved';
import { setFlash } from '@/lib/flash';
import { sameSitePath } from '@/lib/safe-path';
import { currentUser, requireRole } from '@/lib/session';

const ISO = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const UUID = z.string().uuid();

/** Only same-site paths are followed after an action (lib/safe-path: resolved as the browser does). */
function safeBack(v: unknown, fallback = '/tarsene'): string {
  return sameSitePath(v, 1999) ?? fallback;
}

/** The first bar cell's panel (SPEC §13.7). Anyone may ask; a client also sees their recent searches. */
export async function suggestAction(input: { q: string; data?: string | null }) {
  const parsed = z.object({ q: z.string().max(200), data: ISO.nullable().optional() }).safeParse(input);
  if (!parsed.success) return [];
  const u = await currentUser();
  return suggest({ q: parsed.data.q, data: parsed.data.data ?? null }, { clientId: u?.role === 'client' ? u.id : null });
}

/** Every search a signed-in client runs from the bar goes to `search_history` (§13.7). Others: nothing to record. */
export async function recordQueryAction(q: string) {
  const u = await currentUser();
  if (!u || u.role !== 'client') return { ok: true as const };
  const text = z.string().trim().min(1).max(200).safeParse(q);
  if (!text.success) return { ok: true as const };
  const actor = await actorFromUser(u);
  await db.transaction(tx => recordQuery(actor, { q: text.data }, tx));
  return { ok: true as const };
}

/** ‹Запази търсенето› → saved.saveSearch(), toast ‹Търсенето е запазено в профила ви›. */
export async function saveSearchAction(formData: FormData) {
  const back = safeBack(formData.get('back'));
  const u = await requireRole('client', back);
  const qs = z.string().max(2000).catch('').parse(formData.get('qs'));
  const params = parseSearchParams(new URLSearchParams(qs));
  const actor = await actorFromUser(u);
  await db.transaction(tx => saveSearch(actor, { params }, tx));
  revalidatePath('/akaunt/zapazeni');
  await setFlash('Търсенето е запазено в профила ви');
  redirect(back);
}

/**
 * ‹Уведоми ме› on a busy card and ‹Уведоми ме, ако се освободи› on the profile → saved.watchDate().
 * Returns ok for the toast ‹Ще ви известим, ако датата се освободи›; when the date is no longer
 * busy (or has passed) there is nothing to watch and the page is refreshed instead.
 */
export async function watchDateAction(input: { partnerId: string; date: string; sabitieId?: string | null; back?: string }) {
  const back = safeBack(input?.back);
  const u = await requireRole('client', back);
  const parsed = z.object({ partnerId: UUID, date: ISO, sabitieId: UUID.nullable().optional() }).safeParse(input);
  if (!parsed.success) return { ok: false as const };
  const actor = await actorFromUser(u);
  try {
    await db.transaction(tx => watchDate(actor, { partnerId: parsed.data.partnerId, date: parsed.data.date, clientEventId: parsed.data.sabitieId ?? null }, tx));
  } catch (e) {
    if (e instanceof DomainError) return { ok: false as const };
    throw e;
  }
  revalidatePath('/akaunt/zapazeni');
  return { ok: true as const };
}

/** Zero state ‹Уведоми ме при свободна дата› → saved.watchDates(): a watch on every matching partner busy on the date. */
export async function watchDatesAction(formData: FormData) {
  const back = safeBack(formData.get('back'));
  const u = await requireRole('client', back);
  const qs = z.string().max(2000).catch('').parse(formData.get('qs'));
  const params = parseSearchParams(new URLSearchParams(qs));
  const actor = await actorFromUser(u);
  try {
    await db.transaction(tx => watchDates(actor, { params }, tx));
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    redirect(back);
  }
  revalidatePath('/akaunt/zapazeni');
  await setFlash('Ще ви известим, ако датата се освободи');
  redirect(back);
}
