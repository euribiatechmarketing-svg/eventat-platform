// Server errors (instrumentation.ts onRequestError → lib/observability.ts): one JSON log line,
// and Sentry only when SENTRY_DSN is set.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { errorLogLine, parseDsn, reportRequestError, sentryEnvelope, stackFrames, withoutParams } from '@/lib/observability';

const ctx = { routerKind: 'App Router', routePath: '/akaunt/rezervacii/[nomer]', routeType: 'render', renderSource: 'react-server-components' };
const req = { method: 'GET', path: '/akaunt/rezervacii/B-1042?token=abc' };
const boom = () => Object.assign(new Error('relation "x" does not exist'), { digest: '1234567' });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('error log line', () => {
  it('is one JSON line with route, digest and message; the stack only outside production', () => {
    const dev = JSON.parse(errorLogLine(boom(), req, ctx, { NODE_ENV: 'development' }));
    expect(dev).toMatchObject({ level: 'error', route: '/akaunt/rezervacii/[nomer]', routeType: 'render', method: 'GET', digest: '1234567', error: 'Error', message: 'relation "x" does not exist' });
    expect(dev.stack).toContain('relation "x" does not exist');
    const prod = JSON.parse(errorLogLine(boom(), req, ctx, { NODE_ENV: 'production' }));
    expect(prod.stack).toBeUndefined();
    expect(errorLogLine(boom(), req, ctx, { NODE_ENV: 'production' })).not.toContain('\n');
  });

  it('logs the route pattern, never the requested path (it may carry a token)', () => {
    expect(errorLogLine(boom(), req, ctx, { NODE_ENV: 'development' })).not.toContain('token=abc');
  });

  it('names the cause of a failed query (its own message is only "Failed query: …")', () => {
    const e = Object.assign(new Error('Failed query: select 1 from "review"\nparams: '), { cause: new Error('relation "review" does not exist') });
    expect(JSON.parse(errorLogLine(e, req, ctx, { NODE_ENV: 'production' }))).toMatchObject({ cause: 'relation "review" does not exist' });
    expect(JSON.parse(errorLogLine(boom(), req, ctx, { NODE_ENV: 'production' })).cause).toBeNull();
  });

  it('copes with a thrown non-Error', () => {
    expect(JSON.parse(errorLogLine('plain string', req, ctx, { NODE_ENV: 'production' }))).toMatchObject({ error: 'Error', message: 'plain string' });
  });
});

describe('Sentry', () => {
  it('reads a DSN into the envelope endpoint', () => {
    expect(parseDsn('https://abc123@o42.ingest.de.sentry.io/4507')).toEqual({
      publicKey: 'abc123', envelopeUrl: 'https://o42.ingest.de.sentry.io/api/4507/envelope/', dsn: 'https://abc123@o42.ingest.de.sentry.io/4507',
    });
    expect(parseDsn('https://k@sentry.example.com/prefix/7')?.envelopeUrl).toBe('https://sentry.example.com/prefix/api/7/envelope/');
    for (const bad of [undefined, '', '  ', 'not a url', 'https://sentry.io/1', 'https://k@sentry.io/', 'https://k@sentry.io/abc', 'ftp://k@sentry.io/1'])
      expect(parseDsn(bad), String(bad)).toBeNull();
  });

  it('turns a V8 stack into frames, oldest call first', () => {
    const frames = stackFrames('Error: x\n    at inner (/app/.next/server/chunks/1.js:10:5)\n    at async outer (/app/node_modules/next/dist/x.js:2:3)\n    at /app/lib/a.js:7:9\n    at async Promise.all (index 0)');
    expect(frames).toEqual([
      { function: '?', filename: '/app/lib/a.js', lineno: 7, colno: 9, in_app: true },
      { function: 'async outer', filename: '/app/node_modules/next/dist/x.js', lineno: 2, colno: 3, in_app: false },
      { function: 'inner', filename: '/app/.next/server/chunks/1.js', lineno: 10, colno: 5, in_app: true },
    ]);
  });

  it('keeps a failed query\'s bound values out of Sentry', () => {
    expect(withoutParams('Failed query: insert into "user" values ($1, $2)\nparams: maria@example.com,+359888123456'))
      .toBe('Failed query: insert into "user" values ($1, $2)\nparams: [removed]');
    expect(withoutParams('DrizzleQueryError: Failed query: x\nparams: a@b.c\n    at q (/app/x.js:1:2)')).toBe('DrizzleQueryError: Failed query: x\nparams: [removed]\n    at q (/app/x.js:1:2)');
    expect(withoutParams('no params here')).toBe('no params here');
    const e = Object.assign(new Error('Failed query: select $1\nparams: maria@example.com'), { cause: new Error('boom') });
    const env = sentryEnvelope(e, req, ctx, parseDsn('https://k@sentry.io/1')!, {}, new Date(), 'f'.repeat(32));
    expect(env).not.toContain('maria@example.com');
    expect(JSON.parse(env.split('\n')[2]).exception.values.map((v: { type: string }) => v.type)).toEqual(['Cause', 'Error']);
  });

  it('builds a three-line envelope', () => {
    const dsn = parseDsn('https://abc123@o42.ingest.de.sentry.io/4507')!;
    const at = new Date('2026-10-12T09:00:00Z');
    const lines = sentryEnvelope(boom(), req, ctx, dsn, { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_SHA: 'deadbeef' }, at, 'e'.repeat(32)).split('\n');
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0])).toEqual({ event_id: 'e'.repeat(32), sent_at: '2026-10-12T09:00:00.000Z', dsn: dsn.dsn });
    expect(JSON.parse(lines[1])).toEqual({ type: 'event' });
    const ev = JSON.parse(lines[2]);
    expect(ev).toMatchObject({ event_id: 'e'.repeat(32), timestamp: at.getTime() / 1000, level: 'error', environment: 'production', release: 'deadbeef', transaction: '/akaunt/rezervacii/[nomer]' });
    expect(ev.tags).toMatchObject({ digest: '1234567', routeType: 'render', method: 'GET' });
    expect(ev.exception.values[0]).toMatchObject({ type: 'Error', value: 'relation "x" does not exist' });
    expect(lines.join('\n')).not.toContain('token=abc');
  });

  it('sends nothing while SENTRY_DSN is unset', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await reportRequestError(boom(), req, ctx, { NODE_ENV: 'production' });
    expect(fetch).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('posts the envelope when SENTRY_DSN is set, and survives Sentry being down', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetch);
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await reportRequestError(boom(), req, ctx, { NODE_ENV: 'production', SENTRY_DSN: 'https://abc123@o42.ingest.de.sentry.io/4507' });
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://o42.ingest.de.sentry.io/api/4507/envelope/');
    expect(init.method).toBe('POST');
    expect(init.headers['X-Sentry-Auth']).toContain('sentry_key=abc123');
    expect(String(init.body).split('\n')).toHaveLength(3);
    expect(log).toHaveBeenCalledTimes(1);

    fetch.mockRejectedValueOnce(new TypeError('fetch failed'));
    await expect(reportRequestError(boom(), req, ctx, { NODE_ENV: 'production', SENTRY_DSN: 'https://abc123@o42.ingest.de.sentry.io/4507' })).resolves.toBeUndefined();
    expect(JSON.parse(log.mock.calls.at(-1)![0])).toMatchObject({ msg: 'sentry unreachable' });
  });
});
