// Test helpers for the Stripe provider (lib/payments/stripe.ts).
//
// stripe-mock (github.com/stripe/stripe-mock) is Stripe's own mock API server: it knows every
// endpoint and parameter of one API version and rejects requests whose parameters are unknown or
// of the wrong type. It is stateless and answers with fixtures. Start it with `tools/stripe-mock.sh`
// (downloads the pinned release into .tools/, verifies its checksum, listens on 127.0.0.1:12111 with
// -strict-version-check); tests/payments/stripe.*.test.ts that need it are skipped when it is not running.
//
// stripeRecorder() sits between the SDK and stripe-mock (STRIPE_API_BASE points at it): it records
// what the SDK sent (method, path, headers, form fields) and can change an answer — patch a field of
// stripe-mock's response (the shape stays the spec's), answer by itself (a card error, a 500), or drop
// the connection (a timeout). Without an upstream it answers only what the test tells it to, which is
// how the webhook tests run with no stripe-mock at all.
import { createServer, request as httpRequest, type IncomingHttpHeaders, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import Stripe from 'stripe';

/** Where tests look for stripe-mock (`STRIPE_MOCK_URL`, default its standard port). */
export const STRIPE_MOCK_URL = (process.env.STRIPE_MOCK_URL ?? 'http://127.0.0.1:12111').replace(/\/$/, '');
export const STRIPE_MOCK_HINT = `stripe-mock is not running at ${STRIPE_MOCK_URL}: the Stripe API tests are skipped. Start it with tools/stripe-mock.sh (docs/STRIPE-TEST-MODE.md).`;

/** The API version this SDK pins (sent as Stripe-Version on every call). */
export const SDK_API_VERSION = Stripe.API_VERSION;

async function probe(url: string, version: string): Promise<number | null> {
  try {
    const r = await fetch(`${url}/v1/balance`, {
      headers: { Authorization: 'Bearer sk_test_probe', 'Stripe-Version': version }, signal: AbortSignal.timeout(1_000),
    });
    await r.arrayBuffer();
    return r.status;
  } catch {
    return null;
  }
}

/**
 * Is stripe-mock up; does it accept the SDK's API version and reject any other (-strict-version-check)?
 * Up but on another version runs the tests anyway, so the drift fails loudly instead of skipping them.
 */
export async function stripeMockStatus(url = STRIPE_MOCK_URL): Promise<{ up: boolean; sdkVersion: boolean; strict: boolean }> {
  const ours = await probe(url, SDK_API_VERSION);
  if (ours === null) return { up: false, sdkVersion: false, strict: false };
  return { up: true, sdkVersion: ours === 200, strict: (await probe(url, '2019-01-01')) === 400 };
}

export type StripeCall = {
  method: string;
  path: string;
  query: Record<string, string>;
  /** Form fields of a POST, flattened the way Stripe encodes them (`payment_intent_data[metadata][chargeId]`). */
  form: Record<string, string>;
  headers: IncomingHttpHeaders;
  status: number;
  response: unknown;
};

type Json = Record<string, unknown>;

export type Override = {
  method?: string;
  /** Path to match (exact string, or a pattern). */
  path: string | RegExp;
  /** How many matching calls this applies to (default: all). */
  times?: number;
  /** Change stripe-mock's answer (keeps the spec's shape: only values change). */
  patch?: (body: Json, call: StripeCall) => Json | void;
  /** Answer without the upstream. */
  reply?: (call: StripeCall) => { status: number; body: unknown; headers?: Record<string, string> };
  /** Close the connection without an answer (a timeout or a network failure). */
  drop?: boolean;
};

export type StripeRecorder = {
  url: string;
  calls: StripeCall[];
  /** Calls to one path (exact or pattern), optionally of one method. */
  callsTo(path: string | RegExp, method?: string): StripeCall[];
  override(o: Override): void;
  reset(): void;
  close(): Promise<void>;
};

const flat = (s: string) => Object.fromEntries(new URLSearchParams(s));
const matches = (o: Override, c: { method: string; path: string }) =>
  (!o.method || o.method === c.method) && (typeof o.path === 'string' ? o.path === c.path : o.path.test(c.path));

function forward(upstream: string, req: IncomingMessage, body: Buffer): Promise<{ status: number; text: string; headers: IncomingHttpHeaders }> {
  const u = new URL(upstream);
  return new Promise((resolve, reject) => {
    const r = httpRequest({
      host: u.hostname, port: u.port, method: req.method, path: req.url,
      headers: { ...req.headers, host: u.host, 'content-length': String(body.length) },
    }, res => {
      const chunks: Buffer[] = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString('utf8'), headers: res.headers }));
      res.on('error', reject);
    });
    r.on('error', reject);
    r.end(body);
  });
}

