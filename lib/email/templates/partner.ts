// Partner emails (audience 'partner'; keys keep the prototype's `vendor-` prefix), ported word for word
// from the prototype's emails/emails.js. Every concrete value is a variable; pass dates and amounts
// already formatted with lib/format.ts. partnerName is the business's display name ('Студио Мелодия'),
// partnerLegalName the registered one ('Студио Мелодия ЕООД'). eventTypeDefinite is the event in running
// text ('сватбата', 'коледното парти'); hosts are the people celebrating ('Мария и Стефан').
// vendor-verify-code and vendor-password-reset live in ./auth.ts.
//
// Preference keys (notification_preference.key) for the optional emails:
//   partner.new-request      → vendor/settings.html › Известия › „Нова заявка“
//                              (Имейл и известие в платформата веднага щом клиент изпрати заявка.)
//                              vendor-new-request, vendor-new-inquiry
//   partner.payment-reminder → vendor/settings.html › Известия › „Напомняне за 24-часовия срок“
//                              (Съобщение, ако клиентът не е платил 6 часа преди изтичане.)
//                              vendor-payment-reminder
//   partner.new-review       → vendor/settings.html › Известия › „Ново ревю“ (Известие при получена оценка.)
//                              vendor-new-review
import type { EmailTemplate } from '../types';
import { agree, subjectForm, withClitic } from '../grammar';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** First name: 'Мария Димитрова' → 'Мария'. */
const first = (name: string) => name.trim().split(/\s+/)[0];
/** 1 пакет / 2 пакета */
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** Остава 1 час / Остават 6 часа */
const remain = (n: number, one: string, many: string) => `${n === 1 ? 'Остава' : 'Остават'} ${pl(n, one, many)}`;
/** "във Вила Екатерина", "в София" */
const inAt = (place: string) => `${/^[вфВФ]/.test(place) ? 'във' : 'в'} ${place}`;
/** Short quote for the inbox preview line. */
const excerpt = (s: string, max = 80) => {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 0 ? cut.lastIndexOf(' ') : max).replace(/[\s,;:—–-]+$/, '') + '…';
};
/** '2 пакета · 1 по запитване' */
const offerCount = (packages: number, onRequest: number) =>
  [pl(packages, 'пакет', 'пакета'), ...(onRequest > 0 ? [`${onRequest} по запитване`] : [])].join(' · ');

// ── Sign-up and approval ───────────────────────────────────────────────────

type WelcomeVars = { partnerName: string; contactName: string; email: string; phone: string };
export const vendorWelcome: EmailTemplate<WelcomeVars> = {
  key: 'vendor-welcome', audience: 'partner', optional: false,
  render: v => ({
    subject: `Добре дошли в EventAT — настройте профила на ${v.partnerName}`,
    preheader: 'Остават шест стъпки до първите ви заявки, а напредъкът се запазва автоматично.',
    trigger: 'Регистрация — потвърден имейл',
    heading: `Добре дошли, ${first(v.contactName)}`,
    paragraphs: [
      `Имейлът ви е потвърден и акаунтът на ${v.partnerName} е създаден. Остава да настроите профила — шест стъпки до първите ви заявки.`,
      'Ще ви трябват ЕИК, снимки от ваши събития и цени на пакетите. Напредъкът се запазва автоматично, така че можете да продължите по-късно.',
      'След като подадете профила, екипът го преглежда до 48 часа.',
    ],
    details: [
      ['Бизнес', v.partnerName],
      ['Лице за контакт', v.contactName],
      ['Имейл за известия', v.email],
      ['Телефон', v.phone],
    ],
    cta: { label: 'Настрой профила', href: '/partner/registratsiya/1' },
  }),
};

/** packages / onRequest: priced packages and services on request. policy: 'Умерена · депозит 30%'. */
type ApplicationReceivedVars = {
  partnerSlug: string; partnerName: string; partnerCategory: string; city: string; contactName: string; email: string;
  packages: number; onRequest: number; availability: string; policy: string; submittedAt: string;
};
export const vendorApplicationReceived: EmailTemplate<ApplicationReceivedVars> = {
  key: 'vendor-application-received', audience: 'partner', optional: false,
  render: v => ({
    subject: `Профилът на ${v.partnerName} е подаден за преглед`,
    preheader: 'Обикновено отговаряме до 48 часа — ще ви пишем на този адрес.',
    trigger: 'Профилът е подаден за одобрение',
    heading: `Благодарим, ${first(v.contactName)}. Профилът ви е при екипа.`,
    paragraphs: [
      `Получихме профила на ${v.partnerName}. Преглеждаме всеки нов профил ръчно — проверяваме информацията и контактите ви.`,
      `Обикновено отговаряме до 48 часа и ще ви пишем на ${v.email}. След одобрение започвате да приемате заявки.`,
    ],
    details: [
      ['Бизнес', `${v.partnerName} · ${v.partnerCategory} · ${v.city}`],
      ['Пакети и услуги', offerCount(v.packages, v.onRequest)],
      ['Наличност', v.availability],
      ['Политика за анулиране', v.policy],
      ['Подаден', v.submittedAt],
    ],
    cta: { label: 'Виж профила като клиент', href: `/partnyori/${v.partnerSlug}` },
  }),
};

type ApplicationApprovedVars = {
  partnerName: string; partnerCategory: string; city: string; radiusKm: number;
  packages: number; onRequest: number; policyName: string;
};
export const vendorApplicationApproved: EmailTemplate<ApplicationApprovedVars> = {
  key: 'vendor-application-approved', audience: 'partner', optional: false,
  render: v => ({
    subject: `Профилът на ${v.partnerName} е одобрен`,
    preheader: 'Вече сте в каталога и можете да приемате заявки.',
    trigger: 'Профилът е одобрен',
    heading: 'Профилът ви е одобрен',
    paragraphs: [
      `Екипът на EventAT прегледа профила ви. ${v.partnerName} вече се показва в каталога и можете да приемате заявки.`,
      'Поддържайте календара актуален — показвате се в търсенето само за свободните си дати. На всяка нова заявка отговаряйте до 24 часа.',
      'Ако още не сте добавили сметка за изплащане, направете го от „Приходи“ — изплащанията тръгват след потвърждението ѝ.',
    ],
    details: [
      ['Профил', `${v.partnerName} · ${v.partnerCategory}`],
      ['Град', `${v.city} · до ${v.radiusKm} км`],
      ['Пакети и услуги', offerCount(v.packages, v.onRequest)],
      ['Политика за анулиране', v.policyName],
    ],
    cta: { label: 'Към таблото', href: '/partner' },
  }),
};

