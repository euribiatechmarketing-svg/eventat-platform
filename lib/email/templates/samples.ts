// Sample variables for every email: rendering a template with its sample reproduces the prototype's
// example in emails/emails.js (only CTA hrefs differ — they point to production routes).
// Used by the admin email preview (Админ → Имейли) and by tests/emails.test.ts.
// Ids and slugs (bookingId, partnerSlug, …) are only used in CTA links.
import type { EmailTemplate } from '../types';
import * as auth from './auth';
import * as client from './client';
import * as partner from './partner';
import * as team from './team';

const entries: [string, Record<string, unknown>][] = [];
/** Type-checks the sample against the template's own Vars. */
function sample<V>(t: EmailTemplate<V>, vars: NoInfer<V>): void {
  entries.push([t.key, vars as unknown as Record<string, unknown>]);
}

// Canonical prototype facts (eventat-app/CLAUDE.md › Canonical facts)
const maria = { clientName: 'Мария Димитрова', email: 'maria.dimitrova@gmail.com', phone: '+359 88 412 7730' };
const melodia = {
  partnerName: 'Студио Мелодия', partnerLegalName: 'Студио Мелодия ЕООД', partnerCategory: 'DJ и озвучаване',
  partnerSlug: 'studio-melodiya', contactName: 'Мартин Стоянов', email: 'studio.melodia@gmail.com', phone: '+359 88 123 4567',
};
const wedding = {
  bookingId: '2026-0614-ЕА', bookingNo: '2026-0614-ЕА', requestId: '2026-0614-ЕА', requestNo: '2026-0614-ЕА',
  eventType: 'Сватба', eventTypeDefinite: 'сватбата', eventDate: '14 юни 2026', eventWeekday: 'неделя', eventTime: '17:00',
  location: 'Вила Екатерина, с. Панчарево', guests: 120, hosts: 'Мария и Стефан', packageName: 'Цял ден',
  amount: '1 450,00 €', partnerAmount: '1 305,00 €', replyBy: '13 август 2025, 09:24', payBy: '13 август 2025, 11:06',
};

// ── Auth ───────────────────────────────────────────────────────────────────
sample(auth.clientVerifyCode, { code: '482917', email: maria.email });
sample(auth.clientPasswordLink, { url: '/zabravena-parola', email: maria.email });
sample(auth.vendorVerifyCode, { code: '482917', email: melodia.email, partnerName: melodia.partnerName, contactName: melodia.contactName });
sample(auth.vendorPasswordReset, { url: '/zabravena-parola', email: melodia.email, partnerName: melodia.partnerName });

