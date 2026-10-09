import 'server-only';
// File storage for photos, inspiration images, dispute evidence and documents.
//   local — public/uploads (dev and e2e; served as static files, and by app/uploads/[...key] after a build)
//   s3    — Cloudflare R2 or any S3-compatible bucket (production)
// Public files (approved listing photos) get a public URL; private files
// (evidence, documents) are read through /api/files/[...key] with an access check.
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';

export type Visibility = 'public' | 'private';
export type Stored = { key: string; url: string; contentType: string; size: number };

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const driver = () => (process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local');
const LOCAL_ROOT = join(process.cwd(), 'public', 'uploads');
/** A key's file under LOCAL_ROOT; null for a key that would leave the folder (`..`, an absolute path). */
function localPath(key: string): string | null {
  const path = resolve(LOCAL_ROOT, key);
  return path.startsWith(LOCAL_ROOT + sep) ? path : null;
}

let aws: AwsClient | null = null;
function s3(): AwsClient {
  if (!aws) aws = new AwsClient({ accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '', service: 's3', region: 'auto' });
  return aws;
}
const objectUrl = (key: string) => `${process.env.S3_ENDPOINT?.replace(/\/$/, '')}/${process.env.S3_BUCKET}/${key}`;

function ext(type: string) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' } as Record<string, string>)[type] ?? 'bin';
}

/** Store an uploaded File. `folder` e.g. "services/<id>", "disputes/<id>". */
export async function putFile(file: File, folder: string, visibility: Visibility): Promise<Stored> {
  if (!ALLOWED.has(file.type)) throw new Error('Неподдържан формат на файла.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Файлът е по-голям от 10 MB.');
  const key = `${visibility}/${folder}/${randomUUID()}.${ext(file.type)}`;
  const body = Buffer.from(await file.arrayBuffer());
  if (driver() === 'local') {
    const path = join(LOCAL_ROOT, key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  } else {
    const r = await s3().fetch(objectUrl(key), { method: 'PUT', body, headers: { 'Content-Type': file.type } });
    if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  }
  return { key, url: fileUrl(key), contentType: file.type, size: file.size };
}

/** URL to show a stored file. Private files go through the access-checked route. */
export function fileUrl(key: string): string {
  if (key.startsWith('/')) return key; // bundled static asset (public/), e.g. the demo photos
  if (key.startsWith('private/')) return `/api/files/${key}`;
  if (driver() === 'local') return `/uploads/${key}`;
  return `${process.env.S3_PUBLIC_URL?.replace(/\/$/, '')}/${key}`;
}

export async function getFile(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (driver() === 'local') {
    const path = localPath(key);
    if (!path) return null;
    try { return { body: await readFile(path), contentType: guessType(key) }; } catch { return null; }
  }
  const r = await s3().fetch(objectUrl(key));
  if (!r.ok) return null;
  return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? guessType(key) };
}

export async function deleteFile(key: string): Promise<void> {
  if (driver() === 'local') { const path = localPath(key); if (path) await unlink(path).catch(() => {}); return; }
  await s3().fetch(objectUrl(key), { method: 'DELETE' });
}

function guessType(key: string) {
  const e = key.split('.').pop();
  return ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, string>)[e ?? ''] ?? 'application/octet-stream';
}
