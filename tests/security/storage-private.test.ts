// Security: private files never sit where a public URL serves them
// (r2-private-objects-in-public-bucket, local-driver-private-under-public). Before the fix a private
// object shared the public R2 bucket (whose public URL serves every key), the local driver wrote
// private files under public/ (served by Next as static files), and pages linked private files by
// their storage key (`/api/files/private/<key>`), which then also worked against the bucket URL.
import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { deleteFile, fileUrl, getFile, putFile } from '@/lib/storage';
import { GET as uploadsGET } from '@/app/uploads/[...key]/route';
import { GET as filesGET } from '@/app/api/files/[...path]/route';

const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'a.jpg', { type: 'image/jpeg' });
const stored: string[] = [];
afterAll(async () => { for (const k of stored) await deleteFile(k); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('local driver', () => {
  it('writes private files outside public/ and gives them no URL', async () => {
    const s = await putFile(jpeg(), 'bank_proof/test-user', 'private');
    stored.push(s.key);
    expect(s.key.startsWith('private/')).toBe(true);
    expect(s.url).toBeNull();
    expect(existsSync(join(process.cwd(), 'public', 'uploads', s.key))).toBe(false);
    expect(existsSync(join(process.cwd(), '.data', 'uploads', s.key))).toBe(true);
    expect((await getFile(s.key))?.body.length).toBe(4);
    expect(() => fileUrl(s.key)).toThrow();
    const r = await uploadsGET(new Request('http://localhost/uploads'), { params: Promise.resolve({ key: s.key.split('/') }) });
    expect(r.status).toBe(404);
  });

  it('moves a private file an earlier version left under public/uploads out of public/ on first read', async () => {
    const key = 'private/request_attachment/legacy-user/0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0.jpg';
    const legacy = join(process.cwd(), 'public', 'uploads', key);
    await mkdir(dirname(legacy), { recursive: true });
    await writeFile(legacy, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    stored.push(key);
    expect((await getFile(key))?.body.length).toBe(4);
    expect(existsSync(legacy)).toBe(false);
    expect(existsSync(join(process.cwd(), '.data', 'uploads', key))).toBe(true);
    await rm(join(process.cwd(), 'public', 'uploads', 'private', 'request_attachment', 'legacy-user'), { recursive: true, force: true });
  });
});

describe('s3 driver', () => {
  const s3 = () => {
    vi.stubEnv('STORAGE_DRIVER', 's3');
    vi.stubEnv('S3_ENDPOINT', 'https://r2.example.invalid');
    vi.stubEnv('S3_BUCKET', 'eventat-public');
    vi.stubEnv('S3_PUBLIC_URL', 'https://media.eventat.bg');
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (req: Request | string) => {
      urls.push(typeof req === 'string' ? req : req.url);
      return new Response(null, { status: 200 });
    }));
    return urls;
  };

  it('stores private files in the private bucket and public ones in the public bucket', async () => {
    const urls = s3();
    vi.stubEnv('S3_PRIVATE_BUCKET', 'eventat-private');
    const priv = await putFile(jpeg(), 'request_attachment/u1', 'private');
    const pub = await putFile(jpeg(), 'gallery/u1', 'public');
    expect(urls[0]).toBe(`https://r2.example.invalid/eventat-private/${priv.key}`);
    expect(urls[1]).toBe(`https://r2.example.invalid/eventat-public/${pub.key}`);
    expect(pub.url).toBe(`https://media.eventat.bg/${pub.key}`);
    expect(priv.url).toBeNull();
  });

  it('refuses to store a private file without a separate private bucket', async () => {
    s3();
    await expect(putFile(jpeg(), 'bank_proof/u1', 'private')).rejects.toThrow(/S3_PRIVATE_BUCKET/);
    vi.stubEnv('S3_PRIVATE_BUCKET', 'eventat-public');
    await expect(putFile(jpeg(), 'bank_proof/u1', 'private')).rejects.toThrow(/S3_PRIVATE_BUCKET/);
  });
});

describe('/api/files', () => {
  it('answers only by media id: a storage key in the URL is not found', async () => {
    const r = await filesGET(new Request('http://localhost/api/files/private/request_attachment/u/x.jpg'),
      { params: Promise.resolve({ path: ['private', 'request_attachment', 'u', 'x.jpg'] }) });
    expect(r.status).toBe(404);
  });
});
