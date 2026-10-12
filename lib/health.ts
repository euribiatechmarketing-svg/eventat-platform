// /api/health: is this instance able to serve? One trivial database round trip, with a deadline
// so a hung connection answers 503 instead of hanging the monitor. Nothing secret in the body:
// no host, no error text (the error goes to the log).

export type Health = { ok: boolean; db: 'up' | 'down'; time: string };

export async function healthReport(probe: () => Promise<unknown>, timeoutMs = 5000): Promise<{ status: 200 | 503; body: Health }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`database probe timed out after ${timeoutMs} ms`)), timeoutMs); });
  let up = false;
  try {
    await Promise.race([probe(), deadline]);
    up = true;
  } catch (e) {
    console.error(JSON.stringify({ level: 'error', msg: 'health: database probe failed', error: e instanceof Error ? e.message : String(e) }));
  } finally {
    clearTimeout(timer);
  }
  // Wall-clock time of the check (monitoring), not business time (lib/clock.ts).
  const time = new Date().toISOString();
  return up ? { status: 200, body: { ok: true, db: 'up', time } } : { status: 503, body: { ok: false, db: 'down', time } };
}
