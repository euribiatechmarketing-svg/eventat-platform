import type { EmailTemplate } from '../types';

type CodeVars = { code: string; email: string };
type LinkVars = { url: string; email: string };
/** partnerName: the business name typed at sign-up; contactName: the contact person. */
type VendorCodeVars = CodeVars & { partnerName: string; contactName: string };
type VendorLinkVars = LinkVars & { partnerName: string };

export const clientVerifyCode: EmailTemplate<CodeVars> = {
  key: 'client-verify-code', audience: 'client', optional: false, secret: ['code'],
  render: v => ({
    subject: `Код за потвърждение на имейла: ${v.code}`,
    preheader: 'Въведете кода на екрана за регистрация, за да потвърдите имейла си.',
    trigger: 'Регистрация',
    heading: 'Потвърдете имейла си',
    paragraphs: [
      `Въведете този код на екрана за регистрация, за да потвърдите ${v.email} и да завършите профила си.`,
      'Ако не сте създавали профил в EventAT, не правете нищо — без кода профилът не се активира.',
    ],
    details: [['Код за потвърждение', v.code], ['Имейл', v.email]],
    cta: { label: 'Въведи кода', href: `/potvarzhdenie?email=${encodeURIComponent(v.email)}` },
  }),
};

export const vendorVerifyCode: EmailTemplate<VendorCodeVars> = {
  key: 'vendor-verify-code', audience: 'partner', optional: false, secret: ['code'],
  render: v => ({
    subject: `Код за потвърждение на имейла: ${v.code}`,
    preheader: `Въведете кода, за да продължите с профила на ${v.partnerName}.`,
    trigger: 'Регистрация — код за потвърждение',
    heading: 'Потвърдете имейла си',
    paragraphs: [
      `Въведете кода по-долу на екрана за регистрация, за да потвърдите ${v.email} и да продължите с профила на ${v.partnerName}.`,
      'Ако не сте създавали профил в EventAT, пренебрегнете този имейл.',
    ],
    details: [['Код', v.code], ['Бизнес', v.partnerName], ['Лице за контакт', v.contactName]],
    cta: { label: 'Потвърди имейла', href: `/potvarzhdenie?email=${encodeURIComponent(v.email)}` },
  }),
};

export const clientPasswordLink: EmailTemplate<LinkVars> = {
  key: 'client-password-link', audience: 'client', optional: false, secret: ['url'],
  render: v => ({
    subject: 'Линк за нова парола в EventAT',
    preheader: 'Задайте нова парола за профила си с бутона в писмото.',
    trigger: 'Нова парола',
    heading: 'Задайте нова парола',
    paragraphs: [
      `Получихме искане за нова парола за профила с имейл ${v.email}. Натиснете бутона, за да зададете нова парола.`,
      'Ако не сте поискали нова парола, не правете нищо — сегашната ви парола остава в сила.',
    ],
    details: [['Профил', v.email]],
    cta: { label: 'Задай нова парола', href: v.url },
  }),
};

export const vendorPasswordReset: EmailTemplate<VendorLinkVars> = {
  key: 'vendor-password-reset', audience: 'partner', optional: false, secret: ['url'],
  render: v => ({
    subject: 'Линк за нова парола за EventAT',
    preheader: 'Натиснете бутона, за да зададете нова парола.',
    trigger: 'Смяна на паролата',
    heading: 'Задайте нова парола',
    paragraphs: [
      `Поискахте нова парола за акаунта на ${v.partnerName} в EventAT. Натиснете бутона, за да я зададете.`,
      'Ако не сте поискали смяна, пренебрегнете този имейл — паролата ви остава същата.',
    ],
    details: [['Акаунт', v.email]],
    cta: { label: 'Задай нова парола', href: v.url },
  }),
};
