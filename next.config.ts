import type { NextConfig } from 'next';
import { securityHeaders } from './lib/security-headers';

const nextConfig: NextConfig = {
  // The prototype's Bulgarian copy and the app share one language; no i18n routing.
  poweredByHeader: false,
  // A second build directory lets `next dev` run beside a `next start` (NEXT_DIST_DIR=.next-dev).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['postgres'],
  // No page uses next/image, so the optimizer (/_next/image) stays off: with a wildcard host it fetched
  // and transformed anyone's R2 images at our expense. Should it be turned on, only our own media host.
  images: { unoptimized: true, remotePatterns: [{ protocol: 'https', hostname: 'media.eventat.bg', pathname: '/public/**' }] },
  experimental: { serverActions: { bodySizeLimit: '12mb' }, globalNotFound: true },
  // HSTS, CSP, framing, referrer and permissions for every route (lib/security-headers.ts).
  async headers() {
    return securityHeaders(process.env);
  },
};

export default nextConfig;
