import 'server-only';
// Domain refusals → the message shown on the form. Where the prototype or the
// emails have the words, they are used; the rest are short new strings
// (listed for approval in the area hand-over).
import { LifecycleError } from '@/lib/domain/bookings';
import { AftercareError } from '@/lib/domain/aftercare-shared';
import { DomainError } from '@/lib/domain/catalogue-kit';
import { ForbiddenError } from '@/lib/domain/actor';

const TEXT: Record<string, string> = {
  date_unavailable: 'Датата е заета',
  deadline_passed: 'Срокът за плащане изтече',
  duplicate: 'Вече имате заявка към този изпълнител за тази дата.',
  provider_not_ready: 'Плащането не е възможно в момента. Опитайте отново по-късно.',
  not_allowed: 'Действието не е разрешено за този профил.',
  invalid_state: 'Състоянието се промени. Презаредете страницата.',
  not_found: 'Записът не е намерен.',
  event_passed: 'Събитието вече е минало.',
  dispute_open: 'По резервацията има отворен сигнал.',
  not_cancellable: 'Състоянието се промени. Презаредете страницата.',
  already_cancelled: 'Резервацията е анулирана',
  reason_required: 'Опишете причината.',
  review_too_short: 'Вашият коментар — поне 40 символа',
  already_reviewed: 'Ревюто е публикувано',
  not_reviewable: 'Състоянието се промени. Презаредете страницата.',
  upload_type: 'JPG или PNG, до 5 MB всяка',
  upload_size: 'JPG или PNG, до 5 MB всяка',
  too_many_photos: 'До 6 снимки · JPG или PNG, до 5 MB всяка',
};
const FALLBACK = 'Действието не е изпълнено. Опитайте отново.';

export function errorText(e: unknown): string {
  if (e instanceof LifecycleError || e instanceof AftercareError || e instanceof DomainError) return TEXT[e.code] ?? FALLBACK;
  if (e instanceof ForbiddenError) return TEXT.not_allowed;
  return FALLBACK;
}

/** Re-throw Next's redirect/notFound signals; turn everything else into a message. */
export function isNextSignal(e: unknown): boolean {
  const d = (e as { digest?: string } | null)?.digest;
  return typeof d === 'string' && (d.startsWith('NEXT_REDIRECT') || d.startsWith('NEXT_HTTP_ERROR_FALLBACK') || d === 'NEXT_NOT_FOUND');
}
