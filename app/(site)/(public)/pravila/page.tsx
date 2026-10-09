// /pravila (client/legal.html, SCREENS §2): FAQ, terms in short, privacy, the three
// cancellation policies (generated from the policy table, SPEC §5.5) and contact. Numbers come
// from settings; the documents from `legal_document`.
import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { legalView } from '@/lib/domain/views-public';
import { DocNav, DownloadLink } from '../_components/client';
import { Question } from '../_components/icons';
import { signInHref } from '../_components/text';
import { viewerFor } from '../_components/viewer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Условия, поверителност и чести въпроси' };

const POLICY_BADGE = {
  flexible: ['badge--success', 'Най-щадяща'],
  moderate: ['badge--primary', 'Най-често'],
  strict: ['badge--warning', 'Сезонни дати'],
} as const;

const SECTIONS = [
  { id: 'faq', label: 'Чести въпроси' },
  { id: 'terms', label: 'Общи условия' },
  { id: 'privacy', label: 'Поверителност' },
  { id: 'cancel', label: 'Политики за анулиране' },
  { id: 'contact', label: 'Контакт' },
];

function Faq({ q, children }: { q: string; children: React.ReactNode }) {
  return (
    <div className="faq">
      <div className="faq-q"><Question />{q}</div>
      <p className="faq-a">{children}</p>
    </div>
  );
}

