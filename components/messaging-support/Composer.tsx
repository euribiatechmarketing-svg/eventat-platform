'use client';
// The reply box under a thread: the client's single-line composer (client/messages.html .msg-comp)
// and the partner's box with ‹Прикачи файл› (vendor/messages.html .vmsg-compose). Drafts are saved
// while typing (messages.saveDraft()), one attachment per message (media.upload()), ‹Изпрати› →
// messages.send() with the prototype's toasts.
import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/client';

type Result = { ok: true } | { ok: false; error: string };
type Upload = { ok: true; id: string; name: string; mime: string } | { ok: false; error: string };
export type ComposerActions = {
  send: (input: { conversationId: string; body: string; attachmentId: string | null }) => Promise<Result>;
  saveDraft: (input: { conversationId: string; body: string }) => Promise<Result>;
  upload: (formData: FormData) => Promise<Upload>;
};

const CLIP = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"><path d="M21 12.4l-8.6 8.6a5.5 5.5 0 01-7.8-7.8l8.9-8.9a3.7 3.7 0 015.2 5.2l-8.9 8.9a1.8 1.8 0 01-2.6-2.6l8.2-8.2" /></svg>;
const SHIELD = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6l8-3z" /><path d="M9 12l2 2 4-4" /></svg>;
const X = <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6"><path d="M6 6l12 12M18 6L6 18" /></svg>;

function useComposer(conversationId: string, initialDraft: string, actions: ComposerActions) {
  const router = useRouter();
  const [body, setBody] = useState(initialDraft);
  const [file, setFile] = useState<{ id: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saved = useRef(initialDraft);
  const fileInput = useRef<HTMLInputElement>(null);

  // The page keys the composer by conversation, so the draft is read once; later refreshes
  // (every 15 s) never overwrite what is being typed.
  const pending = useRef<string | null>(null);
  const flush = () => {
    clearTimeout(timer.current);
    const v = pending.current;
    pending.current = null;
    if (v === null || v === saved.current) return;
    saved.current = v;
    void actions.saveDraft({ conversationId, body: v });
  };
  // Leaving the conversation saves what was typed.
  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps

  const onType = (v: string) => {
    setBody(v);
    pending.current = v;
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 700);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setUploading(true);
    const fd = new FormData();
    fd.set('conversationId', conversationId);
    fd.set('file', f);
    const r = await actions.upload(fd);
    setUploading(false);
    if (fileInput.current) fileInput.current.value = '';
    if (!r.ok) { toast(r.error, 'error'); return; }
    setFile({ id: r.id, name: r.name });
    toast('Файлът е прикачен към съобщението');
  };

  const submit = () => {
    if (sending || uploading || (!body.trim() && !file)) return;
    clearTimeout(timer.current);
    pending.current = null;
    const text = body;
    start(async () => {
      const r = await actions.send({ conversationId, body: text, attachmentId: file?.id ?? null });
      if (!r.ok) { toast(r.error, 'error'); return; }
      setBody(''); saved.current = ''; setFile(null);
      toast('Съобщението е изпратено');
      router.refresh();
    });
  };

  const fileField = (
    <input ref={fileInput} type="file" hidden accept="image/jpeg,image/png,application/pdf" data-testid="message-file"
      onChange={e => onFile(e.target.files?.[0])} />
  );
  const chip = file && (
    <span className="ms-chip">
      <span className="ms-chip-n">{file.name}</span>
      <button type="button" aria-label={`Премахни ${file.name}`} onClick={() => setFile(null)}>{X}</button>
    </span>
  );
  return { body, onType, submit, sending, uploading, fileInput, fileField, chip, canSend: !!(body.trim() || file) && !uploading };
}

/** client/messages.html: clip · one line · ‹Изпрати›. */
export function ClientComposer({ conversationId, draft, actions }: { conversationId: string; draft: string; actions: ComposerActions }) {
  const c = useComposer(conversationId, draft, actions);
  return (
    <form className="ms-comp-wrap" action={() => c.submit()}>
      {c.chip && <div className="ms-attached">{c.chip}</div>}
      <div className="msg-comp">
        <button type="button" className="msg-comp-clip" aria-label="Прикачи файл" title="Прикачи файл" disabled={c.uploading}
          onClick={() => c.fileInput.current?.click()}>{CLIP}</button>
        {c.fileField}
        <input className="msg-comp-f" name="body" value={c.body} placeholder="Напишете отговор…" aria-label="Съобщение" maxLength={4000}
          autoComplete="off" onChange={e => c.onType(e.target.value)} />
        <button className="btn btn--primary" type="submit" disabled={c.sending || !c.canSend}>Изпрати</button>
      </div>
    </form>
  );
}

/** vendor/messages.html: text box · ‹Прикачи файл› · ‹Изпрати› + the in-platform hint. */
export function PartnerComposer({ conversationId, draft, actions }: { conversationId: string; draft: string; actions: ComposerActions }) {
  const c = useComposer(conversationId, draft, actions);
  return (
    <form className="vmsg-compose" action={() => c.submit()}>
      <div className="vmsg-box">
        <textarea className="vmsg-input" name="body" value={c.body} placeholder="Напишете отговор…" aria-label="Съобщение" maxLength={4000} rows={2}
          onChange={e => c.onType(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); c.submit(); } }} />
        <div className="vmsg-tools">
          {c.fileField}
          <button type="button" className="btn btn--outline" disabled={c.uploading} onClick={() => c.fileInput.current?.click()}>Прикачи файл</button>
          <button type="submit" className="btn btn--primary" disabled={c.sending || !c.canSend}>Изпрати</button>
        </div>
      </div>
      {c.chip && <div className="ms-attached ms-attached--panel">{c.chip}</div>}
      <div className="vmsg-hint">{SHIELD}<span>Разговорите остават в платформата — така всичко договорено е записано.</span></div>
    </form>
  );
}
