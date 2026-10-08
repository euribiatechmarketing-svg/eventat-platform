import 'server-only';
// Shared by the partner catalogue & money actions: who is acting, and the
// Bulgarian text for a refused action (the domain only returns codes).
import { requireRole } from '@/lib/session';
import { actorFromUser, ForbiddenError, type Actor } from '@/lib/domain/actor';
import { DomainError } from '@/lib/domain/catalogue-kit';

/** requireRole('partner') + the domain actor (partnerId resolved from partner_member). */
export async function partnerActor(next = '/partner'): Promise<Actor> {
  const u = await requireRole('partner', next);
  return actorFromUser(u);
}

const MESSAGES: Record<string, string> = {
  validation: 'Проверете попълнените полета.',
  max_packages: 'Достигнахте максималния брой пакети с фиксирана цена.',
  partner_status: 'Действието не е достъпно за профила ви в момента.',
  service_status: 'Услугата не може да се промени в това състояние.',
  not_published: 'Услугата още не е публикувана — изпратете я за преглед.',
  use_submit_change: 'Услугата е публикувана — запазете промените, за да ги прегледа екипът.',
  upload_type: 'Форматът на файла не се приема.',
  upload_size: 'Файлът е по-голям от 5 MB.',
  upload_dimensions: 'Снимката е твърде малка.',
  upload_forbidden: 'Форматът на файла не се приема.',
  gallery_full: 'Галерията е пълна.',
  gallery_min: 'Галерията не може да има по-малко снимки.',
  photo_duplicate: 'Снимката вече е в галерията.',
  invalid_order: 'Подредбата не може да се запази.',
  invalid_iban: 'Въведете валиден български IBAN.',
  bank_required: 'Изберете банка.',
  holder_mismatch: 'Титулярят трябва да е фирмата от профила ви.',
  legal_name_missing: 'Липсва името на фирмата в профила ви.',
  reply_empty: 'Напишете отговор.',
  already_replied: 'Вече сте отговорили на това ревю.',
  name_change_too_soon: 'Името се сменя веднъж месечно.',
  invalid_phone: 'Въведете валиден телефон.',
  has_upcoming_bookings: 'Възможно само без предстоящи резервации.',
  invalid_token: 'Линкът е невалиден или е изтекъл.',
  token_expired: 'Линкът е невалиден или е изтекъл.',
  not_found: 'Записът не е намерен.',
  locale_unavailable: 'Английската версия идва скоро',
};

/** The message for a refused action; unexpected errors are rethrown (they are bugs, not user errors). */
export function refusal(e: unknown): string {
  if (e instanceof DomainError) return MESSAGES[e.code] ?? MESSAGES.validation;
  if (e instanceof ForbiddenError) return MESSAGES.partner_status;
  throw e;
}
