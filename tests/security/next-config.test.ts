// Security: /_next/image is not an open image proxy (image-optimizer-wildcard-r2dev). The optimizer
// is off (no page uses next/image) and no wildcard host is allowed should it be turned on.
import { describe, expect, it } from 'vitest';
import config from '@/next.config';

describe('next.config images', () => {
  it('turns the optimizer off and names only our own media host', () => {
    expect(config.images?.unoptimized).toBe(true);
    const hosts = (config.images?.remotePatterns ?? []).map(p => (p instanceof URL ? p.hostname : p.hostname));
    expect(hosts.every(h => !h.includes('*'))).toBe(true);
    expect(hosts).not.toContain('**.r2.dev');
  });
});
