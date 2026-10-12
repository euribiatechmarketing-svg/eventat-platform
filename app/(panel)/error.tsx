'use client';
// The partner or admin panel itself (its layout) failed, so there is no rail around this.
import { usePathname } from 'next/navigation';
import { ErrorBody } from '@/components/ui/ErrorBody';

export default function PanelRootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const path = usePathname();
  const home = path.startsWith('/admin') ? '/admin' : path.startsWith('/partner') ? '/partner' : '/';
  return <ErrorBody reset={reset} home={home} homeLabel={home === '/' ? 'Към началото' : 'Към таблото'} />;
}
