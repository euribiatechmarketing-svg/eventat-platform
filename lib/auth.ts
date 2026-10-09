import 'server-only';
import { betterAuth, type BetterAuthPlugin } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email/send';
import { afterPasswordChanged, deviceFromUserAgent } from '@/lib/domain/clients';
import { now } from '@/lib/clock';

/** Who an auth email goes to. Partners' emails also name the business (partner.business_name once it exists). */
async function recipient(email: string): Promise<{ role: 'client' | 'partner' | 'admin'; id: string | null; name: string; partnerName: string }> {
  const [u] = await db.select({ id: schema.user.id, role: schema.user.role, name: schema.user.name }).from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (!u) return { role: 'client', id: null, name: '', partnerName: '' };
  return { role: u.role, id: u.id, name: u.name, partnerName: (await partnerNameFor(u.id)) ?? u.name };
}

/** Business name of the partner a user belongs to (partner_member → partner), or null. */
async function partnerNameFor(userId: string): Promise<string | null> {
  const [p] = await db.select({ name: schema.partner.businessName })
    .from(schema.partnerMember)
    .innerJoin(schema.partner, eq(schema.partner.id, schema.partnerMember.partnerId))
    .where(eq(schema.partnerMember.userId, userId))
    .limit(1);
  return p?.name ?? null;
}

// SPEC §4.1 A4: Google / Facebook sign in only with an address the provider vouches for. Better Auth
// then refuses the session to a user whose address is unconfirmed (requireEmailVerification), and
// `validateUserInfo` below refuses to create or link a user from an unvouched address at all.
// (Better Auth never reads a verified flag from Facebook, so Facebook cannot add a new profile.)
const social: Record<string, { clientId: string; clientSecret: string; requireEmailVerification: true }> = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  social.google = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, requireEmailVerification: true };
if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET)
  social.facebook = { clientId: process.env.FACEBOOK_CLIENT_ID, clientSecret: process.env.FACEBOOK_CLIENT_SECRET, requireEmailVerification: true };

/** Where app/api/auth/[...all]/route.ts mounts Better Auth. */
const AUTH_BASE_PATH = '/api/auth';

/**
 * The only Better Auth HTTP routes (/api/auth/*) the site uses; every other one answers 404.
 * Sign-in, sign-up, codes, resets and the SMS step are server actions calling auth.api directly
 * (never blocked by this), each behind its own checks and lib/domain/throttle. Mounted as-is, the
 * plugins' own routes would bypass those checks: a session from an email code alone
 * (/email-otp/verify-email, /sign-in/email-otp), a password set from a code nobody was sent
 * (/email-otp/reset-password), a new phone for the SMS step (/update-user), and so on.
 */
const HTTP_ROUTES: { method: string; path: RegExp }[] = [
  { method: 'GET', path: /^\/callback\/[a-z]+$/ },          // Google / Facebook send the visitor back here
  { method: 'GET', path: /^\/reset-password\/[\w-]+$/ },    // the link in client-password-link / vendor-password-reset
  { method: 'GET', path: /^\/error$/ },                     // Better Auth's page when an OAuth round trip fails early
  { method: 'POST', path: /^\/sign-in\/email$/ },           // tools/shoot.py and tests/e2e (password, SMS step and the limiter still apply)
];

/** Is `method path` (path below /api/auth) one of HTTP_ROUTES? */
function isPublicAuthRoute(method: string, path: string): boolean {
  return HTTP_ROUTES.some(r => r.method === method.toUpperCase() && r.path.test(path));
}

/** Answers 404 for every Better Auth HTTP route outside HTTP_ROUTES (server-side auth.api calls are unaffected). */
const httpAllowList = (): BetterAuthPlugin => ({
  id: 'eventat-http-routes',
  async onRequest(request) {
    const { pathname } = new URL(request.url);
    const path = pathname.startsWith(`${AUTH_BASE_PATH}/`) ? pathname.slice(AUTH_BASE_PATH.length) : '';
    if (!isPublicAuthRoute(request.method, path)) return { response: new Response('Not Found', { status: 404 }) };
  },
});