// ── Client ─────────────────────────────────────────────────────────────────
sample(client.clientWelcome, { clientName: maria.clientName, email: maria.email, phone: maria.phone, registeredOn: '12 март 2025' });
sample(client.clientPasswordChanged, { email: maria.email, changedOn: '9 август 2025' });
sample(client.client2faOn, { email: maria.email, phone: maria.phone });
sample(client.clientSignoutAll, { email: maria.email, sessions: [{ device: 'MacBook', city: 'София' }, { device: 'iPhone', city: 'София' }] });
sample(client.clientDeleteConfirm, { email: maria.email, url: '/akaunt/nastroyki' });
sample(client.clientRequestSent, {
  requestId: wedding.requestId, requestNo: wedding.requestNo,
  partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory, packageName: wedding.packageName,
  eventType: wedding.eventType, guests: wedding.guests, eventDate: wedding.eventDate, eventTime: wedding.eventTime,
  location: wedding.location, photoCount: 3, amount: wedding.amount, replyBy: wedding.replyBy,
});
sample(client.clientBriefSent, {
  services: 'Фотография', eventType: 'Сватба', eventDate: wedding.eventDate, city: 'София', guests: 120, phone: maria.phone,
});
sample(client.clientOfferReceived, {
  requestId: '2026-1219-КТ', requestNo: '2026-1219-КТ',
  partnerName: 'Вкусна История', partnerCategory: 'Кетъринг', offerTitle: 'Коледно меню за 40 гости', amount: '1 980,00 €',
  eventType: 'Коледно парти', eventTypeDefinite: 'коледното парти', eventDate: '19 декември 2026', location: 'Ресторант „Виа Верде“, София',
});
sample(client.clientRequestApproved, {
  bookingId: wedding.bookingId, requestNo: wedding.requestNo,
  partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory, packageName: wedding.packageName,
  eventType: wedding.eventType, eventDate: wedding.eventDate, eventTime: wedding.eventTime,
  amount: wedding.amount, payBy: wedding.payBy, payHours: 24,
});
sample(client.clientPaymentReminder, {
  bookingId: wedding.bookingId, requestNo: wedding.requestNo, hoursLeft: 6,
  partnerName: melodia.partnerName, packageName: wedding.packageName, eventDate: wedding.eventDate, amount: wedding.amount, payBy: wedding.payBy,
});
sample(client.clientPaymentExpired, {
  partnerSlug: 'flora-studio', requestNo: '2026-1219-ДК',
  partnerName: 'Флора Студио', partnerCategory: 'Декорация', serviceName: 'Коледна украса на залата и масите',
  eventType: 'Коледно парти', eventDate: '19 декември 2026', amount: '460,00 €',
});
sample(client.clientRequestDeclined, {
  requestNo: '2026-0614-ФТ', partnerName: 'Ана Петрова Photography', partnerCategory: 'Фотография', serviceName: 'Цял ден с втори фотограф',
  eventType: 'Сватба', eventDate: wedding.eventDate, reason: 'Датата е заета', amount: '1 900,00 €',
});
sample(client.clientRequestExpired, {
  requestNo: '2026-0614-ДК', partnerName: 'Флора Студио', partnerCategory: 'Декорация', serviceName: 'Арка, маси и букет',
  eventType: 'Сватба', eventDate: wedding.eventDate, amount: '1 180,00 €',
});
sample(client.clientApprovalWithdrawn, {
  requestNo: wedding.requestNo, partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory,
  packageName: wedding.packageName, eventType: wedding.eventType, eventDate: wedding.eventDate,
});
sample(client.clientBankTransfer, {
  requestId: wedding.requestId, requestNo: wedding.requestNo, partnerName: melodia.partnerName,
  amount: wedding.amount, recipient: 'EventAT', iban: 'BG80 BNBG 9661 1020 3456 78', payBy: wedding.payBy,
});
sample(client.clientBookingConfirmed, {
  bookingId: wedding.bookingId, bookingNo: wedding.bookingNo,
  partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory, packageName: wedding.packageName,
  packageSummary: 'DJ, озвучаване и осветление',
  eventDate: wedding.eventDate, eventWeekday: wedding.eventWeekday, eventTime: wedding.eventTime, location: wedding.location, guests: wedding.guests,
  amount: wedding.amount, paymentMethod: 'Visa •••• 4242', phone: maria.phone, freeCancelUntil: '15 май 2026',
});
sample(client.clientInvoice, {
  bookingId: wedding.bookingId, bookingNo: wedding.bookingNo, invoiceNo: '0000000412', issuedOn: '12 август 2025',
  partnerLegalName: melodia.partnerLegalName, partnerEik: '204512389', recipientName: maria.clientName,
  packageName: wedding.packageName, partnerCategory: melodia.partnerCategory, amount: wedding.amount, paymentMethod: 'Visa •••• 4242',
});
sample(client.clientNewMessage, {
  partnerName: melodia.partnerName,
  message: 'Очакваме го. Ако има песни, които не искате да звучат, добавете ги в отделен списък — няма да ги пускаме.',
  preview: 'Очакваме го. Ако има песни, които не искате да звучат, добавете ги в отделен списък…',
  eventType: wedding.eventType, eventDate: wedding.eventDate, packageName: wedding.packageName, location: wedding.location,
  receivedAt: '31 август 2025, 11:42',
});
sample(client.clientEventReminder, {
  daysLeft: 7, eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite, eventDate: wedding.eventDate, location: wedding.location,
  bookings: [
    { partnerName: 'Квартет „Адажио“', service: 'Церемония и коктейл', time: '16:00' },
    { partnerName: 'Студио Мелодия', service: 'Пакет „Цял ден“', time: '17:00' },
    { partnerName: 'Snap360', service: 'Фотокабина, 4 часа', time: '20:00' },
  ],
  guests: wedding.guests,
});
sample(client.clientCancelConfirmed, {
  bookingNo: wedding.bookingNo, partnerName: melodia.partnerName, packageName: wedding.packageName,
  eventType: wedding.eventType, eventDate: wedding.eventDate, policyName: 'Умерена', freeCancelUntil: '15 май 2026',
  paid: wedding.amount, refund: wedding.amount, kept: '0,00 €', cardLast4: '4242',
});
sample(client.clientVendorCancelled, {
  bookingNo: wedding.bookingNo, partnerName: melodia.partnerName, packageName: wedding.packageName,
  eventType: wedding.eventType, eventDate: wedding.eventDate, refund: wedding.amount, cardLast4: '4242', paymentMethod: 'Visa •••• 4242',
});
sample(client.clientDisputeOpened, {
  bookingNo: '2026-0614-ФК', partnerName: 'Snap360', serviceName: 'Фотокабина, 4 часа с оператор и реквизит',
  eventType: 'Сватба', eventDate: wedding.eventDate, problem: 'Услугата не беше по описание',
  openedAt: '29 август 2025, 11:30', heldAmount: '560,00 €',
});
sample(client.clientDisputeInfoRequest, { bookingNo: '2026-0614-ФК', partnerName: 'Snap360', topic: 'Обхватът е по-малък от обявения' });
sample(client.clientDisputeDecision, {
  bookingId: '2026-0614-ФК', bookingNo: '2026-0614-ФК', partnerName: 'Snap360', serviceName: 'Фотокабина · 4 часа с оператор и реквизит',
  eventType: 'Сватба', eventDate: wedding.eventDate, venue: 'Вила Екатерина',
  summary: 'Snap360 трябва да осигури фотокабината за 4 часа, както е платено.',
  decision: 'Snap360 трябва да осигури фотокабината за 4 часа — от 20:00 до 24:00, както е платено.',
  motive: 'резервацията е за 4 часа с оператор и реквизит, от 20:00 до 24:00, и е платена изцяло. Предложените 3 часа, от 20:00 до 23:00, не отговарят на нея.',
  decisionShort: '4 часа, 20:00–24:00', heldAmount: '560,00 €', heldUntil: '15 юни 2026',
});
sample(client.clientReviewInvite, {
  bookingId: 'med-i-myako-2025-0424', partnerName: 'Сладкарница „Мед и мляко“', partnerCategory: 'Торта и десерти',
  eventType: 'Годишнина', eventTypeDefinite: 'годишнината', eventDate: '24 април 2025',
  location: 'Ресторант „Стария бряст“, София', guests: 40, amount: '380,00 €',
});
sample(client.clientSavedSearchAlert, {
  newCount: 2, eventDate: wedding.eventDate,
  search: 'Изпълнители за сватба · София · 14 юни 2026 · 120 гости',
  summary: 'Изпълнители за сватба · София · 120 гости · рейтинг 4,5 и нагоре',
  filters: 'Всички услуги · свободни на датата · рейтинг 4,5 и нагоре', totalCount: 29,
});
sample(client.clientDateFreed, {
  partnerSlug: 'ana-petrova-photography', partnerName: 'Ана Петрова Photography', partnerCategory: 'Фотография',
  eventType: 'Сватба', eventDate: wedding.eventDate, watchingSince: '10 август 2025',
});
sample(client.clientPaymentExtended, {
  bookingId: '2026-0621-ТЛ', requestNo: '2026-0621-ТЛ', extraHours: 24,
  partnerName: 'Вкусна История', partnerCategory: 'Кетъринг', eventType: 'Фирмено събитие', eventDate: '21 юни 2026',
  location: 'София Тех Парк', newDeadline: '1 септември 2025, 18:20',
});
sample(client.clientTicketVendorOpened, {
  bookingNo: '2026-0630-АБ', partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory, packageName: 'Вечер',
  eventType: 'Абитуриентски бал', eventTypeDefinite: 'абитуриентския бал', eventDate: '30 юни 2026', location: 'Хотел „Маринела“',
  reason: 'Клиентът не отговаря',
  reasonDetail: 'изпълнителят иска да уточни програмата и часа за саундчек с хотел „Маринела“',
  ask: 'ни дайте контакт с отговорното лице', replyBy: '1 септември 2025, 16:30',
});
sample(client.clientTicketReminder, {
  bookingNo: '2026-0630-АБ', partnerName: melodia.partnerName, eventTypeDefinite: 'абитуриентския бал', eventDate: '30 юни 2026',
  reason: 'Клиентът не отговаря',
  need: 'Изпълнителят иска само контакт с отговорното лице, за да уточни програмата и часа за саундчек с хотел „Маринела“.',
  replyBy: '1 септември 2025, 16:30',
});
sample(client.clientRefundSent, {
  bookingNo: wedding.bookingNo, partnerName: melodia.partnerName, packageName: wedding.packageName, eventDate: wedding.eventDate,
  paid: wedding.amount, paidOn: '12 август 2025', refund: wedding.amount, cardLast4: '4242', paymentMethod: 'Visa •••• 4242',
  policyDefinite: 'умерената',
});
sample(client.clientAccountBlocked, { clientName: maria.clientName, accountType: 'частно лице', email: maria.email });
sample(client.clientReviewReply, {
  partnerSlug: melodia.partnerSlug, partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory,
  eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite, packageName: wedding.packageName,
  reply: 'Благодаря ви! Беше удоволствие — пожелавам ви много поводи за танци занапред.',
});

