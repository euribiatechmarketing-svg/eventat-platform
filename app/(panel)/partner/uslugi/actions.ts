'use server';
// /partner/uslugi: ‹Подреди› (services.reorder) and the cover upload shared by the
// service editors (‹Качи снимка› → media.upload('service_cover')).
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/db';
import * as media from '@/lib/domain/media';
import * as services from '@/lib/domain/services';
import { mediaUrl } from '@/lib/domain/catalogue-kit';
import { partnerActor, refusal } from '../_catalogue/server';

type Result = { ok: true; message: string } | { ok: false; error: string };

const order = z.array(z.uuid()).min(1).max(200);

/** ‹Подреди› → reorder mode → ‹Запази промените›: the full order (the shown tab's cards moved within it). */
export async function reorderServicesAction(ids: string[]): Promise<Result> {
  const actor = await partnerActor('/partner/uslugi');
  const parsed = order.safeParse(ids);
  if (!parsed.success) return { ok: false, error: 'Подредбата не може да се запази.' };
  try {
    await db.transaction(tx => services.reorder(actor, { serviceIds: parsed.data }, tx));
  } catch (e) { return { ok: false, error: refusal(e) }; }
  revalidatePath('/partner/uslugi');
  return { ok: true, message: 'Подредбата е запазена' };
}

/** ‹Качи снимка› in the cover block: the file is stored and recorded; the editor keeps its id until saved. */
export async function uploadServiceCoverAction(formData: FormData): Promise<{ ok: true; mediaId: string; url: string } | { ok: false; error: string }> {
  const actor = await partnerActor('/partner/uslugi');
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Форматът на файла не се приема.' };
  try {
    const m = await media.upload(actor, { kind: 'service_cover', file });
    return { ok: true, mediaId: m.id, url: mediaUrl(m.storageKey)! };
  } catch (e) { return { ok: false, error: refusal(e) }; }
}
