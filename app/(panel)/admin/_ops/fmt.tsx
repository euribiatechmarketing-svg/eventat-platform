// Display helpers for the admin-ops screens (relative ages, waits, digits in display type).
import { Fragment } from 'react';
import { date, daysBetween, monthName, sofiaDate, time } from '@/lib/format';

const NBSP = ' ';
const nf = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);

/** Bulgarian count: n('изпълнител', 'изпълнители'). */
export const n = (k: number, one: string, many: string) => `${nf(k)} ${k === 1 ? one : many}`;

/** ‹преди 2 часа›, ‹вчера›, ‹преди 4 месеца› (SPEC §0 relative ages); ‹току-що› under a minute. */
export function ago(at: Date, now: Date): string {
  const mins = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (mins < 1) return 'току-що';
  if (mins < 60) return `преди ${n(mins, 'минута', 'минути')}`;
  const days = daysBetween(sofiaDate(at), sofiaDate(now));
  const hours = Math.floor(mins / 60);
  if (days === 0 || hours < 12) return `преди ${n(hours, 'час', 'часа')}`;
  if (days === 1) return 'вчера';
  if (days < 30) return `преди ${n(days, 'ден', 'дни')}`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `преди ${n(months, 'месец', 'месеца')}`;
  const years = Math.floor(days / 365.25);
  return `преди ${n(years, 'година', 'години')}`;
}

/** ‹след 287 дни› / ‹преди 4 месеца› for a calendar date relative to today. */
export function fromToday(d: string, today: string, now: Date): string {
  const days = daysBetween(today, d);
  if (days === 0) return 'днес';
  if (days > 0) return `след ${n(days, 'ден', 'дни')}`;
  return ago(new Date(`${d}T12:00:00Z`), now);
}

/** A wait as a badge: ‹2 дни›, ‹1 ден›, ‹6 часа›. */
export function wait(from: Date, now: Date): string {
  const mins = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  const days = Math.floor(mins / 1440);
  if (days >= 1) return n(days, 'ден', 'дни');
  const hours = Math.floor(mins / 60);
  if (hours >= 1) return n(hours, 'час', 'часа');
  return n(mins, 'минута', 'минути');
}

/** ‹днес, 09:12› / ‹вчера, 17:40› / ‹28 август 2025, 10:00›. */
export function dayTime(at: Date, now: Date): string {
  const days = daysBetween(sofiaDate(at), sofiaDate(now));
  if (days === 0) return `днес, ${time(at)}`;
  if (days === 1) return `вчера, ${time(at)}`;
  return `${date(at)}, ${time(at)}`;
}

/** ‹юни 2026› / ‹дек 2026› short month + year under a big day number. */
export function monthYearShort(d: string): string {
  const [y, m] = d.split('-').map(Number);
  const name = monthName(m);
  return `${name.length > 4 ? name.slice(0, 3) : name} ${y}`;
}

/** Percent with a decimal comma: 4.2 → ‹4,2%›. */
export const pct = (v: number, digits = 0) => `${v.toFixed(digits).replace('.', ',')}%`;

/** Wraps digit runs in span.num so display-font text never draws old-style figures. */
export function Num({ children }: { children: string | number | null | undefined }) {
  const s = String(children ?? '');
  const parts = s.split(/(\d[\d  .,]*\d|\d)/);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="num">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}

/** An address that may break after the ‹@› (and only there) when the column is narrow. */
export function Email({ value }: { value: string }) {
  const at = value.indexOf('@');
  if (at < 0) return <>{value}</>;
  return <>{value.slice(0, at + 1)}<wbr />{value.slice(at + 1)}</>;
}

/**
 * A ‹ · › line (‹Фотография · Пловдив · Емилия Стоянова›) whose parts never split: when the column is
 * narrow the line breaks after a separator, so a name or an address is never cut in two.
 */
export function Dots({ parts }: { parts: (string | null | undefined | false)[] }) {
  const xs = parts.filter((p): p is string => !!p);
  return <>{xs.map((p, i) => <Fragment key={i}>{i > 0 && ' · '}<span className="ops-nb">{p}</span></Fragment>)}</>;
}

/**
 * ‹МД› for Мария Димитрова, ‹ПН› for Петя и Николай and ‹ТМ› for Тортите на Мими (short joining words
 * skipped), ‹СУ› for СУ „Христо Ботев“ (a leading abbreviation stays whole).
 */
export function initials(name: string): string {
  const words = name.replace(/[„“"]/g, '').split(/\s+/)
    .filter(w => /[\p{L}\d]/u.test(w) && !/^(и|на|за|от|в|във|с|със|по|&|and|of|the)$/i.test(w));
  if (words.length > 1 && /^[А-ЯЁ]{2,3}$/u.test(words[0])) return words[0];
  const letters = words.slice(0, 2).map(w => [...w].find(ch => /[\p{L}\d]/u.test(ch)) ?? '').join('');
  return letters.toLocaleUpperCase('bg');
}

export function Badge({ tone, dot = true, children }: { tone: string; dot?: boolean; children: React.ReactNode }) {
  return <span className={`badge${tone ? ` badge--${tone}` : ''}${dot ? ' badge--dot' : ''}`}>{children}</span>;
}
