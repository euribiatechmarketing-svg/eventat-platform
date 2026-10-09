import 'server-only';
// One photo from a form's drop area → media.upload() (SPEC §14) → its id.
import type { MediaKind } from '@/db/schema';
import { actorFromUser } from '@/lib/domain/actor';
import { upload } from '@/lib/domain/media';
import { requireRole } from '@/lib/session';
import { errorText } from './errors';

export async function uploadPhoto(kind: MediaKind, formData: FormData): Promise<{ id?: string; error?: string }> {
  const u = await requireRole('client');
  const file = formData.get('file');
  if (!(file instanceof File) || !file.size) return { error: errorText(null) };
  try {
    const m = await upload(await actorFromUser(u), { kind, file });
    return { id: m.id };
  } catch (e) {
    return { error: errorText(e) };
  }
}
