// Registry of every automatic email, keyed like the prototype's emails/emails.js.
import type { EmailTemplate } from '../types';
import * as auth from './auth';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const all: EmailTemplate<any>[] = [...Object.values(auth)];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const TEMPLATES: Record<string, EmailTemplate<any>> = Object.fromEntries(all.map(t => [t.key, t]));
