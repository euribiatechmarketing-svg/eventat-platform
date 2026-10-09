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

/**
 * ‹a · b · c› that breaks only between the parts: a short part never splits (‹78% отзивчивост›,
 * ‹Мария Д.›, ‹По запитване›) and the dot stays with the part before it.
 */
export function Segs({ parts }: { parts: (string | null | undefined | false)[] }) {
  const list = parts.filter((x): x is string => !!x && !!x.trim());
  return (
    <>
      {list.map((p, i) => (
        <Fragment key={i}>{i > 0 && ' · '}{p.length <= 32 ? <span className="pc-seg">{p}</span> : p}</Fragment>
      ))}
    </>
  );
}
