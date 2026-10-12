'use client';
// The body of every error boundary (app/**/error.tsx): the shared message and the area's home button,
// laid out like the 404 page. Approved copy only (review list 28 and 17).
// The button goes home and clears the boundary (reset); on the home page itself it fetches the page
// again first (refresh), so it is the "Опитайте отново" the message asks for.
import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';

export const ERROR_MESSAGE = 'Нещо се обърка. Опитайте отново.';

export function ErrorBody({ reset, home = '/', homeLabel = 'Към началото', inShell = false }: {
  reset: () => void; home?: string; homeLabel?: string; inShell?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = useTransition();
  const go = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;  // new tab: the browser's own
    e.preventDefault();
    start(() => {
      if (pathname === home) router.refresh(); else router.push(home);
      reset();
    });
  };
  // Inside a panel the shell already holds the main landmark (#main).
  return (
    <div className="ui-notfound ui-error" role={inShell ? undefined : 'main'} id={inShell ? undefined : 'main'}>
      <h1 className="ui-notfound-t">{ERROR_MESSAGE}</h1>
      <a className="btn btn--primary" href={home} onClick={go} aria-disabled={pending || undefined}>{homeLabel}</a>
    </div>
  );
}
