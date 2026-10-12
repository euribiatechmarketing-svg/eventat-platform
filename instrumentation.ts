// Next.js instrumentation: runs once per server instance (register) and on every server error
// (onRequestError: pages, route handlers, server actions, middleware).
import type { Instrumentation } from 'next';

export async function register() {
  // Production guards (lib/env-check.ts): a production server with an unsafe configuration throws
  // here and never serves a request. The edge runtime (middleware) holds no secrets of its own.
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertSafeEnv } = await import('./lib/env-check');
    assertSafeEnv(process.env);
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const { reportRequestError } = await import('./lib/observability');
  await reportRequestError(error, { method: request.method }, context);
};
