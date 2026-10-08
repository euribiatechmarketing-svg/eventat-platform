import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The prototype's Bulgarian copy and the app share one language; no i18n routing.
  poweredByHeader: false,
  serverExternalPackages: ['postgres'],
  images: { remotePatterns: [{ protocol: 'https', hostname: '**.r2.dev' }, { protocol: 'https', hostname: 'media.eventat.bg' }] },
  experimental: { serverActions: { bodySizeLimit: '12mb' } },
};

export default nextConfig;
