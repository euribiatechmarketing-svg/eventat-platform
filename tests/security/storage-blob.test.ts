// Storage on Vercel Blob (STORAGE_DRIVER=blob, staging): @vercel/blob is mocked, so nothing leaves the machine.
// Public files go to the public store with a random suffix and load from its own host; private files go to a
// separate private store (a store's access is fixed when it is created, and a public store serves every blob
// in it), get no URL, and reach a browser only through /api/files/<media id> after media.canAccess().
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlobNotFoundError } from '@vercel/blob';
import { MEDIA_RULES, upload } from '@/lib/domain/media';
import { mediaHref } from '@/lib/domain/catalogue-kit';
import { getRequestForPartner } from '@/lib/domain/requests';
import { requestPageExtras } from '@/lib/domain/views-partner-ops';
import { setTestNow } from '@/lib/clock';
import { deleteFile, fileUrl, getFile, putFile } from '@/lib/storage';
import { GET as uploadsGET } from '@/app/uploads/[...key]/route';
import { GET as filesGET } from '@/app/api/files/[...path]/route';
import type { MediaKind } from '@/db/schema';
import { createClient, createPartner } from '../helpers/factories';
import { NOW, sendFor } from '../helpers/lifecycle';

const STORE = { public: 'PubStoreAbc123', private: 'PrivStoreXyz789' };
const TOKEN = { public: `vercel_blob_rw_${STORE.public}_publicsecret`, private: `vercel_blob_rw_${STORE.private}_privatesecret` };
const PUBLIC_HOST = `${STORE.public.toLowerCase()}.public.blob.vercel-storage.com`;

// An in-memory pair of stores behind the mocked SDK: a blob is found only with its own store's token and access.
type Saved = { body: Buffer; contentType: string; access: string; token: string };
const blob = vi.hoisted(() => ({ put: vi.fn(), get: vi.fn(), head: vi.fn(), del: vi.fn(), saved: new Map<string, Saved>() }));
vi.mock('@vercel/blob', async importOriginal => ({
  ...(await importOriginal<typeof import('@vercel/blob')>()),
  put: blob.put, get: blob.get, head: blob.head, del: blob.del,
}));

// /api/files asks lib/session who is signed in.
const who = vi.hoisted(() => ({ user: null as null | { id: string; role: 'client' | 'partner' | 'admin' } }));
vi.mock('@/lib/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/session')>()),
  currentUser: async () => (who.user ? { ...who.user, name: 'x', email: 'x@example.com', phone: null, emailVerified: true, image: null } : null),
}));

const storeOf = (token: string) => token.split('_')[3].toLowerCase();
const blobUrl = (o: { token: string; access: string }, pathname: string) => `https://${storeOf(o.token)}.${o.access}.blob.vercel-storage.com/${pathname}`;
const jpeg = () => new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'a.jpg', { type: 'image/jpeg' });
const pdf = () => new File([Buffer.from('%PDF-1.4\n%%EOF')], 'a.pdf', { type: 'application/pdf' });

