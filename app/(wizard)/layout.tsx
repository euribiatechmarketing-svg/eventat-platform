// Root layout for the partner sign-up wizard (prototype: onboarding/*, wizard.css).
import type { Metadata, Viewport } from 'next';
import '@/styles/tokens.css';
import '@/styles/components.css';
import '@/styles/wizard.css';
import '@/styles/fonts.css';
import '@/styles/platform.css';
import { fontVars } from '@/lib/fonts';
import { Toaster, FlashToast } from '@/components/ui/client';
import { readFlash } from '@/lib/flash';
import { AfterParse } from '@/components/ui/AfterParse';

export const metadata: Metadata = {
  title: { default: 'Регистрация на партньор', template: '%s · EventAT' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#7f64ae' };

export default async function WizardRoot({ children }: { children: React.ReactNode }) {
  const flash = await readFlash();
  return (
    <html lang="bg" className={fontVars}>
      <body>
        <div id="frame"><AfterParse>{children}</AfterParse></div>
        <Toaster />
        <FlashToast message={flash?.message ?? null} kind={flash?.kind} />
      </body>
    </html>
  );
}
