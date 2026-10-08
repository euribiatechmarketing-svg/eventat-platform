'use server';
// /partner/profil: ‹Запази промените› (partners.updateProfile, saved at once, D59), the gallery
// (‹+› → media.upload + partners.addPhoto, remove, order) and the listing toggles (partners.setListing).
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import * as media from '@/lib/domain/media';
import * as partners from '@/lib/domain/partners';
import { partnerActor, refusal } from '../_catalogue/server';

export type ProfileState = { ok?: boolean; message?: string; error?: string; fields?: Record<string, string>; at?: number };
type Result = { ok: true; message: string } | { ok: false; error: string };

const profile = z.object({
  description: z.string().max(2000),
  socialHandle: z.string().max(400),
  cityId: z.uuid(),
  radius: z.union([z.literal(50), z.literal(100), z.literal(150), z.literal('nationwide')]),
  eventTypeIds: z.array(z.uuid()).max(20),
  tags: z.array(z.object({ label: z.string().trim().min(1).max(60), isCustom: z.boolean() })).max(30),
  cancellationPolicy: z.enum(['flexible', 'moderate', 'strict']),
});

export async function updateProfileAction(_prev: ProfileState, formData: FormData): Promise<ProfileState> {
  const actor = await partnerActor('/partner/profil');
  let raw: unknown;
  try { raw = JSON.parse(String(formData.get('payload') ?? '')); } catch { raw = null; }
  const r = profile.safeParse(raw);
  if (!r.success) return { error: 'Проверете попълнените полета.', at: Date.now() };
  const d = r.data;
  const fields: Record<string, string> = {};
  if (!d.description.trim()) fields.description = 'Въведете описание.';
  else if (d.description.trim().length > 600) fields.description = 'До 600 знака.';
  if (!d.socialHandle.trim()) fields.socialHandle = 'Въведете профил в Instagram или Facebook.';
  if (!d.eventTypeIds.length) fields.eventTypeIds = 'Изберете поне едно събитие.';
  if (Object.keys(fields).length) return { fields, at: Date.now() };
  try {
    await db.transaction(tx => partners.updateProfile(actor, {
      description: d.description.trim(), socialHandle: d.socialHandle.trim(), cityId: d.cityId, radius: d.radius,
      eventTypeIds: d.eventTypeIds, tags: d.tags, cancellationPolicy: d.cancellationPolicy,
    }, tx));
  } catch (e) { return { error: refusal(e), at: Date.now() }; }
  revalidatePath('/partner/profil');
  return { ok: true, message: 'Промените са запазени', at: Date.now() };
}

/** ‹+› in the gallery: store the photo and add it at the end. */
export async function addGalleryPhotoAction(formData: FormData): Promise<Result> {
  const actor = await partnerActor('/partner/profil');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Форматът на файла не се приема.' };
  try {
    const m = await media.upload(actor, { kind: 'gallery', file });
    await db.transaction(tx => partners.addPhoto(actor, { mediaId: m.id }, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner/profil');
  return { ok: true, message: 'Снимката е добавена' };
}

export async function removeGalleryPhotoAction(photoId: string): Promise<Result> {
  const actor = await partnerActor('/partner/profil');
  if (!z.uuid().safeParse(photoId).success) return { ok: false, error: 'Записът не е намерен.' };
  try {
    await db.transaction(tx => partners.removePhoto(actor, { photoId }, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner/profil');
  return { ok: true, message: 'Снимката е премахната' };
}

/** The gallery order; the first photo is ‹Главна› (the catalogue photo). */
export async function reorderGalleryAction(photoIds: string[]): Promise<Result> {
  const actor = await partnerActor('/partner/profil');
  const r = z.array(z.uuid()).min(1).max(50).safeParse(photoIds);
  if (!r.success) return { ok: false, error: 'Подредбата не може да се запази.' };
  try {
    await db.transaction(tx => partners.reorderPhotos(actor, { photoIds: r.data }, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner/profil');
  return { ok: true, message: 'Подредбата е запазена' };
}

/** ‹Профилът е активен› / ‹Приемам нови заявки› (immediate, no email). */
export async function setListingAction(a: { isListed?: boolean; acceptingRequests?: boolean }): Promise<Result> {
  const actor = await partnerActor('/partner/profil');
  const r = z.object({ isListed: z.boolean().optional(), acceptingRequests: z.boolean().optional() }).safeParse(a);
  if (!r.success) return { ok: false, error: 'Проверете попълнените полета.' };
  try {
    await db.transaction(tx => partners.setListing(actor, r.data, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner/profil');
  return { ok: true, message: 'Промените са запазени' };
}
