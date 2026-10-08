// Bulgarian display formats used across the product (CLAUDE.md rule 7):
// money "1 450,00 €" (running text may drop the cents: "1 450 €"),
// dates "14 юни 2026", times "11:06", everything shown in Europe/Sofia.

export const TZ = 'Europe/Sofia';
const NBSP = ' ';

const MONTHS = ['януари', 'февруари', 'март', 'април', 'май', 'юни', 'юли', 'август', 'септември', 'октомври', 'ноември', 'декември'];
const WEEKDAYS = ['неделя', 'понеделник', 'вторник', 'сряда', 'четвъртък', 'петък', 'събота'];

/** Group thousands with a no-break space: 1450 -> "1 450". */
function group(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 145000 cents -> "1 450,00 €" */
export function money(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(Math.round(cents));
  const s = `${group(Math.floor(abs / 100))},${String(abs % 100).padStart(2, '0')}${NBSP}€`;
  return neg ? `−${s}` : s;
}

/** 145000 cents -> "1 450 €" (running text; keeps cents only when not whole) */
export function moneyShort(cents: number): string {
  if (Math.round(cents) % 100 !== 0) return money(cents);
  const neg = cents < 0;
  const s = `${group(Math.abs(Math.round(cents)) / 100)}${NBSP}€`;
  return neg ? `−${s}` : s;
}

/** Parse "1 450,00" / "1450" / "1450.5" typed by a user into cents. */
export function parseMoney(input: string): number | null {
  const t = input.replace(/[\s €]/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return Math.round(parseFloat(t) * 100);
}

type Parts = { y: number; m: number; d: number; hh: number; mm: number; wd: number };

/** Calendar parts of an instant as seen in Sofia. */
export function sofiaParts(at: Date): Parts {
  const f = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(at);
  const g = (t: string) => f.find(p => p.type === t)?.value ?? '';
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(g('weekday'));
  return { y: +g('year'), m: +g('month'), d: +g('day'), hh: +g('hour'), mm: +g('minute'), wd };
}

/** A calendar date string "2026-06-14" (event dates are dates, not instants). */
export type DateStr = string;

function partsOf(d: Date | DateStr): { y: number; m: number; d: number; wd: number } {
  if (typeof d === 'string') {
    const [y, m, day] = d.split('-').map(Number);
    const wd = new Date(Date.UTC(y, m - 1, day)).getUTCDay();
    return { y, m, d: day, wd };
  }
  return sofiaParts(d);
}

/** "14 юни 2026" */
export function date(d: Date | DateStr): string {
  const p = partsOf(d);
  return `${p.d}${NBSP}${MONTHS[p.m - 1]} ${p.y}`;
}

/** "14 юни" */
export function dateShort(d: Date | DateStr): string {
  const p = partsOf(d);
  return `${p.d}${NBSP}${MONTHS[p.m - 1]}`;
}

/** "неделя, 14 юни 2026" */
export function dateLong(d: Date | DateStr): string {
  return `${WEEKDAYS[partsOf(d).wd]}, ${date(d)}`;
}

/** "14.06.2026" */
export function dateNumeric(d: Date | DateStr): string {
  const p = partsOf(d);
  return `${String(p.d).padStart(2, '0')}.${String(p.m).padStart(2, '0')}.${p.y}`;
}

/** "11:06" in Sofia */
export function time(at: Date): string {
  const p = sofiaParts(at);
  return `${String(p.hh).padStart(2, '0')}:${String(p.mm).padStart(2, '0')}`;
}

/** "13 август 2025, 11:06" */
export function dateTime(at: Date): string {
  return `${date(at)}, ${time(at)}`;
}

export const monthName = (m: number) => MONTHS[m - 1];
export const weekdayName = (wd: number) => WEEKDAYS[wd];

/** The Sofia calendar date of an instant, as "YYYY-MM-DD". */
export function sofiaDate(at: Date): DateStr {
  const p = sofiaParts(at);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** The instant of a Sofia wall-clock time on a date: sofiaInstant("2026-06-15", 0, 0). */
export function sofiaInstant(d: DateStr, hh = 0, mm = 0): Date {
  const [y, m, day] = d.split('-').map(Number);
  // Start from the UTC guess, then correct by the zone offset at that moment (handles DST).
  let guess = Date.UTC(y, m - 1, day, hh, mm);
  for (let i = 0; i < 2; i++) {
    const p = sofiaParts(new Date(guess));
    const shown = Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm);
    guess += Date.UTC(y, m - 1, day, hh, mm) - shown;
  }
  return new Date(guess);
}

/** Whole calendar days from a to b (Sofia dates). */
export function daysBetween(a: DateStr, b: DateStr): number {
  const [y1, m1, d1] = a.split('-').map(Number);
  const [y2, m2, d2] = b.split('-').map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function addDays(d: DateStr, n: number): DateStr {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day + n));
  return t.toISOString().slice(0, 10);
}

/** Bulgarian plural for counts: plural(3, 'гост', 'гости') */
export function plural(n: number, one: string, many: string): string {
  return `${group(n)}${NBSP}${n === 1 ? one : many}`;
}

/** Remaining time "23 ч 12 мин" / "45 мин" until a deadline. */
export function remaining(from: Date, to: Date): string {
  const mins = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60000));
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h >= 48) return `${Math.floor(h / 24)} дни`;
  return h ? `${h}${NBSP}ч ${m}${NBSP}мин` : `${m}${NBSP}мин`;
}
