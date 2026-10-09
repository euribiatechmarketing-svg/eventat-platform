'use client';
// Hydration waits until the browser has parsed the whole document.
//
// Next starts hydrating as soon as its (async, often cached) scripts run, while the HTML and the
// inline page data are still arriving. React 19.2 sends a large page as several data rows; when
// hydration reaches a row that has not arrived yet it pauses mid-page, and on resuming it can
// compare the wrong DOM nodes: ‹Hydration failed because the server rendered HTML didn't match the
// client› (#418 in production) and the page is thrown away and drawn again. Holding hydration at
// the top of the page until DOMContentLoaded means every row is there and it runs in one pass.
// The server renders straight through; client navigations (document already parsed) never wait.
import { use, type ReactNode } from 'react';

let parsed: Promise<void> | null = null;

function documentParsed(): Promise<void> | null {
  if (typeof document === 'undefined' || document.readyState !== 'loading') return null;
  return (parsed ??= new Promise(resolve => document.addEventListener('DOMContentLoaded', () => resolve(), { once: true })));
}

export function AfterParse({ children }: { children: ReactNode }) {
  const p = documentParsed();
  if (p) use(p);
  return children;
}
