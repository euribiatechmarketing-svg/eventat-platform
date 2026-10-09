// Return paths taken from a request (`?next=`, a form's `back`) must stay on this site.
// A string check is not enough: browsers (WHATWG URL) drop tabs and newlines anywhere and read `\`
// as `/`, so `/\t/evil.example` arrives as `//evil.example` — another origin. The value is resolved
// the way the browser will resolve it, and only a same-origin result is accepted.

const BASE = 'https://same-site.invalid';

/** The value when it is a path on this site (`/…`), else null. The value is returned as given. */
export function sameSitePath(v: unknown, maxLength = 2000): string | null {
  if (typeof v !== 'string' || !v || v.length > maxLength) return null;
  // Control characters (the parser removes tab, CR and LF) and backslashes never belong in our paths.
  if (/[\u0000-\u001f\u007f\\]/.test(v)) return null;
  if (!v.startsWith('/') || v.startsWith('//')) return null;
  let u: URL;
  try { u = new URL(v, BASE); } catch { return null; }
  return u.origin === BASE ? v : null;
}

/** The path a same-site value resolves to (dot segments removed), for prefix checks. */
export function resolvedPathname(v: string): string {
  return new URL(v, BASE).pathname;
}
