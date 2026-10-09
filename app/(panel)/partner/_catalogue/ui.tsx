'use client';
// Small client pieces for the partner catalogue & money screens.
import { useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useFormStatus } from 'react-dom';
import { toast } from '@/components/ui/client';

/** The prototype's `span.toggle`, as a real switch. */
export function Switch({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className={`toggle${on ? ' is-on' : ''}`} onClick={() => onChange(!on)} />
  );
}

const STAR = 'M12 3l2.7 5.8 6.3.8-4.6 4.3 1.2 6.2L12 17.8 6.4 20.1l1.2-6.2L3 9.6l6.3-.8L12 3z';

/** ‹★★★★› — `n` stars, as the prototype draws them (a 4-star review shows four, vendor/reviews.html). */
export function Stars({ n, style }: { n: number; style?: React.CSSProperties }) {
  const k = Math.max(0, Math.min(5, Math.round(n)));
  return (
    <span className="rev-stars" style={style} aria-label={`${k} от 5`}>
      {Array.from({ length: k }, (_, i) => (
        <svg key={i} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d={STAR} /></svg>
      ))}
    </span>
  );
}

/** A table row that opens a page (the prototype's `.tbl tbody tr` routes). */
export function ClickRow({ href, children }: { href: string; children: ReactNode }) {
  const router = useRouter();
  return (
    <tr className="pc-row" tabIndex={0} onClick={() => router.push(href)}
      onKeyDown={e => { if (e.key === 'Enter') router.push(href); }}>
      {children}
    </tr>
  );
}

/** A submit button that is disabled while its form is being sent. */
export function Submit({ children, className = 'btn btn--primary btn--sm', name, value, form, disabled }: {
  children: ReactNode; className?: string; name?: string; value?: string; form?: string; disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return <button type="submit" className={className} name={name} value={value} form={form} disabled={disabled || pending}>{children}</button>;
}

/** ‹Сподели профила›: copies the public profile link. */
export function CopyLink({ path, children, className }: { path: string; children: ReactNode; className: string }) {
  return (
    <button type="button" className={className} onClick={async () => {
      const url = `${window.location.origin}${path}`;
      try { await navigator.clipboard.writeText(url); } catch {
        const t = document.createElement('textarea'); t.value = url; document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); } finally { t.remove(); }
      }
      toast('Линкът към профила е копиран');
    }}>{children}</button>
  );
}

/** A button that opens the file chooser; `onFile` gets the chosen file. */
export function FilePick({ accept, onFile, className, children, disabled, label }: {
  accept: string; onFile: (f: File) => void; className: string; children: ReactNode; disabled?: boolean; label?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} disabled={disabled} aria-label={label} onClick={() => ref.current?.click()}>{children}</button>
      <input ref={ref} type="file" accept={accept} hidden onChange={e => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) onFile(f);
      }} />
    </>
  );
}
