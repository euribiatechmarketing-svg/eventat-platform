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
  /**
   * Variables that are credentials (a one-time link or code). They reach the recipient's inbox only:
   * the outbox keeps a copy with them masked (lib/email/secrets.ts), so no screen can show them.
   */
  secret?: readonly string[];
  render: (vars: V) => EmailContent;
};
