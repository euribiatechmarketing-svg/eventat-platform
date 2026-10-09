// / (client/start.html, SCREENS §2): the two-way choice for guests. Signed-in users go to
// their home (D47, SPEC §1.3): a client to the search, a partner and an admin to their panel.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/session';
import { Lang } from './_components/client';
import { ArrowRight } from './_components/icons';

export const dynamic = 'force-dynamic';
export const metadata = { title: { absolute: 'EventAT · Добре дошли' } };

export default async function Start() {
  const u = await currentUser();
  if (u) redirect(u.role === 'admin' ? '/admin' : u.role === 'partner' ? '/partner' : '/tarsene');
  return (
    <>
      <header className="nav st-nav">
        <Link className="nav-brand" href="/"><img className="nav-logo" src="/assets/eventat-logo.png" alt="EventAT" /></Link>
        <div className="nav-right st-right">
          <Lang />
          <span className="st-have">Вече имате профил?</span>
          <Link className="btn btn--outline st-login" href="/vhod">Вход</Link>
        </div>
      </header>

      <section className="st-head" id="main">
        <h1 className="hero-t st-ask">Как ще използвате EventAT?</h1>
        <p className="hero-d st-lead">Свързваме организаторите на събития с проверени изпълнители.</p>
      </section>

      <main className="st-split">
        <Link className="st-half" href="/tarsene">
          <div className="st-photo st-photo--client" />
          <div className="st-scrim" />
          <div className="st-body">
            <div className="st-eyebrow">Сватби · рождени дни · фирмени събития</div>
            <h2 className="st-label">Търся изпълнител</h2>
            <p className="st-desc">Вижте кой е свободен на вашата дата — с реални цени и ревюта.</p>
            <span className="btn btn--lg btn--onDark st-cta">Започни търсене<ArrowRight className="btn-icon" /></span>
          </div>
        </Link>

        <Link className="st-half" href="/stani-partnyor">
          <div className="st-photo st-photo--vendor" />
          <div className="st-scrim" />
          <div className="st-body">
            <div className="st-eyebrow">Музика · кетъринг · фотография · декорация</div>
            <h2 className="st-label">Предлагам услуга</h2>
            <p className="st-desc">Получавайте заявки от клиенти, готови да резервират — с дата и бюджет.</p>
            <span className="btn btn--lg btn--onDark st-cta">Стани партньор<ArrowRight className="btn-icon" /></span>
          </div>
        </Link>
      </main>
    </>
  );
}