/** note: the team's note to the partner. */
type ApplicationReturnedVars = { partnerName: string; note: string; submittedAt: string };
export const vendorApplicationReturned: EmailTemplate<ApplicationReturnedVars> = {
  key: 'vendor-application-returned', audience: 'partner', optional: false,
  render: v => ({
    subject: `Профилът на ${v.partnerName} е върнат за поправка`,
    preheader: 'Бележка от екипа — поправете я и подайте профила отново.',
    trigger: 'Профилът е върнат за поправка',
    heading: 'Профилът ви се нуждае от поправка',
    paragraphs: [
      `Екипът прегледа профила на ${v.partnerName} и го върна с бележка. Поправете посоченото и подайте профила отново.`,
      'След повторното подаване прегледът отново е до 48 часа.',
    ],
    details: [['Бележка от екипа', v.note], ['Подаден', v.submittedAt]],
    cta: { label: 'Поправи профила', href: '/partner/registratsiya/6' },
  }),
};

/** reason: the team's motive, shown as written. */
type ApplicationRejectedVars = { partnerName: string; eik: string; reason: string; submittedAt: string };
export const vendorApplicationRejected: EmailTemplate<ApplicationRejectedVars> = {
  key: 'vendor-application-rejected', audience: 'partner', optional: false,
  render: v => ({
    subject: `Заявката на ${v.partnerName} за партньорство не е одобрена`,
    preheader: 'Екипът прегледа профила ви — мотивът е в писмото.',
    trigger: 'Заявката за партньорство е отказана',
    heading: 'Не можем да одобрим профила ви',
    paragraphs: [
      `Екипът на EventAT прегледа заявката на ${v.partnerName} и не може да я одобри. Мотивът е по-долу.`,
      `Ако смятате, че има грешка, пишете ни на help@eventat.bg и посочете ЕИК ${v.eik}.`,
    ],
    details: [['Мотив', v.reason], ['Подаден', v.submittedAt]],
    cta: { label: 'Помощ и контакт', href: '/pravila' },
  }),
};

// ── Services and moderation ────────────────────────────────────────────────

/** serviceName: the service as listed ('Пакет „Церемония“'); serviceKind: 'Пакет с фиксирана цена'. */
type ServiceSubmittedVars = { serviceName: string; serviceKind: string; category: string; price: string; duration: string };
export const vendorServiceSubmitted: EmailTemplate<ServiceSubmittedVars> = {
  key: 'vendor-service-submitted', audience: 'partner', optional: false,
  render: v => ({
    subject: `${v.serviceName} е изпратен за преглед`,
    preheader: 'Ще ви пишем, щом екипът прегледа услугата — средно за около 4 часа.',
    trigger: 'Нова услуга — изпратена за преглед',
    heading: 'Получихме новата ви услуга',
    paragraphs: [
      'Екипът на EventAT преглежда новите услуги преди публикуване. Средното време за преглед е около 4 часа.',
      'Услугата се появява в профила ви веднага щом екипът я одобри. Ще ви пишем с решението.',
    ],
    details: [
      ['Услуга', v.serviceName],
      ['Вид', v.serviceKind],
      ['Категория', v.category],
      ['Цена', v.price],
      ['Продължителност', v.duration],
    ],
    cta: { label: 'Към услугите', href: '/partner/uslugi' },
  }),
};

type ServicePublishedVars = { partnerSlug: string; partnerName: string; serviceName: string; price: string; duration: string };
export const vendorServicePublished: EmailTemplate<ServicePublishedVars> = {
  key: 'vendor-service-published', audience: 'partner', optional: false,
  render: v => ({
    subject: `${v.serviceName} е одобрен и вече е в профила ви`,
    preheader: 'Клиентите вече виждат услугата и могат да изпращат заявки за нея.',
    trigger: 'Нова услуга — публикувана',
    heading: `${v.serviceName} е публикуван`,
    paragraphs: [
      `Екипът прегледа и одобри новата ви услуга. Тя вече се вижда в профила на ${v.partnerName}.`,
      'Клиентите могат да изпращат заявки за нея, докато е включено „Приемам заявки за нея“.',
    ],
    details: [
      ['Услуга', v.serviceName],
      ['Цена', v.price],
      ['Продължителност', v.duration],
      ['Статус', 'Активна'],
    ],
    cta: { label: 'Виж профила като клиент', href: `/partnyori/${v.partnerSlug}` },
  }),
};

type ServiceReturnedVars = { serviceId: string; serviceName: string; note: string };
export const vendorServiceReturned: EmailTemplate<ServiceReturnedVars> = {
  key: 'vendor-service-returned', audience: 'partner', optional: false,
  render: v => ({
    subject: `${v.serviceName} е върнат с бележка от екипа`,
    preheader: 'Поправете посоченото и изпратете услугата отново за преглед.',
    trigger: 'Услуга — върната с бележка',
    heading: `${v.serviceName} се нуждае от поправка`,
    paragraphs: [
      'Екипът прегледа новата ви услуга и я върна с бележка. Докато не бъде одобрена, клиентите не я виждат.',
      'Поправете посоченото и я изпратете отново за преглед.',
    ],
    details: [['Услуга', v.serviceName], ['Бележка от екипа', v.note]],
    cta: { label: 'Поправи услугата', href: `/partner/uslugi/${v.serviceId}` },
  }),
};

type ServiceChangeSubmittedVars = { serviceName: string; serviceKind: string };
export const vendorServiceChangeSubmitted: EmailTemplate<ServiceChangeSubmittedVars> = {
  key: 'vendor-service-change-submitted', audience: 'partner', optional: false,
  render: v => ({
    subject: `Промените по ${v.serviceName} са изпратени за преглед`,
    preheader: 'Докато трае прегледът, клиентите виждат услугата такава, каквато е сега.',
    trigger: 'Промени по услуга — изпратени за преглед',
    heading: `Получихме промените по ${v.serviceName}`,
    paragraphs: [
      'Екипът на EventAT преглежда промените, преди клиентите да ги видят. Ще ви пишем, щом приключи.',
      'Докато трае прегледът, клиентите виждат услугата такава, каквато е сега, и тя продължава да приема заявки.',
    ],
    details: [
      ['Услуга', v.serviceName],
      ['Вид', v.serviceKind],
      ['Статус', 'Активна · промените чакат преглед'],
    ],
    cta: { label: 'Към услугите', href: '/partner/uslugi' },
  }),
};

