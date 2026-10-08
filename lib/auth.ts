import 'server-only';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { nextCookies } from 'better-auth/next-js';
import { emailOTP, twoFactor } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import * as schema from '@/db/schema';
import { sendEmail } from '@/lib/email/send';

/** Who an auth email goes to. Partners' emails also name the business (partner_account.business_name when it exists). */
async function recipient(email: string): Promise<{ role: 'client' | 'partner' | 'admin'; id: string | null; name: string; partnerName: string }> {
  const [u] = await db.select({ id: schema.user.id, role: schema.user.role, name: schema.user.name }).from(schema.user).where(eq(schema.user.email, email)).limit(1);
  if (!u) return { role: 'client', id: null, name: '', partnerName: '' };
  return { role: u.role, id: u.id, name: u.name, partnerName: (await partnerNameFor(u.id)) ?? u.name };
}

/** Business name of the partner a user belongs to; replaced by the domain layer once partner tables exist. */
let partnerNameFor: (userId: string) => Promise<string | null> = async () => null;
export function setPartnerNameLookup(fn: (userId: string) => Promise<string | null>) { partnerNameFor = fn; }

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
      const r = await recipient(user.email);
      await sendEmail({ key: r.role === 'partner' ? 'vendor-password-reset' : 'client-password-link', to: user.email, toUserId: user.id, vars: { url, email: user.email, partnerName: r.partnerName } });
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
        const r = await recipient(email);
        await sendEmail({ key: r.role === 'partner' ? 'vendor-verify-code' : 'client-verify-code', to: email, toUserId: r.id, vars: { code: otp, email, partnerName: r.partnerName, contactName: r.name } });
      },
    }),
    twoFactor({ issuer: 'EventAT' }),
    nextCookies(), // must stay last
  ],
});

export type Session = typeof auth.$Infer.Session;
