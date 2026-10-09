// Digits inside display-font text go in <span class="num"> (Constantia draws old-style figures; CLAUDE.md).
import { Fragment } from 'react';

export function Num({ children }: { children: string }) {
  const parts = children.split(/(\d(?:[\d\s.,]*\d)?)/);
  return <>{parts.map((p, i) => (i % 2 ? <span key={i} className="num">{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}
