'use client';
// The step form (#wiz-form). Submitted by the footer, the top bar and the rail with an
// intent; saves itself in the background a moment after the last change
// (‹Напредъкът се запазва автоматично.›). A submission waits for a background save in
// flight, so it always carries the ids that save created.
import { createContext, startTransition, useActionState, useContext, useEffect, useRef, type FormEvent, type ReactNode } from 'react';
import type { StepState } from '../flow';
import { useWizard } from './WizardChrome';
import { Alert } from './icons';

type Action = (prev: StepState, fd: FormData) => Promise<StepState>;

const StateCtx = createContext<{ state: StepState; pending: boolean; touch: () => void }>({ state: {}, pending: false, touch: () => {} });
/** The last response (field errors, created ids) and a way to mark the form changed. */
export const useStepState = () => useContext(StateCtx);

export function WizardForm({ action, children, onResult, className = 'wiz-form' }: {
  action: Action; children: ReactNode; onResult?: (s: StepState, form: HTMLFormElement) => void; className?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  const { markSaved, setBusy } = useWizard();
  const ref = useRef<HTMLFormElement>(null);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<Promise<void> | null>(null);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => { setBusy(pending); }, [pending, setBusy]);
  useEffect(() => () => setBusy(false), [setBusy]);
  useEffect(() => {
    if (state.saved) markSaved();
    if (ref.current && (state.created || state.fields || state.error)) onResultRef.current?.(state, ref.current);
    if (state.error) ref.current?.querySelector('.m-form-alert')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [state, markSaved]);

  const autosave = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const form = ref.current;
    if (!dirty.current || !form) return;
    dirty.current = false;
    const fd = new FormData(form);
    fd.set('intent', 'autosave');
    const run = (inflight.current ?? Promise.resolve())
      .then(() => action({}, fd))
      .then(r => {
        if (r?.savedAt) markSaved();
        if (r && ref.current) onResultRef.current?.(r, ref.current);
      })
      .catch(() => { dirty.current = true; })
      .finally(() => { if (inflight.current === run) inflight.current = null; });
    inflight.current = run;
  };
  const touch = () => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(autosave, 1500);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  // Submissions are dispatched by hand: a form `action` would make React reset every
  // uncontrolled field after each response (wiping what the partner typed when a step
  // comes back with errors). The `action` attribute stays for browsers without JS.
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    dirty.current = false; // the submission carries every field
    const form = e.currentTarget;
    const submitter = ((e.nativeEvent as SubmitEvent).submitter ?? undefined) as HTMLElement | undefined;
    const send = () => { const fd = new FormData(form, submitter); startTransition(() => formAction(fd)); };
    if (inflight.current) inflight.current.then(() => setTimeout(send, 0)); else send();
  };

  return (
    <StateCtx.Provider value={{ state, pending, touch }}>
      <form id="wiz-form" ref={ref} className={className} action={formAction} onSubmit={onSubmit} noValidate
        onChange={touch}
        onKeyDown={e => {
          const t = e.target as HTMLElement;
          // Enter in any input (text, checkbox, radio) must not submit implicitly: the form's first
          // submit button is the logo (‹Запази и продължи по-късно›), which would sign the partner out.
          if (e.key === 'Enter' && t.tagName === 'INPUT') e.preventDefault();
        }}>
        {state.error && (
          <div className="alert alert--danger m-form-alert" role="alert">
            <Alert className="alert-icon" />
            <div><p className="alert-title">{state.error}</p></div>
          </div>
        )}
        {children}
      </form>
    </StateCtx.Provider>
  );
}

/** `.field` with the error state and message of the last response. */
export function Field({ name, label, required, hint, message, children, className = '' }: {
  name?: string; label: ReactNode; required?: boolean; hint?: string; message?: ReactNode; children: ReactNode; className?: string;
}) {
  const { state } = useStepState();
  const err = name ? state.fields?.[name] : undefined;
  return (
    <div className={`field${err ? ' field--error' : ''}${className ? ` ${className}` : ''}`}>
      <label className="field-label" htmlFor={name ? `f-${name}` : undefined}>
        {label}{required && <span className="required-mark">*</span>}{hint && <span className="field-label-hint">{hint}</span>}
      </label>
      {children}
      {err ? <span className="field-message">{err}</span> : message ? <span className="field-message">{message}</span> : null}
    </div>
  );
}
