// Digits inside display-font headings go in <span class="num"> (Constantia draws old-style figures).
import { Fragment } from 'react';

export function Num({ text }: { text: string }) {
  const parts = text.split(/(\d[\d\s.,]*\d|\d)/);
  return <>{parts.map((p, i) => (i % 2 ? <span className="num" key={i}>{p}</span> : <Fragment key={i}>{p}</Fragment>))}</>;
}
