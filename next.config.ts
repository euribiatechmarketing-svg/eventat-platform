import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The prototype's Bulgarian copy and the app share one language; no i18n routing.
  poweredByHeader: false,
  // A second build directory lets `next dev` run beside a `next start` (NEXT_DIST_DIR=.next-dev).
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['postgres'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.r2.dev' }, { protocol: 'https', hostname: 'media.eventat.bg' }] },
  experimental: { serverActions: { bodySizeLimit: '12mb' }, globalNotFound: true },
};

export default nextConfig;