// ── Partner ────────────────────────────────────────────────────────────────
sample(partner.vendorWelcome, { partnerName: melodia.partnerName, contactName: melodia.contactName, email: melodia.email, phone: melodia.phone });
sample(partner.vendorApplicationReceived, {
  partnerSlug: melodia.partnerSlug, partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory, city: 'София',
  contactName: melodia.contactName, email: melodia.email, packages: 2, onRequest: 1,
  availability: 'Една резервация на ден', policy: 'Умерена · депозит 30%', submittedAt: '31 август 2025, 16:38',
});
sample(partner.vendorApplicationApproved, {
  partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory, city: 'София', radiusKm: 150,
  packages: 2, onRequest: 1, policyName: 'Умерена',
});
sample(partner.vendorApplicationReturned, {
  partnerName: melodia.partnerName,
  note: 'Една от снимките в галерията е с чужд воден знак. Заменете я със собствен кадър от ваше събитие.',
  submittedAt: '31 август 2025, 16:38',
});
sample(partner.vendorApplicationRejected, {
  partnerName: melodia.partnerName, eik: '204512389',
  reason: 'ЕИК 204512389 не съвпада с данните в Търговския регистър.', submittedAt: '31 август 2025, 16:38',
});
sample(partner.vendorServiceSubmitted, {
  serviceName: 'Пакет „Церемония“', serviceKind: 'Пакет с фиксирана цена', category: 'DJ и озвучаване', price: '420,00 €', duration: 'До 3 часа',
});
sample(partner.vendorServicePublished, {
  partnerSlug: melodia.partnerSlug, partnerName: melodia.partnerName, serviceName: 'Пакет „Церемония“', price: '420,00 €', duration: 'До 3 часа',
});
sample(partner.vendorServiceReturned, {
  serviceId: 'paket-ceremoniya', serviceName: 'Пакет „Церемония“',
  note: 'Корицата е с чужд воден знак. Изберете собствен кадър от подобно събитие.',
});
sample(partner.vendorServiceChangeSubmitted, { serviceName: 'Пакет „Цял ден“', serviceKind: 'Пакет с фиксирана цена' });
sample(partner.vendorServiceChangeApproved, { partnerSlug: melodia.partnerSlug, serviceName: 'Пакет „Цял ден“' });
sample(partner.vendorNewRequest, {
  requestId: wedding.requestId, requestNo: wedding.requestNo, clientName: maria.clientName,
  eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite, eventDate: wedding.eventDate, eventWeekday: wedding.eventWeekday,
  timeRange: '17:00 – около 02:00', guests: wedding.guests, location: wedding.location, packageName: wedding.packageName,
  partnerAmount: wedding.partnerAmount, replyBy: wedding.replyBy, attached: 'бележка и три снимки за вдъхновение',
});
sample(partner.vendorNewInquiry, {
  requestId: 'tehnolink-2026-0621', clientName: 'Технолинк ЕООД', eventType: 'Фирмено събитие', eventDate: '21 юни 2026',
  guests: 250, location: 'София Тех Парк', need: 'озвучаване за тиймбилдинг вечер', serviceName: 'Фирмени събития',
});
sample(partner.vendorRequestReminder, {
  requestId: wedding.requestId, requestNo: wedding.requestNo, hoursLeft: 6, clientName: maria.clientName,
  eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite, eventDate: wedding.eventDate,
  packageName: wedding.packageName, partnerAmount: wedding.partnerAmount, replyBy: wedding.replyBy,
});
sample(partner.vendorRequestApproved, {
  requestId: wedding.requestId, requestNo: wedding.requestNo, clientName: maria.clientName,
  eventType: wedding.eventType, eventDate: wedding.eventDate, packageName: wedding.packageName,
  partnerAmount: wedding.partnerAmount, payBy: wedding.payBy,
});
sample(partner.vendorPaymentReminder, {
  requestId: wedding.requestId, requestNo: wedding.requestNo, hoursLeft: 6, clientName: maria.clientName,
  eventType: wedding.eventType, eventDate: wedding.eventDate, packageName: wedding.packageName, payBy: wedding.payBy,
});
sample(partner.vendorPaymentDeadlineExtended, {
  requestId: wedding.requestId, requestNo: wedding.requestNo, extraHours: 24, clientName: maria.clientName,
  eventType: wedding.eventType, eventDate: wedding.eventDate,
  previousDeadline: '13 август 2025, 11:06', newDeadline: '14 август 2025, 11:06',
});
sample(partner.vendorHoldExpired, {
  requestNo: wedding.requestNo, clientName: maria.clientName, eventType: wedding.eventType, eventDate: wedding.eventDate,
  packageName: wedding.packageName, expiredAt: '13 август 2025, 11:06',
});
sample(partner.vendorBookingConfirmed, {
  bookingId: wedding.bookingId, bookingNo: wedding.bookingNo, clientName: maria.clientName, clientPhone: maria.phone,
  eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite, hosts: wedding.hosts,
  eventDate: wedding.eventDate, eventWeekday: wedding.eventWeekday, timeRange: '17:00 – 02:00',
  location: wedding.location, guests: wedding.guests, packageName: wedding.packageName,
  partnerAmount: wedding.partnerAmount, payoutDate: '15 юни 2026', freeCancelUntil: '15 май 2026',
});
sample(partner.vendorEventReminder, {
  bookingNo: wedding.bookingNo, daysLeft: 7, eventTypeDefinite: wedding.eventTypeDefinite, hosts: wedding.hosts,
  eventDate: wedding.eventDate, eventWeekday: wedding.eventWeekday, timeRange: '17:00 – 02:00',
  venue: 'Вила Екатерина', location: wedding.location, guests: wedding.guests, packageName: wedding.packageName,
  clientPhone: maria.phone, partnerAmount: wedding.partnerAmount, payoutDate: '15 юни 2026',
});
sample(partner.vendorClientCancelled, {
  bookingNo: wedding.bookingNo, clientName: maria.clientName, eventType: wedding.eventType, hosts: wedding.hosts,
  eventDate: wedding.eventDate, packageName: wedding.packageName, policyDefinite: 'умерената', freeCancelUntil: '15 май 2026',
  reason: 'Залата ще осигури собствено озвучаване.', partnerAmount: '0,00 €',
});
sample(partner.vendorCancelRequested, {
  bookingId: wedding.bookingId, bookingNo: wedding.bookingNo, clientName: maria.clientName, eventType: wedding.eventType,
  hosts: wedding.hosts, eventDate: wedding.eventDate, packageName: wedding.packageName,
});
sample(partner.vendorCancelCompleted, {
  bookingNo: wedding.bookingNo, clientName: maria.clientName, eventType: wedding.eventType, hosts: wedding.hosts,
  eventDate: wedding.eventDate, partnerAmount: '0,00 €',
});
sample(partner.vendorPayoutSent, {
  bookingNo: wedding.bookingNo, amount: wedding.partnerAmount, payoutDate: '15 юни 2026',
  eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite, hosts: wedding.hosts, eventDate: wedding.eventDate,
  packageName: wedding.packageName, account: 'BG•• •••• •••• 5272 01', bankName: 'Postbank', partnerLegalName: melodia.partnerLegalName,
});
sample(partner.vendorPayoutAccountSubmitted, { partnerLegalName: melodia.partnerLegalName, heldAmount: '2 610,00 €' });
sample(partner.vendorPayoutAccountConfirmed, { partnerLegalName: melodia.partnerLegalName, heldAmount: '2 610,00 €' });
sample(partner.vendorTicketReceived, {
  bookingNo: '2026-0630-АБ', eventType: 'Абитуриентски бал', hosts: 'СУ „Христо Ботев“', location: 'Хотел „Маринела“',
  reason: 'Клиентът не отговаря', openedAt: '30 август 2025, 16:20',
});
sample(partner.vendorTicketClientOpened, {
  bookingNo: wedding.bookingNo, clientName: maria.clientName, eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite,
  hosts: wedding.hosts, eventDate: wedding.eventDate,
  message: 'Платих пакета на 12.08.2025. Оттогава изпълнителят два пъти отложи огледа на залата и не потвърждава техниката от описанието. Прилагам снимките, които ми изпрати — апаратурата е различна от тази в обявата.',
  reason: 'Друго',
});
sample(partner.vendorTicketReminder, {
  bookingNo: wedding.bookingNo, clientName: maria.clientName, eventType: wedding.eventType, hosts: wedding.hosts, eventDate: wedding.eventDate,
});
sample(partner.vendorTicketDecision, {
  caseNo: '2025-0509-СВ', eventType: 'Сватба', eventTypeDefinite: 'сватбата', eventDate: '9 май 2025', packageName: wedding.packageName,
  decision: 'Без възстановяване',
  summary: 'Политиката ви е приложена — сумата по резервацията остава за вас.',
  account: 'Деница и Иван анулираха сватбата 4 дни преди датата и поискаха сумата обратно. Екипът приложи умерената ви политика — в последните 7 дни сумата не се връща.',
  motive: 'анулирането е 4 дни преди събитието, а клиентите са приели политиката при плащането.',
  payoutLine: 'Изплащането по резервацията продължава по обичайния график — на 1-во или 15-то число.',
  refunded: '0,00 €', partnerAmount: wedding.partnerAmount, decidedBy: 'Моника Ковачева', decidedAt: '11 май 2025, 10:00',
});
sample(partner.vendorNewReview, {
  reviewerName: 'Стефка Илиева', stars: 5,
  text: 'Всичко мина безупречно. Пристигна навреме, техниката беше на ниво, а плейлистът — точно по вкуса на гостите.',
  preview: 'Всичко мина безупречно. Пристигна навреме…',
  eventType: 'Рожден ден', packageName: 'Вечер', rating: '4,9', reviewCount: 38,
});
sample(partner.vendorNewMessage, {
  clientName: 'Ивелина Тодорова', message: 'Празненството е на 28 юни, от 20:00 до 01:00. Свободни ли сте?',
  eventType: 'Рожден ден', packageName: 'Вечер', eventDate: '28 юни 2026', receivedAt: '31 август 2025, 09:47',
});
sample(partner.vendorReportReady, {
  partnerName: melodia.partnerName, period: 'август 2025', revenue: '3 852,00 €', toPay: '2 610,00 €', paidYear: 2025, paidInYear: '18 940,00 €',
});
sample(partner.vendorDeactivated, { partnerName: melodia.partnerName, partnerCategory: melodia.partnerCategory, upcomingCount: 9 });
sample(partner.vendorDeleteConfirm, { partnerName: melodia.partnerName, email: melodia.email, url: '/partner/nastroyki' });
sample(partner.vendorInvite, { inviterName: 'Моника Ковачева' });
sample(partner.vendorOfferChosen, {
  requestId: '2026-1219-КТ', requestNo: '2026-1219-КТ', clientName: maria.clientName,
  eventType: 'Коледно парти', eventTypeDefinite: 'коледното парти', eventDate: '19 декември 2026', eventTime: '19:00',
  location: 'Ресторант „Виа Верде“, София', guests: 40, offerTitle: 'Коледно меню за 40 гости', partnerAmount: '1 782,00 €',
});
sample(partner.vendorOfferNotChosen, {
  requestNo: '2026-0614-ДК', clientName: maria.clientName, eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite,
  eventDate: wedding.eventDate, location: wedding.location, guests: wedding.guests, offerTitle: 'Арка, маси и букет',
});
sample(partner.vendorRequestExpired, {
  requestNo: wedding.requestNo, clientName: maria.clientName, eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite,
  eventDate: wedding.eventDate, packageName: wedding.packageName, receivedAt: '12 август 2025, 09:24', replyBy: wedding.replyBy,
});
sample(partner.vendorTicketInfoRequest, {
  bookingNo: '2026-0607-СВ', clientName: 'Петя и Николай', eventType: 'Сватба', eventTypeDefinite: 'сватбата', eventDate: '7 юни 2026',
  serviceName: 'Арка, маси и букет', topic: 'Изпълнителят не потвърждава монтажа',
});
sample(partner.vendorServiceChangeReturned, {
  serviceId: 'menyu-gradina', serviceName: 'Меню „Градина“', category: 'Кетъринг',
  current: '28,00 € на гост · минимум 60 гости', proposed: '32,00 € на гост · минимум 40 гости',
});

