// Root layout for the partner panel and the admin panel.
import type { Metadata, Viewport } from 'next';
import '@/styles/tokens.css';
import '@/styles/components.css';
import '@/styles/app.css';
import '@/styles/admin.css';
import '@/styles/fonts.css';
import '@/styles/platform.css';
import { fontVars } from '@/lib/fonts';
import { Toaster, FlashToast, DrawerAutoClose } from '@/components/ui/client';
import { readFlash } from '@/lib/flash';
import { AfterParse } from '@/components/ui/AfterParse';

export const metadata: Metadata = {
  title: { default: 'EventAT', template: '%s · EventAT' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#1f1633' };

export default async function PanelRoot({ children }: { children: React.ReactNode }) {
  const flash = await readFlash();
  return (
    <html lang="bg" className={fontVars}>
      <body>
        <div id="frame"><AfterParse>{children}</AfterParse></div>
        <Toaster />
        <FlashToast message={flash?.message ?? null} kind={flash?.kind} />
        <DrawerAutoClose />
      </body>
    </html>
  );
}