/** A recording proxy in front of `upstream` (stripe-mock), or a fake that answers only overrides when there is none. */
export async function stripeRecorder(upstream?: string): Promise<StripeRecorder> {
  const calls: StripeCall[] = [];
  let overrides: (Override & { used: number })[] = [];

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const u = new URL(req.url ?? '/', 'http://recorder');
    const call: StripeCall = {
      method: req.method ?? 'GET', path: u.pathname, query: flat(u.search.slice(1)), form: flat(body.toString('utf8')),
      headers: req.headers, status: 0, response: null,
    };
    calls.push(call);
    const o = overrides.find(x => matches(x, call) && (x.times === undefined || x.used < x.times));
    if (o) o.used++;
    if (o?.drop) {
      call.status = -1;
      req.socket.destroy();
      return;
    }
    let status: number, out: unknown, headers: Record<string, string> = {};
    if (o?.reply) {
      ({ status, body: out, headers = {} } = o.reply(call));
    } else if (upstream) {
      const r = await forward(upstream, req, body);
      status = r.status;
      out = JSON.parse(r.text) as unknown;
      if (o?.patch && status === 200) out = o.patch(out as Json, call) ?? out;
      const id = r.headers['request-id'];
      if (typeof id === 'string') headers['request-id'] = id;
    } else {
      status = 404;
      out = { error: { type: 'invalid_request_error', message: `No fake answer for ${call.method} ${call.path}` } };
    }
    call.status = status;
    call.response = out;
    res.writeHead(status, { 'content-type': 'application/json', ...headers });
    res.end(JSON.stringify(out));
  }

  const server = createServer((req, res) => {
    handle(req, res).catch(e => {
      res.writeHead(599, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'api_error', message: `recorder: ${String(e)}` } }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    callsTo: (path, method) => calls.filter(c => matches({ path, method }, c)),
    override: o => { overrides.unshift({ ...o, used: 0 }); },
    reset: () => { calls.length = 0; overrides = []; },
    close: () => new Promise<void>(r => { server.closeAllConnections(); server.close(() => r()); }),
  };
}

/** A Stripe API error body (what the API answers on a 4xx). */
export const stripeError = (type: string, message: string, extra: Json = {}) => ({ error: { type, message, ...extra } });

// ── Webhooks ─────────────────────────────────────────────────────────────

let seq = 0;

/** A Stripe event envelope around `object` (the shape the API sends; `account` for Connect events). */
export function stripeEvent(type: string, object: Json, o: { account?: string } = {}): Json {
  seq++;
  return {
    id: `evt_test_${seq}_${Date.now()}`, object: 'event', api_version: SDK_API_VERSION, created: Math.floor(Date.now() / 1000),
    livemode: false, pending_webhooks: 1, request: { id: null, idempotency_key: null }, type,
    data: { object }, ...(o.account ? { account: o.account } : {}),
  };
}

/** The webhook request Stripe would send: the raw JSON body signed with `secret` in Stripe-Signature. */
export function signedWebhook(event: Json, secret: string, o: { url?: string; timestamp?: number } = {}): Request {
  const payload = JSON.stringify(event);
  const header = Stripe.webhooks.generateTestHeaderString({ payload, secret, timestamp: o.timestamp });
  return new Request(o.url ?? 'http://localhost/api/webhooks/stripe', {
    method: 'POST', body: payload, headers: { 'content-type': 'application/json', 'stripe-signature': header },
  });
}
