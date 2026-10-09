// Digits inside display-font headings go in <span class="num"> (CLAUDE.md: Constantia draws old-style figures).
import { Fragment } from 'react';

/** Wraps each run of digits in `text` in span.num. */
export function Num({ children }: { children: string }) {
  const parts = children.split(/(\d(?:[\d\s.,:]*\d)?)/);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="num">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}
