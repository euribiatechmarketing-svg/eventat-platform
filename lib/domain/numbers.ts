// Booking / request numbers YYYY-MMDD-XX (SPEC §0, D2): the event date plus
// two random Cyrillic capitals, unique per event date through the
// booking_number registry. A number is assigned when the request (or brief
// offer) is created and stays the same through booking, invoice line,
// dispute and payout line.
import { randomInt } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Queryable } from '@/db';
import { bookingNumber } from '@/db/schema';
import type { DateStr } from '@/lib/format';

export const NUMBER_LETTERS = 'АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЮЯ';
/** 26 × 26 combinations per event date. */
export const NUMBERS_PER_DATE = NUMBER_LETTERS.length ** 2;
export const NUMBER_RE = new RegExp(`^(\\d{4})-(\\d{2})(\\d{2})-[${NUMBER_LETTERS}]{2}$`);

export class NumberError extends Error {
  constructor(message: string) { super(message); this.name = 'NumberError'; }
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertDate(d: DateStr) {
  const m = DATE_RE.exec(d);
  const t = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !t || t.toISOString().slice(0, 10) !== d) throw new NumberError(`Not a calendar date: ${d}`);
}

/** '2026-06-14' + 'ЕА' → '2026-0614-ЕА' */
export function formatNumber(eventDate: DateStr, letters: string): string {
  return `${eventDate.slice(0, 4)}-${eventDate.slice(5, 7)}${eventDate.slice(8, 10)}-${letters}`;
}

export function isValidNumber(n: string): boolean {
  const m = NUMBER_RE.exec(n);
  if (!m) return false;
  try { assertDate(`${m[1]}-${m[2]}-${m[3]}`); return true; } catch { return false; }
}

/** The event date a number encodes: '2026-0614-ЕА' → '2026-06-14'. */
export function numberDate(n: string): DateStr {
  const m = NUMBER_RE.exec(n);
  if (!m) throw new NumberError(`Not a booking number: ${n}`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function randomLetters(rand: (max: number) => number): string {
  return NUMBER_LETTERS[rand(NUMBER_LETTERS.length)] + NUMBER_LETTERS[rand(NUMBER_LETTERS.length)];
}

/**
 * Allocate a fresh number for an event date inside the caller's transaction.
 * Collision-safe: the registry's primary key decides (INSERT … ON CONFLICT DO
 * NOTHING, so a clash never aborts the transaction). After a few random
 * misses it picks among the combinations still free; throws when all 676 are used.
 */
export async function allocateNumber(tx: Queryable, eventDate: DateStr, opts: { rand?: (max: number) => number } = {}): Promise<string> {
  assertDate(eventDate);
  const rand = opts.rand ?? randomInt;
  const tryInsert = async (n: string) =>
    (await tx.insert(bookingNumber).values({ number: n, eventDate }).onConflictDoNothing().returning({ number: bookingNumber.number })).length > 0;

  for (let i = 0; i < 12; i++) {
    const n = formatNumber(eventDate, randomLetters(rand));
    if (await tryInsert(n)) return n;
  }
  // Crowded date: choose among what is left.
  for (;;) {
    const used = new Set((await tx.select({ n: bookingNumber.number }).from(bookingNumber).where(eq(bookingNumber.eventDate, eventDate))).map(r => r.n));
    const free: string[] = [];
    for (const a of NUMBER_LETTERS) for (const b of NUMBER_LETTERS) {
      const n = formatNumber(eventDate, a + b);
      if (!used.has(n)) free.push(n);
    }
    if (!free.length) throw new NumberError(`All ${NUMBERS_PER_DATE} numbers for ${eventDate} are taken`);
    const n = free[rand(free.length)];
    if (await tryInsert(n)) return n;
  }
}

/** Register a specific number (seed data, e.g. '2026-0614-ЕА'). Throws if it is malformed or taken. */
export async function reserveNumber(tx: Queryable, number: string): Promise<string> {
  if (!isValidNumber(number)) throw new NumberError(`Not a booking number: ${number}`);
  const rows = await tx.insert(bookingNumber).values({ number, eventDate: numberDate(number) })
    .onConflictDoNothing().returning({ number: bookingNumber.number });
  if (!rows.length) throw new NumberError(`Number already taken: ${number}`);
  return number;
}
