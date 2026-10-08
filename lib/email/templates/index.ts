// Registry of every automatic email, keyed like the prototype's emails/emails.js.
import type { Audience, EmailTemplate } from '../types';
import * as auth from './auth';
import * as client from './client';
import * as partner from './partner';
import * as team from './team';
import { SAMPLES } from './samples';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyTemplate = EmailTemplate<any>;

const isTemplate = (x: unknown): x is AnyTemplate =>
  typeof x === 'object' && x !== null && 'key' in x && typeof (x as AnyTemplate).render === 'function';

const all: AnyTemplate[] = [auth, client, partner, team].flatMap(m => Object.values(m).filter(isTemplate));

export const TEMPLATES: Record<string, AnyTemplate> = Object.fromEntries(all.map(t => [t.key, t]));

/** Every email in the prototype's order, with when it is sent (emails.js `when`). */
const WHEN: [key: string, when: string][] = [
  ['client-verify-code', 'веднага след „Създай профил“ и при „Поискайте нов“'],
  ['client-welcome', 'веднага след потвърждаване на имейла или след регистрация с Google/Facebook'],
  ['client-password-link', 'веднага след „Забравена парола?“ или „Смени паролата“'],
  ['client-password-changed', 'веднага след смяна на паролата'],
  ['client-2fa-on', 'веднага след включване в „Настройки“'],
  ['client-signout-all', 'веднага след „Излез навсякъде“'],
  ['client-delete-confirm', 'веднага след „Изтрий профила“'],
  ['client-request-sent', 'веднага след „Изпрати заявката“'],
  ['client-brief-sent', 'веднага след „Изпрати запитването“'],
  ['client-offer-received', 'веднага щом изпълнител отговори на запитването с оферта'],
  ['client-request-approved', 'веднага щом изпълнителят одобри заявката'],
  ['client-payment-reminder', '6 часа и 2 часа преди срока за плащане (заглавието показва оставащите часове); и при „Напомни на клиента“ от изпълнителя'],
  ['client-payment-expired', 'веднага щом изтекат 24-те часа за плащане'],
  ['client-request-declined', 'веднага щом изпълнителят откаже заявката'],
  ['client-request-expired', '24 часа след изпращане, ако изпълнителят не е отговорил'],
  ['client-approval-withdrawn', 'веднага щом изпълнителят отмени одобрението преди плащане'],
  ['client-bank-transfer', 'веднага след избор на „Банков превод“ на екрана за плащане'],
  ['client-booking-confirmed', 'веднага след успешно плащане с карта; при банков превод — щом преводът постъпи'],
  ['client-invoice', 'веднага след плащането; и при „Изпрати по имейл“ от екрана на фактурата'],
  ['client-new-message', 'при ново съобщение от изпълнител, включително въпрос по заявка'],
  ['client-event-reminder', '7 дни и 1 ден преди датата на събитието'],
  ['client-cancel-confirmed', 'веднага след „Анулирай резервацията“'],
  ['client-vendor-cancelled', 'след като екипът потвърди анулирането, поискано от изпълнителя'],
  ['client-dispute-opened', 'веднага след „Изпрати сигнала“'],
  ['client-dispute-info-request', 'когато екипът поиска още информация по сигнала'],
  ['client-dispute-decision', 'веднага след решението на екипа'],
  ['client-review-invite', 'на следващия ден след събитието'],
  ['client-saved-search-alert', 'когато по запазеното търсене се появи нов изпълнител'],
  ['client-date-freed', 'веднага щом датата при следения изпълнител се освободи'],
  ['client-payment-extended', 'веднага след като екипът удължи срока'],
  ['client-ticket-vendor-opened', 'веднага след като изпълнителят изпрати сигнал по резервацията'],
  ['client-ticket-reminder', 'при „Напомни на клиента“ от екипа, докато срокът за отговор тече'],
  ['client-refund-sent', 'веднага щом платформата върне сумата по картата — след анулиране в срок, анулиране от изпълнителя или решение по сигнал'],
  ['client-account-blocked', 'веднага след „Блокирай профила“ от екипа'],
  ['client-review-reply', 'веднага щом изпълнителят публикува отговор под ревюто'],
  ['vendor-verify-code', 'веднага след „Създай профил“'],
  ['vendor-welcome', 'веднага след потвърждаване на имейла'],
  ['vendor-application-received', 'веднага след „Подай за одобрение“'],
  ['vendor-application-approved', 'веднага след одобрение от екипа'],
  ['vendor-application-returned', 'веднага след решение на екипа'],
  ['vendor-application-rejected', 'веднага след решение на екипа'],
  ['vendor-service-submitted', 'веднага след „Изпрати за преглед“'],
  ['vendor-service-published', 'веднага след одобрение в Модерация'],
  ['vendor-service-returned', 'веднага след решение в Модерация'],
  ['vendor-service-change-submitted', 'веднага след „Запази промените“'],
  ['vendor-service-change-approved', 'веднага след одобрение в Модерация'],
  ['vendor-new-request', 'веднага щом клиентът изпрати заявка'],
  ['vendor-new-inquiry', 'веднага щом клиентът изпрати запитване'],
  ['vendor-request-reminder', '6 часа преди срока за отговор'],
  ['vendor-request-approved', 'веднага след „Одобри заявката“'],
  ['vendor-payment-reminder', '6 часа преди изтичане на срока за плащане'],
  ['vendor-payment-deadline-extended', 'веднага след удължаване от екипа'],
  ['vendor-hold-expired', 'в момента на изтичане на срока за плащане'],
  ['vendor-booking-confirmed', 'веднага след плащането на клиента'],
  ['vendor-event-reminder', '7 дни преди събитието'],
  ['vendor-client-cancelled', 'веднага след анулирането'],
  ['vendor-cancel-requested', 'веднага след „Анулиране“'],
  ['vendor-cancel-completed', 'веднага след като екипът анулира резервацията'],
  ['vendor-payout-sent', 'в деня на превода — 1-во или 15-то число след събитието'],
  ['vendor-payout-account-submitted', 'веднага след „Запази сметката“'],
  ['vendor-payout-account-confirmed', 'веднага след потвърждение от екипа'],
  ['vendor-ticket-received', 'веднага след „Изпрати сигнала“'],
  ['vendor-ticket-client-opened', 'веднага след като клиентът изпрати сигнала'],
  ['vendor-ticket-reminder', 'при „Напомни на изпълнителя“ от екипа'],
  ['vendor-ticket-decision', 'веднага след решението на екипа'],
  ['vendor-new-review', 'веднага след публикуване на ревюто'],
  ['vendor-new-message', 'веднага'],
  ['vendor-report-ready', 'щом справката е готова'],
  ['vendor-password-reset', 'веднага след „Смени паролата“'],
  ['vendor-deactivated', 'веднага след „Деактивирай“'],
  ['vendor-delete-confirm', 'веднага след „Изтрий“'],
  ['vendor-invite', 'веднага след „Покани изпълнител“'],
  ['vendor-offer-chosen', 'веднага щом клиентът избере вашата оферта по запитване'],
  ['vendor-offer-not-chosen', 'веднага щом клиентът избере друга оферта по същото запитване'],
  ['vendor-request-expired', '24 часа след получаване, ако не сте отговорили'],
  ['vendor-ticket-info-request', 'когато екипът поиска още информация по сигнала'],
  ['vendor-service-change-returned', 'веднага след „Върни с бележка“ на редакция в Модерация'],
  ['team-invite', 'веднага след „Изпрати покана“'],
  ['team-vendor-application', 'веднага след подаване на профила за одобрение'],
  ['team-dispute-new', 'веднага след като клиент или изпълнител изпрати сигнал'],
  ['team-dispute-reply', 'веднага след отговора'],
  ['team-dispute-deadline', 'в момента, в който изтече срокът от 48 часа без отговор'],
  ['team-payment-deadline', '4 часа преди срока за плащане, само ако по резервацията има отворен спор'],
  ['team-vendor-cancel', 'веднага след като изпълнителят натисне „Анулиране“'],
  ['team-payout-account', 'веднага след като изпълнителят запази новата сметка'],
  ['team-daily-digest', 'всеки ден в 09:00, само ако има отворени задачи'],
  ['team-batch-ready', 'в деня преди партидата (партидите са на 1-во и 15-то число)'],
  ['team-batch-paid', 'когато банката потвърди превода на партидата'],
  ['team-batch-report', 'веднага щом отчетът е готов, след заявка от панела'],
  ['team-transfer-failed', 'веднага, когато банката върне превод от партида'],
];

export type CatalogueEntry = {
  key: string;
  audience: Audience;
  /** The overline of the email, e.g. „Одобрена заявка“. */
  trigger: string;
  when: string;
  optional: boolean;
  preference?: string;
  /** Subject rendered with the sample values. */
  subject: string;
};

/** The list behind Админ → Имейли, in the prototype's order. */
export const CATALOGUE: CatalogueEntry[] = WHEN.map(([key, when]) => {
  const t = TEMPLATES[key];
  if (!t) throw new Error(`Email catalogue: no template for ${key}`);
  const m = t.render(SAMPLES[key]);
  return { key, audience: t.audience, trigger: m.trigger, when, optional: t.optional, preference: t.preference, subject: m.subject };
});