// ── Team ───────────────────────────────────────────────────────────────────
sample(team.teamInvite, {
  inviterName: 'Моника Ковачева', inviterRole: 'Администратор', role: 'Модератор', roleScope: 'обяви и спорове',
  roleDescription: 'Като модератор одобрявате изпълнители, модерирате обяви и снимки, решавате спорове и пишете на клиенти и изпълнители. Плащанията, изплащанията и управлението на екипа не влизат в тази роля.',
  email: 'kalina.stefanova@eventat.bg', url: '/admin',
});
sample(team.teamVendorApplication, {
  partnerId: 'lunna-fotografiya', partnerName: 'Лунна Фотография', partnerLegalName: 'Лунна Фотография ЕООД',
  category: 'Фотография и видео', city: 'Пловдив', contactName: 'Емилия Стоянова', submittedOn: '29 август 2025',
  stepsDone: 5, stepsTotal: 6, bankPending: true, packages: 3, priceFrom: '780,00 €', priceTo: '2 400,00 €',
});
sample(team.teamDisputeNew, {
  caseId: '2026-0614-ФК', bookingNo: '2026-0614-ФК', openerName: 'Мария Димитрова', otherName: 'Snap360',
  clientName: 'Мария Димитрова', partnerName: 'Snap360', claim: 'услугата не е по описание',
  summary: 'Платила е фотокабина за 4 часа от 20:00, а Snap360 ѝ е писал, че на 14 юни може да остане само 3 часа. Тя иска пълните 4 часа или разликата обратно.',
  reason: 'Услугата не беше по описание', heldAmount: '560,00 €',
  eventType: 'Сватба', eventDate: wedding.eventDate, venue: 'Вила Екатерина', openedAt: '29 август 2025, 11:30',
});
sample(team.teamDisputeReply, {
  caseId: '2026-0607-СВ', caseNo: '2026-0607-СВ', responderName: 'Флора Студио', openerName: 'Петя и Николай',
  clientName: 'Петя и Николай', partnerName: 'Флора Студио',
  summary: 'Не отказва монтажа, но той отнема около три часа, затова предлага достъп от 11:00 или арка, сглобена предварително. Клиентите искат потвърждение за 13:00–16:00 или анулиране с пълно възстановяване.',
  topic: 'Изпълнителят не потвърждава монтажа', eventType: 'Сватба', eventDate: '7 юни 2026',
  repliedAt: '29 август 2025, 14:05', photoCount: 2, heldAmount: '1 180,00 €',
});
sample(team.teamDisputeDeadline, {
  caseId: '2026-0614-ФК', caseNo: '2026-0614-ФК', silentName: 'Snap360', clientName: 'Мария Димитрова', partnerName: 'Snap360',
  requestedAt: '29 август 2025, 12:10', deadline: '31 август 2025, 12:10',
  options: 'Възможностите са Snap360 да осигури 4 часа, както е платено, да върнем разликата от 140,00 € или да анулираме с пълно възстановяване на 560,00 €.',
  heldAmount: '560,00 €',
});
sample(team.teamPaymentDeadline, {
  caseId: '2026-0621-ТЛ', bookingNo: '2026-0621-ТЛ', hoursLeft: 4, extraHours: 24,
  clientName: 'Технолинк ЕООД', clientShortName: 'Технолинк', partnerName: 'Вкусна История', disputeTopic: 'за цената',
  disputeSummary: 'одобрената сума е 3 200,00 €, а офертата за плащане стана 3 600,00 € по нова цена на гост, която още чака модерация.',
  eventType: 'Фирмено събитие', eventDate: '21 юни 2026', location: 'София Тех Парк',
  approvedAmount: '3 200,00 €', payNowAmount: '3 600,00 €', payBy: '31 август 2025, 18:20',
});
sample(team.teamVendorCancel, {
  bookingId: wedding.bookingId, bookingNo: wedding.bookingNo, partnerName: melodia.partnerName, contactName: melodia.contactName,
  partnerPhone: melodia.phone, clientName: maria.clientName, clientPhone: maria.phone,
  eventType: wedding.eventType, eventTypeDefinite: wedding.eventTypeDefinite, eventDate: wedding.eventDate, timeRange: '17:00 – 02:00',
  location: wedding.location, packageName: wedding.packageName, paid: wedding.amount, paidOn: '12 август 2025',
});
sample(team.teamPayoutAccount, {
  partnerName: melodia.partnerName, partnerLegalName: melodia.partnerLegalName, eik: '204512389',
  previousIbanLast4: '5272', previousBank: 'Postbank', heldAmount: '2 610,00 €',
});
sample(team.teamDailyDigest, {
  totalTasks: 15, approvals: 4, oldestWaitDays: 2, moderation: 7, newServices: 5, edits: 2, disputes: 4, disputesHeld: '2 380,00 €',
  urgent: { caseNo: '2026-0607-СВ', clientName: 'Петя и Николай', partnerName: 'Флора Студио', heldAmount: '1 180,00 €' },
});
sample(team.teamBatchReady, {
  batchDate: '1 септември 2025', partnerCount: 18, total: '12 840,00 €', bank: 'Обединена банка',
  held: { partnerName: 'Snap360', amount: '504,00 €' },
});
sample(team.teamBatchPaid, {
  batchName: 'август · първа половина', paidOn: '15 август 2025', partnerCount: 21, total: '18 940,00 €',
  bank: 'Обединена банка', nextBatchDate: '1 септември 2025',
});
sample(team.teamBatchReport, {
  batchName: 'август · първа половина', paidOn: '15 август 2025', partnerCount: 21, total: '18 940,00 €', bank: 'Обединена банка',
});
sample(team.teamTransferFailed, {
  partnerName: 'Квартет „Адажио“', amount: '1 332,00 €', ibanLast4: '3306', batchDate: '1 септември 2025',
  bank: 'Обединена банка', reason: 'Сметката е закрита',
});

export const SAMPLES: Record<string, Record<string, unknown>> = Object.fromEntries(entries);
