// GET /api/health: 200 {ok, db: 'up', time} when the database answers, 503 otherwise; never cached.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthReport } from '@/lib/health';
import { GET } from '@/app/api/health/route';

afterEach(() => vi.restoreAllMocks());

describe('health', () => {
  it('answers 200 with the database up', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(['db', 'ok', 'time']);
    expect(body).toMatchObject({ ok: true, db: 'up' });
    expect(Number.isNaN(Date.parse(body.time))).toBe(false);
  });

  it('answers 503 when the query fails, without the error in the body', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await healthReport(() => Promise.reject(new Error('password authentication failed for user "eventat" at db.internal:5432')));
    expect(r.status).toBe(503);
    expect(r.body).toMatchObject({ ok: false, db: 'down' });
    expect(JSON.stringify(r.body)).not.toContain('db.internal');
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('answers 503 when the database hangs', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await healthReport(() => new Promise(() => {}), 50);
    expect(r).toMatchObject({ status: 503, body: { ok: false, db: 'down' } });
  });
});
