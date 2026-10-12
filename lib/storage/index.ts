import 'server-only';
// File storage for photos, inspiration images, dispute evidence and documents.
//   local — public files under public/uploads (dev and e2e; served as static files, and by
//           app/uploads/[...key] after a build); private files under .data/uploads, outside public/,
//           so Next never serves them as static files
//   s3    — Cloudflare R2 or any S3-compatible storage (production): public files in S3_BUCKET (its
//           public URL is S3_PUBLIC_URL), private files in S3_PRIVATE_BUCKET, a bucket with no
//           public access. A bucket's public URL serves the whole bucket, so private files must
//           never share it.
//   blob  — Vercel Blob (staging, until the R2 buckets exist): two stores, for the same reason as the two
//           buckets — a store's access is fixed when it is created, and a public store serves every blob in it.
//           BLOB_READ_WRITE_TOKEN is the public store (public files, served by their blob URL);
//           BLOB_PRIVATE_READ_WRITE_TOKEN a private store (its blobs are read only with the token).
// Public files (approved listing photos) get a public URL; private files (evidence, documents) are
// read only through /api/files/<media id>, after media.canAccess().
import { mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AwsClient } from 'aws4fetch';
import { BlobNotFoundError, del as blobDel, get as blobGet, put as blobPut } from '@vercel/blob';

export type Visibility = 'public' | 'private';
export type Stored = { key: string; url: string | null; contentType: string; size: number };

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type Driver = 'local' | 's3' | 'blob';
export const storageDriver = (): Driver => {
  const d = process.env.STORAGE_DRIVER;
  return d === 's3' || d === 'blob' ? d : 'local';
};
const driver = storageDriver;
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

// ── blob ──
// Every call names its store's token. Without one, @vercel/blob picks a store by itself (VERCEL_OIDC_TOKEN with
// BLOB_STORE_ID, else BLOB_READ_WRITE_TOKEN), and a private file could land in the public store.

/** The store id inside a read-write token (`vercel_blob_rw_<store id>_<secret>`), lower case as in the store's host name. */
const storeIdOf = (token: string) => /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(token)?.[1]?.toLowerCase();
function blobStoreId(name: 'BLOB_READ_WRITE_TOKEN' | 'BLOB_PRIVATE_READ_WRITE_TOKEN'): string {
  const id = storeIdOf(process.env[name] ?? '');
  if (!id) throw new Error(`${name} is not set to a Vercel Blob read-write token`);
  return id;
}

/** The token of the store a key lives in. Private files need their own private store; without one they are not stored at all. */
function blobToken(key: string): string {
  if (!isPrivateKey(key)) { blobStoreId('BLOB_READ_WRITE_TOKEN'); return process.env.BLOB_READ_WRITE_TOKEN!; }
  const id = blobStoreId('BLOB_PRIVATE_READ_WRITE_TOKEN');
  if (process.env.BLOB_READ_WRITE_TOKEN && id === blobStoreId('BLOB_READ_WRITE_TOKEN')) {
    throw new Error('BLOB_PRIVATE_READ_WRITE_TOKEN must belong to a private store, not the public one (BLOB_READ_WRITE_TOKEN)');
  }
  return process.env.BLOB_PRIVATE_READ_WRITE_TOKEN!;
}
const blobAccess = (key: string) => (isPrivateKey(key) ? 'private' : 'public');
/** A stored key: `public|private/<kind>/<owner>/<name>`, plain segments only (no `..`, nothing absolute). */
const BLOB_KEY = /^(public|private)(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)+$/;

function ext(type: string) {
  return ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf' } as Record<string, string>)[type] ?? 'bin';
}

/** Store an uploaded File. `folder` e.g. "services/<id>", "disputes/<id>". A private file has no URL (it is linked by its media id). */
export async function putFile(file: File, folder: string, visibility: Visibility): Promise<Stored> {
  if (!ALLOWED.has(file.type)) throw new Error('Неподдържан формат на файла.');
  if (file.size > MAX_UPLOAD_BYTES) throw new Error('Файлът е по-голям от 10 MB.');
  let key = `${visibility}/${folder}/${randomUUID()}.${ext(file.type)}`;
  const body = Buffer.from(await file.arrayBuffer());
  if (driver() === 'local') {
    const path = localPath(key);
    if (!path) throw new Error('Неподдържан формат на файла.');
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  } else if (driver() === 'blob') {
    // The store adds a random suffix to the name (`<uuid>-<suffix>.jpg`): the key is the pathname it answers with.
    const token = blobToken(key), access = blobAccess(key);
    const r = await blobPut(key, body, { access, addRandomSuffix: true, contentType: file.type, token });
    // The store's answer is checked, not assumed: a store's access is fixed when it is created, and the token's own
    // store must have kept the file with the access asked for. A private file put through the token of another, public
    // store (or a public one through the private store's) is deleted again and refused.
    let host = '';
    try { host = new URL(r.url).hostname; } catch { /* refused below */ }
    const name = access === 'private' ? 'BLOB_PRIVATE_READ_WRITE_TOKEN' : 'BLOB_READ_WRITE_TOKEN';
    const problem = host !== `${storeIdOf(token)}.${access}.blob.vercel-storage.com` ? `${name} must belong to a ${access} store (the file was kept at ${host || 'no address'})`
      : !r.pathname.startsWith(`${visibility}/${folder}/`) || !BLOB_KEY.test(r.pathname) ? `Upload failed: unexpected pathname ${r.pathname}` : null;
    if (problem) {
      await blobDel(r.url || r.pathname, { token }).catch(e => console.error('storage: could not delete a refused blob upload', e));
      throw new Error(problem);
    }
    key = r.pathname;
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
  if (driver() === 'blob') return `https://${blobStoreId('BLOB_READ_WRITE_TOKEN')}.public.blob.vercel-storage.com/${key}`;
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
  if (driver() === 'blob') {
    if (!BLOB_KEY.test(key)) return null;
    const r = await blobGet(key, { access: blobAccess(key), token: blobToken(key) })
      .catch(e => { if (e instanceof BlobNotFoundError) return null; throw e; });
    if (!r || r.statusCode !== 200) return null;
    return { body: Buffer.from(await new Response(r.stream).arrayBuffer()), contentType: r.blob.contentType || guessType(key) };
  }
  const r = await s3().fetch(objectUrl(key));
  if (!r.ok) return null;
  return { body: Buffer.from(await r.arrayBuffer()), contentType: r.headers.get('content-type') ?? guessType(key) };
}

export async function deleteFile(key: string): Promise<void> {
  if (key.startsWith('/')) return; // bundled static assets are part of the app
  if (driver() === 'local') { const path = localPath(key); if (path) await unlink(path).catch(() => {}); return; }
  if (driver() === 'blob') {
    if (BLOB_KEY.test(key)) await blobDel(key, { token: blobToken(key) }).catch(e => { if (!(e instanceof BlobNotFoundError)) throw e; });
    return;
  }
  const r = await s3().fetch(objectUrl(key), { method: 'DELETE' });
  if (!r.ok && r.status !== 404) throw new Error(`Delete failed: ${r.status}`);
}

function guessType(key: string) {
  const e = key.split('.').pop();
  return ({ jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', pdf: 'application/pdf' } as Record<string, string>)[e ?? ''] ?? 'application/octet-stream';
}
