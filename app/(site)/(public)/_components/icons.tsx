// The prototype's inline icons for the public pages, drawn exactly as in client/*.html
// (stroke 2 on a 24-unit grid unless noted). Category and event-type icons are keyed by slug.
import type { CSSProperties, ReactNode } from 'react';

type P = { className?: string; style?: CSSProperties };

function S({ children, className, style, sw = 2, filled = false }: P & { children: ReactNode; sw?: number; filled?: boolean }) {
  return filled
    ? <svg className={className} style={style} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">{children}</svg>
    : <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} aria-hidden="true">{children}</svg>;
}

const STAR = 'M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.8 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3z';

export const Star = (p: P) => <S {...p} filled><path d={STAR} /></S>;
/**
 * Five filled stars (`.v-stars`, `.rev-stars`); `n` of them lit when given. `rated`: the stars are the only
 * place the rating shows (a review), so they read as ‹5 звезди›; beside a printed rating they stay hidden.
 */
export function Stars({ n = 5, className, rated = false }: { n?: number; className?: string; rated?: boolean }) {
  return (
    <span className={className} {...(rated ? { role: 'img', 'aria-label': n === 1 ? '1 звезда' : `${n} звезди` } : {})}>
      {[0, 1, 2, 3, 4].map(i => <Star key={i} style={i < n ? undefined : { opacity: 0.25 }} />)}
    </span>
  );
}
export const ShieldCheck = (p: P) => <S {...p}><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></S>;
export const ArrowRight = (p: P) => <svg className={p.className} style={p.style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const Caret = (p: P) => <S {...p} sw={2.4}><path d="M6 9l6 6 6-6" /></S>;
export const CrumbChevron = (p: P) => <S {...p} sw={2.4}><path d="M9 6l6 6-6 6" /></S>;
export const SearchIcon = (p: P) => <S {...p}><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.9-3.9" /></S>;
export const ChatIcon = (p: P) => <S {...p} sw={1.9}><path d="M21 11.5a8.4 8.4 0 01-9 8.4 9 9 0 01-3.8-.8L3 20.5l1.4-4.2A8.4 8.4 0 013 11.5 8.4 8.4 0 0112 3a8.4 8.4 0 019 8.5z" /></S>;
export const Pin = (p: P) => <S {...p}><path d="M12 21s-7-5.2-7-11a7 7 0 1114 0c0 5.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.4" /></S>;
export const CalendarSm = (p: P) => <S {...p}><path d="M4 7h16v13H4z" /><path d="M4 11h16M9 4v4M15 4v4" /></S>;
export const Guests = (p: P) => <S {...p}><circle cx="9" cy="8" r="3.4" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 6.2a3.4 3.4 0 010 6.6M17.5 20a6.5 6.5 0 00-2.2-4.9" /></S>;
export const Clock = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></S>;
export const CardIcon = (p: P) => <S {...p}><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 11h20" /></S>;
export const Question = (p: P) => <S {...p}><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 113.5 2.3c-.7.3-1 .9-1 1.7M12 17h.01" /></S>;
export const Close = (p: P) => <S {...p} sw={2.6}><path d="M6 6l12 12M18 6L6 18" /></S>;
export const Lines = (p: P) => <S {...p}><path d="M4 7h16M4 12h10M4 17h7" /></S>;
export const Check = (p: P) => <S {...p}><path d="M20 6L9 17l-5-5" /></S>;
export const Calendar = (p: P) => <S {...p}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></S>;
export const Warn = (p: P) => <S {...p}><path d="M12 3l9 16H3l9-16z" /><path d="M12 10v4M12 17h.01" /></S>;
export const Speech = (p: P) => <S {...p}><path d="M4 4h16v12H7l-3 3z" /></S>;
export const Inbox = (p: P) => <S {...p}><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5 5h14l2 8v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4z" /></S>;
export const Shield = (p: P) => <S {...p}><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></S>;
export const Filter = (p: P) => <S {...p}><path d="M4 5h16l-6 7.5V19l-4 1.5v-8z" /></S>;

/** Category icons (client/categories.html, event-type.html). */
const CATEGORY: Record<string, ReactNode> = {
  'zali-i-lokatsii': <><path d="M12 21s-7-5.2-7-11a7 7 0 1114 0c0 5.8-7 11-7 11z" /><circle cx="12" cy="10" r="2.6" /></>,
  ketaring: <><path d="M6 3v7a2 2 0 004 0V3" /><path d="M8 10v11" /><path d="M16 3c1.9 0 3 1.6 3 4s-1.1 4-3 4v10" /></>,
  'dj-i-ozvuchavane': <><path d="M9 18V6l10-2v12" /><circle cx="6.6" cy="18" r="2.4" /><circle cx="16.6" cy="16" r="2.4" /></>,
  fotografiya: <><path d="M4 8h3l1.6-2h6.8L17 8h3v11H4z" /><circle cx="12" cy="13.2" r="3.4" /></>,
  videozasnemane: <><rect x="3" y="7" width="12" height="10" rx="2" /><path d="M15 11.2l6-3.2v8l-6-3.2z" /></>,
  dekoratsiya: <><circle cx="12" cy="7.6" r="3.2" /><path d="M12 21V11" /><path d="M12 14.5c-2.4 0-4.3 1.9-4.3 4.3M12 14.5c2.4 0 4.3 1.9 4.3 4.3" /></>,
  fotokabini: <><rect x="4" y="4" width="16" height="16" rx="2" /><circle cx="12" cy="10.2" r="2.6" /><path d="M8 16.6h8" /></>,
  'torti-i-deserti': <><path d="M4 20h16v-7H4z" /><path d="M4 16.4h16" /><path d="M8 13V9.4M12 13V8.4M16 13V9.4" /></>,
  muzikanti: <><circle cx="7.4" cy="17.6" r="3.2" /><path d="M10.6 17.6V4.2c3.9.8 6.4 2.6 6.4 5.5" /></>,
  'transport-za-gosti': <><rect x="3" y="5" width="18" height="11" rx="2" /><path d="M3 11h18" /><circle cx="7.4" cy="19" r="1.6" /><circle cx="16.6" cy="19" r="1.6" /></>,
  'kolichka-za-sladoled': <><path d="M7 9.4l5 11.6 5-11.6" /><path d="M7 9.4a5 5 0 0110 0z" /></>,
  'studeni-foyerverki': <><path d="M12 3v5M12 16v5M3 12h5M16 12h5M6.3 6.3l3.5 3.5M14.2 14.2l3.5 3.5M17.7 6.3l-3.5 3.5M9.8 14.2l-3.5 3.5" /></>,
  'bar-s-kokteyli': <><path d="M4 5h16l-8 8z" /><path d="M12 13v6" /><path d="M8.4 19h7.2" /></>,
  karaoke: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M6 11.2a6 6 0 0012 0" /><path d="M12 17.2V21M9 21h6" /></>,
  'kasna-zakuska': <><path d="M4 8.4h12v4.8a6 6 0 01-12 0z" /><path d="M16 9.6h2.4a2.4 2.4 0 010 4.8H16" /><path d="M4 19.6h14" /></>,
  'kat-za-detsa': <><circle cx="12" cy="9" r="6" /><path d="M12 15v6" /><path d="M9.8 11.2a3 3 0 004.4 0" /><path d="M9.6 7.6h.01M14.4 7.6h.01" /></>,
  kaligraf: <><path d="M4 20l4.2-1L19 8.2 15.8 5 5 15.8z" /><path d="M14 7l3 3" /></>,
};

/** Event-type icons (client/categories.html ‹Най-търсени по тип събитие›). */
const EVENT_TYPE: Record<string, ReactNode> = {
  svatba: <><circle cx="8.6" cy="14.4" r="5.4" /><circle cx="15.4" cy="14.4" r="5.4" /><path d="M12 4.2l2 2.6h-4z" /></>,
  'rozhden-den': <><rect x="3" y="8.6" width="18" height="11.4" rx="2" /><path d="M3 13h18M12 8.6V20" /><path d="M12 8.6S10.5 4.4 8.5 4.4a2.3 2.3 0 000 4.2" /><path d="M12 8.6s1.5-4.2 3.5-4.2a2.3 2.3 0 010 4.2" /></>,
  'firmeno-sabitie': <><path d="M4 21V5a2 2 0 012-2h7a2 2 0 012 2v16" /><path d="M15 9.4h3a2 2 0 012 2V21" /><path d="M8 7.4h3M8 11.4h3M8 15.4h3" /></>,
  'abiturientski-bal': <><path d="M3 9.2l9-4 9 4-9 4-9-4z" /><path d="M7 11.4v4.8c0 1.5 2.2 2.6 5 2.6s5-1.1 5-2.6v-4.8" /></>,
};

export function CategoryIcon({ slug }: { slug: string }) {
  return <S>{CATEGORY[slug] ?? CATEGORY['zali-i-lokatsii']}</S>;
}
export function EventTypeIcon({ slug }: { slug: string }) {
  return <S>{EVENT_TYPE[slug] ?? EVENT_TYPE.svatba}</S>;
}

/** The catering tips' icons in order (client/category.html): what is included, when they arrive, tasting. */
export function TipIcon({ index }: { index: number }) {
  return [<Lines key="l" />, <Clock key="c" />, <Check key="k" />][index % 3];
}
