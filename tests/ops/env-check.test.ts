// Production guards (lib/env-check.ts, run by instrumentation.ts register()).
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { EXAMPLE_AUTH_SECRET, EXAMPLE_CRON_SECRET, UnsafeEnvironmentError, assertSafeEnv, checkEnv, envMode, type Env } from '@/lib/env-check';

const SECRET = 'x'.repeat(48);
/** A production deployment that is fine as it is. */
const good: Env = {
  NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production', APP_URL: 'https://eventat.bg',
  BETTER_AUTH_SECRET: SECRET, CRON_SECRET: 'c'.repeat(32),
  PAYMENT_PROVIDER: 'stripe', STRIPE_SECRET_KEY: 'sk_live_x', STRIPE_WEBHOOK_SECRET: 'whsec_a', STRIPE_CONNECT_WEBHOOK_SECRET: 'whsec_b',
  STORAGE_DRIVER: 's3',
};
const boots = (env: Env) => { assertSafeEnv(env, () => {}); return true; };
const refusal = (env: Env) => {
  try { assertSafeEnv(env, () => {}); } catch (e) { expect(e).toBeInstanceOf(UnsafeEnvironmentError); return (e as UnsafeEnvironmentError).problems; }
  throw new Error('expected the production guard to refuse');
};

describe('env check', () => {
  it('keeps the placeholders in step with .env.example', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    expect(example).toMatch(new RegExp(`^BETTER_AUTH_SECRET=${EXAMPLE_AUTH_SECRET}$`, 'm'));
    expect(example).toMatch(new RegExp(`^CRON_SECRET=${EXAMPLE_CRON_SECRET}$`, 'm'));
  });

  it('a sound production configuration boots', () => {
    expect(checkEnv(good)).toEqual({ mode: 'production', problems: [] });
    expect(boots(good)).toBe(true);
  });

  it('refuses a missing, short or placeholder auth secret', () => {
    expect(refusal({ ...good, BETTER_AUTH_SECRET: undefined })).toEqual(['BETTER_AUTH_SECRET is not set']);
    expect(refusal({ ...good, BETTER_AUTH_SECRET: '  ' })).toEqual(['BETTER_AUTH_SECRET is not set']);
    expect(refusal({ ...good, BETTER_AUTH_SECRET: 'short-secret' })).toEqual(['BETTER_AUTH_SECRET is shorter than 32 characters']);
    expect(refusal({ ...good, BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET })).toEqual(['BETTER_AUTH_SECRET is the .env.example placeholder']);
  });

  it('refuses a missing or placeholder cron secret', () => {
    expect(refusal({ ...good, CRON_SECRET: '' })).toEqual(['CRON_SECRET is not set']);
    expect(refusal({ ...good, CRON_SECRET: 'change-me' })).toEqual(['CRON_SECRET is the .env.example placeholder']);
  });

  it('refuses the demo clock on the production domain', () => {
    expect(refusal({ ...good, ALLOW_TIME_TRAVEL: 'true' })).toEqual(['ALLOW_TIME_TRAVEL=true on the production domain (eventat.bg)']);
    expect(refusal({ ...good, ALLOW_TIME_TRAVEL: 'true', APP_URL: 'https://www.eventat.bg/' })).toHaveLength(1);
    expect(boots({ ...good, ALLOW_TIME_TRAVEL: 'false' })).toBe(true);
  });

  it('refuses Stripe without its secrets', () => {
    expect(refusal({ ...good, STRIPE_SECRET_KEY: '' })).toEqual(['PAYMENT_PROVIDER=stripe without STRIPE_SECRET_KEY']);
    expect(refusal({ ...good, STRIPE_WEBHOOK_SECRET: undefined, STRIPE_CONNECT_WEBHOOK_SECRET: undefined }))
      .toEqual(['PAYMENT_PROVIDER=stripe without STRIPE_WEBHOOK_SECRET, STRIPE_CONNECT_WEBHOOK_SECRET']);
    expect(boots({ ...good, PAYMENT_PROVIDER: 'simulated', STRIPE_SECRET_KEY: undefined, STRIPE_WEBHOOK_SECRET: undefined, STRIPE_CONNECT_WEBHOOK_SECRET: undefined })).toBe(true);
  });

  it('refuses local file storage on Vercel, not elsewhere', () => {
    expect(refusal({ ...good, STORAGE_DRIVER: 'local' })).toEqual(['STORAGE_DRIVER=local on Vercel (needs s3)']);
    expect(refusal({ ...good, STORAGE_DRIVER: undefined })).toEqual(['STORAGE_DRIVER=local on Vercel (needs s3)']);
    expect(boots({ ...good, VERCEL: undefined, VERCEL_ENV: undefined, STORAGE_DRIVER: 'local' })).toBe(true);
  });

  it('names every problem at once, and never a value', () => {
    const problems = refusal({ ...good, BETTER_AUTH_SECRET: 'tiny', CRON_SECRET: undefined, ALLOW_TIME_TRAVEL: 'true', STRIPE_SECRET_KEY: undefined, STORAGE_DRIVER: 'local' });
    expect(problems).toHaveLength(5);
    expect(problems.join(' ')).not.toContain('tiny');
  });

  it('staging still boots: a Vercel preview, or the demo clock on a *.vercel.app address', () => {
    const demo: Env = {
      NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production', APP_URL: 'https://eventat-staging.vercel.app',
      ALLOW_TIME_TRAVEL: 'true', PAYMENT_PROVIDER: 'simulated', STORAGE_DRIVER: 'local',
      BETTER_AUTH_SECRET: SECRET, CRON_SECRET: 'c'.repeat(32),
    };
    expect(envMode(demo)).toBe('staging');
    const warn = vi.fn();
    expect(assertSafeEnv(demo, warn).problems).toEqual(['STORAGE_DRIVER=local on Vercel (needs s3)']);
    expect(JSON.parse(warn.mock.calls[0][0])).toMatchObject({ level: 'warn', problems: ['STORAGE_DRIVER=local on Vercel (needs s3)'] });

    const preview: Env = { ...good, VERCEL_ENV: 'preview', BETTER_AUTH_SECRET: EXAMPLE_AUTH_SECRET, ALLOW_TIME_TRAVEL: 'true' };
    expect(envMode(preview)).toBe('staging');
    expect(boots(preview)).toBe(true);
    // The same demo clock on a vercel.app address without ALLOW_TIME_TRAVEL is a production deployment.
    expect(envMode({ ...demo, ALLOW_TIME_TRAVEL: undefined })).toBe('production');
  });

  it('checks nothing outside a production build (next dev, tests)', () => {
    expect(checkEnv({ NODE_ENV: 'development' })).toEqual({ mode: 'development', problems: [] });
    expect(checkEnv({ NODE_ENV: 'test' })).toEqual({ mode: 'development', problems: [] });
  });

  it('a local production build (next start on localhost) with the demo clock boots', () => {
    expect(boots({ NODE_ENV: 'production', APP_URL: 'http://localhost:3602', ALLOW_TIME_TRAVEL: 'true', PAYMENT_PROVIDER: 'simulated', STORAGE_DRIVER: 'local', BETTER_AUTH_SECRET: SECRET, CRON_SECRET: 'c'.repeat(32) })).toBe(true);
  });
});