type ServiceChangeApprovedVars = { partnerSlug: string; serviceName: string };
export const vendorServiceChangeApproved: EmailTemplate<ServiceChangeApprovedVars> = {
  key: 'vendor-service-change-approved', audience: 'partner', optional: false,
  render: v => ({
    subject: `Промените по ${v.serviceName} са одобрени`,
    preheader: 'Клиентите вече виждат новата версия на услугата.',
    trigger: 'Промени по услуга — одобрени',
    heading: `Промените по ${v.serviceName} са одобрени`,
    paragraphs: [
      `Екипът прегледа и одобри промените. Клиентите вече виждат новата версия на ${v.serviceName} в профила ви.`,
    ],
    details: [['Услуга', v.serviceName], ['Статус', 'Активна']],
    cta: { label: 'Виж профила като клиент', href: `/partnyori/${v.partnerSlug}` },
  }),
};

// ── Requests ───────────────────────────────────────────────────────────────

/**
 * timeRange: '17:00 – около 02:00'. partnerAmount: what the partner receives.
 * attached: what the client added ('бележка и три снимки за вдъхновение'); leave out when nothing was added.
 */
type NewRequestVars = {
  requestId: string; requestNo: string; clientName: string;
  eventType: string; eventTypeDefinite: string; eventDate: string; eventWeekday: string; timeRange: string;
  guests: number; location: string; packageName: string; partnerAmount: string; replyBy: string; attached?: string;
};
export const vendorNewRequest: EmailTemplate<NewRequestVars> = {
  key: 'vendor-new-request', audience: 'partner', optional: true, preference: 'partner.new-request',
  render: v => ({
    subject: `Нова заявка: ${low(v.eventType)} на ${v.eventDate} от ${v.clientName}`,
    preheader: `Пакет „${v.packageName}“ · ${v.guests} гости · отговорете до ${v.replyBy}.`,
    trigger: 'Нова заявка',
    heading: `Нова заявка от ${v.clientName}`,
    paragraphs: [
      `${v.clientName} иска Пакет „${v.packageName}“ за ${withClitic(v.eventTypeDefinite, 'си')} на ${v.eventDate}. Датата е свободна в календара ви.${v.attached ? ` ${first(v.clientName)} е добавила ${v.attached}.` : ''}`,
      'Одобрението запазва датата за 24 часа, докато клиентът плати. Отговорете до 24 часа, за да запазите рейтинга си за отзивчивост.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Събитие', `${v.eventType} · ${v.eventDate}, ${v.eventWeekday}`],
      ['Час', v.timeRange],
      ['Гости', `${v.guests} души`],
      ['Локация', v.location],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Получавате', v.partnerAmount],
      ['Отговорете до', v.replyBy],
    ],
    cta: { label: 'Разгледай заявката', href: `/partner/zayavki/${v.requestId}` },
  }),
};

/** need: what the client is looking for ('озвучаване за тиймбилдинг вечер'); serviceName: the on-request service. */
type NewInquiryVars = {
  requestId: string; clientName: string; eventType: string; eventDate: string;
  guests: number; location: string; need: string; serviceName: string;
};
export const vendorNewInquiry: EmailTemplate<NewInquiryVars> = {
  key: 'vendor-new-inquiry', audience: 'partner', optional: true, preference: 'partner.new-request',
  render: v => ({
    subject: `Ново запитване: ${low(v.eventType)} на ${v.eventDate} от ${v.clientName}`,
    preheader: `${v.guests} гости ${inAt(v.location)} — клиентът чака вашата оферта.`,
    trigger: 'Ново запитване за оферта',
    heading: `${v.clientName} чака вашата оферта`,
    paragraphs: [
      `${v.clientName} търси ${v.need} ${inAt(v.location)}. Запитването е за услугата „${v.serviceName}“, затова клиентът чака индивидуална оферта.`,
      'Отговорете до 24 часа, за да запазите рейтинга си за отзивчивост.',
    ],
    details: [
      ['Клиент', v.clientName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Гости', `${v.guests} души`],
      ['Локация', v.location],
      ['Услуга', `${v.serviceName} · по запитване`],
    ],
    cta: { label: 'Разгледай запитването', href: `/partner/zayavki/${v.requestId}` },
  }),
};

type RequestReminderVars = {
  requestId: string; requestNo: string; hoursLeft: number; clientName: string;
  eventType: string; eventTypeDefinite: string; eventDate: string; packageName: string; partnerAmount: string; replyBy: string;
};
export const vendorRequestReminder: EmailTemplate<RequestReminderVars> = {
  key: 'vendor-request-reminder', audience: 'partner', optional: false,
  render: v => ({
    subject: `${remain(v.hoursLeft, 'час', 'часа')} да отговорите на заявката на ${v.clientName}`,
    preheader: `Срокът за отговор е ${v.replyBy}.`,
    trigger: 'Напомняне — заявка без отговор',
    heading: `Заявката на ${v.clientName} чака отговор`,
    paragraphs: [
      `${v.clientName} чака отговор за ${v.eventTypeDefinite} на ${v.eventDate}. Срокът за отговор е ${v.replyBy}.`,
      'Отговорете навреме, за да запазите рейтинга си за отзивчивост. Ако не можете да поемете събитието, откажете заявката.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Получавате', v.partnerAmount],
      ['Отговорете до', v.replyBy],
    ],
    cta: { label: 'Разгледай заявката', href: `/partner/zayavki/${v.requestId}` },
  }),
};

type RequestApprovedVars = {
  requestId: string; requestNo: string; clientName: string;
  eventType: string; eventDate: string; packageName: string; partnerAmount: string; payBy: string;
};
export const vendorRequestApproved: EmailTemplate<RequestApprovedVars> = {
  key: 'vendor-request-approved', audience: 'partner', optional: false,
  render: v => ({
    subject: `Одобрихте заявката на ${v.clientName} — датата е запазена`,
    preheader: `Клиентът има време да плати до ${v.payBy}.`,
    trigger: 'Одобрена заявка — чака плащане',
    heading: `Датата ${v.eventDate} е запазена`,
    paragraphs: [
      `Одобрихте заявката на ${v.clientName}. Датата ${v.eventDate} е блокирана в календара ви, докато клиентът плати.`,
      `${first(v.clientName)} има 24 часа да плати през платформата. Ако плащането не постъпи навреме, датата се освобождава автоматично. Ще ви пишем веднага щом плати.`,
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Получавате', v.partnerAmount],
      ['Срок за плащане', v.payBy],
    ],
    cta: { label: 'Виж заявката', href: `/partner/zayavki/${v.requestId}` },
  }),
};

