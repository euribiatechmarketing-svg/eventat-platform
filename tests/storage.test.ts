// Local storage (STORAGE_DRIVER=local) and /uploads/…: files are read only from public/uploads, and the
// route serves public uploads only. Next hands the route decoded segments, so `/uploads/public/..%2F..%2Fx`
// arrives as the one segment `../../x` (journey J4 review: it used to return package.json).
import { afterAll, describe, expect, it } from 'vitest';
import { deleteFile, getFile, putFile } from '@/lib/storage';
import { GET } from '@/app/uploads/[...key]/route';

const get = (key: string[]) => GET(new Request('http://localhost/uploads'), { params: Promise.resolve({ key }) });
const stored: string[] = [];
afterAll(async () => { for (const k of stored) await deleteFile(k); });

describe('local uploads stay inside public/uploads', () => {
  it('getFile refuses a key that leaves the folder', async () => {
    expect(await getFile('../../package.json')).toBeNull();
    expect(await getFile('public/../../../package.json')).toBeNull();
    expect(await getFile('/etc/hosts')).toBeNull();
  });

  it('/uploads/… serves a stored public photo and nothing else', async () => {
    const s = await putFile(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], 'a.jpg', { type: 'image/jpeg' }), 'gallery/test', 'public');
    stored.push(s.key);
    expect(s.url).toBe(`/uploads/${s.key}`);
    const ok = await get(s.key.split('/'));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('image/jpeg');
    for (const key of [
      ['public', '../../../package.json'], ['public', '..', '..', 'package.json'], ['public', 'gallery', '..\\..\\package.json'],
      ['public', '.env.local'], ['private', 'x.jpg'], ['public'],
    ]) expect((await get(key)).status, key.join('/')).toBe(404);
  });
});
