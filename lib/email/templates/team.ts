// Team emails (audience 'team'), ported word for word from the prototype's emails/emails.js.
// Every concrete value is a variable; pass dates and amounts already formatted with lib/format.ts.
// For disputes the case number is the booking number ('2026-0614-ФК'); caseId is the id in the
// /admin/sporove/[id] route.
//
// Preference keys: none. Every team email is a service email (optional: false) — admin/settings.html
// has no notification switches for them.
import type { EmailTemplate } from '../types';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const low = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
/** 1 задача / 15 задачи */
const pl = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
/** "в Пловдив", "във Варна" */
const inAt = (place: string) => `${/^[вфВФ]/.test(place) ? 'във' : 'в'} ${place}`;
/** '29 август 2025, 12:10' → '29 август 2025 в 12:10' */
const at = (dateTime: string) => dateTime.replace(/,\s*(\d{1,2}:\d{2})$/, ' в $1');

/** role / roleScope / roleDescription come from the role picked in Екип; url accepts the invitation. */
type InviteVars = {
  inviterName: string; inviterRole: string; role: string; roleScope: string; roleDescription: string;
  email: string; url: string;
};
export const teamInvite: EmailTemplate<InviteVars> = {
  key: 'team-invite', audience: 'team', optional: false,
  render: v => ({
    subject: `Покана в екипа на EventAT от ${v.inviterName}`,
    preheader: `Ролята ви е ${v.role}, а паролата си избирате при първото влизане.`,
    trigger: 'Покана в екипа',
    heading: 'Покана в екипа на EventAT',
    paragraphs: [
      `${v.inviterName} ви кани в панела на EventAT с роля ${v.role}.`,
      v.roleDescription,
      `Влизате с ${v.email} и си избирате парола при първото влизане.`,
    ],
    details: [
      ['Роля', `${v.role} · ${v.roleScope}`],
      ['Имейл за вход', v.email],
      ['Покана от', `${v.inviterName} · ${v.inviterRole}`],
    ],
    cta: { label: 'Приеми поканата', href: v.url },
  }),
};

/**
 * stepsDone / stepsTotal: how much of the profile is complete. bankPending: the payout account still
 * waits for the bank's confirmation (adds the paragraph about it). priceFrom / priceTo: package range.
 */
type VendorApplicationVars = {
  partnerId: string; partnerName: string; partnerLegalName: string; category: string; city: string; contactName: string;
  submittedOn: string; stepsDone: number; stepsTotal: number; bankPending: boolean;
  packages: number; priceFrom: string; priceTo: string;
};
export const teamVendorApplication: EmailTemplate<VendorApplicationVars> = {
  key: 'team-vendor-application', audience: 'team', optional: false,
  render: v => ({
    subject: `Нова заявка за одобрение: ${v.partnerName}`,
    preheader: `${v.category} ${inAt(v.city)}, профил ${v.stepsDone} от ${v.stepsTotal} — целта е преглед до 24 часа.`,
    trigger: 'Нова заявка от изпълнител',
    heading: 'Нова заявка от изпълнител',
    paragraphs: [
      `${v.partnerName} подаде профила си за одобрение. Вътрешната ни цел е преглед до 24 часа, а на изпълнителя обещаваме отговор до 48 часа.`,
      ...(v.bankPending
        ? ['Остава една проверка: банковата сметка чака потвърждение от банката. Може да одобрите профила и без нея — изплащанията тръгват след потвърждението ѝ.']
        : []),
    ],
    details: [
      ['Изпълнител', v.partnerLegalName],
      ['Категория', `${v.category} · ${v.city}`],
      ['Лице за контакт', v.contactName],
      ['Подадена', v.submittedOn],
      ['Профил', `${v.stepsDone} от ${v.stepsTotal}`],
      ['Пакети', `${v.packages} · от ${v.priceFrom} до ${v.priceTo}`],
    ],
    cta: { label: 'Прегледай заявката', href: `/admin/partnyori/${v.partnerId}` },
  }),
};

/**
 * openerName / otherName: who opened the ticket and the other side. claim: the reason in running text
 * ('услугата не е по описание'); summary: what happened and what the opener wants (sentences after the first).
 */
