'use client';
// A page of the public site or the client's account failed (the layout above it still stands).
import { ErrorBody } from '@/components/ui/ErrorBody';

export default function SiteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <>
      <header className="nav"><a className="nav-brand" href="/"><img className="nav-logo" src="/assets/eventat-logo.png" alt="EventAT" /></a></header>
      <div className="wrap"><div className="hold"><ErrorBody reset={reset} /></div></div>
    </>
  );
}