export default async function Legal() {
  const [n, { viewer }] = await Promise.all([legalView(), viewerFor('/pravila')]);
  const account = (path: string) => (viewer.kind === 'guest' ? signInHref(path) : viewer.kind === 'client' ? path : null);
  const contact = [
    { n: 'Въпрос към екипа', d: `Пишете ни на ${n.supportEmail}`, badge: 'badge--primary', b: 'Имейл', href: `mailto:${n.supportEmail}` },
    { n: 'Проблем с конкретна резервация', d: 'Отворете спор от самата резервация — средствата остават задържани, докато екипът разгледа случая', badge: 'badge--warning', b: 'Спор', href: account('/akaunt/rezervacii') },
    { n: 'Въпрос към изпълнител', d: 'Пишете му директно от резервацията или от заявката', badge: 'badge--success', b: 'Съобщения', href: account('/akaunt/saobshteniya') },
  ];

  return (
    <>
      <SiteHeader active="/kategorii" />
      <main className="wrap" id="main">
        <div className="hold">
          <div className="hero hero--left" style={{ padding: '40px 0 30px' }}>
            <div className="hero-eyebrow">Правна информация</div>
            <h1 className="hero-t" style={{ fontSize: 38 }}>Условия, поверителност и чести въпроси</h1>
            {n.lastEdited && <p className="hero-d" style={{ marginLeft: 0 }}>Последна редакция: {n.lastEdited}</p>}
          </div>

          <div className="doc">
            <DocNav items={SECTIONS}>
              {n.documents.length > 0 && (
                <>
                  <div className="doc-nav-t" style={{ marginTop: 22 }}>Документи</div>
                  {n.documents.map(d => <DownloadLink key={d.id} href={d.url}>{d.title}</DownloadLink>)}
                </>
              )}
            </DocNav>

            <div>
              <section className="doc-body" id="faq">
                <h2 className="doc-h">Чести въпроси</h2>
                <p className="doc-sub">Отговорите, които спестяват най-много обаждания.</p>
                <Faq q="Кога плащам?">Едва след като изпълнителят одобри заявката ви. Тогава имате {n.paymentText} да платите — датата е блокирана за вас през това време. Ако не платите, тя се освобождава автоматично и не дължите нищо.</Faq>
                <Faq q="Къде стоят парите до събитието?">В платформата. Сумата се превежда на изпълнителя на {n.payoutDaysOr} число след събитието, минус комисионата. Така изпълнителят е сигурен, че ще получи плащане, а вие имате към кого да се обърнете, ако нещо се обърка.</Faq>
                <Faq q="Мога ли да анулирам?">Да, според политиката на конкретния изпълнител — гъвкава, умерена или строга. Тя е изписана на профила му и в резюмето преди плащане. Възстановяването тръгва автоматично, без да се разбирате помежду си.</Faq>
                <Faq q="Ако изпълнителят не се яви?">Отваряте спор от резервацията. Средствата остават задържани, докато екипът не разгледа случая. Решението може да е пълно или частично възстановяване и се изпраща на двете страни с мотив.</Faq>
                <Faq q="Колко струва на изпълнителите?">Регистрацията и профилът са безплатни. Платформата удържа {n.commissionPct} комисиона само при потвърдена резервация — {n.introPct} за първите {n.introCountWord}. Няма месечни такси и няма плащане за по-добра позиция в резултатите.</Faq>
                <Faq q="Истински ли са ревютата?">Оценка може да остави само клиент с платена през платформата резервация и след като събитието е минало. Изпълнителят не може да трие ревюта — може само да отговори публично.</Faq>
              </section>

              <section className="doc-body" id="terms" style={{ marginTop: 20 }}>
                <h2 className="doc-h">Общи условия — накратко</h2>
                {n.documents.length > 0 && <p className="doc-sub">Пълният текст е достъпен като PDF в лявата колона.</p>}
                <div className="rules">
                  <div className="rule"><span className="rule-num">1</span><span><strong>EventAT е посредник.</strong> Услугата се извършва от изпълнителя; платформата осигурява намирането, договарянето и плащането.</span></div>
                  <div className="rule"><span className="rule-num">2</span><span><strong>Договорът е между вас и изпълнителя.</strong> Условията на конкретния пакет са част от него.</span></div>
                  <div className="rule"><span className="rule-num">3</span><span><strong>Плащанията минават през платформата.</strong> Договаряне извън нея лишава и двете страни от защитата при спор.</span></div>
                  <div className="rule"><span className="rule-num">4</span><span><strong>Данните ви се обработват по GDPR.</strong> Изпълнителят вижда само това, което е нужно за събитието.</span></div>
                </div>
              </section>

              <section className="doc-body" id="privacy" style={{ marginTop: 20 }}>
                <h2 className="doc-h">Поверителност</h2>
                <p className="doc-sub">Обработваме данните ви по GDPR и само за това, за което са дадени.</p>
                <div className="rules">
                  <div className="rule"><span className="rule-num">1</span><span><strong>Какво събираме.</strong> Името, имейла и телефона от профила ви, както и детайлите на събитието, които попълвате в заявката.</span></div>
                  <div className="rule"><span className="rule-num">2</span><span><strong>Какво вижда изпълнителят.</strong> Само необходимото за събитието — датата, мястото и описанието на заявката, а след потвърдена резервация и телефона ви за деня на събитието. Данните за плащане не се споделят с него.</span></div>
                  <div className="rule"><span className="rule-num">3</span><span><strong>Колко дълго ги пазим.</strong> Докато профилът ви съществува. Документите по платените резервации се пазят и след това, защото законът го изисква.</span></div>
                  <div className="rule"><span className="rule-num">4</span><span><strong>Вашите права.</strong> Можете да поискате достъп, поправка или изтриване на данните си. Изтриването на профила е в „Настройки“.</span></div>
                </div>
              </section>

              <section className="doc-body" id="cancel" style={{ marginTop: 20 }}>
                <h2 className="doc-h">Политики за анулиране</h2>
                <p className="doc-sub">Всеки изпълнител избира една от трите при създаване на профила си.</p>
                {n.policies.map(p => (
                  <div key={p.key} className="set-row">
                    <div className="set-t"><div className="set-n">{p.name}</div><div className="set-d">{p.description}</div></div>
                    <span className={`badge ${POLICY_BADGE[p.key][0]}`}>{POLICY_BADGE[p.key][1]}</span>
                  </div>
                ))}
              </section>

              <section className="doc-body" id="contact" style={{ marginTop: 20 }}>
                <h2 className="doc-h">Контакт</h2>
                <p className="doc-sub">Отговаряме в работни дни, а спешните случаи по резервация минават с приоритет.</p>
                {contact.map(c => {
                  const body = (
                    <>
                      <div className="set-t"><div className="set-n">{c.n}</div><div className="set-d">{c.d}</div></div>
                      <span className={`badge ${c.badge}`}>{c.b}</span>
                    </>
                  );
                  if (!c.href) return <div key={c.n} className="set-row">{body}</div>;
                  return c.href.startsWith('mailto:')
                    ? <a key={c.n} className="set-row" href={c.href}>{body}</a>
                    : <Link key={c.n} className="set-row" href={c.href}>{body}</Link>;
                })}
              </section>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
