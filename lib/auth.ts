import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email/send';
import { afterPasswordChanged, deviceFromUserAgent } from '@/lib/domain/clients';

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

const social: Record<string, { clientId: string; clientSecret: string }> = {};
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
  social.google = { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET };
if (process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET)
  social.facebook = { clientId: process.env.FACEBOOK_CLIENT_ID, clientSecret: process.env.FACEBOOK_CLIENT_SECRET };

export const auth = betterAuth({
  appName: 'EventAT',
  baseURL: process.env.BETTER_AUTH_URL ?? process.env.APP_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  telemetry: { enabled: false },
  // Better Auth's own limits (on in production). AUTH_RATE_LIMIT=off only for local end-to-end runs,
  // which sign in dozens of times a minute from one address.
  rateLimit: { enabled: process.env.AUTH_RATE_LIMIT === 'off' ? false : process.env.NODE_ENV === 'production' },
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: { user: schema.user, session: schema.session, account: schema.account, verification: schema.verification, twoFactor: schema.twoFactor },
  }),
  user: {
    additionalFields: {
      role: { type: 'string', required: false, defaultValue: 'client', input: false },
      phone: { type: 'string', required: false, input: true },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 30,          // "Запомни ме": 30 days
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 5 * 60 },
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
    session: {
      create: {
        // SPEC §1.3: a blocked (or deleted) user cannot sign in by any method. Each session gets a
        // device label from the user agent and the user's last known city (‹Активни сесии›, §16).
        async before(s) {
          const [u] = await db.select({ banned: schema.user.banned, deletedAt: schema.user.deletedAt, city: schema.user.lastLoginCity })
            .from(schema.user).where(eq(schema.user.id, s.userId)).limit(1);
          if (!u || u.banned || u.deletedAt) return false;
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
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
