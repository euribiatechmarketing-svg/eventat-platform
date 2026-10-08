export type Audience = 'client' | 'partner' | 'team';

/** One rendered email, in the shape of the prototype's emails/emails.js entries. */
export type EmailContent = {
  subject: string;
  preheader: string;
  /** Small overline above the heading, e.g. "Регистрация". */
  trigger: string;
  heading: string;
  paragraphs: string[];
  details?: [string, string][];
  cta?: { label: string; href: string };
  note?: string;
};

export type EmailTemplate<V = Record<string, unknown>> = {
  key: string;
  audience: Audience;
  /** true only if a matching switch exists in the recipient's notification settings. */
  optional: boolean;
  /** Settings switch key that turns this email off (when optional). */
  preference?: string;
  render: (vars: V) => EmailContent;
};
