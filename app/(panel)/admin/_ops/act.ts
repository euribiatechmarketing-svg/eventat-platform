import 'server-only';
// Shared tail of the admin-ops server actions: flash the prototype's toast and go back to the page
// (only same-origin admin paths), or turn a domain error into a short inline message.
import { redirect } from 'next/navigation';
import { setFlash } from '@/lib/flash';
import { DomainError, ForbiddenError } from '@/lib/domain/catalogue-kit';
import { SettingsError } from '@/lib/domain/settings';

export async function toastBack(message: string, back: string, fallback = '/admin'): Promise<never> {
  await setFlash(message + nonce());
  redirect(safeBack(back, fallback));
}

/**
 * The shared FlashToast shows a message only when it differs from the previous one (its effect depends
 * on the text), so the same toast twice in a row would stay silent. A short invisible suffix
 * (zero-width characters) keeps each flash distinct without changing what anyone reads.
 */
function nonce(): string {
  let n = Math.floor(Math.random() * 4096);
  let out = '';
  for (let i = 0; i < 12; i++) { out += n & 1 ? '\u200c' : '\u200b'; n >>= 1; }
  return out;
}

export function safeBack(back: string | null | undefined, fallback = '/admin'): string {
  const b = String(back ?? '');
  return b.startsWith('/admin') && !b.startsWith('//') && !/[\r\n]/.test(b) ? b : fallback;
}

/** Inline error text for a failed action (codes from lib/domain; the messages are short and factual). */
const MESSAGES: Record<string, string> = {
  invalid_email: 'Невалиден имейл',
  already_member: 'Този имейл вече е в екипа',
  note_required: 'Бележка до изпълнителя',
  partner_status: 'Заявката вече е обработена',
  revision_status: 'Обявата вече е прегледана',
  invite_status: 'Поканата вече не е активна',
  owner: 'Собственик',
  duplicate: 'Категорията вече съществува',
  invalid_token: 'Поканата вече не е активна',
  token_expired: 'Поканата вече не е активна',
  password_short: 'Паролата е твърде кратка',
  name_required: 'Име и фамилия',
  email_taken: 'Имейлът вече има профил',
  wrong_password: 'Грешна парола',
};

export function failure(e: unknown): string {
  if (typeof e === 'string') return MESSAGES[e] ?? 'Проверете данните';
  if (e instanceof ForbiddenError) return 'Нямате достъп';
  if (e instanceof DomainError) return MESSAGES[e.code] ?? 'Проверете данните';
  if (e instanceof SettingsError) return 'Проверете данните';
  throw e;
}
