// Server errors (instrumentation.ts onRequestError): one structured JSON log line per error, and,
// only when SENTRY_DSN is set, the same error sent to Sentry as an envelope over plain fetch
// (no SDK: nothing loads, patches or phones home while the variable is unset).
// Edge-safe: no node: imports, so middleware errors go through the same path.

export type RequestErrorContext = {
  routerKind?: string;
  routePath?: string;
  routeType?: string;
  renderSource?: string;
};
/** Only the method: the requested path may carry a one-time token, so it is never passed on. */
export type RequestInfo = { method?: string };

type Err = { name?: string; message?: string; stack?: string; digest?: string; cause?: unknown };

const asErr = (e: unknown): Err => (e && typeof e === 'object' ? (e as Err) : { message: String(e) });
/** The underlying error's message: a failed query's own message is only "Failed query: …". */
const causeOf = (e: Err): string | null => {
  const c = e.cause;
  if (!c) return null;
  return typeof c === 'object' && 'message' in c ? String((c as { message: unknown }).message) : String(c);
};
/**
 * A failed query's message ends with its bound values (names, emails, message text…): kept out of what
 * leaves the server. Everything from "params:" on goes, since a value may itself hold line breaks.
 */
export const withoutParams = (s: string) => {
  const at = s.indexOf('\nparams: ');
  return at < 0 ? s : `${s.slice(0, at)}\nparams: [removed]`;
};
/** The stack without its head, which repeats the message (bound values included); unknown head: no frames. */
const stackBelowMessage = (e: Err): string | undefined => {
  if (!e.stack) return undefined;
  const at = e.message ? e.stack.indexOf(e.message) : -1;
  return at < 0 ? withoutParams(e.stack) : e.stack.slice(at + e.message!.length);
};

/**
 * The log line. `route` is the route pattern (/akaunt/rezervacii/[nomer]), never the requested
 * path, which may carry a one-time token. The stack is left out in production.
 */
export function errorLogLine(error: unknown, request: RequestInfo, context: RequestErrorContext, env: Record<string, string | undefined>): string {
  const e = asErr(error);
  const line: Record<string, unknown> = {
    level: 'error',
    msg: 'request error',
    route: context.routePath ?? null,
    routeType: context.routeType ?? null,
    method: request.method ?? null,
    digest: e.digest ?? null,
    error: e.name ?? 'Error',
    message: e.message ?? '',
    cause: causeOf(e),
  };
  if (env.NODE_ENV !== 'production' && e.stack) line.stack = e.stack;
  return JSON.stringify(line);
}

export type Dsn = { publicKey: string; envelopeUrl: string; dsn: string };

/** `https://<key>@<host>[/<path>]/<projectId>` → where to post envelopes. Null when unusable. */
export function parseDsn(raw: string | undefined): Dsn | null {
  if (!raw?.trim()) return null;
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const parts = u.pathname.split('/').filter(Boolean);
  const projectId = parts.pop();
  if (!u.username || !projectId || !/^\d+$/.test(projectId)) return null;
  const prefix = parts.length ? `/${parts.join('/')}` : '';
  return { publicKey: decodeURIComponent(u.username), envelopeUrl: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, dsn: raw.trim() };
}

type Frame = { function?: string; filename?: string; lineno?: number; colno?: number; in_app?: boolean };

/** V8 stack lines → Sentry frames (oldest call first, as Sentry expects). */
export function stackFrames(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const raw of stack.split('\n').slice(1)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?\s*$/.exec(raw);
    if (!m) continue;
    const filename = m[2];
    frames.push({ function: m[1] || '?', filename, lineno: Number(m[3]), colno: Number(m[4]), in_app: !/node_modules|node:internal|^node:/.test(filename) });
  }
  return frames.reverse();
}

/** One error as a Sentry envelope (header line, item header line, event line). */
export function sentryEnvelope(error: unknown, request: RequestInfo, context: RequestErrorContext, dsn: Dsn, env: Record<string, string | undefined>, at: Date, eventId: string): string {
  const e = asErr(error);
  const cause = causeOf(e);
  const event = {
    event_id: eventId,
    timestamp: at.getTime() / 1000,
    platform: 'node',
    level: 'error',
    logger: 'onRequestError',
    environment: env.VERCEL_ENV ?? env.NODE_ENV ?? 'production',
    release: env.VERCEL_GIT_COMMIT_SHA || undefined,
    transaction: context.routePath,
    tags: { routeType: context.routeType, routerKind: context.routerKind, renderSource: context.renderSource, method: request.method, digest: e.digest },
    // Sentry lists the values oldest first: the cause, then the error that wrapped it.
    exception: { values: [
      ...(cause ? [{ type: 'Cause', value: withoutParams(cause) }] : []),
      { type: e.name ?? 'Error', value: withoutParams(e.message ?? ''), stacktrace: { frames: stackFrames(stackBelowMessage(e)) } },
    ] },
  };
  return [
    JSON.stringify({ event_id: eventId, sent_at: at.toISOString(), dsn: dsn.dsn }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
}

/** Sends one error to Sentry when SENTRY_DSN is set; never throws, gives up after 2 s. */
export async function forwardToSentry(error: unknown, request: RequestInfo, context: RequestErrorContext, env: Record<string, string | undefined>): Promise<void> {
  const dsn = parseDsn(env.SENTRY_DSN);
  if (!dsn) return;
  // Wall-clock time of the report, not business time (lib/clock.ts is for business rules).
  const at = new Date();
  const eventId = crypto.randomUUID().replace(/-/g, '');
  try {
    const res = await fetch(dsn.envelopeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-sentry-envelope',
        'X-Sentry-Auth': `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=eventat-platform/1.0`,
      },
      body: sentryEnvelope(error, request, context, dsn, env, at, eventId),
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) console.error(JSON.stringify({ level: 'error', msg: 'sentry rejected the event', status: res.status }));
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'sentry unreachable', error: asErr(e).name ?? 'Error' }));
  }
}

/** instrumentation.ts onRequestError: log, then forward. */
export async function reportRequestError(error: unknown, request: RequestInfo, context: RequestErrorContext, env: Record<string, string | undefined> = process.env): Promise<void> {
  console.error(errorLogLine(error, request, context, env));
  await forwardToSentry(error, request, context, env);
}
