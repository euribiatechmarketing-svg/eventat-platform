import 'server-only';
// File storage for photos, inspiration images, dispute evidence and documents.
//   local — public files under public/uploads (dev and e2e; served as static files, and by
//           app/uploads/[...key] after a build); private files under .data/uploads, outside public/,
//           so Next never serves them as static files
//   s3    — Cloudflare R2 or any S3-compatible storage (production): public files in S3_BUCKET (its
//           public URL is S3_PUBLIC_URL), private files in S3_PRIVATE_BUCKET, a bucket with no
//           public access. A bucket's public URL serves the whole bucket, so private files must
//           never share it.
// Public files (approved listing photos) get a public URL; private files (evidence, documents) are
// read only through /api/files/<media id>, after media.canAccess().
import { mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';

export type Visibility = 'public' | 'private';
export type Stored = { key: string; url: string | null; contentType: string; size: number };

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const driver = () => (process.env.STORAGE_DRIVER === 's3' ? 's3' : 'local');
const isPrivateKey = (key: string) => key.startsWith('private/');

const PUBLIC_ROOT = join(process.cwd(), 'public', 'uploads');
const PRIVATE_ROOT = join(process.cwd(), '.data', 'uploads');
/** A key's file in its root (private keys outside public/); null for a key that would leave it (`..`, an absolute path). */
function localPath(key: string, root = isPrivateKey(key) ? PRIVATE_ROOT : PUBLIC_ROOT): string | null {
  const path = resolve(root, key);
  return path.startsWith(root + sep) ? path : null;
}

let aws: AwsClient | null = null;
function s3(): AwsClient {
  if (!aws) aws = new AwsClient({ accessKeyId: process.env.S3_ACCESS_KEY_ID ?? '', secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? '', service: 's3', region: 'auto' });
  return aws;
}

/** The bucket a key lives in. Private files need their own bucket; without one they are not stored at all. */
function bucketFor(key: string): string {
  if (!isPrivateKey(key)) return process.env.S3_BUCKET ?? '';
  const b = process.env.S3_PRIVATE_BUCKET;
  if (!b) throw new Error('S3_PRIVATE_BUCKET is not set: private files need a bucket without public access');
  if (b === process.env.S3_BUCKET) throw new Error('S3_PRIVATE_BUCKET must not be the public bucket (S3_BUCKET)');
  return b;
}
const objectUrl = (key: string) => `${process.env.S3_ENDPOINT?.replace(/\/$/, '')}/${bucketFor(key)}/${key}`;

function ext(type: string) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' } as Record<string, string>)[type] ?? 'bin';
}

/** Store an uploaded File. `folder` e.g. "services/<id>", "disputes/<id>". A private file has no URL (it is linked by its media id). */
export async function putFile(file: File, folder: string, visibility: Visibility): Promise<Stored> {
  if (!ALLOWED.has(file.type)) throw new Error('Неподдържан формат на файла.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Файлът е по-голям от 10 MB.');
  const key = `${visibility}/${folder}/${randomUUID()}.${ext(file.type)}`;
  const body = Buffer.from(await file.arrayBuffer());
  if (driver() === 'local') {
    const path = localPath(key);
    if (!path) throw new Error('Неподдържан формат на файла.');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  } else {
    const r = await s3().fetch(objectUrl(key), { method: 'PUT', body, headers: { 'Content-Type': file.type } });
    if (!r.ok) throw new Error(`Upload failed: ${r.status}`);
  }
  return { key, url: visibility === 'public' ? fileUrl(key) : null, contentType: file.type, size: file.size };
}

/**
 * URL to show a public stored file. A private file has no URL of its own: it is read through
 * /api/files/<media id> after the access check (its storage key never goes to a browser).
 */
export function fileUrl(key: string): string {
  if (key.startsWith('/')) return key; // bundled static asset (public/), e.g. the demo photos
  if (isPrivateKey(key)) throw new Error('A private file is linked by its media id (/api/files/<id>), not by its storage key');
  if (driver() === 'local') return `/uploads/${key}`;
  return `${process.env.S3_PUBLIC_URL?.replace(/\/$/, '')}/${key}`;
}

/**
 * A private file stored by an earlier version under public/uploads/private: moved out of public/ on
 * first read, so Next stops serving it as a static file.
 */
async function moveLegacyPrivate(key: string, to: string): Promise<boolean> {
  const from = localPath(key, PUBLIC_ROOT);
  if (!from) return false;
  try {
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
    return true;
  } catch { return false; }
}

export async function getFile(key: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (driver() === 'local') {
    const path = localPath(key);
    if (!path) return null;
    try { return { body: await readFile(path), contentType: guessType(key) }; } catch { /* below */ }
    if (isPrivateKey(key) && await moveLegacyPrivate(key, path)) {
      try { return { body: await readFile(path), contentType: guessType(key) }; } catch { return null; }
    }
    return null;
  }
  const r = await s3().fetch(objectUrl(key));
  if (!r.ok) return null;
  return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? guessType(key) };
}

export async function deleteFile(key: string): Promise<void> {
  if (key.startsWith('/')) return; // bundled static assets are part of the app
  if (driver() === 'local') { const path = localPath(key); if (path) await unlink(path).catch(() => {}); return; }
  const r = await s3().fetch(objectUrl(key), { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error(`Delete failed: ${r.status}`);
}

function guessType(key: string) {
  const e = key.split('.').pop();
  return ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, string>)[e ?? ''] ?? 'application/octet-stream';
}
