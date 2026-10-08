import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email/send';

async function roleOf(email: string): Promise<'client' | 'partner' | 'admin'> {
  const [u] = await db.select({ role: schema.user.role }).from(schema.user).where(eq(schema.user.email, email)).limit(1);
  return u?.role ?? 'client';
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
  },
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: true,
    resetPasswordTokenExpiresIn: 60 * 60,
    sendResetPassword: async ({ user, url }) => {
      const role = await roleOf(user.email);
      await sendEmail({ key: role === 'partner' ? 'vendor-password-reset' : 'client-password-link', to: user.email, toUserId: user.id, vars: { url, email: user.email } });
    },
  },
  emailVerification: { autoSignInAfterVerification: true },
  socialProviders: social,
  plugins: [
    emailOTP({
      otpLength: 6,
      expiresIn: 10 * 60,
      allowedAttempts: 5,
      sendVerificationOnSignUp: true,
      overrideDefaultEmailVerification: true,
      async sendVerificationOTP({ email, otp, type }) {
        if (type !== 'email-verification') return;
        const role = await roleOf(email);
        await sendEmail({ key: role === 'partner' ? 'vendor-verify-code' : 'client-verify-code', to: email, vars: { code: otp, email } });
      },
    }),
    twoFactor({ issuer: 'EventAT' }),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