type PaymentReminderVars = {
  requestId: string; requestNo: string; hoursLeft: number; clientName: string;
  eventType: string; eventDate: string; packageName: string; payBy: string;
};
export const vendorPaymentReminder: EmailTemplate<PaymentReminderVars> = {
  key: 'vendor-payment-reminder', audience: 'partner', optional: true, preference: 'partner.payment-reminder',
  render: v => ({
    subject: `${v.clientName} още не е платила — ${low(remain(v.hoursLeft, 'час', 'часа'))}`,
    preheader: `Срокът за плащане изтича на ${v.payBy}.`,
    trigger: 'Напомняне — клиентът още не е платил',
    heading: 'Клиентът още не е платил',
    paragraphs: [
      `Одобрихте заявката на ${v.clientName}, но плащането още не е постъпило. Срокът изтича на ${v.payBy}.`,
      `Ако плащането не постъпи навреме, датата ${v.eventDate} се освобождава автоматично. Можете да напомните на клиента от заявката.`,
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Срок за плащане', v.payBy],
    ],
    cta: { label: 'Напомни на клиента', href: `/partner/zayavki/${v.requestId}` },
  }),
};

/** extraHours: how long the team extended the deadline by (24). */
type PaymentDeadlineExtendedVars = {
  requestId: string; requestNo: string; extraHours: number; clientName: string;
  eventType: string; eventDate: string; previousDeadline: string; newDeadline: string;
};
export const vendorPaymentDeadlineExtended: EmailTemplate<PaymentDeadlineExtendedVars> = {
  key: 'vendor-payment-deadline-extended', audience: 'partner', optional: false,
  render: v => ({
    subject: `Екипът удължи срока за плащане по заявка № ${v.requestNo}`,
    preheader: `Датата ${v.eventDate} остава запазена още ${v.extraHours} часа.`,
    trigger: 'Удължен срок за плащане',
    heading: `Срокът за плащане е удължен с ${v.extraHours} часа`,
    paragraphs: [
      `Екипът на EventAT удължи с ${v.extraHours} часа срока, в който ${v.clientName} трябва да плати. Датата ${v.eventDate} остава блокирана в календара ви дотогава.`,
      'Ако плащането не постъпи и в новия срок, датата се освобождава автоматично.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Предишен срок', v.previousDeadline],
      ['Нов срок', v.newDeadline],
    ],
    cta: { label: 'Виж заявката', href: `/partner/zayavki/${v.requestId}` },
  }),
};

/** expiredAt: the payment deadline that passed. */
type HoldExpiredVars = {
  requestNo: string; clientName: string; eventType: string; eventDate: string; packageName: string; expiredAt: string;
};
export const vendorHoldExpired: EmailTemplate<HoldExpiredVars> = {
  key: 'vendor-hold-expired', audience: 'partner', optional: false,
  render: v => ({
    subject: `${v.clientName} не плати навреме — ${v.eventDate} е свободна`,
    preheader: `Заявка № ${v.requestNo} отпадна и датата отново е свободна за други клиенти.`,
    trigger: 'Неплатена заявка — датата е освободена',
    heading: `Датата ${v.eventDate} е освободена`,
    paragraphs: [
      `Срокът за плащане по заявката на ${v.clientName} изтече на ${v.expiredAt}, без да постъпи плащане.`,
      'Датата се освободи автоматично и отново е свободна за други клиенти.',
    ],
    details: [
      ['Заявка №', v.requestNo],
      ['Клиент', v.clientName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Пакет', `Пакет „${v.packageName}“`],
    ],
    cta: { label: 'Виж календара', href: '/partner/kalendar' },
  }),
};

// ── Bookings ───────────────────────────────────────────────────────────────

/** timeRange: '17:00 – 02:00'. clientPhone: shown only now that the booking is paid. */
type BookingConfirmedVars = {
  bookingId: string; bookingNo: string; clientName: string; clientPhone: string;
  eventType: string; eventTypeDefinite: string; hosts: string; eventDate: string; eventWeekday: string; timeRange: string;
  location: string; guests: number; packageName: string; partnerAmount: string; payoutDate: string; freeCancelUntil: string;
};
export const vendorBookingConfirmed: EmailTemplate<BookingConfirmedVars> = {
  key: 'vendor-booking-confirmed', audience: 'partner', optional: false,
  render: v => ({
    subject: `Получено плащане: ${subjectForm(v.eventTypeDefinite)} на ${v.eventDate} е ${agree(v.eventTypeDefinite, 'потвърден', 'потвърдена', 'потвърдено')}`,
    preheader: `${v.clientName} плати Пакет „${v.packageName}“ — получавате ${v.partnerAmount}.`,
    trigger: 'Плащане получено — потвърдена резервация',
    heading: 'Резервацията е потвърдена',
    paragraphs: [
      `${v.clientName} плати Пакет „${v.packageName}“ за ${v.eventTypeDefinite} на ${v.eventDate}. Датата е блокирана в календара ви.`,
      'Сумата се задържа в платформата до събитието и се превежда по сметката ви на 1-во или 15-то число след него.',
      'Телефонът на клиента е за деня на събитието. За всичко останало пишете през платформата — така остава писмена история на договореното.',
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.hosts}`],
      ['Дата и час', `${v.eventDate}, ${v.eventWeekday}, ${v.timeRange}`],
      ['Локация', v.location],
      ['Гости', `${v.guests} души`],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Телефон за деня на събитието', v.clientPhone],
      ['Получавате', v.partnerAmount],
      ['Изплащане', v.payoutDate],
      ['Безплатно анулиране за клиента', `до ${v.freeCancelUntil}`],
    ],
    cta: { label: 'Виж резервацията', href: `/partner/rezervacii/${v.bookingId}` },
  }),
};

/** venue: the short venue name for running text ('Вила Екатерина'); location: the full one. */
type EventReminderVars = {
  bookingNo: string; daysLeft: number; eventTypeDefinite: string; hosts: string;
  eventDate: string; eventWeekday: string; timeRange: string; venue: string; location: string; guests: number;
  packageName: string; clientPhone: string; partnerAmount: string; payoutDate: string;
};
export const vendorEventReminder: EmailTemplate<EventReminderVars> = {
  key: 'vendor-event-reminder', audience: 'partner', optional: false,
  render: v => ({
    subject: `След ${pl(v.daysLeft, 'ден', 'дни')}: ${subjectForm(v.eventTypeDefinite)} на ${v.hosts}, ${v.eventDate}`,
    preheader: `${v.location} · начало ${v.timeRange.split('–')[0].trim()} · ${v.guests} гости.`,
    trigger: 'Напомняне преди събитието',
    heading: `${cap(subjectForm(v.eventTypeDefinite))} на ${v.hosts} е след седмица`,
    paragraphs: [
      `На ${v.eventDate} сте на ${v.eventTypeDefinite} на ${v.hosts} ${inAt(v.venue)}. Ако още не сте уточнили програмата и плейлиста с клиента, направете го сега през съобщенията.`,
      `След събитието получавате ${v.partnerAmount} с партидата на ${v.payoutDate}.`,
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Дата и час', `${v.eventDate}, ${v.eventWeekday}, ${v.timeRange}`],
      ['Локация', v.location],
      ['Гости', `${v.guests} души`],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Телефон за деня на събитието', v.clientPhone],
    ],
    cta: { label: 'Пиши на клиента', href: '/partner/saobshteniya' },
  }),
};

/**
 * policyDefinite: 'умерената'. The prototype's running text is the in-period (full refund) case, the default.
 * A late cancellation (`inFreePeriod: false`) leaves the partner the kept amount (‹Получавате›), so the
 * sentence that says everything goes back and nothing is paid out is left out.
 */
type ClientCancelledVars = {
  bookingNo: string; clientName: string; eventType: string; hosts: string; eventDate: string; packageName: string;
  policyDefinite: string; freeCancelUntil: string; reason: string; partnerAmount: string; inFreePeriod?: boolean;
};
export const vendorClientCancelled: EmailTemplate<ClientCancelledVars> = {
  key: 'vendor-client-cancelled', audience: 'partner', optional: false,
  render: v => ({
    subject: `${v.clientName} анулира резервацията за ${v.eventDate}`,
    preheader: 'Датата е освободена в календара ви.',
    trigger: 'Клиентът анулира резервацията',
    heading: `Резервацията за ${v.eventDate} е анулирана`,
    paragraphs: [
      `${v.clientName} анулира резервация № ${v.bookingNo}. Датата ${v.eventDate} е освободена в календара ви и отново се показвате в търсенето за нея.`,
      (v.inFreePeriod ?? true) ? `Анулирането е в безплатния срок по ${v.policyDefinite} ви политика — до ${v.freeCancelUntil}. Сумата се връща изцяло на клиента и по тази резервация няма изплащане.` : '',
    ].filter(Boolean),
    details: [
      ['Резервация №', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.hosts}`],
      ['Дата', v.eventDate],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Причина', v.reason],
      ['Получавате', v.partnerAmount],
    ],
    cta: { label: 'Виж календара', href: '/partner/kalendar' },
  }),
};

