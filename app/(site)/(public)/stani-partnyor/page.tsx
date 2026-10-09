// /stani-partnyor (client/become-partner.html, SCREENS §2, SPEC §13.10, D8): commission, the
// introductory rate, payout days, approval time, packages and the payout example from settings;
// the testimonial's partner from the data.
import Link from 'next/link';
import { SiteHeader } from '@/components/site/SiteHeader';
import { moneyShort } from '@/lib/format';
import { becomePartnerView } from '@/lib/domain/views-public';
import { CardIcon, Inbox, Shield, Star, Stars } from '../_components/icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Стани партньор' };

const SIGN_UP = '/registratsiya?as=partner';

export default async function BecomePartner() {
  const n = await becomePartnerView();
  const ex = n.payoutExample;
  const partnerEuros = moneyShort(ex.partnerCents).replace(/\s?€$/, '');
  return (
    <>
      <SiteHeader active="/stani-partnyor" />
      <main className="wrap" id="main">
        <div className="hold">
          <div className="band" style={{ backgroundImage: "url('/photos/thumbs/v1-dj-mod.jpg')", height: 340, marginTop: 30 }}>
            <div className="band-scrim" />
            <div className="band-in">
              <div className="hero-eyebrow" style={{ color: 'var(--pink-300)' }}>За изпълнители</div>
              <div className="band-t" style={{ marginTop: 12 }}>Работете с клиенти,{' '}<br />които вече са решили да платят</div>
              <p className="band-d">Без обаждания „само да питам“. Заявката идва с дата, брой гости, бюджет и локация — вие отговаряте с да или не.</p>
              <div className="hero-cta" style={{ justifyContent: 'flex-start', marginTop: 24 }}>
                <Link className="btn btn--lg btn--onDark" href={SIGN_UP}>Стани партньор</Link>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 44 }}>
            <div className="earn-split">
              <div>
                <div className="sec-head sec-head--left" style={{ marginBottom: 18 }}>
                  <h2 className="sec-t">Плащате само когато печелите</h2>
                  <p className="sec-d">Няма месечна такса и няма пакет за видимост. Платформата взима комисиона само от резервация, която реално се е случила.</p>
                </div>
                <div className="rules">
                  <div className="rule"><span className="rule-num">1</span><span>Регистрацията и профилът са <strong>безплатни</strong>.</span></div>
                  <div className="rule"><span className="rule-num">2</span><span>При потвърдена резервация платформата удържа <strong>{n.commissionPct} комисиона</strong>.</span></div>
                  <div className="rule"><span className="rule-num">3</span><span>За първите {n.introCountWord} резервации комисионата е <strong>{n.introPct}</strong>.</span></div>
                  <div className="rule"><span className="rule-num">4</span><span>Изплащането идва на <strong>{n.payoutDaysText}</strong> число, след като събитието е минало.</span></div>
                </div>
              </div>
              <div className="money">
                <div className="money-l">{ex.title}</div>
                <div className="money-v">{partnerEuros} <small>€</small></div>
                <div className="split" style={{ marginTop: 16 }}><span>Цена за клиента</span><b>{moneyShort(ex.priceCents)}</b></div>
                <div className="split is-fee"><span>Комисиона ({n.commissionPct})</span><b>− {moneyShort(ex.commissionCents)}</b></div>
                <div className="split is-total"><span>Получавате</span><b>{moneyShort(ex.partnerCents)}</b></div>
                <div className="book-note" style={{ marginTop: 16 }}>
                  <CardIcon />
                  <span>Банков превод, с фактура от платформата.</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 48 }}>
            <div className="sec-head">
              <h2 className="sec-t">Как започвате</h2>
              <p className="sec-d">Профилът се одобрява до {n.approvalSlaHours} часа. Първата заявка обикновено идва в първата седмица.</p>
            </div>
            <div className="steps3">
              <div className="step3">
                <div className="step3-n">1</div>
                <div className="step3-t">Създавате профил</div>
                <p className="step3-d">Име на фирмата, категория, град и обхват. Добавяте галерия и до {n.maxPackagesWord} пакета с ясни цени.</p>
              </div>
              <div className="step3">
                <div className="step3-n">2</div>
                <div className="step3-t">Поддържате календара</div>
                <p className="step3-d">Блокирате заетите дати. Показвате се в търсенето само когато сте свободни — затова заявките са реални.</p>
              </div>
              <div className="step3">
                <div className="step3-n">3</div>
                <div className="step3-t">Отговаряте до <span className="num">{n.responseHours}</span> часа</div>
                <p className="step3-d">Одобрявате или отказвате. При одобрение клиентът има {n.paymentHours} часа да плати и датата е блокирана.</p>
              </div>
            </div>
          </div>

          <div style={{ marginTop: 48 }}>
            <div className="feats">
              <div className="feat">
                <span className="feat-i"><Inbox /></span>
                <div className="feat-t">Заявки с всичко наведнъж</div>
                <p className="feat-d">Дата, час, брой гости, локация и бюджет. Без три разговора, за да разберете какво иска клиентът.</p>
              </div>
              <div className="feat">
                <span className="feat-i"><Shield /></span>
                <div className="feat-t">Сигурно плащане</div>
                <p className="feat-d">Клиентът плаща предварително в платформата. Вие започвате работа със знанието, че парите са там.</p>
              </div>
              <div className="feat">
                <span className="feat-i"><Star /></span>
                <div className="feat-t">Репутация, която остава</div>
                <p className="feat-d">Ревютата се трупат в профила ви и работят за вас при всяко следващо търсене.</p>
              </div>
            </div>
          </div>

          {n.testimonial && (
            <div style={{ marginTop: 44 }}>
              <section className="dcard" style={{ padding: '30px 34px' }}>
                <div className="rev" style={{ paddingTop: 0 }}>
                  <div className="rev-head">
                    <span className="avatar avatar--lg">{n.testimonial.avatarUrl ? <img src={n.testimonial.avatarUrl} alt="" /> : null}</span>
                    <div>
                      <div className="rev-name" style={{ fontSize: 16 }}>{n.testimonial.name}</div>
                      <div className="rev-meta">{n.testimonial.meta}</div>
                    </div>
                    <Stars className="rev-stars" n={n.testimonial.stars} />
                  </div>
                  <div className="rev-text" style={{ fontSize: 15 }}>„Преди прекарвах вечерите в отговаряне на съобщения от хора, които после изчезваха. Сега получавам заявка с дата и бюджет и решавам за минута. Само за юни имам 9 резервации.“</div>
                </div>
              </section>
            </div>
          )}

          <div style={{ marginTop: 44 }}>
            <div className="cta">
              <div>
                <div className="cta-t">Профилът се одобрява до <span className="num">{n.approvalSlaHours}</span> часа</div>
                <p className="cta-d">Регистрацията отнема около 10 минути. Ще ви трябват ЕИК, снимки от ваши събития и цени на пакетите.</p>
              </div>
              <div className="cta-act">
                <Link className="btn btn--lg btn--onDark" href={SIGN_UP}>Създай профил</Link>
                <Link className="btn btn--lg btn--onDarkGhost" href="/pravila#terms">Условия за партньори</Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
