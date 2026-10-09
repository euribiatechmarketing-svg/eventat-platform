// /kak-raboti (client/how-it-works.html, SCREENS §2). The response and payment windows and the
// hold until ‹деня след събитието› come from settings (SPEC §13.10; the hero's ‹до деня на
// събитието› is corrected to the canonical ‹до деня след събитието›).
import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { howItWorksView } from '@/lib/domain/views-public';
import { Calendar, Check, Clock, Lines, SearchIcon, Shield, Speech, Star, Warn } from '../_components/icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Как работи' };

export default async function HowItWorks() {
  const n = await howItWorksView();
  return (
    <>
      <SiteHeader active="/kak-raboti" />
      <main className="wrap" id="main">
        <div className="hold">
          <div className="hero">
            <div className="hero-eyebrow">Как работи</div>
            <h1 className="hero-t">От търсене до потвърдена резервация<br />за три стъпки</h1>
            <p className="hero-d">Не плащате нищо, докато изпълнителят не потвърди, че е свободен. Парите стоят в платформата {n.holdText}.</p>
            <div className="hero-cta">
              <Link className="btn btn--primary btn--lg" href="/tarsene">Търси изпълнител</Link>
              <Link className="btn btn--outline btn--lg" href="/stani-partnyor">Предлагам услуга</Link>
            </div>
          </div>

          <div className="steps3">
            <div className="step3">
              <div className="step3-n">1</div>
              <div className="step3-t">Търсите и сравнявате</div>
              <p className="step3-d">Избирате категория, град и дата. Виждате само изпълнители, които са свободни тогава — с реални цени, галерия и ревюта от платени резервации.</p>
              <div className="step3-note"><SearchIcon />Филтри по бюджет, тип събитие и политика за анулиране.</div>
            </div>
            <div className="step3">
              <div className="step3-n">2</div>
              <div className="step3-t">Изпращате запитване</div>
              <p className="step3-d">Описвате събитието веднъж и изпращате към когото искате. Изпълнителят отговаря до {n.responseText}. Все още не плащате нищо.</p>
              <div className="step3-note"><Clock />Ако не отговори до {n.responseText}, заявката отпада автоматично.</div>
            </div>
            <div className="step3">
              <div className="step3-n">3</div>
              <div className="step3-t">Плащате и датата е ваша</div>
              <p className="step3-d">След одобрение имате {n.paymentText} да платите. Датата е блокирана за вас, а сумата стои в платформата {n.holdText}.</p>
              <div className="step3-note"><Shield />При анулиране в срок сумата се възстановява автоматично.</div>
            </div>
          </div>

          <div style={{ marginTop: 44 }}>
            <div className="band" style={{ backgroundImage: "url('/photos/thumbs/dancers.jpg')" }}>
              <div className="band-scrim" />
              <div className="band-in">
                <div className="band-t">Защо парите стоят в платформата</div>
                <p className="band-d">Изпълнителят знае, че плащането е осигурено, и блокира датата. Вие знаете, че ако нещо се обърка, има към кого да се обърнете. Сумата тръгва към изпълнителя чак след като събитието се проведе.</p>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 48 }}>
            <div className="sec-head">
              <h2 className="sec-t">Какво получавате</h2>
              <p className="sec-d">Разликата между EventAT и групата във Facebook, в която питате за препоръки.</p>
            </div>
            <div className="feats">
              <div className="feat">
                <span className="feat-i"><Calendar /></span>
                <div className="feat-t">Реална наличност</div>
                <p className="feat-d">Календарът на изпълнителя е свързан с профила му. Ако датата е заета, той не се показва.</p>
              </div>
              <div className="feat">
                <span className="feat-i"><Lines /></span>
                <div className="feat-t">Цени без изненади</div>
                <p className="feat-d">Всеки пакет казва какво влиза в цената и колко часа трае. Транспортът е отделен ред, не скрита такса.</p>
              </div>
              <div className="feat">
                <span className="feat-i"><Star /></span>
                <div className="feat-t">Ревюта само от платили</div>
                <p className="feat-d">Оценка оставя само клиент с платена резервация. Затова 4,8 тук значи 4,8.</p>
              </div>
              <div className="feat">
                <span className="feat-i"><Check /></span>
                <div className="feat-t">Проверени изпълнители</div>
                <p className="feat-d">Всеки профил минава през проверка на фирмата, контактите и портфолиото, преди да излезе в каталога.</p>
              </div>
              <div className="feat">
                <span className="feat-i"><Warn /></span>
                <div className="feat-t">Ако нещо се обърка</div>
                <p className="feat-d">Отваряте спор в платформата. Средствата се задържат, докато не се вземе решение.</p>
              </div>
              <div className="feat">
                <span className="feat-i"><Speech /></span>
                <div className="feat-t">Всичко на едно място</div>
                <p className="feat-d">Заявки, договорки и плащания за цялото събитие — в един профил, не в пет чата.</p>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 48 }}>
            <div className="cta">
              <div>
                <div className="cta-t">Кажете ни за събитието си</div>
                <p className="cta-d">Отнема две минути. Ще видите кой е свободен на вашата дата още на първия екран.</p>
              </div>
              <div className="cta-act">
                <Link className="btn btn--lg btn--onDark" href="/tarsene">Започни търсене</Link>
                <Link className="btn btn--lg btn--onDarkGhost" href="/pravila#faq">Въпроси и отговори</Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
