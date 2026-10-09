// Inline icons drawn like the prototype's (24-unit grid, 1.8 stroke).
import type { SVGProps } from 'react';

const P: Record<string, React.ReactNode> = {
  bell: <><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></>,
  menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  close: <><path d="M6 6l12 12M18 6L6 18" /></>,
  chevronDown: <><path d="M7 10l5 5 5-5" /></>,
  chevronRight: <><path d="M10 7l5 5-5 5" /></>,
  check: <><path d="M5 12.5l4.5 4.5L19 7.5" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></>,
  dashboard: <><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>,
  inbox: <><path d="M4 13h4l2 3h4l2-3h4" /><path d="M5 5h14l2 8v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4z" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  layers: <><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 12l9 5 9-5M3 16l9 5 9-5" /></>,
  booking: <><path d="M9 11l2 2 4-4" /><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4" /></>,
  wallet: <><rect x="2" y="6" width="20" height="13" rx="2" /><path d="M2 11h20" /><circle cx="17.5" cy="15" r="1.3" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0113 0" /><path d="M16 4.5a3.5 3.5 0 010 7M18 14a6.5 6.5 0 013.5 6" /></>,
  star: <><path d="M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.8 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3z" /></>,
  settings: <><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 007 19.4a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00-1.2-2.9H1a2 2 0 110-4h.1A1.7 1.7 0 004.6 7a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V1a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H23a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>,
  shield: <><path d="M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3z" /></>,
  flag: <><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></>,
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></>,
  chat: <><path d="M21 12a8 8 0 01-11.6 7.1L4 20l1-4.6A8 8 0 1121 12z" /></>,
  heart: <><path d="M12 20s-7-4.4-9-9a4.8 4.8 0 019-3 4.8 4.8 0 019 3c-2 4.6-9 9-9 9z" /></>,
  logout: <><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  pin: <><path d="M12 21s-7-6.2-7-12a7 7 0 0114 0c0 5.8-7 12-7 12z" /><circle cx="12" cy="9" r="2.5" /></>,
  photo: <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-8 8" /></>,
  upload: <><path d="M12 16V4M7 9l5-5 5 5" /><path d="M4 16v3a2 2 0 002 2h12a2 2 0 002-2v-3" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></>,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16v4z" /></>,
  external: <><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></>,
  phone: <><path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  alert: <><path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4M12 17h.01" /></>,
  store: <><path d="M3 21V8l9-5 9 5v13" /><path d="M9 21v-6h6v6" /></>,
  filter: <><path d="M4 6h16M7 12h10M10 18h4" /></>,
};

export type IconName = keyof typeof P;

export function Icon({ name, ...rest }: { name: IconName } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {P[name]}
    </svg>
  );
}
