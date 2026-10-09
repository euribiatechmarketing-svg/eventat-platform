// Inline SVGs of the onboarding screens, drawn exactly as in the prototype.
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const Check = (p: P) => <svg {...base} strokeWidth={3} aria-hidden="true" {...p}><polyline points="20 6 9 17 4 12" /></svg>;
export const ArrowRight = (p: P) => <svg {...base} strokeWidth={2} aria-hidden="true" {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>;
export const ArrowLeft = (p: P) => <svg {...base} strokeWidth={2} aria-hidden="true" {...p}><path d="M19 12H5M11 6l-6 6 6 6" /></svg>;
export const Plus = ({ size = 14, sw = 2, ...p }: P & { size?: number; sw?: number }) =>
  <svg {...base} width={size} height={size} strokeWidth={sw} aria-hidden="true" {...p}><path d="M12 5v14M5 12h14" /></svg>;
export const Close = (p: P) => <svg {...base} width={14} height={14} strokeWidth={2} aria-hidden="true" {...p}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;
export const Trash = (p: P) => <svg {...base} width={14} height={14} strokeWidth={2} aria-hidden="true" {...p}><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>;
export const ChevronUp = (p: P) => <svg {...base} width={14} height={14} strokeWidth={2} aria-hidden="true" {...p}><polyline points="18 15 12 9 6 15" /></svg>;
export const ChevronLeft = (p: P) => <svg {...base} width={14} height={14} strokeWidth={2} aria-hidden="true" {...p}><polyline points="15 18 9 12 15 6" /></svg>;
export const ChevronRight = (p: P) => <svg {...base} width={14} height={14} strokeWidth={2} aria-hidden="true" {...p}><polyline points="9 18 15 12 9 6" /></svg>;
export const SelectChevron = () => (
  <svg className="select-chevron" viewBox="0 0 20 20" aria-hidden="true"><path d="M5.5 8l4.5 4.5L14.5 8" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const ListCheck = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="var(--success-600)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12" /></svg>
);
export const Shield = (p: P) => <svg {...base} strokeWidth={2} aria-hidden="true" {...p}><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>;
export const Clock = (p: P) => <svg {...base} strokeWidth={2} aria-hidden="true" {...p}><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
export const CircleCheck = (p: P) => <svg {...base} strokeWidth={2} aria-hidden="true" {...p}><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>;
export const Alert = (p: P) => <svg {...base} strokeWidth={2} aria-hidden="true" {...p}><path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>;