type CancelRequestedVars = {
  bookingId: string; bookingNo: string; clientName: string; eventType: string; hosts: string; eventDate: string; packageName: string;
};
export const vendorCancelRequested: EmailTemplate<CancelRequestedVars> = {
  key: 'vendor-cancel-requested', audience: 'partner', optional: false,
  render: v => ({
    subject: `Получихме искането ви за анулиране на резервация № ${v.bookingNo}`,
    preheader: 'Екипът се свързва с клиента и освобождава датата.',
    trigger: 'Искане за анулиране от партньора',
    heading: 'Искането ви за анулиране е при екипа',
    paragraphs: [
      `Изпратихме искането ви до екипа на EventAT. Той се свързва с ${v.clientName} и след това освобождава датата.`,
      'Ще ви пишем, когато анулирането приключи.',
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.hosts}`],
      ['Дата', v.eventDate],
      ['Пакет', `Пакет „${v.packageName}“`],
    ],
    cta: { label: 'Виж резервацията', href: `/partner/rezervacii/${v.bookingId}` },
  }),
};

type CancelCompletedVars = {
  bookingNo: string; clientName: string; eventType: string; hosts: string; eventDate: string; partnerAmount: string;
};
export const vendorCancelCompleted: EmailTemplate<CancelCompletedVars> = {
  key: 'vendor-cancel-completed', audience: 'partner', optional: false,
  render: v => ({
    subject: `Резервацията за ${v.eventDate} е анулирана по ваше искане`,
    preheader: 'Екипът се свърза с клиента и освободи датата.',
    trigger: 'Анулиране по искане на партньора — завършено',
    heading: 'Резервацията е анулирана',
    paragraphs: [
      `Екипът на EventAT се свърза с ${v.clientName} и анулира резервация № ${v.bookingNo} по ваше искане. Датата ${v.eventDate} е освободена в календара ви.`,
      'По тази резервация няма изплащане.',
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.hosts}`],
      ['Дата', v.eventDate],
      ['Получавате', v.partnerAmount],
    ],
    cta: { label: 'Виж календара', href: '/partner/kalendar' },
  }),
};

// ── Money ──────────────────────────────────────────────────────────────────

/** account: the masked IBAN as shown ('BG•• •••• •••• 5272 01'); bankName: 'Postbank'. */
type PayoutSentVars = {
  bookingNo: string; amount: string; payoutDate: string;
  eventType: string; eventTypeDefinite: string; hosts: string; eventDate: string; packageName: string;
  account: string; bankName: string; partnerLegalName: string;
};
export const vendorPayoutSent: EmailTemplate<PayoutSentVars> = {
  key: 'vendor-payout-sent', audience: 'partner', optional: false,
  render: v => ({
    subject: `Изплатихме ${v.amount} за ${v.eventTypeDefinite} на ${v.eventDate}`,
    preheader: `Преводът е към сметката ви ${v.account} в ${v.bankName}.`,
    trigger: 'Изплащане',
    heading: 'Изплащането е изпратено',
    paragraphs: [
      `Събитието мина и преведохме сумата за ${v.eventTypeDefinite} на ${v.hosts} по сметката на ${v.partnerLegalName}.`,
      'Изплащанията тръгват на 1-во и 15-то число след събитието. Всички преводи виждате в „Приходи“.',
    ],
    details: [
      ['Сума', v.amount],
      ['Дата на превода', v.payoutDate],
      ['Резервация', `№ ${v.bookingNo} · ${v.eventType} · ${v.hosts}`],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Сметка', `${v.account} · ${v.bankName}`],
      ['Титуляр', v.partnerLegalName],
    ],
    cta: { label: 'Виж приходите', href: '/partner/prihodi' },
  }),
};

/** heldAmount: money held for upcoming events that will go to the new account. */
type PayoutAccountVars = { partnerLegalName: string; heldAmount: string };
export const vendorPayoutAccountSubmitted: EmailTemplate<PayoutAccountVars> = {
  key: 'vendor-payout-account-submitted', audience: 'partner', optional: false,
  render: v => ({
    subject: 'Получихме новата ви сметка за изплащане',
    preheader: 'Екипът я проверява до два работни дни.',
    trigger: 'Смяна на сметката за изплащане — подадена',
    heading: 'Новата сметка чака проверка',
    paragraphs: [
      `Получихме новите данни и документа от банката. Екипът ги проверява до два работни дни. Сметката трябва да е на името на ${v.partnerLegalName}.`,
      `Докато трае проверката, нищо не се превежда. Задържаните ${v.heldAmount} остават заделени за вас и тръгват по новата сметка по обичайния график.`,
      'Ако не сте подали тази промяна, пишете ни веднага на help@eventat.bg.',
    ],
    details: [
      ['Титуляр', v.partnerLegalName],
      ['Проверка', 'до два работни дни'],
      ['Задържани до събитията', v.heldAmount],
    ],
    cta: { label: 'Виж сметката', href: '/partner/smetka' },
  }),
};