type DisputeNewVars = {
  caseId: string; bookingNo: string; openerName: string; otherName: string; clientName: string; partnerName: string;
  claim: string; summary: string; reason: string; heldAmount: string;
  eventType: string; eventDate: string; venue: string; openedAt: string;
};
export const teamDisputeNew: EmailTemplate<DisputeNewVars> = {
  key: 'team-dispute-new', audience: 'team', optional: false,
  render: v => ({
    subject: `Нов сигнал по резервация ${v.bookingNo} · ${v.partnerName}`,
    preheader: `${v.openerName} сигнализира, че ${v.claim} — обещахме отговор до 24 часа.`,
    trigger: 'Нов сигнал по резервация',
    heading: 'Нов сигнал по резервация',
    paragraphs: [
      `${v.openerName} отвори сигнал по резервация ${v.bookingNo} при ${v.otherName}. ${v.summary}`,
      `Изплащането към ${v.partnerName} е спряно и ${v.heldAmount} остават задържани до решението. Обещахме на клиента отговор до 24 часа — поискайте позицията на ${v.otherName} със срок 48 часа.`,
    ],
    details: [
      ['Резервация', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.eventDate} · ${v.venue}`],
      ['Страни', `${v.clientName} ↔ ${v.partnerName}`],
      ['Причина', v.reason],
      ['Задържани', v.heldAmount],
      ['Подаден', v.openedAt],
    ],
    cta: { label: 'Отвори кейса', href: `/admin/sporove/${v.caseId}` },
  }),
};

/**
 * responderName replied to openerName's ticket. summary: the reply and what each side asks for.
 * photoCount: files attached to the reply.
 */
type DisputeReplyVars = {
  caseId: string; caseNo: string; responderName: string; openerName: string; clientName: string; partnerName: string;
  summary: string; topic: string; eventType: string; eventDate: string; repliedAt: string; photoCount: number; heldAmount: string;
};
export const teamDisputeReply: EmailTemplate<DisputeReplyVars> = {
  key: 'team-dispute-reply', audience: 'team', optional: false,
  render: v => ({
    subject: `${v.responderName} отговори · кейс ${v.caseNo} чака решение`,
    preheader: `Двете позиции са събрани, а ${v.heldAmount} остават задържани до решението.`,
    trigger: 'Отговор на другата страна по сигнал',
    heading: 'Кейсът чака вашето решение',
    paragraphs: [
      `${v.responderName} отговори по сигнала на ${v.openerName}. ${v.summary}`,
      `Двете позиции са събрани и кейсът чака вашето решение. Изплащането към ${v.partnerName} е спряно, а ${v.heldAmount} остават задържани.`,
    ],
    details: [
      ['Кейс', v.caseNo],
      ['Сигнал', v.topic],
      ['Събитие', `${v.eventType} · ${v.eventDate}`],
      ['Страни', `${v.clientName} ↔ ${v.partnerName}`],
      ['Отговор', v.photoCount > 0 ? `${v.repliedAt} · ${pl(v.photoCount, 'снимка', 'снимки')}` : v.repliedAt],
      ['Задържани', v.heldAmount],
    ],
    cta: { label: 'Отвори кейса', href: `/admin/sporove/${v.caseId}` },
  }),
};

/**
 * silentName: the side that did not answer in time. requestedAt / deadline: '29 август 2025, 12:10'.
 * options: the sentence listing the possible decisions, written for the case.
 */
type DisputeDeadlineVars = {
  caseId: string; caseNo: string; silentName: string; clientName: string; partnerName: string;
  requestedAt: string; deadline: string; options: string; heldAmount: string;
};
export const teamDisputeDeadline: EmailTemplate<DisputeDeadlineVars> = {
  key: 'team-dispute-deadline', audience: 'team', optional: false,
  render: v => ({
    subject: `${v.silentName} не отговори в срок · кейс ${v.caseNo}`,
    preheader: 'Срокът от 48 часа изтече и кейсът чака вашето решение.',
    trigger: 'Изтекъл срок за позиция по сигнал',
    heading: 'Срокът за позиция изтече',
    paragraphs: [
      `Поискахме позиция от ${v.silentName} на ${at(v.requestedAt)}. Срокът от 48 часа изтече на ${at(v.deadline)} без отговор.`,
      `Кейсът чака вашето решение. ${v.options}`,
    ],
    details: [
      ['Кейс', v.caseNo],
      ['Страни', `${v.clientName} ↔ ${v.partnerName}`],
      ['Поискана позиция', v.requestedAt],
      ['Срок', v.deadline],
      ['Задържани', v.heldAmount],
    ],
    cta: { label: 'Вземи решение', href: `/admin/sporove/${v.caseId}` },
  }),
};

/**
 * Sent only when the booking has an open dispute. disputeTopic: 'за цената'; disputeSummary: the sentence
 * after „По резервацията има отворен спор:“. extraHours: the extension the button grants (24).
 * clientShortName: the client as named in running text ('Технолинк' for 'Технолинк ЕООД').
 */
type PaymentDeadlineVars = {
  caseId: string; bookingNo: string; hoursLeft: number; extraHours: number; clientName: string; clientShortName: string;
  partnerName: string; disputeTopic: string; disputeSummary: string; eventType: string; eventDate: string; location: string;
  approvedAmount: string; payNowAmount: string; payBy: string;
};
export const teamPaymentDeadline: EmailTemplate<PaymentDeadlineVars> = {
  key: 'team-payment-deadline', audience: 'team', optional: false,
  render: v => ({
    subject: `Срокът за плащане по резервация ${v.bookingNo} изтича след ${pl(v.hoursLeft, 'час', 'часа')}`,
    preheader: `Има отворен спор ${v.disputeTopic} — удължете срока, за да не се освободи датата.`,
    trigger: 'Срок за плащане по резервация с отворен спор',
    heading: 'Срокът за плащане изтича',
    paragraphs: [
      `Срокът на ${v.clientName} да плати резервация ${v.bookingNo} при ${v.partnerName} изтича след ${pl(v.hoursLeft, 'час', 'часа')}. След това датата се освобождава автоматично.`,
      `По резервацията има отворен спор: ${v.disputeSummary} Удължете срока с ${v.extraHours} часа, за да не изгуби ${v.clientShortName} датата, докато решите.`,
    ],
    details: [
      ['Резервация', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.eventDate} · ${v.location}`],
      ['Страни', `${v.clientName} ↔ ${v.partnerName}`],
      ['Одобрено', v.approvedAmount],
      ['За плащане сега', v.payNowAmount],
      ['Срок за плащане', v.payBy],
    ],
    cta: { label: 'Удължи срока', href: `/admin/sporove/${v.caseId}` },
  }),
};

