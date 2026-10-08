// Digits inside display-font text go in span.num (Constantia draws old-style figures):
// <Num>Фотокабина 360°</Num> → Фотокабина <span class="num">360</span>°
import { Fragment } from 'react';

export function Num({ children }: { children: string | null | undefined }) {
  const text = children ?? '';
  const parts = text.split(/(\d[\d\s.,]*\d|\d)/);
  return (
    <>
      {parts.map((p, i) => (i % 2 === 1 ? <span key={i} className="num">{p}</span> : <Fragment key={i}>{p}</Fragment>))}
    </>
  );
}
