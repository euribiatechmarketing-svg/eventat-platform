'use client';
// ‹Прикачете снимки за вдъхновение› / ‹Добавете снимки от събитието›: the drop
// area opens the file picker (or takes dropped files); each photo is uploaded
// at once through the page's server action (media.upload) and the form then
// carries only its id. The × takes a photo off again (‹Снимката е премахната›).
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/components/ui/client';

type Shot = { key: string; id: string | null; preview: string };
export type UploadResult = { id?: string; error?: string };

export function PhotoPicker({ name, title, max, maxMb, upload, inline = false, onCount }: {
  name: string; title: string; max: number; maxMb: number;
  upload: (fd: FormData) => Promise<UploadResult>;
  /** Review form: the thumbnails sit inside the drop area, on the right. */
  inline?: boolean;
  onCount?: (n: number) => void;
}) {
  const [shots, setShots] = useState<Shot[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const hint = `До ${max} снимки · JPG или PNG, до ${maxMb} MB всяка`;

  useEffect(() => { onCount?.(shots.filter(s => s.id).length); }, [shots, onCount]);
  useEffect(() => () => shots.forEach(s => URL.revokeObjectURL(s.preview)), []); // eslint-disable-line react-hooks/exhaustive-deps

  async function add(files: FileList | File[]) {
    const list = [...files];
    const room = max - shots.length;
    if (list.length > room || list.some(f => !['image/jpeg', 'image/png'].includes(f.type) || f.size > maxMb * 1024 * 1024)) {
      toast(hint, 'error');
    }
    for (const f of list.slice(0, Math.max(0, room))) {
      if (!['image/jpeg', 'image/png'].includes(f.type) || f.size > maxMb * 1024 * 1024) continue;
      const key = `${f.name}-${f.size}-${Math.random()}`;
      const preview = URL.createObjectURL(f);
      setShots(s => [...s, { key, id: null, preview }]);
      const fd = new FormData();
      fd.set('file', f);
      const r = await upload(fd).catch(() => ({ error: hint }) as UploadResult);
      if (r.id) setShots(s => s.map(x => (x.key === key ? { ...x, id: r.id! } : x)));
      else {
        setShots(s => s.filter(x => x.key !== key));
        URL.revokeObjectURL(preview);
        toast(r.error ?? hint, 'error');
      }
    }
    if (input.current) input.current.value = '';
  }

  function remove(key: string) {
    setShots(s => {
      const x = s.find(y => y.key === key);
      if (x) URL.revokeObjectURL(x.preview);
      return s.filter(y => y.key !== key);
    });
    toast('Снимката е премахната');
  }

  const thumbs = shots.map(s => (
    <span key={s.key} className={`rw-shot${s.id ? '' : ' is-loading'}`} style={{ backgroundImage: `url(${s.preview})` }}>
      {s.id && <input type="hidden" name={name} value={s.id} />}
      <button type="button" className="rw-shot-x" aria-label="Премахни снимката" onClick={e => { e.preventDefault(); e.stopPropagation(); remove(s.key); }}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
      </button>
    </span>
  ));

  return (
    <>
      <label className={`rw-drop cb-drop${inline ? ' cb-drop--inline' : ''}`}
        onDragOver={e => e.preventDefault()}
        onDrop={e => { e.preventDefault(); if (e.dataTransfer.files.length) void add(e.dataTransfer.files); }}>
        <input ref={input} className="sr-only" type="file" accept="image/jpeg,image/png" multiple
          onChange={e => { if (e.target.files?.length) void add(e.target.files); }} disabled={shots.length >= max} />
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M21 16l-5-5-6 8" /></svg>
        <div>
          <div className="rw-drop-t">{title}</div>
          <div className="rw-drop-d">{hint}</div>
        </div>
        {inline && shots.length > 0 && <span className="rw-shots">{thumbs}</span>}
      </label>
      {!inline && shots.length > 0 && <div className="rw-shots rw-shots--att">{thumbs}</div>}
    </>
  );
}
