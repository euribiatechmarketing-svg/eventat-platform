// Security headers for every response (next.config.ts headers()). Read when the app is built:
// a change to S3_PUBLIC_URL or the social sign-in variables needs a new build (on Vercel, a redeploy).
// Pure and dependency-free, because next.config.ts imports it.

type Env = Record<string, string | undefined>;
export type HeaderRule = { source: string; headers: { key: string; value: string }[] };

const MEDIA_ORIGIN = 'https://media.eventat.bg';
const STRIPE_CHECKOUT = 'https://checkout.stripe.com';

const originOf = (url: string | undefined): string | null => {
  if (!url?.trim()) return null;
  try {
    const u = new URL(url.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null;
  } catch { return null; }
};
const uniq = (xs: (string | null | false | undefined)[]) => [...new Set(xs.filter((x): x is string => !!x))];
const policy = (d: Record<string, string[]>) =>
  Object.entries(d).map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k)).join('; ');

/** The directives of the site-wide Content-Security-Policy. */
export function cspDirectives(env: Env): Record<string, string[]> {
  const dev = env.NODE_ENV === 'development';
  const google = !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const facebook = !!(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET);
  return {
    'default-src': ["'self'"],
    // Listing photos: our media domain and the R2 bucket's public URL. A Google / Facebook sign-in
    // keeps the provider's profile picture (‹Настройки› shows it).
    'img-src': uniq(["'self'", 'data:', 'blob:', MEDIA_ORIGIN, originOf(env.S3_PUBLIC_URL),
      google && 'https://*.googleusercontent.com', facebook && 'https://platform-lookaside.fbsbx.com']),
    'style-src': ["'self'", "'unsafe-inline'"],
    // Next.js inlines its bootstrap and page data; `next dev` also needs eval (React's dev tools).
    'script-src': uniq(["'self'", "'unsafe-inline'", dev && "'unsafe-eval'"]),
    'font-src': ["'self'"],
    // `next dev` reloads over a websocket.
    'connect-src': uniq(["'self'", dev && 'ws:']),
    // A form posted before the page is interactive follows the server's redirect natively, and the
    // browser checks every hop: Stripe checkout and Connect onboarding, and the social sign-in pages.
    'form-action': uniq(["'self'", STRIPE_CHECKOUT, env.PAYMENT_PROVIDER === 'stripe' && 'https://connect.stripe.com',
      google && 'https://accounts.google.com', facebook && 'https://www.facebook.com']),
    'frame-ancestors': ["'none'"],
    'base-uri': ["'self'"],
    'object-src': ["'none'"],
    // Off under `next dev`, which a phone on the LAN opens over plain http.
    ...(dev ? {} : { 'upgrade-insecure-requests': [] }),
  };
}

export const contentSecurityPolicy = (env: Env) => policy(cspDirectives(env));

/**
 * Two standalone documents draw the transactional emails' look with Google Fonts (as the emails do
 * in an inbox): the invoice print view and the admin email preview, which the admin page frames.
 */
function documentPolicy(env: Env, framedBySelf: boolean): string {
  const d = cspDirectives(env);
  return policy({
    ...d,
    'style-src': [...d['style-src'], 'https://fonts.googleapis.com'],
    'font-src': [...d['font-src'], 'https://fonts.gstatic.com'],
    ...(framedBySelf ? { 'frame-ancestors': ["'self'"] } : {}),
  });
}

export function securityHeaders(env: Env): HeaderRule[] {
  const site = [
    // Two years. Browsers ignore it over plain http, so localhost is unaffected.
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: `camera=(), microphone=(), geolocation=(), payment=(self "${STRIPE_CHECKOUT}")` },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Content-Security-Policy', value: contentSecurityPolicy(env) },
  ];
  // Later rules override the same header of earlier ones (Next.js applies them in order).
  return [
    { source: '/:path*', headers: site },
    { source: '/api/invoices/:id', headers: [{ key: 'Content-Security-Policy', value: documentPolicy(env, false) }] },
    { source: '/admin/imeyli/:key/preview', headers: [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'Content-Security-Policy', value: documentPolicy(env, true) },
    ] },
  ];
}