export const vendorPayoutAccountConfirmed: EmailTemplate<PayoutAccountVars> = {
  key: 'vendor-payout-account-confirmed', audience: 'partner', optional: false,
  render: v => ({
    subject: 'Новата ви сметка за изплащане е потвърдена',
    preheader: 'Изплащанията вече тръгват по новата сметка.',
    trigger: 'Смяна на сметката за изплащане — потвърдена',
    heading: 'Новата сметка е потвърдена',
    paragraphs: [
      `Екипът провери данните и документа от банката. Изплащанията за ${v.partnerLegalName} вече тръгват по новата сметка.`,
      `Задържаните ${v.heldAmount} се превеждат по нея по обичайния график — на 1-во или 15-то число след съответното събитие.`,
      'Ако не сте подали тази промяна, пишете ни веднага на help@eventat.bg.',
    ],
    details: [
      ['Титуляр', v.partnerLegalName],
      ['Изплащане', '1-во и 15-то число след събитието'],
      ['Задържани до събитията', v.heldAmount],
    ],
    cta: { label: 'Виж приходите', href: '/partner/prihodi' },
  }),
};

// ── Tickets ────────────────────────────────────────────────────────────────

/** The case number is the booking number. hosts: whose event it is ('СУ „Христо Ботев“'). */
type TicketReceivedVars = { bookingNo: string; eventType: string; hosts: string; location: string; reason: string; openedAt: string };
export const vendorTicketReceived: EmailTemplate<TicketReceivedVars> = {
  key: 'vendor-ticket-received', audience: 'partner', optional: false,
  render: v => ({
    subject: `Получихме сигнала ви по резервация № ${v.bookingNo}`,
    preheader: 'Екипът отговаря до 24 часа и иска позиция от клиента.',
    trigger: 'Сигнал до екипа — получен',
    heading: 'Сигналът ви е при екипа',
    paragraphs: [
      'Екипът на EventAT пое случая. Отговаряме до 24 часа и искаме позиция от клиента. Решението идва по имейл до двете страни.',
      'Резервацията остава в календара ви, докато случаят е отворен. Ако се разберете с клиента преди решението, оттеглете сигнала.',
    ],
    details: [
      ['Кейс №', v.bookingNo],
      ['Резервация', `${v.eventType} · ${v.hosts}`],
      ['Локация', v.location],
      ['Причина', v.reason],
      ['Подаден', v.openedAt],
    ],
    cta: { label: 'Към резервациите', href: '/partner/rezervacii' },
  }),
};

/** message: the client's text, quoted as written. */
type TicketClientOpenedVars = {
  bookingNo: string; clientName: string; eventType: string; eventTypeDefinite: string; hosts: string; eventDate: string;
  message: string; reason: string;
};
export const vendorTicketClientOpened: EmailTemplate<TicketClientOpenedVars> = {
  key: 'vendor-ticket-client-opened', audience: 'partner', optional: false,
  render: v => ({
    subject: `Сигнал по резервация № ${v.bookingNo} — очакваме вашата позиция`,
    preheader: `${v.clientName} изпрати сигнал до екипа — срокът за позиция е 48 часа.`,
    trigger: 'Сигнал от клиент по ваша резервация',
    heading: 'Клиентът изпрати сигнал по ваша резервация',
    paragraphs: [
      `${v.clientName} изпрати сигнал до екипа за ${v.eventTypeDefinite} на ${v.eventDate}. Ето какво пише:`,
      `„${v.message}“`,
      'Изпратете своята позиция и доказателства до 48 часа. Изплащането по резервацията спира до решението, което идва по имейл до двете страни, с мотив.',
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.hosts}, ${v.eventDate}`],
      ['Причина', v.reason],
      ['Срок за позиция', '48 часа'],
    ],
    cta: { label: 'Изпрати позицията', href: `/partner/poddrazhka/${v.bookingNo}` },
  }),
};

type TicketReminderVars = { bookingNo: string; clientName: string; eventType: string; hosts: string; eventDate: string };
export const vendorTicketReminder: EmailTemplate<TicketReminderVars> = {
  key: 'vendor-ticket-reminder', audience: 'partner', optional: false,
  render: v => ({
    subject: `Още чакаме позицията ви по сигнал № ${v.bookingNo}`,
    preheader: `Сигнал от ${v.clientName} · ${v.eventType} · ${v.eventDate}.`,
    trigger: 'Напомняне — позиция по сигнал',
    heading: 'Екипът още чака вашата позиция',
    paragraphs: [
      `${v.clientName} изпрати сигнал по резервация № ${v.bookingNo} и екипът още не е получил вашата позиция.`,
      'Опишете какво се е случило и добавете снимки или документи. Изплащането по резервацията остава спряно до решението.',
    ],
    details: [
      ['Резервация №', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.hosts}, ${v.eventDate}`],
      ['Сигнал от', v.clientName],
    ],
    cta: { label: 'Изпрати позицията', href: `/partner/poddrazhka/${v.bookingNo}` },
  }),
};

/**
 * Written by the team when deciding: decision ('Без възстановяване'), summary (inbox line),
 * account (what happened, first paragraph), motive (after „Мотив:“), payoutLine (what happens to the payout).
 */
type TicketDecisionVars = {
  caseNo: string; eventType: string; eventTypeDefinite: string; eventDate: string; packageName: string;
  decision: string; summary: string; account: string; motive: string; payoutLine: string;
  refunded: string; partnerAmount: string; decidedBy: string; decidedAt: string;
};
export const vendorTicketDecision: EmailTemplate<TicketDecisionVars> = {
  key: 'vendor-ticket-decision', audience: 'partner', optional: false,
  render: v => ({
    subject: `Решение по сигнал № ${v.caseNo}: ${low(v.decision)}`,
    preheader: v.summary,
    trigger: 'Решение по сигнал',
    heading: `Екипът реши сигнала по ${v.eventTypeDefinite} на ${v.eventDate}`,
    paragraphs: [
      v.account,
      `Мотив: ${v.motive} ${v.payoutLine}`,
    ],
    details: [
      ['Кейс №', v.caseNo],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Решение', v.decision],
      ['Върнати на клиентите', v.refunded],
      ['Получавате', v.partnerAmount],
      ['Решено от', `${v.decidedBy} · ${v.decidedAt}`],
    ],
    cta: { label: 'Виж приходите', href: '/partner/prihodi' },
  }),
};

// ── Reviews, messages, reports ─────────────────────────────────────────────

