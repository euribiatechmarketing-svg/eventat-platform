'use client';
// ‹Добавете снимки към сигнала›: up to ⚙ uploads.max_photos files per statement, each uploaded at once
// (media.upload(), kind dispute_evidence) and sent with the form as hidden `evidence` ids.
// Client look: client/dispute.html .rw-drop with .rw-shots; partner look: vendor/dispute.html .dp-drop + .gal.dp-ev.
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { toast } from '@/components/ui/client';

type Upload = { ok: true; id: string; name: string; mime: string } | { ok: false; error: string };
type Shot = { id: string; name: string; preview: string | null };

const PHOTO = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-6 8" /></svg>;
const UP = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="M8 8l4-4 4 4" /><path d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2" /></svg>;
const PLUS = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 5v14M5 12h14" /></svg>;
const X = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M6 6l12 12M18 6L6 18" /></svg>;
const DOC = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></svg>;

export function Evidence({ variant, upload, max, maxMb }: {
  variant: 'client' | 'partner'; upload: (fd: FormData) => Promise<Upload>; max: number; maxMb: number;
}) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const live = useRef(shots);
  live.current = shots;
  useEffect(() => () => live.current.forEach(s => s.preview && URL.revokeObjectURL(s.preview)), []);

  const pick = () => {
    if (busy) return;
    if (shots.length >= max) { toast(`Може да прикачите до ${max} снимки`); return; }
    input.current?.click();
  };
  const onFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (input.current) input.current.value = '';
    if (!files.length) return;
    setBusy(true);
    let count = shots.length;
    for (const f of files) {
      if (count >= max) { toast(`Може да прикачите до ${max} снимки`); break; }
      const fd = new FormData();
      fd.set('file', f);
      const r = await upload(fd);
      if (!r.ok) { toast(r.error, 'error'); continue; }
      count++;
      const preview = r.mime.startsWith('image/') ? URL.createObjectURL(f) : null;
      setShots(s => [...s, { id: r.id, name: r.name, preview }]);
      toast('Снимката е прикачена към сигнала');
    }
    setBusy(false);
  };
  // Both zones are drop targets too: files dragged onto them upload like chosen ones.
  const [over, setOver] = useState(false);
  const drop = {
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setOver(true); } },
    onDragLeave: () => setOver(false),
    onDrop: (e: DragEvent) => {
      if (!e.dataTransfer.files.length) return;
      e.preventDefault();
      setOver(false);
      if (busy) return;
      if (shots.length >= max) { toast(`Може да прикачите до ${max} снимки`); return; }
      void onFiles(e.dataTransfer.files);
    },
  };
  const remove = (id: string) => {
    setShots(s => s.filter(x => x.id !== id));
    toast('Снимката е премахната');
  };

  const hidden = (
    <>
      <input ref={input} type="file" hidden multiple accept="image/jpeg,image/png,application/pdf" data-testid="evidence-file" onChange={e => onFiles(e.target.files)} />
      {shots.map(s => <input key={s.id} type="hidden" name="evidence" value={s.id} />)}
    </>
  );
  const hint = `До ${max} снимки · JPG или PNG, до ${maxMb} MB всяка`;
  const shot = (s: Shot, cls: string) => (
    <span key={s.id} className={`${cls} ms-shot${s.preview ? '' : ' ms-shot--doc'}`} title={s.name} style={s.preview ? { backgroundImage: `url(${s.preview})` } : undefined}>
      {!s.preview && DOC}
      <button type="button" className="rw-shot-x" aria-label="Премахни снимката" onClick={e => { e.stopPropagation(); remove(s.id); }}>{X}</button>
    </span>
  );

  if (variant === 'client') {
    return (
      <>
        <div className={`rw-drop ms-drop${over ? ' is-over' : ''}`} role="button" tabIndex={0} aria-busy={busy} onClick={pick} {...drop}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } }}>
          {PHOTO}
          <div>
            <div className="rw-drop-t">Добавете снимки към сигнала</div>
            <div className="rw-drop-d">{hint}</div>
          </div>
          {shots.length > 0 && <span className="rw-shots">{shots.map(s => shot(s, 'rw-shot'))}</span>}
        </div>
        {hidden}
      </>
    );
  }
  return (
    <>
      {/* The whole dashed zone opens the file picker (vendor/dispute.html), as does its button for the keyboard. */}
      <div className={`dp-drop ms-drop${over ? ' is-over' : ''}`} aria-busy={busy} onClick={pick} {...drop}>
        <span className="dp-drop-ic">{UP}</span>
        <div>
          <div className="dp-drop-t">Добавете снимки към сигнала</div>
          <div className="dp-drop-d">{hint}</div>
        </div>
        <button type="button" className="btn btn--outline btn--sm" disabled={busy} onClick={e => { e.stopPropagation(); pick(); }}>Прикачи файл</button>
      </div>
      {shots.length > 0 && (
        <div className="gal dp-ev">
          {shots.map(s => shot(s, 'gal-item'))}
          {shots.length < max && <button type="button" className="gal-add" aria-label="Прикачи файл" onClick={pick}>{PLUS}</button>}
        </div>
      )}
      <div className="fld-hint">Прикачените файлове се виждат от екипа и от другата страна по случая.</div>
      {hidden}
    </>
  );
}
