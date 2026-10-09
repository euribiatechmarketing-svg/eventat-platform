// Client emails (audience 'client'), ported word for word from the prototype's emails/emails.js.
// Every concrete value is a variable; pass dates and amounts already formatted with lib/format.ts
// (eventDate '14 юни 2026', deadlines '13 август 2025, 11:06', amounts '1 450,00 €').
// client-verify-code and client-password-link live in ./auth.ts.
//
// Preference keys (notification_preference.key) for the optional emails:
//   client.payment-deadline → client/settings.html › Известия › „Срок за плащане“ (Напомняне 6 и 2 часа преди изтичане)
//                             client-payment-reminder
//   client.messages         → client/settings.html › Известия › „Съобщение от изпълнител“ (Ново съобщение в разговора)
//                             client-new-message
//   client.event-reminder   → client/settings.html › Известия › „Напомняне преди събитието“ (7 дни и 1 ден преди датата)
//                             client-event-reminder
//   client.review-invite    → client/settings.html › Известия › „Покана за ревю“ (На следващия ден след събитието)
//                             client-review-invite
//   client.saved-search     → client/saved.html › Запазени търсения › звънчето на търсенето
//                             („Изключи известията за това търсене“); no row in settings.html
//                             client-saved-search-alert
//   client.date-watch       → client/saved.html › „Чакам да се освободи“ (следене на дата); no row in settings.html
//                             client-date-freed
import type { EmailTemplate } from '../types';

