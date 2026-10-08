// Root layout for the public site and the client's account.
import type { Metadata, Viewport } from 'next';
import '@/styles/tokens.css';
import '@/styles/components.css';
import '@/styles/app.css';
import '@/styles/client.css';
import '@/styles/public.css';
import '@/styles/fonts.css';
import '@/styles/platform.css';
import { fontVars } from '@/lib/fonts';
import { Toaster, FlashToast, DrawerAutoClose } from '@/components/ui/client';
import { readFlash } from '@/lib/flash';

export const metadata: Metadata = {
  title: { default: 'EventAT — изпълнители за събития', template: '%s · EventAT' },
  description: 'Намерете и резервирайте проверени изпълнители за сватби, рождени дни и фирмени събития.',
  robots: process.env.ALLOW_INDEXING === 'true' ? undefined : { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#7f64ae' };

export default async function SiteRoot({ children }: { children: React.ReactNode }) {
  const flash = await readFlash();
  return (
    <html lang="bg" className={fontVars}>
      <body>
        <a className="ui-skip" href="#main">Към съдържанието</a>
        <div id="frame"><div className="site">{children}</div></div>
        <Toaster />
        <FlashToast message={flash?.message ?? null} kind={flash?.kind} />
        <DrawerAutoClose />
      </body>
    </html>
  );
}
