// Credentials in emails — a password-reset or deletion link, a team invitation, a 6-digit code —
// belong in the recipient's inbox and nowhere else. A template lists them in `secret`; the outbox
// (Админ → Имейли, the ‹Изпратени› previews) keeps the message with those values masked, and the
// real values are rendered only at delivery (lib/email/send.ts deliver()).
import { renderEmail } from './render';
import type { EmailContent, EmailTemplate } from './types';

export const MASK = '••••••';

export const appUrl = () => process.env.APP_URL ?? 'http://localhost:3000';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTemplate = EmailTemplate<any>;

export const hasSecrets = (tpl: AnyTemplate | undefined): boolean => !!tpl?.secret?.length;

/** A token-like path segment: base64url / alphanumeric, 16 characters or more. */
const TOKEN_SEGMENT = /^[A-Za-z0-9_-]{16,}$/;

/**
 * A one-time link with its secret parts masked: every query value and every token-like path
 * segment (`/admin/pokana/<token>`, Better Auth's `/reset-password/<token>`). The page it leads to
 * stays readable. A link with nothing to mask is masked whole, so a credential never slips through.
 */
export function maskLink(url: string): string {
  let u: URL;
  try { u = new URL(url, 'http://mask.invalid'); } catch { return MASK; }
  const absolute = /^https?:\/\//i.test(url);
  let masked = false;
  const path = u.pathname.split('/').map(s => {
    if (!TOKEN_SEGMENT.test(s)) return s;
    masked = true;
    return MASK;
  }).join('/');
  const keys = [...new Set(u.searchParams.keys())];
  if (keys.length) masked = true;
  if (!masked) return MASK;
  const query = keys.length ? `?${keys.map(k => `${encodeURIComponent(k)}=${MASK}`).join('&')}` : '';
  return `${absolute ? u.origin : ''}${path}${query}`;
}

/** The variables with every secret one masked (links keep where they lead). */
export function redactVars(tpl: AnyTemplate, vars: Record<string, unknown>): Record<string, unknown> {
  if (!hasSecrets(tpl)) return vars;
  const out: Record<string, unknown> = { ...vars };
  for (const k of tpl.secret!) {
    const v = out[k];
    if (v === undefined || v === null || v === '') continue;
    const s = String(v);
    out[k] = /^(https?:\/\/|\/)/i.test(s) ? maskLink(s) : MASK;
  }
  return out;
}

export type RenderedEmail = { subject: string; html: string; text: string };

function rendered(tpl: AnyTemplate, content: EmailContent): RenderedEmail {
  return { subject: content.subject, ...renderEmail(content, tpl.audience, tpl.optional, appUrl()) };
}

/** What the outbox keeps and the team may see: the email with its credentials masked. */
export function storedCopy(tpl: AnyTemplate, vars: Record<string, unknown>): RenderedEmail {
  return rendered(tpl, tpl.render(redactVars(tpl, vars)));
}

/** What the transport sends: the email with its real values (delivery only). */
export function liveCopy(tpl: AnyTemplate, vars: Record<string, unknown>): RenderedEmail {
  return rendered(tpl, tpl.render(vars));
}
