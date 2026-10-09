// /admin/partnyori/[id] — admin/vendor.html (SCREENS §8) [approve_partners]: the application (company,
// contacts, category, gallery, packages), checks, the decision panel and the team's notes.
import Link from 'next/link';
import { notFound } from 'next/navigation';
import '@/styles/m-admin-ops.css';
import { can } from '@/lib/domain/actor';
import { NotFoundError } from '@/lib/domain/catalogue-kit';
import { POLICY_FREE_DAYS } from '@/lib/domain/partners';
import { CHECK_DETAIL_LABEL, EXPERIENCE_LABEL, PARTNER_ADMIN, adminPartnerDetail, policyLine } from '@/lib/domain/views-admin-ops';
import { now } from '@/lib/clock';
import { date, dateShort, dateTime, moneyShort } from '@/lib/format';
import { shortName } from '@/lib/initials';
import { requireTeam } from '../../_ops/guard';
import { Badge, Dots, Num, ago, initials, n, Email } from '../../_ops/fmt';
import { CheckRow, DecisionForm, NotesCard } from '../_parts';
import { TopbarTitleText } from '../../_ops/ui';

export const metadata = { title: 'Профил на изпълнител' };

export default async function PartnerApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await requireTeam('approve_partners', `/admin/partnyori/${id}`);
  let d;
  try { d = await adminPartnerDetail(actor, id); } catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  const at = await now();
  const p = d.partner;
  const finance = can(actor, 'view_finance');
  const submitted = p.status === 'submitted';
  const status = PARTNER_ADMIN[p.status] ?? { label: '', tone: '' };
  const back = `/admin/partnyori/${p.id}`;
  const pol = policyLine(p.cancellationPolicy);
  const waitingChecks = d.checks.checks.filter(c => c.state !== 'ok').length;
  const fixed = d.services.filter(s => s.kind === 'package_fixed');
  const galleryOk = d.checks.checks.some(c => c.kind === 'gallery' && c.state === 'ok');
  const bankWaiting = d.checks.checks.some(c => c.kind === 'bank_account' && c.state !== 'ok');
  const shown = d.photos.length > 8 ? d.photos.slice(0, 7) : d.photos;
  const rawDetail = (kind: string) => kind === 'company' ? [p.eik ? `ЕИК ${p.eik}` : null, p.legalName].filter(Boolean).join(' · ')
    : kind === 'contacts' ? [d.phone, p.notificationEmail].filter(Boolean).join(' · ')
    : kind === 'gallery' ? n(d.photos.length, 'снимка', 'снимки') : null;
  const contactsOk = d.checks.checks.some(c => c.kind === 'contacts' && c.state === 'ok');
  // The application page words the checks as admin/vendor.html does (the queue panel keeps the shorter vendors.html lines).
  const freeDays = p.cancellationPolicy ? POLICY_FREE_DAYS[p.cancellationPolicy] : null;
  const pageDetail = (c: (typeof d.checks.checks)[number]): string | null => {
    if (c.kind === 'company' && c.state === 'ok' && p.eik) return [p.eik, p.legalName, 'данните съвпадат с Търговския регистър'].filter(Boolean).join(' · ');
    if (c.kind === 'contacts' && c.state === 'ok' && c.checkedAt) return `Имейлът и телефонът са потвърдени на ${dateShort(c.checkedAt)}`;
    if (c.kind === 'cancellation_policy' && c.state === 'ok' && pol && freeDays != null) return `${pol.name} · безплатно анулиране до ${freeDays} дни преди събитието`;
    if (c.kind === 'bank_account' && c.state !== 'ok' && d.pendingBankName) return `IBAN подаден в ${d.pendingBankName}, чака потвърждение от банката`;
    return c.detail ?? rawDetail(c.kind);
  };

  return (
    <div className="ops-page">
      <TopbarTitleText text={`Изпълнител · ${p.businessName}`} short={p.businessName} />
      <Link className="crumb" href="/admin/partnyori"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" /></svg>Изпълнители</Link>
      <div className="page-head">
        <div>
          <h1 className="page-title">Профил на изпълнител</h1>
          <p className="page-sub">
            {submitted
              ? <Dots parts={['Заявка за одобрение', p.submittedAt ? `подадена ${ago(p.submittedAt, at)}` : null, `профил ${d.checks.ok} от ${d.checks.total}`]} />
              : <Dots parts={[status.label, `профил ${d.checks.ok} от ${d.checks.total}`]} />}
          </p>
        </div>
        <div className="page-head-right"><Badge tone={status.tone}>{status.label}</Badge></div>
      </div>

      <div className="adm-grid">
        <div>
          <section className="dcard">
            <div className="vrev-id">
              <span className="avatar avatar--lg">{initials(p.businessName)}</span>
              <div>
                <div className="vrev-id-n"><Num>{p.businessName}</Num></div>
                <div className="vrev-id-s"><Dots parts={[d.categoryName, d.cityName, p.contactName]} /></div>
              </div>
              {p.submittedAt && (
                <div className="vrev-id-end">
                  <span className="vrev-id-l">Подадена</span>
                  <span className="vrev-id-v">{date(p.submittedAt)}</span>
                </div>
              )}
            </div>

            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 17 }}>Подадени данни</h2></div>
            <div className="kv">
              <div className="kv-item"><div className="kv-label">Фирма</div><div className="kv-value">{p.legalName ?? p.businessName}{p.registeredAddress && <small>седалище {p.registeredAddress}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">ЕИК</div><div className="kv-value">{p.eik ?? '—'}{d.checks.checks.some(c => c.kind === 'company' && c.state === 'ok') && <small>проверен в Търговския регистър</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Град на работа</div><div className="kv-value">{d.cityName || '—'}{p.alsoServesNote && <small>{p.alsoServesNote}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Категория</div><div className="kv-value">{d.categoryName || '—'}{d.subtypes.length > 0 && <small>{n(d.subtypes.length, 'подкатегория', 'подкатегории')}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Лице за контакт</div><div className="kv-value">{p.contactName}{p.contactRole && <small>{p.contactRole}</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Опит</div><div className="kv-value">{p.activeSinceYear ? `от ${p.activeSinceYear} г.` : p.experienceBand ? EXPERIENCE_LABEL[p.experienceBand] : '—'}<small>по данни на изпълнителя</small></div></div>
              <div className="kv-item"><div className="kv-label">Имейл</div><div className="kv-value"><Email value={p.notificationEmail} />{d.emailVerified && <small>потвърден</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Телефон</div><div className="kv-value">{d.phone || '—'}{d.phone && contactsOk && <small>потвърден</small>}</div></div>
              <div className="kv-item"><div className="kv-label">Анулиране</div><div className="kv-value">{pol ? `${pol.name} политика` : '—'}{pol && <small>{pol.detail}</small>}</div></div>
            </div>

            {d.subtypes.length > 0 && (
              <>
                <div className="field-label" style={{ margin: '22px 0 10px' }}>Подкатегории</div>
                <div className="chips">{d.subtypes.map(s => <span className="chip" key={s}>{s}</span>)}</div>
              </>
            )}
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title" style={{ fontSize: 17 }}>Галерия</h2>
              {galleryOk && <span className="badge badge--success">без чужди водни знаци</span>}
            </div>
            {d.photos.length ? (
              <div className="vrev-gal">
                {shown.map(u => <span key={u} className="vrev-gi" style={{ backgroundImage: `url('${u}')` }}></span>)}
                {d.photos.length > 8 && (
                  <span className="vrev-gmore"><span className="vrev-gmore-v">+{d.photos.length - 7}</span><span className="vrev-gmore-l">още</span></span>
                )}
              </div>
            ) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title" style={{ fontSize: 17 }}>Пакети и цени</h2>
              {fixed.length > 0 && <span className="badge">{n(fixed.length, 'пакет', 'пакета')}</span>}
            </div>
            {d.services.length ? d.services.map(s => {
              const inner = (
                <>
                  <span className="vrev-pk-t" style={s.cover ? { backgroundImage: `url('${s.cover}')` } : undefined}></span>
                  <span>
                    <span className="vrev-pk-n">{s.name}</span>
                    <span className="vrev-pk-d">{[s.durationLabel, s.description].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="vrev-pk-p">{s.price == null ? 'По оферта' : `${moneyShort(s.price)}${s.priceUnit === 'per_guest' ? ' на гост' : ''}`}</span>
                </>
              );
              // A row opens its revision in the moderation queue; with nothing there to review it is a plain row (admin/vendor.html).
              return s.inReview
                ? <Link key={s.id} className="vrev-pk" href={`/admin/moderatsiya?partnyor=${p.id}`}>{inner}</Link>
                : <div key={s.id} className="vrev-pk">{inner}</div>;
            }) : <div className="ui-empty">Няма записи в този изглед.</div>}
          </section>

          <section className="dcard">
            <div className="dcard-head">
              <h2 className="dcard-title" style={{ fontSize: 17 }}>Документи и проверки</h2>
              {waitingChecks > 0 && <span className="badge badge--warning">{waitingChecks === 1 ? 'остава 1 проверка' : `остават ${waitingChecks} проверки`}</span>}
            </div>
            {d.checks.checks.map(c => (
              <CheckRow key={c.kind} c={{ kind: c.kind, state: c.state, label: CHECK_DETAIL_LABEL[c.kind], detail: pageDetail(c) }}
                partnerId={p.id} editable back={back} />
            ))}
          </section>
        </div>

        <aside>
          <section className="dcard">
            <div className="dcard-head"><h2 className="dcard-title" style={{ fontSize: 19 }}>Решение</h2></div>
            {submitted ? (
              <>
                <div className="vrev-q">
                  <span className="vrev-q-v">{d.queueSize}</span>
                  <span>
                    <span className="vrev-q-n">чакат одобрение</span>
                    {d.queueIndex === 0 && <span className="vrev-q-s">Тази заявка е най-старата в реда</span>}
                  </span>
                </div>
                <DecisionForm partnerId={p.id} />
                {bankWaiting && (
                  <div className="hint" style={{ marginTop: 18 }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8h.01M11 12h1v4h1" /></svg>
                    <span>Може да одобрите и без банкова сметка — изплащанията тръгват след потвърждението ѝ.</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="split"><span>Резервации</span><b>{d.totals.bookings}</b></div>
                {finance && <div className="split"><span>Оборот</span><b>{moneyShort(d.totals.turnoverCents)}</b></div>}
                {d.lastDecision && (
                  <div className="rev">
                    <div className="rev-head">
                      <Badge tone={status.tone}>{status.label}</Badge>
                      <div style={{ marginLeft: 'auto', textAlign: 'right' }}><div className="rev-meta">{shortName(d.lastDecision.byName)} · {dateTime(d.lastDecision.decidedAt)}</div></div>
                    </div>
                    {d.lastDecision.note && <div className="rev-text">{d.lastDecision.note}</div>}
                  </div>
                )}
              </>
            )}
          </section>

          <NotesCard partnerId={p.id} notes={d.notes} back={back} />
        </aside>
      </div>
    </div>
  );
}