export const auth = betterAuth({
  appName: 'EventAT',
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL,
  basePath: AUTH_BASE_PATH,
  secret: process.env.BETTER_AUTH_SECRET,
  telemetry: { enabled: false },
  // Better Auth's own limits for its HTTP routes (/api/auth/*; on in production), counted in the
  // database so every serverless instance shares them. They never see the sign-in, reset and code
  // forms: those are server actions calling auth.api directly, throttled by lib/domain/throttle.ts.
  // AUTH_RATE_LIMIT=off (both) only for local end-to-end runs, which sign in dozens of times a minute.
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT === 'off' ? false : process.env.NODE_ENV === 'production', storage: 'database' },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, twoFactor: schema.twoFactor,
      rateLimit: schema.rateLimit,
    },
  }),
  user: {
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'client', input: false },
      phone: { type: 'string', required: false, input: true },
    },
    // A4: a Google / Facebook identity is admitted (new profile, link to an existing one, sign-in)
    // only when the provider vouches for the address. Otherwise someone else's address on a social
    // profile would hold a profile for that address, and the real owner's later sign-in or reset
    // would land in it.
    validateUserInfo({ user, source }) {
      if (source.method === 'oauth' && user.emailVerified !== true) return { error: 'email_not_verified' };
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,          // "Запомни ме": 30 days
    updateAge: 60 * 60 * 24,
    // No cookie cache: every request reads the session row, so blocking, deletion, ‹Излез
    // навсякъде› and a password reset end every other device's session at once (a cached
    // session_data cookie kept them working for its whole lifetime).
    cookieCache: { enabled: false },
    additionalFields: {
      deviceLabel: { type: 'string', required: false, input: false },
      city: { type: 'string', required: false, input: false },
    },
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    // A6: password_changed_at, every session revoked, client-password-changed (clients).
    onPasswordReset: async ({ user }) => { await afterPasswordChanged({ userId: user.id }); },
    sendResetPassword: async ({ user, url }) => {
      const r = await recipient(user.email);
      await sendEmail({ key: r.role === 'partner' ? 'vendor-password-reset' : 'client-password-link', to: user.email, toUserId: user.id, vars: { url, email: user.email, partnerName: r.partnerName } });
    },
  },
  // The sign-up action sends the code itself, after the client profile or the partner draft exists,
  // so the code email matches the role (client-verify-code / vendor-verify-code).
  emailVerification: { autoSignInAfterVerification: true, sendOnSignUp: false },
  socialProviders: social,
  databaseHooks: {
    user: {
      create: {
        // ‹Клиент от 2025›, ‹Регистрирани› and the admin's sign-up counts read the platform clock
        // (lib/clock: equal to real time in production, the demo day with ALLOW_TIME_TRAVEL).
        async before(u) {
          const at = await now();
          return { data: { ...u, createdAt: at, updatedAt: at } };
        },
      },
    },
    session: {
      create: {
        // SPEC §1.3: a blocked (or deleted) user cannot sign in by any method, and nobody gets a
        // session on an address not yet confirmed (A2/A3: the email code, A4: the provider). Each
        // session gets a device label from the user agent and the user's last known city (‹Активни сесии›, §16).
        async before(s) {
          const [u] = await db.select({ banned: schema.user.banned, deletedAt: schema.user.deletedAt, emailVerified: schema.user.emailVerified, city: schema.user.lastLoginCity })
            .from(schema.user).where(eq(schema.user.id, s.userId)).limit(1);
          if (!u || u.banned || u.deletedAt || !u.emailVerified) return false;
          return { data: { ...s, deviceLabel: deviceFromUserAgent(s.userAgent), city: u.city ?? null } };
        },
      },
    },
  },
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      sendVerificationOnSignUp: true,
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'email-verification') return;
        const r = await recipient(email);
        await sendEmail({ key: r.role === 'partner' ? 'vendor-verify-code' : 'client-verify-code', to: email, toUserId: r.id, vars: { code: otp, email, partnerName: r.partnerName, contactName: r.name } });
      },
    }),
    twoFactor({
      issuer: 'EventAT',
      // SPEC §1.3 / §11.4: the code goes by SMS to the profile phone (sms_outbox; ⚙ sms.transport).
      // The SMS wording is new copy awaiting approval (D20), so the text is the code alone.
      otpOptions: {
        period: 10,
        allowedAttempts: 5,
        async sendOTP({ user, otp }) {
          const [u] = await db.select({ phone: schema.user.phone }).from(schema.user).where(eq(schema.user.id, user.id)).limit(1);
          if (!u?.phone) return;
          await db.insert(schema.smsOutbox).values({ templateKey: 'two-factor-code', toPhone: u.phone, toUserId: user.id, body: otp });
        },
      },
    }),
    httpAllowList(),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