beforeEach(() => {
  vi.stubEnv('STORAGE_DRIVER', 'blob');
  vi.stubEnv('BLOB_READ_WRITE_TOKEN', TOKEN.public);
  vi.stubEnv('BLOB_PRIVATE_READ_WRITE_TOKEN', TOKEN.private);
  who.user = null;
  blob.put.mockImplementation(async (pathname: string, body: Buffer, o: { access: string; token: string; contentType: string; addRandomSuffix?: boolean }) => {
    const suffix = Math.random().toString(36).slice(2, 12);
    const p = o.addRandomSuffix ? pathname.replace(/(\.[a-z]+)$/, `-${suffix}$1`) : pathname;
    blob.saved.set(p, { body: Buffer.from(body), contentType: o.contentType, access: o.access, token: o.token });
    return { pathname: p, url: blobUrl(o, p), downloadUrl: `${blobUrl(o, p)}?download=1`, contentType: o.contentType, contentDisposition: 'inline', etag: '"1"' };
  });
  blob.get.mockImplementation(async (pathname: string, o: { access: string; token: string }) => {
    const f = blob.saved.get(pathname);
    if (!f || f.token !== o.token || f.access !== o.access) return null;
    return {
      statusCode: 200, stream: new Blob([new Uint8Array(f.body)]).stream(), headers: new Headers(),
      blob: { url: blobUrl(o, pathname), downloadUrl: '', pathname, contentType: f.contentType, contentDisposition: '', cacheControl: '', uploadedAt: new Date(), etag: '"1"', size: f.body.length },
    };
  });
  blob.del.mockImplementation(async (pathname: string, o: { token: string }) => {
    if (blob.saved.get(pathname)?.token === o.token) blob.saved.delete(pathname);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); setTestNow(null); });
afterAll(() => { blob.saved.clear(); });

describe('blob driver: where files go', () => {
  it('stores a public file in the public store with a random suffix, served from that store’s host', async () => {
    const s = await putFile(jpeg(), 'gallery/u1', 'public');
    expect(blob.put).toHaveBeenCalledTimes(1);
    const [pathname, body, options] = blob.put.mock.calls[0];
    expect(pathname).toMatch(/^public\/gallery\/u1\/[0-9a-f-]{36}\.jpg$/);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(options).toEqual({ access: 'public', addRandomSuffix: true, contentType: 'image/jpeg', token: TOKEN.public });
    // The key is the pathname the store answered with (suffix included); the URL is the one it serves the file at.
    expect(s.key).toMatch(/^public\/gallery\/u1\/[0-9a-f-]{36}-[a-z0-9]+\.jpg$/);
    expect(s.url).toBe(`https://${PUBLIC_HOST}/${s.key}`);
    expect(fileUrl(s.key)).toBe(await blob.put.mock.results[0].value.then((r: { url: string }) => r.url));
  });

  it('stores a private file in the private store, with no URL of its own', async () => {
    const s = await putFile(pdf(), 'bank_proof/u1', 'private');
    const [pathname, , options] = blob.put.mock.calls[0];
    expect(pathname).toMatch(/^private\/bank_proof\/u1\/[0-9a-f-]{36}\.pdf$/);
    expect(options).toEqual({ access: 'private', addRandomSuffix: true, contentType: 'application/pdf', token: TOKEN.private });
    expect(s.key).toMatch(/^private\/bank_proof\/u1\/[0-9a-f-]{36}-[a-z0-9]+\.pdf$/);
    expect(s.url).toBeNull();
    expect(() => fileUrl(s.key)).toThrow(/media id/);
  });

  it('refuses a private file without a private store of its own (nothing is stored)', async () => {
    vi.stubEnv('BLOB_PRIVATE_READ_WRITE_TOKEN', '');
    await expect(putFile(jpeg(), 'request_attachment/u1', 'private')).rejects.toThrow(/BLOB_PRIVATE_READ_WRITE_TOKEN/);
    // Another token of the public store is still the public store.
    vi.stubEnv('BLOB_PRIVATE_READ_WRITE_TOKEN', `vercel_blob_rw_${STORE.public}_othersecret`);
    await expect(putFile(jpeg(), 'request_attachment/u1', 'private')).rejects.toThrow(/private store/);
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('refuses a public file without the public store’s token', async () => {
    vi.stubEnv('BLOB_READ_WRITE_TOKEN', '');
    await expect(putFile(jpeg(), 'gallery/u1', 'public')).rejects.toThrow(/BLOB_READ_WRITE_TOKEN/);
    expect(blob.put).not.toHaveBeenCalled();
  });
});

describe('blob driver: reading and deleting', () => {
  it('getFile reads each file from its own store with that store’s token', async () => {
    const priv = await putFile(jpeg(), 'dispute_evidence/u1', 'private');
    const pub = await putFile(jpeg(), 'gallery/u1', 'public');
    expect(await getFile(priv.key)).toEqual({ body: Buffer.from([0xff, 0xd8, 0xff, 0xd9]), contentType: 'image/jpeg' });
    expect(blob.get).toHaveBeenLastCalledWith(priv.key, { access: 'private', token: TOKEN.private });
    expect((await getFile(pub.key))?.body.length).toBe(4);
    expect(blob.get).toHaveBeenLastCalledWith(pub.key, { access: 'public', token: TOKEN.public });
    expect(await getFile('private/dispute_evidence/u1/missing.jpg')).toBeNull();
  });

  it('getFile answers null for a missing blob, refuses odd keys without asking the store, and surfaces other failures', async () => {
    for (const key of ['../x.jpg', 'private/../public/x.jpg', 'public/a/../../x.jpg', '/etc/hosts', 'https://evil.example/x.jpg', 'other/x.jpg']) {
      expect(await getFile(key), key).toBeNull();
    }
    expect(blob.get).not.toHaveBeenCalled();
    blob.get.mockRejectedValueOnce(new BlobNotFoundError());
    expect(await getFile('private/x/y/z.jpg')).toBeNull();
    blob.get.mockRejectedValueOnce(new Error('store unavailable'));
    await expect(getFile('private/x/y/z.jpg')).rejects.toThrow(/store unavailable/);
  });

  it('deleteFile deletes from the file’s own store; bundled photos and odd keys are left alone', async () => {
    const priv = await putFile(jpeg(), 'message_attachment/u1', 'private');
    const pub = await putFile(jpeg(), 'gallery/u1', 'public');
    await deleteFile(priv.key);
    await deleteFile(pub.key);
    expect(blob.del.mock.calls).toEqual([[priv.key, { token: TOKEN.private }], [pub.key, { token: TOKEN.public }]]);
    expect(blob.saved.has(priv.key) || blob.saved.has(pub.key)).toBe(false);
    await deleteFile('/photos/dj-1.jpg');
    await deleteFile('private/../x.jpg');
    expect(blob.del).toHaveBeenCalledTimes(2);
    blob.del.mockRejectedValueOnce(new BlobNotFoundError());
    await expect(deleteFile(priv.key)).resolves.toBeUndefined();
  });

  it('/uploads/… serves nothing with the blob driver (public files load from the store’s host)', async () => {
    const pub = await putFile(jpeg(), 'gallery/u1', 'public');
    const r = await uploadsGET(new Request('http://localhost/uploads'), { params: Promise.resolve({ key: pub.key.split('/') }) });
    expect(r.status).toBe(404);
    expect(blob.get).not.toHaveBeenCalled();
  });
});

describe('blob driver: a private file’s blob URL never reaches a page', () => {
  it('every private kind is linked by media id, every public kind by the public store’s URL', async () => {
    const id = '0f1e2d3c-4b5a-4978-8796-a5b4c3d2e1f0';
    for (const [kind, rule] of Object.entries(MEDIA_RULES) as [MediaKind, (typeof MEDIA_RULES)[MediaKind]][]) {
      const s = await putFile(rule.mimes.includes('image/jpeg') ? jpeg() : pdf(), `${kind}/u1`, rule.visibility);
      const href = mediaHref(id, s.key);
      if (rule.visibility === 'private') expect(href, kind).toBe(`/api/files/${id}`);
      else expect(href, kind).toBe(`https://${PUBLIC_HOST}/${s.key}`);
    }
    // No private file was ever written to the public store.
    for (const [, , o] of blob.put.mock.calls as [string, Buffer, { access: string; token: string }][]) {
      expect(o.access === 'private').toBe(o.token === TOKEN.private);
    }
  });

  it('a client’s inspiration photo: private store → the partner’s request page links /api/files/<id> → the route streams it after the access check', async () => {
    setTestNow(NOW);
    const client = await createClient();
    const partner = await createPartner();
    const m = await upload(client.actor, { kind: 'request_attachment', file: jpeg() });
    expect(m.storageKey.startsWith('private/request_attachment/')).toBe(true);
    expect(blob.saved.get(m.storageKey)).toMatchObject({ access: 'private', token: TOKEN.private });
    const { number } = await sendFor(client, partner, { attachmentMediaIds: [m.id] });

    // What /partner/zayavki/[nomer] renders from.
    const r = await getRequestForPartner(partner.actor, number);
    const x = await requestPageExtras(partner.actor, { number, serviceId: r.serviceId, attachmentMediaIds: r.attachmentMediaIds });
    const props = JSON.stringify({ r, x });
    expect(x?.attachments).toEqual([`/api/files/${m.id}`]);
    expect(props).not.toContain('blob.vercel-storage.com');
    expect(props).not.toContain(m.storageKey);

    const fetchAs = async (u: typeof who.user) => {
      who.user = u;
      return filesGET(new Request(`http://localhost/api/files/${m.id}`), { params: Promise.resolve({ path: [m.id] }) });
    };
    // Guests and strangers get nothing, and the store is not asked.
    expect((await fetchAs(null)).status).toBe(401);
    const stranger = await createClient();
    expect((await fetchAs({ id: stranger.user.id, role: 'client' })).status).toBe(404);
    expect(blob.get).not.toHaveBeenCalled();

    // The partner the request went to: the bytes, fetched server-side from the private store — no redirect to it.
    const ok = await fetchAs({ id: partner.user.id, role: 'partner' });
    expect(ok.status).toBe(200);
    expect(ok.headers.get('location')).toBeNull();
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    expect(ok.headers.get('cache-control')).toMatch(/^private/);
    expect(Buffer.from(await ok.arrayBuffer())).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(blob.get).toHaveBeenCalledWith(m.storageKey, { access: 'private', token: TOKEN.private });
  });
});
