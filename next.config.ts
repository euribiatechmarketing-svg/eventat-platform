import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';

// ── Storage media hosts (STORAGE_DRIVER=blob) ─────────────────────────────────────────────────────────
// Staging keeps files in Vercel Blob (lib/storage): public photos load from the public store's own host,
// https://<store id>.public.blob.vercel-storage.com, named exactly — the store id is part of BLOB_READ_WRITE_TOKEN —
// never a wildcard, which would admit every Vercel customer's store. Other drivers add nothing.
// A Content-Security-Policy adds `https://<host>` for each of these to img-src.
const blobPublicStore = process.env.STORAGE_DRIVER === 'blob'
  ? /^vercel_blob_rw_([A-Za-z0-9]+)_/.exec(process.env.BLOB_READ_WRITE_TOKEN ?? '')?.[1]?.toLowerCase() : undefined;
const storageImageHosts = blobPublicStore ? [`${blobPublicStore}.public.blob.vercel-storage.com`] : [];
const storageImagePatterns = storageImageHosts.map(hostname => ({ protocol: 'https' as const, hostname, pathname: '/public/**' }));
// ── end storage media hosts ───────────────────────────────────────────────────────────────────────────

const nextConfig: NextConfig = {
  // The prototype's Bulgarian copy and the app share one language; no i18n routing.
  poweredByHeader: false,
  // A second build directory lets `next dev` run beside a `next start` (NEXT_DIST_DIR=.next-dev).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['postgres'],
  // No page uses next/image, so the optimizer (/_next/image) stays off: with a wildcard host it fetched
  // and transformed anyone's R2 images at our expense. Should it be turned on, only our own media host.
  images: { unoptimized: true, remotePatterns: [{ protocol: 'https', hostname: 'media.eventat.bg', pathname: '/public/**' }, ...storageImagePatterns] },
  experimental: { serverActions: { bodySizeLimit: '12mb' }, globalNotFound: true },
  // HSTS, CSP, framing, referrer and permissions for every route (lib/security-headers.ts).
  async headers() {
    return securityHeaders(process.env);
  },
};

export default nextConfig;