/** rating: the profile average as shown ('4,9'). preview: optional shorter quote for the inbox line. */
type NewReviewVars = {
  reviewerName: string; stars: number; text: string; preview?: string;
  eventType: string; packageName: string; rating: string; reviewCount: number;
};
export const vendorNewReview: EmailTemplate<NewReviewVars> = {
  key: 'vendor-new-review', audience: 'partner', optional: true, preference: 'partner.new-review',
  render: v => ({
    subject: `Ново ревю с ${pl(v.stars, 'звезда', 'звезди')} от ${v.reviewerName}`,
    preheader: `„${v.preview ?? excerpt(v.text)}“`,
    trigger: 'Ново ревю',
    heading: `${v.reviewerName} ви остави ревю`,
    paragraphs: [
      `„${v.text}“`,
      'Ревюто вече е в профила ви. Не можете да го изтриете, но можете да отговорите публично — отговорът се показва под него.',
    ],
    details: [
      ['Оценка', `${v.stars} от 5`],
      ['Събитие', `${v.eventType} · Пакет „${v.packageName}“`],
      ['Рейтинг на профила', `${v.rating} от ${pl(v.reviewCount, 'ревю', 'ревюта')}`],
    ],
    cta: { label: 'Отговори на ревюто', href: '/partner/revyuta' },
  }),
};

/** message: already masked for phone numbers and emails before a paid booking. */
type NewMessageVars = {
  clientName: string; message: string; preview?: string;
  eventType: string; packageName: string; eventDate: string; receivedAt: string;
};
export const vendorNewMessage: EmailTemplate<NewMessageVars> = {
  key: 'vendor-new-message', audience: 'partner', optional: false,
  render: v => ({
    subject: `Ново съобщение от ${v.clientName}`,
    preheader: `„${v.preview ?? excerpt(v.message)}“`,
    trigger: 'Ново съобщение от клиент',
    heading: `${v.clientName} ви писа`,
    paragraphs: [
      `„${v.message}“`,
      'Отговорете през платформата — така всичко договорено остава записано.',
    ],
    details: [
      ['От', v.clientName],
      ['Относно', `${v.eventType} · Пакет „${v.packageName}“ · ${v.eventDate}`],
      ['Получено', v.receivedAt],
    ],
    cta: { label: 'Отговори', href: '/partner/saobshteniya' },
  }),
};

/** period: 'август 2025'. paidYear / paidInYear: payouts so far this year. */
type ReportReadyVars = {
  partnerName: string; period: string; revenue: string; toPay: string; paidYear: number; paidInYear: string;
};
export const vendorReportReady: EmailTemplate<ReportReadyVars> = {
  key: 'vendor-report-ready', audience: 'partner', optional: false,
  render: v => ({
    subject: `Справката за приходите за ${v.period} е готова`,
    preheader: `Приходи ${v.revenue} · за изплащане ${v.toPay}.`,
    trigger: 'Справка или експорт — готов файл',
    heading: 'Справката ви е готова',
    paragraphs: [
      `Подготвихме справката за приходите на ${v.partnerName}, която поискахте от „Приходи“. Изтеглете я от бутона по-долу.`,
    ],
    details: [
      ['Период', cap(v.period)],
      ['Приходи', v.revenue],
      ['За изплащане', v.toPay],
      [`Изплатени за ${v.paidYear}`, v.paidInYear],
    ],
    cta: { label: 'Изтегли справката', href: '/partner/prihodi' },
  }),
};

// ── Account ────────────────────────────────────────────────────────────────

type DeactivatedVars = { partnerName: string; partnerCategory: string; upcomingCount: number };
export const vendorDeactivated: EmailTemplate<DeactivatedVars> = {
  key: 'vendor-deactivated', audience: 'partner', optional: false,
  render: v => ({
    subject: `Профилът на ${v.partnerName} е деактивиран`,
    preheader: 'Профилът не се показва в каталога, но резервациите остават.',
    trigger: 'Деактивиран профил',
    heading: 'Профилът ви е деактивиран',
    paragraphs: [
      `${v.partnerName} вече не се показва в каталога. Потвърдените резервации остават в сила.`,
      'Можете да върнете профила по всяко време от настройките. Ако не сте го деактивирали вие, пишете ни на help@eventat.bg.',
    ],
    details: [
      ['Профил', `${v.partnerName} · ${v.partnerCategory}`],
      ['Предстоящи резервации', `${v.upcomingCount} — остават в сила`],
    ],
    cta: { label: 'Към настройките', href: '/partner/nastroyki' },
  }),
};

/** url: the one-time confirmation link that actually deletes the account. */
type DeleteConfirmVars = { partnerName: string; email: string; url: string };
export const vendorDeleteConfirm: EmailTemplate<DeleteConfirmVars> = {
  key: 'vendor-delete-confirm', audience: 'partner', optional: false, secret: ['url'],
  render: v => ({
    subject: `Потвърдете изтриването на акаунта на ${v.partnerName}`,
    preheader: 'Изтриването е необратимо — потвърдете, че го искате.',
    trigger: 'Изтриване на акаунта',
    heading: 'Потвърдете изтриването на акаунта',
    paragraphs: [
      `Поискахте да изтриете акаунта на ${v.partnerName} в EventAT. Изтриването е необратимо и е възможно само без предстоящи резервации.`,
      'Ако не сте поискали изтриване, пренебрегнете този имейл — акаунтът ви остава активен.',
    ],
    details: [['Акаунт', v.email], ['Бизнес', v.partnerName]],
    cta: { label: 'Потвърди изтриването', href: v.url },
  }),
};

/** inviterName: the team member who sent the invitation. */
type InviteVars = { inviterName: string };
export const vendorInvite: EmailTemplate<InviteVars> = {
  key: 'vendor-invite', audience: 'partner', optional: false,
  render: v => ({
    subject: 'Покана да станете партньор в EventAT',
    preheader: 'Регистрацията и профилът са безплатни — отнемат около 10 минути.',
    trigger: 'Покана за партньорство',
    heading: 'Каним ви да станете партньор в EventAT',
    paragraphs: [
      `${v.inviterName} от екипа на EventAT ви кани да предлагате услугите си в платформата. Заявките идват с дата, брой гости, бюджет и локация — вие отговаряте с да или не.`,
      'Регистрацията и профилът са безплатни и отнемат около 10 минути. Ще ви трябват ЕИК, снимки от ваши събития и цени на пакетите. Профилът се одобрява до 48 часа.',
    ],
    details: [
      ['Покана от', `${v.inviterName} · EventAT`],
      ['Регистрация', 'безплатна'],
      ['Изплащане', 'на 1-во и 15-то число след събитието'],
    ],
    cta: { label: 'Стани партньор', href: '/stani-partnyor' },
  }),
};

// ── Open requests (offers) ─────────────────────────────────────────────────

