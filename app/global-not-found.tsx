// Any URL that matches no route at all (Next 15.4+ experimental.globalNotFound).
import type { Metadata } from 'next';
import '@/styles/tokens.css';
import '@/styles/components.css';
import '@/styles/app.css';
import '@/styles/client.css';
import '@/styles/fonts.css';
import '@/styles/platform.css';
import { fontVars } from '@/lib/fonts';
import { NotFoundBody } from '@/components/ui/NotFound';

export const metadata: Metadata = { title: 'Страницата не е намерена · EventAT', robots: { index: false } };

export default function GlobalNotFound() {
  return (
    <html lang="bg" className={fontVars}>
      <body>
        <div id="frame"><div className="site">
          <header className="nav"><a className="nav-brand" href="/"><img className="nav-logo" src="/assets/eventat-logo.png" alt="EventAT" /></a></header>
          <div className="wrap"><div className="hold"><NotFoundBody /></div></div>
        </div></div>
      </body>
    </html>
  );
}
