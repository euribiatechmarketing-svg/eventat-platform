'use server';
// Client support (SCREENS §4 /akaunt/poddrazhka): open a case on an own booking (X1), answer the
// team (X6), withdraw an own case (X9), upload evidence. Every action authenticates as the client;
// the domain checks that the booking / case is the client's.
import { openDispute, sendStatement, uploadEvidence, withdrawDispute, type FormState } from '@/lib/actions/messaging-support';

/** ‹Добавете снимки към сигнала› → media.upload(); toast ‹Снимката е прикачена към сигнала›. */
export async function uploadEvidenceAction(formData: FormData) {
  return uploadEvidence('client', formData);
}

/** ‹Изпрати сигнала› → disputes.openByClient() → /akaunt/rezervacii, toast ‹Сигналът е изпратен — екипът отговаря до 24 часа›. */
export async function openDisputeAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return openDispute('client', formData);
}

/** ‹Изпрати› (‹Отговори на екипа›) → disputes.submitStatement(). */
export async function submitStatementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  return sendStatement('client', formData);
}

/** ‹Оттегли сигнала› → disputes.withdraw(). */
export async function withdrawDisputeAction(formData: FormData) {
  return withdrawDispute('client', formData);
}
