'use server';
// Step 2 ‹Профил и галерия› (SPEC §12.1, §14): uploads are saved at once
// (media.upload() + partners.setAvatar / setCover / addPhoto / removePhoto);
// the texts and specialisations go with the step form.
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import { addPhoto, removePhoto, saveDraft, saveStep, setAvatar, setCover } from '@/lib/domain/partners';
import { upload } from '@/lib/domain/media';
import { DomainError, partnerOf } from '@/lib/domain/catalogue-kit';
import { galleryOf } from '@/lib/domain/views-partner-onboarding';
import { getSetting } from '@/lib/domain/settings';
import { BASE, CHECK_FORM, REQUIRED, issueFields, proceed, readIntent, readOnlyRedirect, text, wizardActor, type StepState } from '../flow';

const VIDEO_RE = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be|vimeo\.com|player\.vimeo\.com)\/\S+$/i;
const PHOTO_RULE = 'JPG или PNG · до 5 MB';
const AVATAR_RULE = 'JPG или PNG · до 5 MB · поне 400 × 400';

export type UploadResult = { ok: boolean; error?: string; added?: number };

function uploadError(e: unknown, rule: string): UploadResult {
  readOnlyRedirect(e);
  if (e instanceof DomainError && e.code === 'gallery_full') return { ok: false, error: 'Галерията е пълна' };
  if (e instanceof DomainError || (e instanceof Error && /формат|MB/.test(e.message))) return { ok: false, error: rule };
  throw e;
}

function fileOf(fd: FormData): File | null {
  const f = fd.get('file');
  return f instanceof File && f.size > 0 ? f : null;
}

/** ‹Смени снимката› → media.upload() + partners.setAvatar(); toast ‹Снимката е обновена›. */
export async function uploadAvatarAction(fd: FormData): Promise<UploadResult> {
  const actor = await wizardActor();
  const file = fileOf(fd);
  if (!file) return { ok: false, error: AVATAR_RULE };
  try {
    const m = await upload(actor, { kind: 'partner_avatar', file });
    await setAvatar(actor, { mediaId: m.id });
  } catch (e) { return uploadError(e, AVATAR_RULE); }
  revalidatePath(BASE, 'layout');
  return { ok: true };
}

/** Cover upload → media.upload() + partners.setCover(); toast ‹Снимката е качена›. */
export async function uploadCoverAction(fd: FormData): Promise<UploadResult> {
  const actor = await wizardActor();
  const file = fileOf(fd);
  if (!file) return { ok: false, error: PHOTO_RULE };
  try {
    const m = await upload(actor, { kind: 'partner_cover', file });
    await setCover(actor, { mediaId: m.id });
  } catch (e) { return uploadError(e, PHOTO_RULE); }
  revalidatePath(BASE, 'layout');
  return { ok: true };
}

/** ‹Добави снимка› → media.upload() + partners.addPhoto() per file, up to ⚙ partner.gallery_max; toast ‹Снимката е добавена›. */
export async function addPhotosAction(fd: FormData): Promise<UploadResult> {
  const actor = await wizardActor();
  const files = fd.getAll('file').filter((f): f is File => f instanceof File && f.size > 0);
  if (!files.length) return { ok: false, error: PHOTO_RULE };
  const p = await partnerOf(actor, db);
  const room = (await getSetting('partner.gallery_max')) - (await galleryOf(p.id)).length;
  let added = 0;
  for (const file of files.slice(0, Math.max(0, room))) {
    try {
      const m = await upload(actor, { kind: 'gallery', file });
      await addPhoto(actor, { mediaId: m.id });
      added++;
    } catch (e) {
      revalidatePath(BASE, 'layout');
      const r = uploadError(e, PHOTO_RULE);
      return { ...r, added };
    }
  }
  revalidatePath(BASE, 'layout');
  return added ? { ok: true, added } : { ok: false, error: 'Галерията е пълна', added };
}

/** ‹Премахни› on a photo → partners.removePhoto(); toast ‹Снимката е премахната›. */
export async function removePhotoAction(photoId: string): Promise<UploadResult> {
  const actor = await wizardActor();
  if (!z.uuid().safeParse(photoId).success) return { ok: false };
  try {
    await removePhoto(actor, { photoId });
  } catch (e) {
    readOnlyRedirect(e);
    if (e instanceof DomainError) return { ok: false };
    throw e;
  }
  revalidatePath(BASE, 'layout');
  return { ok: true };
}

/** The step form: texts, video link, specialisations (event types + tags, D74). */
export async function profileAction(_prev: StepState, fd: FormData): Promise<StepState> {
  const actor = await wizardActor();
  const intent = readIntent(fd);
  const ids = fd.getAll('eventTypeIds').map(String).filter(v => z.uuid().safeParse(v).success);
  const tags = [
    ...fd.getAll('tags').map(String).map(l => ({ label: l.trim().slice(0, 60), isCustom: false })),
    ...fd.getAll('customTags').map(String).map(l => ({ label: l.trim().slice(0, 60), isCustom: true })),
  ].filter(t => t.label);
  const d = {
    shortDescription: text(fd, 'shortDescription').slice(0, 140),
    description: text(fd, 'description').slice(0, 600),
    videoUrl: text(fd, 'videoUrl').slice(0, 300),
  };
  const draft: Record<string, unknown> = { tags, videoUrl: d.videoUrl || null };
  if (ids.length) draft.eventTypeIds = ids;
  if (d.shortDescription) draft.shortDescription = d.shortDescription;
  if (d.description) draft.description = d.description;
  try {
    await saveDraft(actor, { step: 2, data: draft });
  } catch (e) {
    readOnlyRedirect(e);
    if (!(e instanceof DomainError)) throw e;
  }
  if (intent === 'next') {
    const p = await partnerOf(actor, db);
    const photos = (await galleryOf(p.id)).length;
    const min = await getSetting('partner.gallery_min');
    const f: Record<string, string> = {};
    if (!p.avatarMediaId) f.avatar = 'Качете снимка.';
    if (!p.coverMediaId) f.cover = 'Качете снимка.';
    if (!d.shortDescription) f.shortDescription = REQUIRED;
    if (!d.description) f.description = REQUIRED;
    if (d.videoUrl && !VIDEO_RE.test(d.videoUrl)) f.videoUrl = 'Линк към YouTube или Vimeo.';
    if (photos < min) f.gallery = `Поне ${min} снимки от ваши събития.`;
    if (!ids.length) f.eventTypes = 'Изберете поне едно събитие.';
    if (Object.keys(f).length) return { error: CHECK_FORM, fields: f, saved: true, at: Date.now() };
    try {
      await saveStep(actor, { step: 2, data: { ...d, avatarMediaId: p.avatarMediaId, coverMediaId: p.coverMediaId, eventTypeIds: ids, tags } });
    } catch (e) {
      readOnlyRedirect(e);
      if (!(e instanceof DomainError)) throw e;
      const errs = (e.details?.errors as string[] | undefined) ?? [];
      const fields = { ...issueFields(e), ...Object.fromEntries(errs.map(k => [k === 'eventTypes' ? 'eventTypes' : k, REQUIRED])) };
      return { error: CHECK_FORM, fields, saved: true, at: Date.now() };
    }
  }
  return proceed(2, intent);
}
