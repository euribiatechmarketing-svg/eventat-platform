import { timingSafeEqual } from 'node:crypto';

/**
 * Is this `Authorization` header `Bearer $CRON_SECRET` (/api/cron/tick)? Never when the secret is
 * unset: the comparison used to accept the literal header "Bearer undefined".
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
