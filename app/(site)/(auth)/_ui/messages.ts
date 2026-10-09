// Inline form errors of the auth and account screens. The prototype has no error states, so
// these short lines are new copy (formal „Вие“, no exclamation marks) kept in one place for
// approval; every success message on these screens is the prototype's own toast.
export const ERR = {
  required: 'Попълнете полето.',
  email: 'Въведете валиден имейл.',
  password: 'Паролата трябва да е поне 8 знака.',
  phone: 'Въведете валиден телефонен номер.',
  consent: 'Приемете Общите условия и Политиката за поверителност.',
  emailTaken: 'Вече има профил с този имейл.',
  credentials: 'Грешен имейл или парола.',
  blocked: 'Профилът е блокиран',
  code: 'Кодът не е верен.',
  codeExpired: 'Кодът е изтекъл. Поискайте нов.',
  link: 'Линкът е изтекъл. Поискайте нов от екрана за вход.',
  linkUsed: 'Линкът е изтекъл или вече е използван.',
  eik: 'Въведете валиден ЕИК.',
  upcoming: 'Изтриването е възможно само без предстоящи резервации.',
  fileType: 'Неподдържан формат на файла.',
  fileSize: 'Файлът е твърде голям.',
  generic: 'Нещо се обърка. Опитайте отново.',
} as const;

export type FieldErrors = Partial<Record<string, string>>;
/** What a form action returns when it does not redirect: field errors, a form error, the typed values, or a toast. */
export type FormState = { errors?: FieldErrors; error?: string; values?: Record<string, string>; ok?: string; at?: number } | null;

/** `?as=&next=` carried between Вход ↔ Регистрация ↔ the code screen. */
export function carry(as: string | null | undefined, next: string | null | undefined, extra: Record<string, string> = {}) {
  const u = new URLSearchParams(extra);
  if (as === 'partner') u.set('as', 'partner');
  if (next) u.set('next', next);
  const s = u.toString();
  return s ? `?${s}` : '';
}
