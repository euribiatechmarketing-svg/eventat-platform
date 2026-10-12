'use client';
// A root layout itself failed: this replaces it, so it brings its own <html>, styles and fonts.
// A full page load home is the retry (the app's router is gone with the layout).
import '@/styles/tokens.css';
import '@/styles/components.css';
import '@/styles/app.css';
import '@/styles/client.css';
import '@/styles/fonts.css';
import '@/styles/platform.css';
import { fontVars } from '@/lib/fonts';
import { ERROR_MESSAGE } from '@/components/ui/ErrorBody';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="bg" className={fontVars}>
      <head><title>EventAT</title></head>
      <body>
        <div id="frame"><div className="site">
          <header className="nav"><a className="nav-brand" href="/"><img className="nav-logo" src="/assets/eventat-logo.png" alt="EventAT" /></a></header>
          <div className="wrap"><div className="hold">
            <div className="ui-notfound ui-error" role="main" id="main">
              <h1 className="ui-notfound-t">{ERROR_MESSAGE}</h1>
              <a className="btn btn--primary" href="/" onClick={() => reset()}>Към началото</a>
            </div>
          </div></div>
        </div></div>
      </body>
    </html>
  );
}
