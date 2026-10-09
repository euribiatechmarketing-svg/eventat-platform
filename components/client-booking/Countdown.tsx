'use client';
// A live ‹Остават HH:MM› countdown. The server sends the deadline and its own
// business "now" (the platform clock may be shifted in demo, lib/clock.ts), so
// the browser counts from that instant, ticking every minute; when the time is
// up the page is refreshed to show the new state.
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/** ‹21:14›: hours and minutes left, never negative. */
export function hoursMinutes(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60_000));
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** `prefix`/`suffix` render in the same text run (a badge is a flex box: separate nodes would get its gap). */
export function Countdown({ to, now, prefix = '', suffix = '' }: { to: string; now: string; prefix?: string; suffix?: string }) {
  const router = useRouter();
  const deadline = Date.parse(to);
  const [left, setLeft] = useState(() => deadline - Date.parse(now));
  const refreshed = useRef(false);
  useEffect(() => {
    const skew = Date.parse(now) - Date.now();
    const tick = () => {
      const ms = deadline - (Date.now() + skew);
      setLeft(ms);
      if (ms <= 0 && !refreshed.current) { refreshed.current = true; router.refresh(); }
    };
    tick();
    let timer: ReturnType<typeof setInterval> | undefined;
    // Align the ticks with the minute boundary of the remaining time.
    const first = setTimeout(() => { tick(); timer = setInterval(tick, 60_000); }, ((deadline - (Date.now() + skew)) % 60_000 + 60_000) % 60_000 + 50);
    return () => { clearTimeout(first); if (timer) clearInterval(timer); };
  }, [deadline, now, router]);
  return <span suppressHydrationWarning>{`${prefix}${hoursMinutes(left)}${suffix}`}</span>;
}
