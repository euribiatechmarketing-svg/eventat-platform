'use client';
// The wizard frame (prototype onboarding/*.html: .wiz-top, .wiz-stepper, .wiz-footer).
// The top bar, the rail and the footer buttons submit the current step's form
// (#wiz-form) with an intent, so nothing typed is lost (SPEC §4.2 P3).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { LangSwitch } from './LangSwitch';
import { ArrowLeft, ArrowRight, Check } from './icons';

export type ChromeStep = { step: number; title: string; done: boolean; reachable: boolean; meta: string };

type Ctx = { markSaved: () => void; busy: boolean; setBusy: (b: boolean) => void };
const WizardCtx = createContext<Ctx>({ markSaved: () => {}, busy: false, setBusy: () => {} });
export const useWizard = () => useContext(WizardCtx);

const NEXT_LABEL = ['Продължи към профила', 'Продължи към услугите', 'Продължи към наличността', 'Продължи към политиката', 'Продължи към прегледа', 'Подай за одобрение'];

function savedText(ms: number, longLabel: string): string {
  const m = Math.floor(Math.max(0, ms) / 60_000);
  if (m < 1) return 'Запазено току-що';
  if (m < 60) return `Запазено преди ${m} мин`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Запазено преди ${h} ч`;
  return longLabel;
}

/** ‹Запазено току-що› / ‹Запазено преди N мин› (SPEC §12.1), ticking on the client. */
function SaveStatus({ elapsedMs, longLabel, savedNow }: { elapsedMs: number | null; longLabel: string; savedNow: number | null }) {
  const mounted = useRef(Date.now());
  const [, tick] = useState(0);
  useEffect(() => { mounted.current = Date.now(); }, [elapsedMs]);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30_000); return () => clearInterval(t); }, []);
  if (elapsedMs == null && savedNow == null) return null;
  const ms = savedNow != null ? Date.now() - savedNow : (elapsedMs ?? 0) + (Date.now() - mounted.current);
  return <span className="wiz-save-status" suppressHydrationWarning>{savedText(ms, savedNow != null ? '' : longLabel)}</span>;
}

export function WizardChrome({ steps, elapsedMs, savedLongLabel, children }: {
  steps: ChromeStep[]; elapsedMs: number | null; savedLongLabel: string; children: ReactNode;
}) {
  const path = usePathname();
  const m = /\/partner\/registratsiya\/([1-6])(?:\/|$)/.exec(path);
  const current = m ? Number(m[1]) : null;
  const [savedNow, setSavedNow] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // A fresh server render (navigation, revalidation) carries the stored time again.
  useEffect(() => { setSavedNow(null); }, [elapsedMs]);
  const markSaved = useCallback(() => setSavedNow(Date.now()), []);
  const ctx = useMemo(() => ({ markSaved, busy, setBusy }), [markSaved, busy]);

  if (current == null) return <WizardCtx.Provider value={ctx}>{children}</WizardCtx.Provider>;
  const pct = ((current / 6) * 100).toFixed(1).replace(/\.0$/, '');
  return (
    <WizardCtx.Provider value={ctx}>
      <div className="wiz-shell">
        <a className="ui-skip" href="#main">Към съдържанието</a>
        <header className="wiz-top">
          <button type="submit" form="wiz-form" name="intent" value="later" className="wiz-logo"><img src="/assets/eventat-logo.png" alt="EventAT" /></button>
          <div className="wiz-top-right">
            <SaveStatus elapsedMs={elapsedMs} longLabel={savedLongLabel} savedNow={savedNow} />
            <button type="submit" form="wiz-form" name="intent" value="later" className="btn btn--outline wiz-top-btn">Запази и продължи по-късно</button>
            <button type="submit" form="wiz-form" name="intent" value="later" className="wiz-top-link">Изход</button>
            <LangSwitch />
          </div>
        </header>

        <main className="wiz-body">
          <aside className="wiz-stepper" aria-labelledby="wiz-stepper-t">
            <span className="wiz-stepper-eyebrow">Изпълнител</span>
            <h2 className="wiz-stepper-title" id="wiz-stepper-t">Настройте профила си</h2>
            <p className="wiz-stepper-sub">Шест стъпки до първите ви заявки. Напредъкът се запазва автоматично.</p>
            <ol className="wiz-steps">
              {steps.map(s => {
                const isCurrent = s.step === current;
                const clickable = s.reachable && !isCurrent;
                // The spaces keep the words apart in the text (‹2 Профил и галерия …›, not ‹2Профил и галерия…›); the
                // layout drops them (grid and block boxes).
                const inner = (
                  <>
                    <span className="wiz-step-bullet">{s.done && !isCurrent ? <Check /> : s.step}</span>{' '}
                    <span className="wiz-step-label">{s.title}{' '}<span className="wiz-step-meta">{s.meta}</span></span>
                  </>
                );
                return (
                  <li key={s.step} className={`wiz-step${s.done ? ' wiz-step--done' : ''}${isCurrent ? ' wiz-step--current' : ''}${clickable ? ' ui-click' : ''}`}
                    aria-current={isCurrent ? 'step' : undefined}>
                    {clickable
                      // Named for 390 px, where only the bullet shows: the number, the title and the meta, i.e. everything the
                      // button shows at full width, in the same order (WCAG 2.5.3).
                      ? <button type="submit" form="wiz-form" name="intent" value={`goto:${s.step}`} className="m-step-btn"
                          aria-label={`${s.step}. ${s.title} · ${s.meta}`}>{inner}</button>
                      : inner}
                  </li>
                );
              })}
            </ol>
          </aside>
          <div className="wiz-content" id="main">{children}</div>
        </main>

        <footer className="wiz-footer">
          <div className="wiz-footer-inner">
            <div className="wiz-progress">
              <div className="wiz-progress-bar" aria-hidden="true"><span style={{ width: `${pct}%` }} /></div>
              <span>Стъпка {current} от 6</span>
            </div>
            <div className="wiz-footer-actions">
              {current > 1 && (
                <button type="submit" form="wiz-form" name="intent" value="back" className="btn btn--ghost btn--lg" disabled={busy}>
                  <ArrowLeft className="btn-icon" />Назад
                </button>
              )}
              <button type="submit" form="wiz-form" name="intent" value={current === 6 ? 'submit' : 'next'} className="btn btn--primary btn--lg" disabled={busy}>
                {NEXT_LABEL[current - 1]}<ArrowRight className="btn-icon" />
              </button>
            </div>
          </div>
        </footer>
      </div>
    </WizardCtx.Provider>
  );
}