/** eventTypeDefinite: 'сватбата'; timeRange: '17:00 – 02:00'; contactName / partnerPhone: the partner's contact. */
type VendorCancelVars = {
  bookingId: string; bookingNo: string; partnerName: string; contactName: string; partnerPhone: string;
  clientName: string; clientPhone: string; eventType: string; eventTypeDefinite: string; eventDate: string; timeRange: string;
  location: string; packageName: string; paid: string; paidOn: string;
};
export const teamVendorCancel: EmailTemplate<VendorCancelVars> = {
  key: 'team-vendor-cancel', audience: 'team', optional: false,
  render: v => ({
    subject: `${v.partnerName} иска да анулира резервация ${v.bookingNo}`,
    preheader: `Свържете се с ${v.clientName} и освободете датата ${v.eventDate}.`,
    trigger: 'Искане за анулиране от изпълнител',
    heading: 'Искане за анулиране от изпълнител',
    paragraphs: [
      `${v.partnerName} поиска да анулира резервация ${v.bookingNo} за ${v.eventTypeDefinite} на ${v.clientName} на ${v.eventDate}.`,
      `Свържете се с клиента и освободете датата. Клиентът е платил ${v.paid} на ${v.paidOn} и сумата стои задържана в платформата.`,
    ],
    details: [
      ['Резервация', v.bookingNo],
      ['Събитие', `${v.eventType} · ${v.eventDate}, ${v.timeRange}`],
      ['Място', v.location],
      ['Услуга', `Пакет „${v.packageName}“`],
      ['Клиент', `${v.clientName} · ${v.clientPhone}`],
      ['Изпълнител', `${v.partnerName} · ${v.contactName} · ${v.partnerPhone}`],
      ['Платено', `${v.paid} на ${v.paidOn}`],
    ],
    cta: { label: 'Отвори резервацията', href: `/admin/rezervacii/${v.bookingId}` },
  }),
};

