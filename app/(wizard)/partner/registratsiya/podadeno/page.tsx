// /partner/registratsiya/podadeno (prototype onboarding/pending.html; SCREENS §6, D51, D94):
// the application's live status. Submitted → the timeline; approved → ‹Към таблото›;
// rejected → the team's motive (copy from vendor-application-rejected).
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { dateTime } from '@/lib/format';
import { pendingStatus } from '@/lib/domain/views-partner-onboarding';
import { wizardContext } from '../guard';
import { BASE } from '../flow';
import { LangSwitch } from '../_ui/LangSwitch';
import { Num } from '../_ui/Num';
import { Alert, ArrowRight, Check, CircleCheck } from '../_ui/icons';
import { PendingLive, SignOutLink } from './PendingLive';

export const metadata: Metadata = { title: 'Профилът е подаден' };

function Step({ n, state, title, meta }: { n: number; state: 'done' | 'current' | 'todo'; title: string; meta: string }) {
  return (
    <div className={`pending-step${state === 'todo' ? '' : ` pending-step--${state}`}`}>
      <span className="pending-step-bullet">{state === 'done' ? <Check /> : n}</span>
      <div className="pending-step-content">
        <p className="pending-step-title">{title}</p>
        <p className="pending-step-meta">{meta}</p>
      </div>
    </div>
  );
}

export default async function PendingPage() {
  const { actor, chrome } = await wizardContext();
  if (chrome.status === 'draft' || chrome.status === 'returned') redirect(`${BASE}/${chrome.firstOpen}`);
  if (chrome.status === 'deactivated') redirect('/partner');
  const s = await pendingStatus(actor);
  const approved = s.status === 'approved';
  const rejected = s.status === 'rejected';
  const justNow = s.submittedAt && s.serverNow.getTime() - s.submittedAt.getTime() < 2 * 60_000;
  const submittedMeta = s.submittedAt ? `${justNow ? 'Току-що · ' : ''}${dateTime(s.submittedAt)}` : '';
  const mail = <a href={`mailto:${s.supportEmail}`}>{s.supportEmail}</a>;

  return (
    <div className="pending-shell">
      <PendingLive watching={s.status === 'submitted'} />
      <header className="wiz-top">
        <Link className="wiz-logo" href="/"><img src="/assets/eventat-logo.png" alt="EventAT" /></Link>
        <div className="wiz-top-right">
          <Link className="wiz-top-link" href="/pravila">Помощ</Link>
          <SignOutLink />
          <LangSwitch />
        </div>
      </header>

      <main className="pending-hero">
        <div className="pending-card" data-status={s.status}>
          {rejected ? (
            <>
              <div className="pending-icon pending-icon--danger"><Alert /></div>
              <span className="pending-eyebrow">Заявката е отказана</span>
              <h1 className="pending-title">Не можем да одобрим профила ви</h1>
              <p className="pending-text">Екипът на EventAT прегледа заявката на <strong><Num>{s.businessName}</Num></strong> и не може да я одобри. Мотивът е по-долу.</p>
              {s.note && <p className="m-reason"><b>Мотив</b>{s.note}</p>}
              <p className="pending-help">Ако смятате, че има грешка, пишете ни на {mail}{s.eik ? ` и посочете ЕИК ${s.eik}` : ''}.</p>
            </>
          ) : (
            <>
              <div className="pending-icon"><CircleCheck /></div>
              <span className="pending-eyebrow">{approved ? 'Профилът ви е одобрен' : 'Профилът ви е подаден'}</span>
              <h1 className="pending-title">Благодарим, <Num>{s.firstName}</Num>.</h1>
              {approved
                ? <p className="pending-text"><strong>{s.businessName}</strong> вече се показва в каталога и можете да приемате заявки.</p>
                : <p className="pending-text">Профилът ви очаква преглед от екипа. Обикновено отговаряме до&nbsp;{s.slaHours}&nbsp;часа и ще ви пишем на&nbsp;<strong>{s.email}</strong>.</p>}

              <div className="pending-timeline">
                <Step n={1} state="done" title="Подаден за преглед" meta={submittedMeta} />
                <Step n={2} state={approved ? 'done' : 'current'} title="Преглед от екипа" meta="Проверяваме информацията и контактите ви" />
                <Step n={3} state={approved ? 'done' : 'todo'} title="Активиране"
                  meta={approved && s.approvedAt ? dateTime(s.approvedAt) : 'Получавате имейл и започвате да приемате заявки'} />
              </div>

              <div className="pending-actions">
                <Link className="btn btn--outline btn--lg" href={approved ? `/partnyori/${s.slug}` : `/partnyori/${s.slug}?preview=1`}>Виж профила като клиент</Link>
                {approved && <Link className="btn btn--primary btn--lg" href="/partner">Към таблото<ArrowRight className="btn-icon" /></Link>}
              </div>

              <p className="pending-help">Имате въпрос? Пишете ни на {mail}</p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