type OfferChosenVars = {
  requestId: string; requestNo: string; clientName: string;
  eventType: string; eventTypeDefinite: string; eventDate: string; eventTime: string; location: string; guests: number;
  offerTitle: string; partnerAmount: string;
};
export const vendorOfferChosen: EmailTemplate<OfferChosenVars> = {
  key: 'vendor-offer-chosen', audience: 'partner', optional: false,
  render: v => ({
    subject: `${v.clientName} избра вашата оферта — ${low(v.eventType)}, ${v.eventDate}`,
    preheader: 'Потвърдете до 24 часа, за да мине клиентът към плащане.',
    trigger: 'Избрана оферта',
    heading: 'Клиентът избра вашата оферта',
    paragraphs: [
      `${v.clientName} избра вашата оферта за ${v.eventTypeDefinite} на ${v.eventDate}. Потвърдете я до 24 часа.`,
      'След потвърждението датата се запазва и клиентът има 24 часа да плати през платформата. Сумата се задържа до събитието и ви се превежда на 1-во или 15-то число след него.',
    ],
    details: [
      ['Заявка', v.requestNo],
      ['Клиент', v.clientName],
      ['Събитие', `${v.eventType} · ${v.eventDate}, ${v.eventTime}`],
      ['Локация', v.location],
      ['Гости', String(v.guests)],
      ['Оферта', v.offerTitle],
      ['Получавате', v.partnerAmount],
    ],
    cta: { label: 'Потвърди офертата', href: `/partner/zayavki/${v.requestId}` },
  }),
};

type OfferNotChosenVars = {
  requestNo: string; clientName: string; eventType: string; eventTypeDefinite: string; eventDate: string;
  location: string; guests: number; offerTitle: string;
};
export const vendorOfferNotChosen: EmailTemplate<OfferNotChosenVars> = {
  key: 'vendor-offer-not-chosen', audience: 'partner', optional: false,
  render: v => ({
    subject: `${v.clientName} избра друга оферта за ${v.eventTypeDefinite} на ${v.eventDate}`,
    preheader: 'Нищо не се променя в календара ви.',
    trigger: 'Неизбрана оферта',
    heading: 'Клиентът избра друга оферта',
    paragraphs: [
      `${v.clientName} избра друга оферта по запитването си за ${v.eventTypeDefinite} на ${v.eventDate}. Благодарим ви, че отговорихте.`,
      'Датата не е била запазена за този клиент и остава свободна в календара ви.',
    ],
    details: [
      ['Заявка', v.requestNo],
      ['Клиент', v.clientName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Локация', v.location],
      ['Гости', String(v.guests)],
      ['Вашата оферта', v.offerTitle],
    ],
    cta: { label: 'Към заявките', href: '/partner/zayavki' },
  }),
};

type RequestExpiredVars = {
  requestNo: string; clientName: string; eventType: string; eventTypeDefinite: string; eventDate: string;
  packageName: string; receivedAt: string; replyBy: string;
};
export const vendorRequestExpired: EmailTemplate<RequestExpiredVars> = {
  key: 'vendor-request-expired', audience: 'partner', optional: false,
  render: v => ({
    subject: `Заявката от ${v.clientName} изтече без отговор`,
    preheader: `Срокът за отговор беше до ${v.replyBy}.`,
    trigger: 'Изтекла заявка',
    heading: 'Заявката изтече',
    paragraphs: [
      `Не отговорихте до 24 часа на заявката от ${v.clientName} за ${v.eventTypeDefinite} на ${v.eventDate} и тя отпадна автоматично.`,
      'Отговорът до 24 часа пази рейтинга ви за отзивчивост. Ако временно сте заети, изключете „Приемам нови заявки“ в публичния профил.',
    ],
    details: [
      ['Заявка', v.requestNo],
      ['Клиент', v.clientName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Пакет', `Пакет „${v.packageName}“`],
      ['Получена', v.receivedAt],
      ['Срок за отговор', v.replyBy],
    ],
    cta: { label: 'Към заявките', href: '/partner/zayavki' },
  }),
};

/** clientName: the clients as named on the case ('Петя и Николай'); topic: the case subject. */
type TicketInfoRequestVars = {
  bookingNo: string; clientName: string; eventType: string; eventTypeDefinite: string; eventDate: string;
  serviceName: string; topic: string;
};
export const vendorTicketInfoRequest: EmailTemplate<TicketInfoRequestVars> = {
  key: 'vendor-ticket-info-request', audience: 'partner', optional: false,
  render: v => ({
    subject: `Въпрос от екипа по сигнала за ${v.eventTypeDefinite} на ${v.eventDate}`,
    preheader: 'Отговорете, за да можем да вземем решение.',
    trigger: 'Въпрос от екипа по сигнал',
    heading: 'Екипът има въпрос по сигнала',
    paragraphs: [
      `Разглеждаме сигнала на ${v.clientName} по резервация № ${v.bookingNo} и имаме още един въпрос към вас. Същият въпрос е изпратен и до клиентите.`,
      'Изплащането по резервацията остава спряно до решението. Решението идва по имейл до двете страни, с мотив.',
    ],
    details: [
      ['Кейс', v.bookingNo],
      ['Клиенти', v.clientName],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Услуга', v.serviceName],
      ['Сигнал', v.topic],
    ],
    cta: { label: 'Отговори на екипа', href: `/partner/poddrazhka/${v.bookingNo}` },
  }),
};

/** current / proposed: the published and the submitted terms ('28,00 € на гост · минимум 60 гости'). */
type ServiceChangeReturnedVars = {
  serviceId: string; serviceName: string; category: string; current: string; proposed: string;
};
export const vendorServiceChangeReturned: EmailTemplate<ServiceChangeReturnedVars> = {
  key: 'vendor-service-change-returned', audience: 'partner', optional: false,
  render: v => ({
    subject: `Промяната по ${v.serviceName} е върната с бележка`,
    preheader: 'Клиентите продължават да виждат досегашната версия на услугата.',
    trigger: 'Промени по услуга — върнати с бележка',
    heading: 'Промяната е върната с бележка',
    paragraphs: [
      `Екипът на EventAT прегледа промяната по ${v.serviceName} и я върна с бележка. Промяната не е публикувана.`,
      'Клиентите виждат услугата такава, каквато е сега, докато не изпратите поправена версия и тя не бъде одобрена. Бележката на екипа е в редакцията на услугата.',
    ],
    details: [
      ['Услуга', `${v.serviceName} · ${v.category}`],
      ['В профила сега', v.current],
      ['Подадена промяна', v.proposed],
    ],
    cta: { label: 'Поправи услугата', href: `/partner/uslugi/${v.serviceId}` },
  }),
};
