// Security: /_next/image is not an open image proxy (image-optimizer-wildcard-r2dev). The optimizer
// is off (no page uses next/image) and no wildcard host is allowed should it be turned on.
// With the Vercel Blob driver (staging) only that project's public store is added, by its exact host.
import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '@/next.config';

const hostsOf = (c: typeof config) => (c.images?.remotePatterns ?? []).map(p => (p instanceof URL ? p.hostname : p.hostname));
async function configWith(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  vi.resetModules();
  return (await import('@/next.config')).default;
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe('next.config images', () => {
  it('turns the optimizer off and names only our own media host', () => {
    expect(config.images?.unoptimized).toBe(true);
    const hosts = hostsOf(config);
    expect(hosts.every(h => !h.includes('*'))).toBe(true);
    expect(hosts).not.toContain('**.r2.dev');
  });

  it('adds the public Blob store’s exact host only with STORAGE_DRIVER=blob', async () => {
    const token = 'vercel_blob_rw_PubStoreAbc123_secret';
    const blob = await configWith({ STORAGE_DRIVER: 'blob', BLOB_READ_WRITE_TOKEN: token });
    expect(blob.images?.unoptimized).toBe(true);
    expect(hostsOf(blob)).toEqual(['media.eventat.bg', 'pubstoreabc123.public.blob.vercel-storage.com']);
    expect(blob.images?.remotePatterns?.[1]).toMatchObject({ protocol: 'https', pathname: '/public/**' });
    for (const env of [{ STORAGE_DRIVER: 's3', BLOB_READ_WRITE_TOKEN: token }, { STORAGE_DRIVER: 'local', BLOB_READ_WRITE_TOKEN: token }, { STORAGE_DRIVER: 'blob', BLOB_READ_WRITE_TOKEN: '' }]) {
      expect(hostsOf(await configWith(env)), JSON.stringify(env)).toEqual(['media.eventat.bg']);
    }
  });
});
