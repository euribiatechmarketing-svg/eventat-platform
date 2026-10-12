// instrumentation.ts: register() runs the production guards in the Node.js runtime; onRequestError logs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { onRequestError, register } from '@/instrumentation';
import { UnsafeEnvironmentError } from '@/lib/env-check';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const unsafeProduction = () => {
  vi.stubEnv('NEXT_RUNTIME', 'nodejs');
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('VERCEL_ENV', '');
  vi.stubEnv('VERCEL', '');
  vi.stubEnv('ALLOW_TIME_TRAVEL', '');
  vi.stubEnv('PAYMENT_PROVIDER', 'simulated');
  vi.stubEnv('APP_URL', 'https://eventat.bg');
  vi.stubEnv('BETTER_AUTH_SECRET', 'x'.repeat(40));
  vi.stubEnv('CRON_SECRET', 'change-me');
};

describe('instrumentation', () => {
  it('register() refuses an unsafe production configuration', async () => {
    unsafeProduction();
    await expect(register()).rejects.toBeInstanceOf(UnsafeEnvironmentError);
    vi.stubEnv('CRON_SECRET', 'c'.repeat(32));
    await expect(register()).resolves.toBeUndefined();
  });

  it('register() leaves the edge runtime alone', async () => {
    unsafeProduction();
    vi.stubEnv('NEXT_RUNTIME', 'edge');
    await expect(register()).resolves.toBeUndefined();
  });

  it('onRequestError writes one JSON line and sends nothing without SENTRY_DSN', async () => {
    vi.stubEnv('SENTRY_DSN', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await onRequestError(Object.assign(new Error('boom'), { digest: '42' }),
      { path: '/partner/revyuta', method: 'GET', headers: {} },
      { routerKind: 'App Router', routePath: '/partner/revyuta', routeType: 'render', revalidateReason: undefined, renderSource: 'react-server-components' });
    expect(log).toHaveBeenCalledTimes(1);
    expect(JSON.parse(log.mock.calls[0][0])).toMatchObject({ route: '/partner/revyuta', digest: '42', message: 'boom' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
