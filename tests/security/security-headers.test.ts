// Security headers on every route (next.config.ts headers() → lib/security-headers.ts).
import { describe, expect, it } from 'vitest';
import config from '@/next.config';
import { cspDirectives, securityHeaders } from '@/lib/security-headers';

const prod = { NODE_ENV: 'production' };
const header = (rules: ReturnType<typeof securityHeaders>, source: string, key: string) =>
  rules.find(r => r.source === source)?.headers.find(h => h.key === key)?.value;

describe('security headers', () => {
  it('next.config sends them on every route', async () => {
    const rules = await config.headers!();
    const all = rules.find(r => r.source === '/:path*')!;
    expect(all.headers.map(h => h.key)).toEqual(expect.arrayContaining([
      'Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'Permissions-Policy', 'X-Frame-Options', 'Content-Security-Policy',
    ]));
  });

  it('has the fixed values', () => {
    const r = securityHeaders(prod);
    expect(header(r, '/:path*', 'Strict-Transport-Security')).toBe('max-age=63072000; includeSubDomains');
    expect(header(r, '/:path*', 'X-Content-Type-Options')).toBe('nosniff');
    expect(header(r, '/:path*', 'Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(header(r, '/:path*', 'Permissions-Policy')).toBe('camera=(), microphone=(), geolocation=(), payment=(self "https://checkout.stripe.com")');
    expect(header(r, '/:path*', 'X-Frame-Options')).toBe('DENY');
  });

  it('the production CSP', () => {
    expect(header(securityHeaders(prod), '/:path*', 'Content-Security-Policy')).toBe([
      "default-src 'self'",
      "img-src 'self' data: blob: https://media.eventat.bg",
      "style-src 'self' 'unsafe-inline'",
      "script-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "connect-src 'self'",
      "form-action 'self' https://checkout.stripe.com",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "object-src 'none'",
      'upgrade-insecure-requests',
    ].join('; '));
  });

  it('adds the R2 public host, and the providers that are switched on', () => {
    const d = cspDirectives({ ...prod, S3_PUBLIC_URL: 'https://pub-0123.r2.dev/', PAYMENT_PROVIDER: 'stripe', GOOGLE_CLIENT_ID: 'g', GOOGLE_CLIENT_SECRET: 's' });
    expect(d['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://media.eventat.bg', 'https://pub-0123.r2.dev', 'https://*.googleusercontent.com']);
    expect(d['form-action']).toEqual(["'self'", 'https://checkout.stripe.com', 'https://connect.stripe.com', 'https://accounts.google.com']);
    // Our own media domain as the public URL is not listed twice; a broken value is ignored.
    expect(cspDirectives({ ...prod, S3_PUBLIC_URL: 'https://media.eventat.bg/public' })['img-src']).toEqual(["'self'", 'data:', 'blob:', 'https://media.eventat.bg']);
    expect(cspDirectives({ ...prod, S3_PUBLIC_URL: 'media bucket' })['img-src']).toHaveLength(4);
  });

  it('allows eval and the reload socket only under next dev, never in a build', () => {
    expect(cspDirectives(prod)['script-src']).not.toContain("'unsafe-eval'");
    expect(cspDirectives({ NODE_ENV: 'development' })['script-src']).toContain("'unsafe-eval'");
    expect(cspDirectives({ NODE_ENV: 'development' })['connect-src']).toContain('ws:');
  });

  it('only the admin email preview may be framed, and only by the site itself', () => {
    const r = securityHeaders(prod);
    expect(header(r, '/admin/imeyli/:key/preview', 'X-Frame-Options')).toBe('SAMEORIGIN');
    expect(header(r, '/admin/imeyli/:key/preview', 'Content-Security-Policy')).toContain("frame-ancestors 'self'");
    expect(header(r, '/api/invoices/:id', 'Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(header(r, '/api/invoices/:id', 'Content-Security-Policy')).toContain('font-src \'self\' https://fonts.gstatic.com');
    // The overrides come after the site-wide rule (Next.js: the last rule for a header wins).
    expect(r.map(x => x.source)[0]).toBe('/:path*');
  });
});
