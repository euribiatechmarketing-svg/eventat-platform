// Text helpers for the public pages.
import type { ReactNode } from 'react';
import type { Rich } from '@/lib/domain/search';

/**
 * Digits inside display-font text go in `span.num` (Constantia draws old-style figures):
 * ‹Snap360› → Snap<span class="num">360</span>.
 */
export function Num({ children }: { children: string }) {
  const parts = children.split(/(\d[\d\s.,]*\d|\d)/);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="num">{p}</span> : p))}</>;
}

/** A count line / results sentence with bold parts. */
export function RichText({ value }: { value: Rich }): ReactNode {
  return <>{value.map((x, i) => (typeof x === 'string' ? x : <b key={i}>{x.b}</b>))}</>;
}

/** `?a=1&b=2` from Next's searchParams object (repeated keys kept). */
export function toSearch(sp: Record<string, string | string[] | undefined>): URLSearchParams {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (v == null) continue;
    for (const x of Array.isArray(v) ? v : [v]) u.append(k, x);
  }
  return u;
}

/** The current URL, for `?next=` (guests) and for returning after an action. */
export function hereUrl(path: string, sp: URLSearchParams): string {
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}

export const signInHref = (next: string) => `/vhod?next=${encodeURIComponent(next)}`;
export const registerHref = (next: string) => `/registratsiya?next=${encodeURIComponent(next)}`;
