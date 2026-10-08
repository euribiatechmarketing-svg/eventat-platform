import type { EmailTemplate } from '../types';

type CodeVars = { code: string; email: string };
type LinkVars = { url: string; email: string };

export const clientVerifyCode: EmailTemplate<CodeVars> = {
  key: 'client-verify-code', audience: 'client', optional: false,
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

export const vendorVerifyCode: EmailTemplate<CodeVars> = {
  key: 'vendor-verify-code', audience: 'partner', optional: false,
  render: v => ({
    subject: `Код за потвърждение на имейла: ${v.code}`,
    preheader: 'Въведете кода на екрана за регистрация, за да потвърдите имейла си.',
    trigger: 'Регистрация',
    heading: 'Потвърдете имейла си',
    paragraphs: [
      `Въведете този код на екрана за регистрация, за да потвърдите ${v.email} и да продължите към профила на бизнеса си.`,
      'Ако не сте създавали профил в EventAT, не правете нищо — без кода профилът не се активира.',
    ],
    details: [['Код за потвърждение', v.code], ['Имейл', v.email]],
    cta: { label: 'Въведи кода', href: `/potvarzhdenie?email=${encodeURIComponent(v.email)}` },
  }),
};

export const clientPasswordLink: EmailTemplate<LinkVars> = {
  key: 'client-password-link', audience: 'client', optional: false,
  render: v => ({
    subject: 'Нова парола за EventAT',
    preheader: 'Линкът е валиден 1 час.',
    trigger: 'Забравена парола',
    heading: 'Задайте нова парола',
    paragraphs: [
      `Поискахте нова парола за профила ${v.email}. Натиснете бутона, за да зададете нова. Линкът е валиден 1 час.`,
      'Ако не сте поискали нова парола, не правете нищо — сегашната остава в сила.',
    ],
    cta: { label: 'Задай нова парола', href: v.url },
  }),
};

export const vendorPasswordReset: EmailTemplate<LinkVars> = {
  key: 'vendor-password-reset', audience: 'partner', optional: false,
  render: v => ({
    subject: 'Нова парола за EventAT',
    preheader: 'Линкът е валиден 1 час.',
    trigger: 'Забравена парола',
    heading: 'Задайте нова парола',
    paragraphs: [
      `Поискахте нова парола за партньорския профил ${v.email}. Натиснете бутона, за да зададете нова. Линкът е валиден 1 час.`,
      'Ако не сте поискали нова парола, не правете нищо — сегашната остава в сила.',
    ],
    cta: { label: 'Задай нова парола', href: v.url },
  }),
};