type Rows = [string, string][];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** 1 снимка / 3 снимки */
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Остава 1 ден / Остават 7 дни */
const remain = (n: number, one: string, many: string) => `${n === 1 ? 'Остава' : 'Остават'} ${pl(n, one, many)}`;
/** "във Вила Екатерина", "в София" */
const inAt = (place: string) => `${/^[вфВФ]/.test(place) ? 'във' : 'в'} ${place}`;
/** "14 юни 2026" → "14 юни" */
const dayMonth = (date: string) => date.replace(/\s+\d{4}$/, '');
/** "MacBook, iPad и iPhone" */
const andJoin = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} и ${xs[xs.length - 1]}`);
/** Short quote for the inbox preview line. */
const excerpt = (s: string, max = 80) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[\s,;:—–-]+$/, '') + '…';
};

// ── Account ────────────────────────────────────────────────────────────────

type WelcomeVars = { clientName: string; email: string; phone?: string; registeredOn: string };
export const clientWelcome: EmailTemplate<WelcomeVars> = {
  key: 'client-welcome', audience: 'client', optional: false,
  render: v => ({
    subject: 'Профилът ви в EventAT е създаден',
    preheader: 'Търсите изпълнители, изпращате запитвания и плащате едва след одобрение.',
    trigger: 'Профилът е създаден',
    heading: 'Добре дошли в EventAT',
    paragraphs: [
      'Профилът ви е създаден и имейлът е потвърден. Регистрацията е безплатна.',
      'Избирате категория, град и дата и виждате само изпълнителите, които са свободни тогава. Изпращате запитване, изпълнителят отговаря до 24 часа, а вие плащате едва след като одобри заявката.',
    ],
    details: [
      ['Име', v.clientName],
      ['Имейл', v.email],
      ...(v.phone ? [['Телефон', v.phone] as [string, string]] : []),
      ['Профил', 'Клиентски'],
      ['Регистрация', v.registeredOn],
    ],
    cta: { label: 'Търси изпълнител', href: '/tarsene' },
  }),
};

type PasswordChangedVars = { email: string; changedOn: string };
export const clientPasswordChanged: EmailTemplate<PasswordChangedVars> = {
  key: 'client-password-changed', audience: 'client', optional: false,
  render: v => ({
    subject: 'Паролата ви в EventAT е сменена',
    preheader: 'Ако не сте сменили паролата вие, свържете се с нас веднага.',
    trigger: 'Смяна на паролата',
    heading: 'Паролата ви е сменена',
    paragraphs: [
      `Паролата за профила ви в EventAT беше сменена на ${v.changedOn}.`,
      'Ако сте я сменили вие, не е нужно да правите нищо. Ако не сте, поискайте нова парола от екрана за вход и ни пишете на help@eventat.bg.',
    ],
    details: [['Профил', v.email], ['Дата на промяната', v.changedOn]],
    cta: { label: 'Прегледай сигурността', href: '/akaunt/nastroyki' },
  }),
};

type TwoFactorVars = { email: string; phone: string };
export const client2faOn: EmailTemplate<TwoFactorVars> = {
  key: 'client-2fa-on', audience: 'client', optional: false,
  render: v => ({
    subject: 'Потвърждението в две стъпки е включено',
    preheader: 'При вход от ново устройство ще ви изпращаме код по SMS.',
    trigger: 'Потвърждение в две стъпки',
    heading: 'Потвърждението в две стъпки е включено',
    paragraphs: [
      'При вход от ново устройство ще ви изпращаме код по SMS на телефона от профила ви.',
      'Ако не сте включили тази защита вие, сменете паролата си и ни пишете на help@eventat.bg.',
    ],
    details: [['Профил', v.email], ['Код по SMS на', v.phone]],
    cta: { label: 'Прегледай сигурността', href: '/akaunt/nastroyki' },
  }),
};

type SignoutAllVars = { email: string; sessions: { device: string; city: string }[] };
export const clientSignoutAll: EmailTemplate<SignoutAllVars> = {
  key: 'client-signout-all', audience: 'client', optional: false,
  render: v => {
    const cities = [...new Set(v.sessions.map(s => s.city))];
    const where = cities.length === 1
      ? `${andJoin(v.sessions.map(s => s.device))} ${inAt(cities[0])}`
      : andJoin(v.sessions.map(s => `${s.device} ${inAt(s.city)}`));
    return {
      subject: 'Излязохте от профила си на всички устройства',
      preheader: 'За да продължите, влезте отново с имейла и паролата си.',
      trigger: 'Изход от всички устройства',
      heading: 'Излязохте от всички устройства',
      paragraphs: [
        `По ваше искане прекратихме всички активни сесии в профила ви, включително на ${where}.`,
        'За да продължите, влезте отново. Ако не сте поискали това вие, сменете паролата си.',
      ],
      details: [['Профил', v.email], ['Прекратени сесии', v.sessions.map(s => `${s.device} · ${s.city}`).join(', ')]],
      cta: { label: 'Вход', href: '/vhod' },
    };
  },
};

/** url: the one-time confirmation link that actually deletes the profile. */
type DeleteConfirmVars = { email: string; url: string };
export const clientDeleteConfirm: EmailTemplate<DeleteConfirmVars> = {
  key: 'client-delete-confirm', audience: 'client', optional: false,
  render: v => ({
    subject: 'Потвърдете изтриването на профила си в EventAT',
    preheader: 'Профилът се изтрива едва след като потвърдите от писмото.',
    trigger: 'Изтриване на профила',
    heading: 'Потвърдете изтриването на профила',
    paragraphs: [
      'Получихме искане за изтриване на профила ви в EventAT. Профилът се изтрива едва след като потвърдите с бутона по-долу.',
      'Активните резервации остават валидни до събитието. Данните за плащане и документите по платените резервации се пазят според закона.',
      'Ако не сте поискали изтриване, не правете нищо — профилът ви остава активен.',
    ],
    details: [['Профил', v.email]],
    cta: { label: 'Потвърди изтриването', href: v.url },
  }),
};

// ── Requests and offers ────────────────────────────────────────────────────

type RequestSentVars = {
  requestId: string; requestNo: string;
  partnerName: string; partnerCategory: string; packageName: string;
  eventType: string; guests: number; eventDate: string; eventTime: string; location: string;
  photoCount: number; amount: string; replyBy: string;
};
export const clientRequestSent: EmailTemplate<RequestSentVars> = {
  key: 'client-request-sent', audience: 'client', optional: false,
  render: v => ({
    subject: `Запитването ви до ${v.partnerName} е изпратено`,
    preheader: 'Изпълнителят отговаря до 24 часа, а плащате само ако одобри заявката.',
    trigger: 'Запитване до изпълнител',
    heading: 'Запитването е изпратено',
    paragraphs: [
      `Изпратихме запитването ви до ${v.partnerName} за ${v.eventDate}. Изпълнителят отговаря до 24 часа.`,
      'Плащате само ако заявката бъде одобрена. Ако изпълнителят не отговори до 24 часа, заявката отпада автоматично и не дължите нищо.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Пакет', `„${v.packageName}“`],
      ['Събитие', `${v.eventType} · ${v.guests} гости`],
      ['Дата', `${v.eventDate}, ${v.eventTime}`],
      ['Локация', v.location],
      ...(v.photoCount > 0 ? [['Прикачени', `${pl(v.photoCount, 'снимка', 'снимки')} за вдъхновение`] as [string, string]] : []),
      ['Сума', v.amount],
      ['Отговор до', v.replyBy],
    ],
    cta: { label: 'Виж заявката', href: `/akaunt/zayavki/${v.requestId}` },
  }),
};

type BriefSentVars = { services: string; eventType: string; eventDate: string; city: string; guests: number; phone: string };
export const clientBriefSent: EmailTemplate<BriefSentVars> = {
  key: 'client-brief-sent', audience: 'client', optional: false,
  render: v => ({
    subject: 'Запитването ви е изпратено до свободните изпълнители',
    preheader: 'Офертите идват в „Моите заявки“ до 24 часа.',
    trigger: 'Запитване до изпълнителите',
    heading: 'Запитването е изпратено',
    paragraphs: [
      'Изпратихме описанието на събитието ви до свободните изпълнители, които отговарят на него. Те ви отговарят с оферта до 24 часа.',
      'Офертите идват в „Моите заявки“. Избирате една, а другите изпълнители получават учтив отказ. Плащате едва след като изберете оферта и изпълнителят я потвърди.',
      'Телефона ви вижда само изпълнителят, когото изберете, след потвърдена резервация.',
    ],
    details: [
      ['Услуги', v.services],
      ['Събитие', v.eventType],
      ['Дата', v.eventDate],
      ['Град', v.city],
      ['Гости', String(v.guests)],
      ['Телефон за връзка', v.phone],
    ],
    cta: { label: 'Моите заявки', href: '/akaunt/zayavki' },
  }),
};

/** eventTypeDefinite: the event in running text, e.g. 'коледното парти'. offerTitle: 'Коледно меню за 40 гости'. */
type OfferReceivedVars = {
  requestId: string; requestNo: string;
  partnerName: string; partnerCategory: string; offerTitle: string; amount: string;
  eventType: string; eventTypeDefinite: string; eventDate: string; location: string;
};
export const clientOfferReceived: EmailTemplate<OfferReceivedVars> = {
  key: 'client-offer-received', audience: 'client', optional: false,
  render: v => ({
    subject: `${v.partnerName} ви изпрати оферта за ${v.eventDate}`,
    preheader: `${v.offerTitle} на стойност ${v.amount} — плащате едва след като изберете оферта.`,
    trigger: 'Нова оферта',
    heading: `Получихте оферта от ${v.partnerName}`,
    paragraphs: [
      `${v.partnerName} отговори на запитването ви за ${v.eventTypeDefinite} с оферта за ${low(v.offerTitle)}.`,
      'Прегледайте офертата в „Моите заявки“. Плащате едва след като изберете оферта и изпълнителят я потвърди.',
    ],
    details: [
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Оферта', v.offerTitle],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Локация', v.location],
      ['Заявка №', v.requestNo],
      ['Сума', v.amount],
    ],
    cta: { label: 'Виж офертата', href: `/akaunt/zayavki/${v.requestId}` },
  }),
};

/** payHours: the payment window in hours (24). */
type RequestApprovedVars = {
  bookingId: string; requestNo: string;
  partnerName: string; partnerCategory: string; packageName: string;
  eventType: string; eventDate: string; eventTime: string;
  amount: string; payBy: string; payHours: number;
};
export const clientRequestApproved: EmailTemplate<RequestApprovedVars> = {
  key: 'client-request-approved', audience: 'client', optional: false,
  render: v => ({
    subject: `${v.partnerName} одобри заявката ви — платете до ${v.payHours} часа`,
    preheader: `Датата ${v.eventDate} е запазена за вас до ${v.payBy}.`,
    trigger: 'Одобрена заявка',
    heading: `${v.partnerName} одобри заявката ви`,
    paragraphs: [
      `Датата ${v.eventDate} е запазена за вас. За да потвърдите резервацията, платете в рамките на ${v.payHours} часа — след това датата се освобождава автоматично.`,
      'Сумата се задържа от платформата и се превежда на изпълнителя чак след като събитието се проведе.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Пакет', `„${v.packageName}“`],
      ['Събитие', `${v.eventType} · ${v.eventDate}, ${v.eventTime}`],
      ['Сума', v.amount],
      ['Платете до', v.payBy],
    ],
    cta: { label: `Плати ${v.amount}`, href: `/plashtane/${v.bookingId}` },
  }),
};

/** hoursLeft: 6 or 2 (or whatever is left when the partner presses „Напомни на клиента“). */
type PaymentReminderVars = {
  bookingId: string; requestNo: string; hoursLeft: number;
  partnerName: string; packageName: string; eventDate: string; amount: string; payBy: string;
};
export const clientPaymentReminder: EmailTemplate<PaymentReminderVars> = {
  key: 'client-payment-reminder', audience: 'client', optional: true, preference: 'client.payment-deadline',
  render: v => ({
    subject: `${remain(v.hoursLeft, 'час', 'часа')} да платите заявка № ${v.requestNo}`,
    preheader: `След ${v.payBy} датата ${v.eventDate} се освобождава автоматично.`,
    trigger: 'Срок за плащане',
    heading: `${remain(v.hoursLeft, 'час', 'часа')} да платите`,
    paragraphs: [
      `${v.partnerName} е запазил ${v.eventDate} за вас до ${v.payBy}. Ако платите дотогава, датата става окончателно ваша.`,
      'Ако не платите навреме, датата се освобождава автоматично и не дължите нищо.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Изпълнител', v.partnerName],
      ['Пакет', `„${v.packageName}“`],
      ['Сума', v.amount],
      ['Платете до', v.payBy],
    ],
    cta: { label: `Плати ${v.amount}`, href: `/plashtane/${v.bookingId}` },
  }),
};

/** hours: how long the client had to pay — 24, more after ‹Удължи срока›, less when the event start clamps it (default 24). */
type PaymentExpiredVars = {
  partnerSlug: string; requestNo: string;
  partnerName: string; partnerCategory: string; serviceName: string;
  eventType: string; eventDate: string; amount: string; hours?: number;
};
export const clientPaymentExpired: EmailTemplate<PaymentExpiredVars> = {
  key: 'client-payment-expired', audience: 'client', optional: false,
  render: v => ({
    subject: 'Срокът за плащане изтече — датата е освободена',
    preheader: `Заявка № ${v.requestNo} към ${v.partnerName} не е платена навреме и не дължите нищо по нея.`,
    trigger: 'Изтекъл срок за плащане',
    heading: 'Срокът за плащане изтече',
    paragraphs: [
      `Не получихме плащане по заявката ви към ${v.partnerName} в рамките на ${pl(v.hours ?? 24, 'час', 'часа')}. Датата ${v.eventDate} е освободена автоматично и не дължите нищо.`,
      'Ако все още искате тази услуга, изпратете нова заявка — датата може вече да е заета.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Услуга', v.serviceName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Сума', v.amount],
    ],
    cta: { label: 'Изпрати нова заявка', href: `/partnyori/${v.partnerSlug}` },
  }),
};

/** reason: the decline reason as shown, e.g. 'Датата е заета'. The running text is written for that reason. */
type RequestDeclinedVars = {
  requestNo: string; partnerName: string; partnerCategory: string; serviceName: string;
  eventType: string; eventDate: string; reason: string; amount: string;
};
export const clientRequestDeclined: EmailTemplate<RequestDeclinedVars> = {
  key: 'client-request-declined', audience: 'client', optional: false,
  render: v => ({
    subject: `${v.partnerName} отказа заявката ви за ${v.eventDate}`,
    preheader: `${v.reason} и не дължите нищо — вижте подобни изпълнители.`,
    trigger: 'Отказана заявка',
    heading: 'Заявката ви е отказана',
    paragraphs: [
      `${v.partnerName} отказа заявката ви, защото датата ${v.eventDate} е заета. Не дължите нищо — плащате само за одобрени заявки.`,
      'Вижте подобни изпълнители, които са свободни на тази дата. Можете и да следите датата — ако се освободи, ще ви известим веднага.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Услуга', v.serviceName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Причина', v.reason],
      ['Сума', v.amount],
    ],
    cta: { label: 'Виж подобни', href: '/tarsene' },
  }),
};

type RequestExpiredVars = {
  requestNo: string; partnerName: string; partnerCategory: string; serviceName: string;
  eventType: string; eventDate: string; amount: string;
};
export const clientRequestExpired: EmailTemplate<RequestExpiredVars> = {
  key: 'client-request-expired', audience: 'client', optional: false,
  render: v => ({
    subject: `${v.partnerName} не отговори — заявката ви отпадна`,
    preheader: `Не дължите нищо — вижте други изпълнители, свободни на ${v.eventDate}.`,
    trigger: 'Изтекла заявка',
    heading: 'Заявката ви отпадна',
    paragraphs: [
      `${v.partnerName} не отговори на заявката ви в рамките на 24 часа и тя отпадна автоматично. Не дължите нищо.`,
      `Вижте други изпълнители, които са свободни на ${v.eventDate}.`,
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Услуга', v.serviceName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Сума', v.amount],
    ],
    cta: { label: 'Виж подобни', href: '/tarsene' },
  }),
};

type ApprovalWithdrawnVars = {
  requestNo: string; partnerName: string; partnerCategory: string; packageName: string;
  eventType: string; eventDate: string;
};
export const clientApprovalWithdrawn: EmailTemplate<ApprovalWithdrawnVars> = {
  key: 'client-approval-withdrawn', audience: 'client', optional: false,
  render: v => ({
    subject: `${v.partnerName} оттегли одобрението на заявката ви`,
    preheader: `Датата ${v.eventDate} вече не е запазена за вас и не дължите нищо.`,
    trigger: 'Оттеглено одобрение',
    heading: 'Одобрението е оттеглено',
    paragraphs: [
      `${v.partnerName} отмени одобрението на заявка № ${v.requestNo}. Датата ${v.eventDate} вече не е запазена за вас и не дължите нищо.`,
      'Вижте други изпълнители, които са свободни на същата дата.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Пакет', `„${v.packageName}“`],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
    ],
    cta: { label: 'Виж подобни', href: '/tarsene' },
  }),
};

// ── Payment and booking ────────────────────────────────────────────────────

/** recipient / iban: the account the transfer goes to, as shown on the payment screen. */
type BankTransferVars = {
  requestId: string; requestNo: string; partnerName: string;
  amount: string; recipient: string; iban: string; payBy: string;
};
export const clientBankTransfer: EmailTemplate<BankTransferVars> = {
  key: 'client-bank-transfer', audience: 'client', optional: false,
  render: v => ({
    subject: `Данни за банков превод по заявка № ${v.requestNo}`,
    preheader: `Преведете ${v.amount} с номера на заявката като основание.`,
    trigger: 'Банков превод',
    heading: 'Данни за банковия превод',
    paragraphs: [
      `Избрахте плащане с банков превод за заявка № ${v.requestNo} към ${v.partnerName}. Посочете номера на заявката като основание, за да свържем превода с нея.`,
      'Потвърждението отнема до 2 работни дни. Щом преводът постъпи, ще получите потвърждение на резервацията.',
    ],
    details: [
      ['Сума', v.amount],
      ['Получател', v.recipient],
      ['IBAN', v.iban],
      ['Основание', v.requestNo],
      ['Платете до', v.payBy],
    ],
    cta: { label: 'Виж заявката', href: `/akaunt/zayavki/${v.requestId}` },
  }),
};

/** packageSummary: 'DJ, озвучаване и осветление'. paymentMethod: 'Visa •••• 4242'. */
type BookingConfirmedVars = {
  bookingId: string; bookingNo: string;
  partnerName: string; partnerCategory: string; packageName: string; packageSummary: string;
  eventDate: string; eventWeekday: string; eventTime: string; location: string; guests: number;
  amount: string; paymentMethod: string; phone: string; freeCancelUntil: string;
};
export const clientBookingConfirmed: EmailTemplate<BookingConfirmedVars> = {
  key: 'client-booking-confirmed', audience: 'client', optional: false,
  render: v => ({
    subject: `Резервацията ви е потвърдена — ${v.partnerName}, ${v.eventDate}`,
    preheader: `Получихме плащането от ${v.amount} и датата е окончателно ваша.`,
    trigger: 'Потвърдена резервация',
    heading: 'Резервацията ви е потвърдена',
    paragraphs: [
      `Получихме плащането ви. ${v.partnerName} вече е блокирал ${v.eventDate} за вашето събитие.`,
      'Изпълнителят ще се свърже с вас обикновено до седмица преди събитието, за да уточните програмата. От днес той вижда и телефона ви за деня на събитието.',
      `Сумата стои в платформата и се превежда на изпълнителя чак след като събитието се проведе. Безплатното анулиране е до ${v.freeCancelUntil}.`,
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Пакет', `„${v.packageName}“ · ${v.packageSummary}`],
      ['Дата', `${v.eventDate}, ${v.eventWeekday}, ${v.eventTime}`],
      ['Локация', v.location],
      ['Гости', String(v.guests)],
      ['Платено', `${v.amount} · ${v.paymentMethod}`],
      ['Телефон за деня на събитието', v.phone],
    ],
    cta: { label: 'Виж резервацията', href: `/akaunt/rezervacii/${v.bookingId}` },
  }),
};

type InvoiceVars = {
  bookingId: string; bookingNo: string; invoiceNo: string; issuedOn: string;
  partnerLegalName: string; partnerEik: string; recipientName: string;
  packageName: string; partnerCategory: string; amount: string; paymentMethod: string;
};
export const clientInvoice: EmailTemplate<InvoiceVars> = {
  key: 'client-invoice', audience: 'client', optional: false,
  render: v => ({
    subject: `Фактура № ${v.invoiceNo} за резервация № ${v.bookingNo}`,
    preheader: `Платена фактура от ${v.partnerLegalName} на стойност ${v.amount}.`,
    trigger: 'Фактура',
    heading: `Фактура № ${v.invoiceNo}`,
    paragraphs: [
      `Изпращаме ви фактурата за резервация № ${v.bookingNo}. Документът е издаден през EventAT от името на изпълнителя ${v.partnerLegalName}.`,
      'Фактурата е издадена по електронен път и е валидна без подпис и печат. За фирмена фактура добавете ЕИК и МОЛ в „Настройки“.',
    ],
    details: [
      ['Фактура №', v.invoiceNo],
      ['Дата на издаване', v.issuedOn],
      ['Издател', `${v.partnerLegalName} · ЕИК ${v.partnerEik}`],
      ['Получател', v.recipientName],
      ['Услуга', `Пакет „${v.packageName}“ · ${v.partnerCategory}`],
      ['Общо', v.amount],
      ['Статус', `Платена · ${v.paymentMethod}`],
    ],
    cta: { label: 'Свали фактурата', href: `/akaunt/rezervacii/${v.bookingId}/faktura` },
  }),
};

/** preview: optional shorter quote for the inbox line (defaults to an excerpt of message). */
type NewMessageVars = {
  partnerName: string; message: string; preview?: string;
  eventType: string; eventDate: string; packageName: string; location: string; receivedAt: string;
};
export const clientNewMessage: EmailTemplate<NewMessageVars> = {
  key: 'client-new-message', audience: 'client', optional: true, preference: 'client.messages',
  render: v => ({
    subject: `Ново съобщение от ${v.partnerName}`,
    preheader: `„${v.preview ?? excerpt(v.message)}“`,
    trigger: 'Съобщение от изпълнител',
    heading: `${v.partnerName} ви писа`,
    paragraphs: [
      `„${v.message}“`,
      'Отговорете в разговора в платформата — така договорките остават записани.',
    ],
    details: [
      ['Изпълнител', v.partnerName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Резервация', `Пакет „${v.packageName}“ · ${v.location}`],
      ['Получено', v.receivedAt],
    ],
    cta: { label: 'Отговори', href: '/akaunt/saobshteniya' },
  }),
};

/** eventTypeDefinite: 'сватбата'. bookings: every booked partner with what and when it starts. */
type EventReminderVars = {
  daysLeft: number; eventType: string; eventTypeDefinite: string; eventDate: string; location: string;
  bookings: { partnerName: string; service: string; time: string }[]; guests: number;
};
export const clientEventReminder: EmailTemplate<EventReminderVars> = {
  key: 'client-event-reminder', audience: 'client', optional: true, preference: 'client.event-reminder',
  render: v => ({
    subject: `${remain(v.daysLeft, 'ден', 'дни')} до събитието ви на ${v.eventDate}`,
    preheader: `${v.eventType} · ${v.location} · резервирани изпълнители и часове.`,
    trigger: 'Напомняне преди събитието',
    heading: `${remain(v.daysLeft, 'ден', 'дни')} до събитието ви`,
    paragraphs: [
      `${cap(v.eventTypeDefinite)} ви е на ${v.eventDate} ${inAt(v.location)}. Ето кои изпълнители са резервирани и в колко часа започват.`,
      'Изпълнителите обикновено се свързват с вас до седмица преди събитието, за да уточните програмата. Ако някой още не ви е писал, пишете му от резервацията.',
    ],
    details: [
      ...v.bookings.map(b => [b.partnerName, `${b.service} · ${b.time}`] as [string, string]),
      ['Гости', String(v.guests)],
    ],
    cta: { label: 'Виж събитието', href: '/akaunt/sabitiya' },
  }),
};

// ── Cancellations, disputes, refunds ──────────────────────────────────────

/**
 * policyName: 'Умерена'. cardLast4: '4242'. The prototype's running text is the in-period (full refund) case,
 * which the optional flags default to. A late cancellation (`inFreePeriod: false`) keeps only the sentences
 * that stay true — the amounts are in ‹Връща се› / ‹Задържа се› (the partial and no-refund wording is new
 * copy, SPEC §5.5); with nothing to refund (`refunded: false`) nothing is promised to the card. A policy with
 * no free period (Строга) has `freeCancelUntil: ''`: the ‹Политика› row then gives its canonical description.
 */
type CancelConfirmedVars = {
  bookingNo: string; partnerName: string; packageName: string; eventType: string; eventDate: string;
  policyName: string; freeCancelUntil: string; paid: string; refund: string; kept: string; cardLast4: string;
  inFreePeriod?: boolean; refunded?: boolean; otherBookingsSameDay?: boolean; policyDescription?: string;
};
export const clientCancelConfirmed: EmailTemplate<CancelConfirmedVars> = {
  key: 'client-cancel-confirmed', audience: 'client', optional: false,
  render: v => {
    const inFree = v.inFreePeriod ?? true, refunded = v.refunded ?? true, others = v.otherBookingsSameDay ?? true;
    const done = `Анулирахте резервацията си при ${v.partnerName} за ${v.eventDate}.`;
    const toCard = `Възстановяването тръгва автоматично към картата, завършваща на ${v.cardLast4} — същата, с която платихте.`;
    const sameDay = `Другите ви резервации за ${dayMonth(v.eventDate)} остават непроменени.`;
    return {
      subject: `Резервацията при ${v.partnerName} е анулирана`,
      preheader: refunded ? `Връщаме ${v.refund} към картата, завършваща на ${v.cardLast4}.` : done,
      trigger: 'Анулиране на резервация',
      heading: 'Резервацията е анулирана',
      paragraphs: [
        inFree ? `${done} Анулирането е в безплатния срок и сумата се възстановява изцяло.` : done,
        [refunded && toCard, others && sameDay].filter(Boolean).join(' '),
        'Ако размислите, ще трябва нова заявка — датата може вече да е заета.',
      ].filter(Boolean),
      details: [
        ['Резервация №', v.bookingNo],
        ['Изпълнител', `${v.partnerName} · Пакет „${v.packageName}“`],
        ['Събитие', `${v.eventType} · ${v.eventDate}`],
        ['Политика', v.freeCancelUntil ? `${v.policyName} — безплатно до ${v.freeCancelUntil}`
          : v.policyDescription ? `${v.policyName} — ${low(v.policyDescription)}` : v.policyName],
        ['Платено', v.paid],
        ['Връща се', v.refund],
        ['Задържа се', v.kept],
      ],
      cta: { label: 'Моите резервации', href: '/akaunt/rezervacii' },
    };
  },
};

/** otherBookingsSameDay: the client has other bookings on that date (default true, as in the prototype). */
type VendorCancelledVars = {
  bookingNo: string; partnerName: string; packageName: string; eventType: string; eventDate: string;
  refund: string; cardLast4: string; paymentMethod: string; otherBookingsSameDay?: boolean;
};
export const clientVendorCancelled: EmailTemplate<VendorCancelledVars> = {
  key: 'client-vendor-cancelled', audience: 'client', optional: false,
  render: v => ({
    subject: `${v.partnerName} анулира резервацията ви за ${v.eventDate}`,
    preheader: `Връщаме цялата сума от ${v.refund} към картата ви.`,
    trigger: 'Анулиране от изпълнителя',
    heading: 'Изпълнителят анулира резервацията',
    paragraphs: [
      `${v.partnerName} анулира резервация № ${v.bookingNo} за ${v.eventDate}. Връщаме ви цялата сума — ${v.refund} — към картата, завършваща на ${v.cardLast4}.`,
      `${v.otherBookingsSameDay ?? true ? `Другите ви резервации за ${dayMonth(v.eventDate)} остават непроменени. ` : ''}Вижте други изпълнители, които са свободни на тази дата.`,
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Изпълнител', `${v.partnerName} · Пакет „${v.packageName}“`],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Връща се', `${v.refund} · ${v.paymentMethod}`],
    ],
    cta: { label: 'Виж подобни', href: '/tarsene' },
  }),
};

/** serviceName: 'Фотокабина, 4 часа с оператор и реквизит'. problem: the reason picked in the form. */
type DisputeOpenedVars = {
  bookingNo: string; partnerName: string; serviceName: string; eventType: string; eventDate: string;
  problem: string; openedAt: string; heldAmount: string;
};
export const clientDisputeOpened: EmailTemplate<DisputeOpenedVars> = {
  key: 'client-dispute-opened', audience: 'client', optional: false,
  render: v => ({
    subject: `Получихме сигнала ви по резервация № ${v.bookingNo}`,
    preheader: 'Екипът отговаря в рамките на 24 часа, а средствата остават задържани до решението.',
    trigger: 'Сигнал до екипа',
    heading: 'Получихме сигнала ви',
    paragraphs: [
      'Екипът отговаря в рамките на 24 часа и може да поиска още детайли от вас. Средствата по резервацията остават задържани, докато случаят се разглежда.',
      `${v.partnerName} вижда сигнала и има 48 часа да отговори със своята позиция. Решението идва по имейл до вас и до изпълнителя, с мотив.`,
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Изпълнител', `${v.partnerName} · ${v.serviceName}`],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Проблем', v.problem],
      ['Подаден', v.openedAt],
      ['Задържани', v.heldAmount],
    ],
    cta: { label: 'Моите сигнали', href: '/akaunt/poddrazhka' },
  }),
};

/** topic: the subject of the case, e.g. 'Обхватът е по-малък от обявения'. */
type DisputeInfoRequestVars = { bookingNo: string; partnerName: string; topic: string };
export const clientDisputeInfoRequest: EmailTemplate<DisputeInfoRequestVars> = {
  key: 'client-dispute-info-request', audience: 'client', optional: false,
  render: v => ({
    subject: `Екипът има въпрос по сигнала ви за ${v.partnerName}`,
    preheader: 'Отговорете, за да решим случая по-бързо — дотогава средствата остават задържани.',
    trigger: 'Въпрос по сигнала',
    heading: 'Екипът има въпрос по сигнала ви',
    paragraphs: [
      `За да решим сигнала ви по резервация № ${v.bookingNo}, ни трябват още детайли. Вижте въпроса и отговорете от страницата на сигнала.`,
      'Средствата по резервацията остават задържани, докато случаят се разглежда.',
    ],
    details: [['Резервация №', v.bookingNo], ['Изпълнител', v.partnerName], ['Сигнал', v.topic]],
    cta: { label: 'Отговори', href: '/akaunt/poddrazhka' },
  }),
};

/**
 * Written by the team when deciding: summary (inbox line), decision (full sentence after „Решение:“),
 * motive (after „Мотив:“), decisionShort (details row). heldAmount stays held until heldUntil.
 */
type DisputeDecisionVars = {
  bookingId: string; bookingNo: string; partnerName: string; serviceName: string;
  eventType: string; eventDate: string; venue: string;
  summary: string; decision: string; motive: string; decisionShort: string;
  heldAmount: string; heldUntil: string;
};
export const clientDisputeDecision: EmailTemplate<DisputeDecisionVars> = {
  key: 'client-dispute-decision', audience: 'client', optional: false,
  render: v => ({
    subject: `Решение по сигнала ви за резервация № ${v.bookingNo}`,
    preheader: v.summary,
    trigger: 'Решение по сигнала',
    heading: 'Екипът реши сигнала ви',
    paragraphs: [
      `Решение: ${v.decision}`,
      `Мотив: ${v.motive}`,
      `Сумата от ${v.heldAmount} остава задържана до деня след събитието.`,
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Изпълнител', v.partnerName],
      ['Услуга', v.serviceName],
      ['Събитие', `${v.eventType} · ${v.eventDate} · ${v.venue}`],
      ['Решение', v.decisionShort],
      ['Задържани', `${v.heldAmount} до ${v.heldUntil}`],
    ],
    cta: { label: 'Виж резервацията', href: `/akaunt/rezervacii/${v.bookingId}` },
  }),
};

// ── After the event ────────────────────────────────────────────────────────

/** eventTypeDefinite: 'годишнината'. */
type ReviewInviteVars = {
  bookingId: string; partnerName: string; partnerCategory: string;
  eventType: string; eventTypeDefinite: string; eventDate: string; location: string; guests: number; amount: string;
};
export const clientReviewInvite: EmailTemplate<ReviewInviteVars> = {
  key: 'client-review-invite', audience: 'client', optional: true, preference: 'client.review-invite',
  render: v => ({
    subject: `Как мина ${v.eventTypeDefinite} ви? Оценете ${v.partnerName}`,
    preheader: 'Ревюто ви помага на следващите клиенти да избират.',
    trigger: 'Покана за ревю',
    heading: `Оценете ${v.partnerName}`,
    paragraphs: [
      `Вчера ${v.partnerName} беше част от ${v.eventTypeDefinite} ви. Оценката ви помага на следващите клиенти да избират.`,
      'Ревюто се публикува само от клиенти с платена резервация — затова оценките в EventAT са реални. Изпълнителят не може да трие ревюта, може само да отговори публично.',
    ],
    details: [
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Локация', v.location],
      ['Гости', String(v.guests)],
      ['Платено', v.amount],
    ],
    cta: { label: 'Остави ревю', href: `/akaunt/rezervacii/${v.bookingId}/revyu` },
  }),
};

/**
 * search: the saved search as listed ('Изпълнители за сватба · София · 14 юни 2026 · 120 гости');
 * summary: the inbox line ('Изпълнители за сватба · София · 120 гости · рейтинг 4,5 и нагоре').
 * eventDate is left out of the subject for searches without a date.
 */
type SavedSearchAlertVars = {
  newCount: number; eventDate?: string; search: string; summary: string; filters: string; totalCount: number;
};
export const clientSavedSearchAlert: EmailTemplate<SavedSearchAlertVars> = {
  key: 'client-saved-search-alert', audience: 'client', optional: true, preference: 'client.saved-search',
  render: v => {
    const n = pl(v.newCount, 'нов изпълнител', 'нови изпълнители');
    return {
      subject: `${n} по търсенето ви${v.eventDate ? ` за ${v.eventDate}` : ''}`,
      preheader: `${v.summary}.`,
      trigger: 'Запазено търсене',
      heading: `${n} по търсенето ви`,
      paragraphs: [
        `Пазим филтрите ви и ви казваме, когато се появи нов изпълнител по тях. От вчера по това търсене има ${n}.`,
        'Известията за всяко търсене спирате и пускате от звънчето в „Запазени търсения“.',
      ],
      details: [
        ['Търсене', v.search],
        ['Филтри', v.filters],
        ['Нови', `${v.newCount} от вчера`],
        ['Общо резултати', pl(v.totalCount, 'изпълнител', 'изпълнители')],
      ],
      cta: { label: 'Виж резултатите', href: '/akaunt/zapazeni' },
    };
  },
};

/** eventType: the watcher's own event ('' when they have none that day: the row shows the date alone). date: ISO, for the CTA's ?data=. */
type DateFreedVars = {
  partnerSlug: string; partnerName: string; partnerCategory: string;
  eventType: string; eventDate: string; watchingSince: string; date?: string;
};
export const clientDateFreed: EmailTemplate<DateFreedVars> = {
  key: 'client-date-freed', audience: 'client', optional: true, preference: 'client.date-watch',
  render: v => ({
    subject: `${v.partnerName} е свободна на ${v.eventDate}`,
    preheader: `Следите тази дата от ${v.watchingSince} и вече можете да изпратите заявка отново.`,
    trigger: 'Свободна дата',
    heading: 'Датата се освободи',
    paragraphs: [
      `${v.partnerName} вече е свободна на ${v.eventDate}. Следите тази дата от ${v.watchingSince}.`,
      'Можете да заявите отново. Датата се запазва за вас едва когато изпълнителят одобри заявката ви.',
    ],
    details: [
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Събитие', v.eventType ? `${v.eventType} · ${v.eventDate}` : v.eventDate],
      ['Следите от', v.watchingSince],
    ],
    cta: { label: 'Изпрати запитване', href: `/partnyori/${v.partnerSlug}${v.date ? `?data=${v.date}` : ''}` },
  }),
};

/** extraHours: how long the team extended the deadline by (24). */
type PaymentExtendedVars = {
  bookingId: string; requestNo: string; extraHours: number;
  partnerName: string; partnerCategory: string; eventType: string; eventDate: string; location: string; newDeadline: string;
};
export const clientPaymentExtended: EmailTemplate<PaymentExtendedVars> = {
  key: 'client-payment-extended', audience: 'client', optional: false,
  render: v => ({
    subject: `Срокът за плащане е удължен с ${v.extraHours} часа — ${v.partnerName}, ${v.eventDate}`,
    preheader: `Датата ${v.eventDate} остава запазена за вас до ${v.newDeadline}.`,
    trigger: 'Удължен срок за плащане',
    heading: 'Срокът за плащане е удължен',
    paragraphs: [
      `Екипът на EventAT удължи с ${v.extraHours} часа срока за плащане по заявка № ${v.requestNo}. Датата ${v.eventDate} остава запазена за вас при ${v.partnerName} до новия срок.`,
      'Ако не платите дотогава, датата се освобождава автоматично и не дължите нищо.',
    ],
    details: [
      ['Заявка', v.requestNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Локация', v.location],
      ['Нов срок', v.newDeadline],
    ],
    cta: { label: 'Към плащането', href: `/plashtane/${v.bookingId}` },
  }),
};

/**
 * A partner's ticket about the client's booking. reason: the picked reason ('Клиентът не отговаря');
 * reasonDetail: what the partner needs, after the colon; ask: what the client should do by replyBy.
 */
type TicketVendorOpenedVars = {
  bookingNo: string; partnerName: string; partnerCategory: string; packageName: string;
  eventType: string; eventTypeDefinite: string; eventDate: string; location: string;
  reason: string; reasonDetail: string; ask: string; replyBy: string;
};
export const clientTicketVendorOpened: EmailTemplate<TicketVendorOpenedVars> = {
  key: 'client-ticket-vendor-opened', audience: 'client', optional: false,
  render: v => ({
    subject: `${v.partnerName} подаде сигнал по резервацията ви за ${v.eventDate}`,
    preheader: `Очакваме отговора ви до ${v.replyBy}.`,
    trigger: 'Сигнал от изпълнителя',
    heading: 'Изпълнителят подаде сигнал до екипа',
    paragraphs: [
      `${v.partnerName} подаде сигнал до екипа на EventAT по резервацията ви за ${v.eventTypeDefinite} на ${v.eventDate}. Причината е „${v.reason}“: ${v.reasonDetail}.`,
      `Изпълнителят не иска да анулира, а сумата по резервацията не е засегната. Отговорете ни до ${v.replyBy} и ${v.ask}.`,
    ],
    details: [
      ['Резервация', v.bookingNo],
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Локация', v.location],
      ['Услуга', `Пакет „${v.packageName}“`],
      ['Срок за отговор', v.replyBy],
    ],
    cta: { label: 'Отговори на екипа', href: '/akaunt/poddrazhka' },
  }),
};

/** need: one sentence on what the partner is asking for, written by the team. */
type TicketReminderVars = {
  bookingNo: string; partnerName: string; eventTypeDefinite: string; eventDate: string;
  reason: string; need: string; replyBy: string;
};
export const clientTicketReminder: EmailTemplate<TicketReminderVars> = {
  key: 'client-ticket-reminder', audience: 'client', optional: false,
  render: v => ({
    subject: `Напомняне: очакваме отговора ви по резервация № ${v.bookingNo}`,
    preheader: `Срокът за отговор е ${v.replyBy}.`,
    trigger: 'Напомняне — отговор по сигнал',
    heading: 'Очакваме отговора ви',
    paragraphs: [
      `Още нямаме отговор от вас по сигнала на ${v.partnerName} за ${v.eventTypeDefinite} на ${v.eventDate}. Срокът е ${v.replyBy}.`,
      `${v.need} Резервацията продължава.`,
    ],
    details: [
      ['Резервация', v.bookingNo],
      ['Изпълнител', v.partnerName],
      ['Причина', v.reason],
      ['Срок за отговор', v.replyBy],
    ],
    cta: { label: 'Отговори на екипа', href: '/akaunt/poddrazhka' },
  }),
};

/**
 * policyDefinite: 'умерената'. The prototype's running text is the in-period cancellation case (the default);
 * any other refund (`inFreePeriod: false`: a late cancellation's part, the partner's or the team's
 * cancellation, a case decision) does not claim the policy gave everything back.
 */
type RefundSentVars = {
  bookingNo: string; partnerName: string; packageName: string; eventDate: string;
  paid: string; paidOn: string; refund: string; cardLast4: string; paymentMethod: string; policyDefinite: string;
  inFreePeriod?: boolean;
};
export const clientRefundSent: EmailTemplate<RefundSentVars> = {
  key: 'client-refund-sent', audience: 'client', optional: false,
  render: v => ({
    subject: `Върнахме ви ${v.refund} по резервация № ${v.bookingNo}`,
    preheader: `Сумата е преведена към картата, завършваща на ${v.cardLast4}.`,
    trigger: 'Възстановена сума',
    heading: 'Сумата е възстановена',
    paragraphs: [
      `Върнахме ${v.refund} по анулираната резервация при ${v.partnerName} за ${v.eventDate}. Сумата е преведена към картата, завършваща на ${v.cardLast4} — същата, с която платихте.`,
      (v.inFreePeriod ?? true) ? `Анулирането беше в безплатния срок по ${v.policyDefinite} политика на изпълнителя, затова се връща цялата сума без удръжки.` : '',
    ].filter(Boolean),
    details: [
      ['Резервация', v.bookingNo],
      ['Изпълнител', `${v.partnerName} · Пакет „${v.packageName}“`],
      ['Платено', `${v.paid} на ${v.paidOn}`],
      ['Върнати', v.refund],
      ['Карта', v.paymentMethod],
    ],
    cta: { label: 'Виж резервациите', href: '/akaunt/rezervacii' },
  }),
};

/** accountType: 'частно лице' or the company wording used on the client card. */
type AccountBlockedVars = { clientName: string; accountType: string; email: string };
export const clientAccountBlocked: EmailTemplate<AccountBlockedVars> = {
  key: 'client-account-blocked', audience: 'client', optional: false,
  render: v => ({
    subject: 'Профилът ви в EventAT е блокиран',
    preheader: 'Ако смятате, че е грешка, пишете ни на help@eventat.bg.',
    trigger: 'Блокиран профил',
    heading: 'Профилът ви е блокиран',
    paragraphs: [
      `Екипът на EventAT блокира профила ви, регистриран с ${v.email}.`,
      'Ако смятате, че това е грешка, или искате да научите причината, пишете ни на help@eventat.bg. Отговаряме в работни дни.',
    ],
    details: [
      ['Профил', `${v.clientName} · ${v.accountType}`],
      ['Имейл', v.email],
      ['Контакт с екипа', 'help@eventat.bg'],
    ],
    cta: { label: 'Пиши на екипа', href: '/pravila' },
  }),
};

/** eventTypeDefinite: 'сватбата'; reply: the partner's public reply. */
type ReviewReplyVars = {
  partnerSlug: string; partnerName: string; partnerCategory: string;
  eventType: string; eventTypeDefinite: string; packageName: string; reply: string;
};
export const clientReviewReply: EmailTemplate<ReviewReplyVars> = {
  key: 'client-review-reply', audience: 'client', optional: false,
  render: v => ({
    subject: `${v.partnerName} отговори на ревюто ви`,
    preheader: 'Отговорът се вижда публично под ревюто в профила на изпълнителя.',
    trigger: 'Отговор на ревю',
    heading: 'Изпълнителят отговори на ревюто ви',
    paragraphs: [
      `${v.partnerName} публикува отговор под ревюто, което оставихте за ${v.eventTypeDefinite} си.`,
      'Отговорът се вижда публично в профила на изпълнителя, под вашето ревю. Изпълнителят не може да трие ревюта — може само да отговори.',
    ],
    details: [
      ['Изпълнител', `${v.partnerName} · ${v.partnerCategory}`],
      ['Вашето ревю', `${v.eventType} · Пакет „${v.packageName}“`],
      ['Отговор', `„${v.reply}“`],
    ],
    cta: { label: 'Виж отговора', href: `/partnyori/${v.partnerSlug}` },
  }),
};
