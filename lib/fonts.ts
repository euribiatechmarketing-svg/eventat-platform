import { Inter, Cormorant_Garamond, Spectral } from 'next/font/google';

// Self-hosted at build time (no request to Google from the visitor's browser).
export const inter = Inter({ subsets: ['latin', 'cyrillic'], weight: ['400', '500', '600', '700'], variable: '--nf-inter', display: 'swap' });
export const cormorant = Cormorant_Garamond({ subsets: ['latin', 'cyrillic'], weight: ['600', '700'], variable: '--nf-cormorant', display: 'swap' });
export const spectral = Spectral({ subsets: ['latin', 'cyrillic'], weight: ['500', '600', '700'], variable: '--nf-spectral', display: 'swap' });

export const fontVars = `${inter.variable} ${cormorant.variable} ${spectral.variable}`;