/** previousIbanLast4 / previousBank: the account being replaced. heldAmount: money held for upcoming events. */
type PayoutAccountVars = {
  partnerName: string; partnerLegalName: string; eik: string; previousIbanLast4: string; previousBank: string; heldAmount: string;
};
export const teamPayoutAccount: EmailTemplate<PayoutAccountVars> = {
  key: 'team-payout-account', audience: 'team', optional: false,
  render: v => ({
    subject: `${v.partnerName} смени сметката за изплащане`,
    preheader: 'Изплащанията са спрени до проверката, която отнема до два работни дни.',
    trigger: 'Смяна на сметката за изплащане',
    heading: 'Нова сметка за проверка',
    paragraphs: [
      `${v.partnerName} подаде нова сметка за изплащане с документ от банката. Сметката трябва да е на името на ${v.partnerLegalName} — проверете IBAN и титуляря в документа.`,
      `До потвърждението изплащанията към изпълнителя са спрени, а задържаните ${v.heldAmount} остават заделени за него. Обещахме проверка до два работни дни.`,
    ],
    details: [
      ['Изпълнител', v.partnerLegalName],
      ['ЕИК', v.eik],
      ['Досегашна сметка', `IBAN ···${v.previousIbanLast4} · ${v.previousBank}`],
      ['Задържани суми', v.heldAmount],
      ['Срок за проверка', 'до два работни дни'],
    ],
    cta: { label: 'Провери сметката', href: '/admin/plashtaniya' },
  }),
};

/**
 * Counts of open tasks. oldestWaitDays: how long the oldest partner application waits.
 * urgent: the case that needs a decision first (its paragraph is left out when there is none).
 */
type DailyDigestVars = {
  totalTasks: number; approvals: number; oldestWaitDays: number;
  moderation: number; newServices: number; edits: number;
  disputes: number; disputesHeld: string;
  urgent?: { caseNo: string; clientName: string; partnerName: string; heldAmount: string };
};
export const teamDailyDigest: EmailTemplate<DailyDigestVars> = {
  key: 'team-daily-digest', audience: 'team', optional: false,
  render: v => {
    const days = pl(v.oldestWaitDays, 'ден', 'дни');
    return {
      subject: `Изисква вашето внимание: ${pl(v.totalTasks, 'задача', 'задачи')} в панела`,
      preheader: `${pl(v.approvals, 'изпълнител', 'изпълнители')} за одобрение, ${pl(v.moderation, 'обява', 'обяви')} за модерация, ${pl(v.disputes, 'отворен спор', 'отворени спора')}.`,
      trigger: 'Дневен преглед на задачите',
      heading: 'Изисква вашето внимание',
      paragraphs: [
        `В панела има ${pl(v.totalTasks, 'отворена задача', 'отворени задачи')}. Най-старата заявка от изпълнител чака от ${days} при цел от 24 часа.`,
        ...(v.urgent
          ? [`Най-спешен е кейс ${v.urgent.caseNo} между ${v.urgent.clientName} и ${v.urgent.partnerName} — чака решение, а ${v.urgent.heldAmount} са задържани.`]
          : []),
      ],
      details: [
        ['Изпълнители за одобрение', `${v.approvals} · най-старата чака от ${days}`],
        ['Обяви за модерация', `${v.moderation} · ${pl(v.newServices, 'нова услуга', 'нови услуги')} и ${pl(v.edits, 'редакция', 'редакции')}`],
        ['Отворени спорове', `${v.disputes} · ${v.disputesHeld} задържани`],
      ],
      cta: { label: 'Отвори таблото', href: '/admin' },
    };
  },
};

/**
 * batchDate: '1 септември 2025'; bank: 'Обединена банка'. held: a partner whose payout stays held
 * because of a dispute (its paragraph and row are left out when there is none).
 */
type BatchReadyVars = {
  batchDate: string; partnerCount: number; total: string; bank: string;
  held?: { partnerName: string; amount: string };
};
export const teamBatchReady: EmailTemplate<BatchReadyVars> = {
  key: 'team-batch-ready', audience: 'team', optional: false,
  render: v => ({
    subject: `Партидата за ${v.batchDate} е готова за пускане`,
    preheader: `${pl(v.partnerCount, 'изпълнител', 'изпълнители')} · ${v.total} за превод през ${v.bank}.`,
    trigger: 'Партидата е готова за пускане',
    heading: 'Партидата е готова',
    paragraphs: [
      `Партидата за ${v.batchDate} е готова: ${pl(v.partnerCount, 'изпълнител', 'изпълнители')}, чиито събития са минали, и ${v.total} за превод.`,
      ...(v.held
        ? [`${v.held.partnerName} има спор по една от резервациите си, затова ${v.held.amount} към него остават задържани до решението.`]
        : []),
      'Прегледайте сумите и пуснете партидата към банката.',
    ],
    details: [
      ['Дата на партидата', v.batchDate],
      ['Изпълнители', String(v.partnerCount)],
      ['За превод', v.total],
      ...(v.held ? [['Задържани по спор', `${v.held.amount} · ${v.held.partnerName}`] as [string, string]] : []),
      ['Банка', `${v.bank} · SEPA`],
    ],
    cta: { label: 'Прегледай партидата', href: '/admin/plashtaniya' },
  }),
};

