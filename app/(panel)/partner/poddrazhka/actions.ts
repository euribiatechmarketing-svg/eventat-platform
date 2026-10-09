'use server';
// Partner support (SCREENS §7 /partner/poddrazhka): open a case on an own booking (X2), answer the
// team (X6), withdraw an own case (X9), upload evidence. Every action authenticates as the partner;
// the domain checks that the booking / case is the partner's.
import { openDispute, sendStatement, uploadEvidence, withdrawDispute, type FormState } from '@/lib/actions/messaging-support';

/** ‹Прикачи файл› → media.upload(); toast ‹Снимката е прикачена към сигнала›. */
export async function uploadEvidenceAction(formData: FormData) {
  return uploadEvidence('partner', formData);
}

/** ‹Изпрати сигнала› → disputes.openByPartner() → /partner/rezervacii, toast ‹Сигналът е изпратен — екипът отговаря до 24 часа›. */
export async function openDisputeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return openDispute('partner', formData);
}

/** ‹Изпрати позицията› / ‹Отговори на екипа› → disputes.submitStatement(). */
export async function submitStatementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return sendStatement('partner', formData);
}

/** ‹Оттегли сигнала› → disputes.withdraw(). */
export async function withdrawDisputeAction(formData: FormData) {
  return withdrawDispute('partner', formData);
}
