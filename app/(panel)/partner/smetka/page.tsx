// vendor/payout-account.html → /partner/smetka (SCREENS §7, SPEC §4.3)
import '@/styles/m-partner-catalogue.css';
import Link from 'next/link';
import { moneyShort } from '@/lib/format';
import { BANKS, euros, payoutAccountPage } from '@/lib/domain/views-partner-catalogue';
import { partnerActor } from '../_catalogue/server';
import { AccountForm } from './AccountForm';
import { providerOnboardingAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Сметка за изплащане' };

export default async function PayoutAccountPage() {
  const actor = await partnerActor('/partner/smetka');
  const v = await payoutAccountPage(actor);
  return (
    <div className="pc-page">
      <Link className="crumb" href="/partner/prihodi"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>Назад към приходите</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">Сметка за изплащане</h1>
          <p className="page-sub">Банковата сметка, по която EventAT превежда сумите след вашите събития.</p>
        </div>
        <div className="page-head-right">
          <button type="submit" form="pa-form" className="btn btn--primary btn--sm">Запази сметката</button>
        </div>
      </div>

      <div className="dash-grid">
        <div>
          {v.confirmed && (
            <section className="dcard">
              <div className="dcard-head"><h2 className="dcard-title">Текуща сметка</h2></div>
              <div className="pa-cur">
                <span className="payout-logo">BG</span>
                <div className="pa-cur-id">
                  <div className="pa-cur-name">{v.confirmed.holderName}</div>
                  <div className="pa-cur-sub">{v.confirmed.masked} · {v.confirmed.bankName}</div>
                </div>
                <span className="badge badge--success badge--dot">Потвърдена</span>
              </div>
              <div className="kv pa-kv">
                <div className="kv-item"><div className="kv-label">Титуляр</div><div className="kv-value">{v.confirmed.holderName} {v.eik && <small>ЕИК {v.eik}</small>}</div></div>
                <div className="kv-item"><div className="kv-label">Банка</div><div className="kv-value">{v.confirmed.bankName} {v.confirmed.bankBranch && <small>{v.confirmed.bankBranch}</small>}</div></div>
                <div className="kv-item"><div className="kv-label">Изплащане</div><div className="kv-value">1-во и 15-то число <small>след събитието</small></div></div>
              </div>
            </section>
          )}
          {v.pending && (
            <section className="dcard">
              <div className="pa-cur">
                <span className="payout-logo">BG</span>
                <div className="pa-cur-id">
                  <div className="pa-cur-name">{v.pending.holderName}</div>
                  <div className="pa-cur-sub">{v.pending.masked} · {v.pending.bankName}</div>
                </div>
                <span className="badge badge--warning badge--dot">Новата сметка чака проверка</span>
              </div>
            </section>
          )}
          <AccountForm legalName={v.legalName} heldText={moneyShort(v.heldCents)} banks={[...BANKS]} />
        </div>
        <aside className="pc-sticky">
          <div className="panel">
            <h3 className="panel-title">За изплащане</h3>
            <div className="split is-total"><span>Задържани до събитията</span><b>{euros(v.heldCents)} €</b></div>
            <p className="panel-note">Сумата се задържа до събитието и се превежда на 1-во или 15-то число след него.</p>
          </div>
          <div className="panel">
            <h3 className="panel-title">Потвърждаване</h3>
            <div className="rules">
              <div className="rule"><span className="rule-num">1</span><span>Изпращате данните и <strong>документ от банката</strong>.</span></div>
              <div className="rule"><span className="rule-num">2</span><span>Екипът ги проверява до <strong>два работни дни</strong>.</span></div>
              <div className="rule"><span className="rule-num">3</span><span>Изплащанията тръгват по <strong>новата сметка</strong>.</span></div>
            </div>
            <p className="panel-note">До потвърждението нищо не се превежда — задържаните суми остават заделени за вас.</p>
            {v.provider === 'stripe' && v.providerStatus !== 'enabled' && (
              <form action={providerOnboardingAction} className="panel-actions" style={{ marginTop: 14 }}>
                <button type="submit" className="btn btn--outline btn--block">Потвърди данните при доставчика</button>
              </form>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
