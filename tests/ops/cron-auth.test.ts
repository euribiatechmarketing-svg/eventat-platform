// /api/cron/tick authorisation: an unset CRON_SECRET used to accept the header "Bearer undefined".
import { describe, expect, it } from 'vitest';
import { cronAuthorized } from '@/lib/jobs/cron-auth';

describe('cron authorisation', () => {
  it('accepts exactly Bearer $CRON_SECRET', () => {
    expect(cronAuthorized('Bearer s3cret-value', 's3cret-value')).toBe(true);
    expect(cronAuthorized('Bearer s3cret-valuE', 's3cret-value')).toBe(false);
    expect(cronAuthorized('Bearer s3cret', 's3cret-value')).toBe(false);
    expect(cronAuthorized('s3cret-value', 's3cret-value')).toBe(false);
    expect(cronAuthorized(null, 's3cret-value')).toBe(false);
  });

  it('refuses everything while the secret is unset', () => {
    expect(cronAuthorized('Bearer undefined', undefined)).toBe(false);
    expect(cronAuthorized('Bearer ', '')).toBe(false);
  });
});