/** batchName: 'август · първа половина'; nextBatchDate: '1 септември 2025'. */
type BatchPaidVars = {
  batchName: string; paidOn: string; partnerCount: number; total: string; bank: string; nextBatchDate: string;
};
export const teamBatchPaid: EmailTemplate<BatchPaidVars> = {
  key: 'team-batch-paid', audience: 'team', optional: false,
  render: v => ({
    subject: `Партида ${v.batchName} е изплатена`,
    preheader: `${pl(v.partnerCount, 'изпълнител', 'изпълнители')} · ${v.total} · ${v.paidOn}.`,
    trigger: 'Партидата е изплатена',
    heading: 'Партидата е изплатена',
    paragraphs: [
      `Партида ${v.batchName} е изплатена през ${v.bank}. Сумите са преведени на ${pl(v.partnerCount, 'изпълнител', 'изпълнители')}.`,
      `Следващата партида тръгва на ${v.nextBatchDate}.`,
    ],
    details: [
      ['Партида', cap(v.batchName)],
      ['Дата', v.paidOn],
      ['Изпълнители', String(v.partnerCount)],
      ['Сума', v.total],
      ['Банка', `${v.bank} · SEPA`],
    ],
    cta: { label: 'Виж плащанията', href: '/admin/plashtaniya' },
  }),
};

type BatchReportVars = { batchName: string; paidOn: string; partnerCount: number; total: string; bank: string };
export const teamBatchReport: EmailTemplate<BatchReportVars> = {
  key: 'team-batch-report', audience: 'team', optional: false,
  render: v => ({
    subject: `Отчетът за партида ${v.batchName} е готов`,
    preheader: `${v.paidOn} · ${pl(v.partnerCount, 'изпълнител', 'изпълнители')} · ${v.total}.`,
    trigger: 'Отчет за партида',
    heading: 'Отчетът е готов',
    paragraphs: [
      `Отчетът, който поискахте за партида ${v.batchName}, е готов за сваляне.`,
      `Партидата е изплатена на ${v.paidOn} през ${v.bank} към ${pl(v.partnerCount, 'изпълнител', 'изпълнители')}.`,
    ],
    details: [
      ['Партида', cap(v.batchName)],
      ['Дата', v.paidOn],
      ['Изпълнители', String(v.partnerCount)],
      ['Сума', v.total],
    ],
    cta: { label: 'Свали отчета', href: '/admin/plashtaniya' },
  }),
};

/** reason: the bank's reason as shown in the row ('Сметката е закрита'). */
type TransferFailedVars = {
  partnerName: string; amount: string; ibanLast4: string; batchDate: string; bank: string; reason: string;
};
export const teamTransferFailed: EmailTemplate<TransferFailedVars> = {
  key: 'team-transfer-failed', audience: 'team', optional: false,
  render: v => ({
    subject: `Преводът към ${v.partnerName} е върнат от банката`,
    preheader: `${v.amount} от партидата на ${v.batchDate} не са преведени.`,
    trigger: 'Неуспешен превод към изпълнител',
    heading: 'Неуспешен превод',
    paragraphs: [
      `${v.bank} върна превода към ${v.partnerName} от партидата на ${v.batchDate}. Причина от банката: ${low(v.reason)}.`,
      `Сумата от ${v.amount} остава в платформата. Поискайте от изпълнителя нова сметка — до потвърждението ѝ нищо не се превежда.`,
    ],
    details: [
      ['Изпълнител', v.partnerName],
      ['Сума', v.amount],
      ['Сметка', `IBAN ···${v.ibanLast4}`],
      ['Партида', `${v.batchDate} · ${v.bank}`],
      ['Причина', v.reason],
    ],
    cta: { label: 'Отвори плащанията', href: '/admin/plashtaniya' },
  }),
};
