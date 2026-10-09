'use client';
// The pending page follows the application live: while the team reviews it, the page
// re-reads its status every 20 seconds and whenever the tab comes back into view.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { signOutAction } from '@/lib/actions/common';

export function PendingLive({ watching }: { watching: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => router.refresh(), 20_000);
    const onVisible = () => { if (document.visibilityState === 'visible') router.refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
  }, [watching, router]);
  return null;
}

/** ‹Изход› → auth.signOut() → / */
export function SignOutLink() {
  return <button type="button" className="wiz-top-link" onClick={() => signOutAction()}>Изход</button>;
}
