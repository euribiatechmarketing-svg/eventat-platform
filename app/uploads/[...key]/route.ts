// /uploads/public/… with the local storage driver (development, and e2e runs against `next start`).
// Next serves only the files that were in public/ when the app was built, so a photo uploaded
// after the build (a partner's profile photo, cover, gallery) would 404 without this route.
// Production stores files in the S3 bucket and never reaches it.
import { getFile } from '@/lib/storage';

export async function GET(_req: Request, { params }: { params: Promise<{ key: string[] }> }) {
  if (process.env.STORAGE_DRIVER === 's3') return new Response(null, { status: 404 });
  const { key } = await params;
  // Public uploads only (private files go through /api/files with an access check), and no way out of the folder.
  if (key[0] !== 'public' || key.some(s => !s || s === '.' || s === '..' || s.includes('\\'))) return new Response(null, { status: 404 });
  const file = await getFile(key.join('/'));
  if (!file) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(file.body), { headers: { 'Content-Type': file.contentType, 'Cache-Control': 'public, max-age=31536000, immutable' } });
}
