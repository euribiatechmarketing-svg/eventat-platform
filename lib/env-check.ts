// Production guards, run once when a server starts (instrumentation.ts register()).
// A production server refuses to boot on a configuration that is unsafe or cannot work:
// a guessable auth or cron secret, the demo clock on the public domain, Stripe without its
// secrets, local file storage on Vercel. Staging (a Vercel preview, or the demo clock on a
// *.vercel.app address) only logs the same findings, so the demo keeps running.
// Pure: reads only the env object it is given, never imports server code (also used by tests).

/** The placeholder in .env.example (tests/ops/env-check.test.ts keeps the two in step). */
export const EXAMPLE_AUTH_SECRET = 'change-me-32-bytes-minimum-random-string';
export const EXAMPLE_CRON_SECRET = 'change-me';
/** Better Auth's own minimum for a production secret. */
export const MIN_AUTH_SECRET_LENGTH = 32;
/** The public domain (and its www alias) the demo clock must never run on. */
const PRODUCTION_HOSTS = ['eventat.bg', 'www.eventat.bg'];
/** What PAYMENT_PROVIDER=stripe needs (lib/payments/stripe.ts; docs/DEPLOY.md step 3). */
const STRIPE_SECRETS = ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'STRIPE_CONNECT_WEBHOOK_SECRET'] as const;

export type Env = Record<string, string | undefined>;
export type EnvMode = 'development' | 'staging' | 'production';
export type EnvReport = { mode: EnvMode; problems: string[] };

const hostOf = (url: string | undefined): string | null => {
  if (!url) return null;
  try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
};
const blank = (v: string | undefined) => !v || !v.trim();

/** development = not a production build; staging = a Vercel preview or the demo clock on *.vercel.app. */
export function envMode(env: Env): EnvMode {
  if (env.NODE_ENV !== 'production') return 'development';
  if (env.VERCEL_ENV === 'preview') return 'staging';
  if (env.ALLOW_TIME_TRAVEL === 'true' && (hostOf(env.APP_URL)?.endsWith('.vercel.app') ?? false)) return 'staging';
  return 'production';
}

/** Every unsafe or unworkable setting, as one line each (names only, never values). */
export function envProblems(env: Env): string[] {
  const out: string[] = [];
  const secret = env.BETTER_AUTH_SECRET?.trim() ?? '';
  if (!secret) out.push('BETTER_AUTH_SECRET is not set');
  else if (secret === EXAMPLE_AUTH_SECRET) out.push('BETTER_AUTH_SECRET is the .env.example placeholder');
  else if (secret.length < MIN_AUTH_SECRET_LENGTH) out.push(`BETTER_AUTH_SECRET is shorter than ${MIN_AUTH_SECRET_LENGTH} characters`);

  const cron = env.CRON_SECRET?.trim() ?? '';
  if (!cron) out.push('CRON_SECRET is not set');
  else if (cron === EXAMPLE_CRON_SECRET) out.push('CRON_SECRET is the .env.example placeholder');

  const host = hostOf(env.APP_URL);
  if (env.ALLOW_TIME_TRAVEL === 'true' && host && PRODUCTION_HOSTS.includes(host))
    out.push(`ALLOW_TIME_TRAVEL=true on the production domain (${host})`);

  if (env.PAYMENT_PROVIDER === 'stripe') {
    const missing = STRIPE_SECRETS.filter(k => blank(env[k]));
    if (missing.length) out.push(`PAYMENT_PROVIDER=stripe without ${missing.join(', ')}`);
  }

  // lib/storage: anything but STORAGE_DRIVER=s3 writes to the local disk, which Vercel throws away.
  if (env.VERCEL && env.STORAGE_DRIVER !== 's3') out.push(`STORAGE_DRIVER=${env.STORAGE_DRIVER || 'local'} on Vercel (needs s3)`);
  return out;
}

export function checkEnv(env: Env): EnvReport {
  const mode = envMode(env);
  return { mode, problems: mode === 'development' ? [] : envProblems(env) };
}

export class UnsafeEnvironmentError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Refusing to start in production: ${problems.join('; ')}`);
    this.name = 'UnsafeEnvironmentError';
  }
}

/**
 * Production: throws UnsafeEnvironmentError when anything is wrong.
 * Staging: logs the same findings as one structured warning line and carries on.
 */
export function assertSafeEnv(env: Env, log: (line: string) => void = console.warn): EnvReport {
  const report = checkEnv(env);
  if (!report.problems.length) return report;
  if (report.mode === 'production') throw new UnsafeEnvironmentError(report.problems);
  log(JSON.stringify({ level: 'warn', msg: 'unsafe environment (staging, not enforced)', problems: report.problems }));
  return report;
}
