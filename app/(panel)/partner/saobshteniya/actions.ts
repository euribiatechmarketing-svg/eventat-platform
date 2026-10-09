'use server';
// Partner messages (SCREENS §7 /partner/saobshteniya): every action authenticates as the partner
// and acts only on the partner's own conversations (the domain checks the party).
import { saveMessageDraft, sendMessage, uploadMessageFile } from '@/lib/actions/messaging-support';

/** ‹Изпрати› → messages.send() → client-new-message; toast ‹Съобщението е изпратено›. */
export async function sendMessageAction(input: { conversationId: string; body: string; attachmentId: string | null }) {
  return sendMessage('partner', input);
}

/** Typing → messages.saveDraft(). */
export async function saveDraftAction(input: { conversationId: string; body: string }) {
  return saveMessageDraft('partner', input);
}

/** ‹Прикачи файл› → media.upload(); toast ‹Файлът е прикачен към съобщението›. */
export async function uploadMessageFileAction(formData: FormData) {
  return uploadMessageFile('partner', formData);
}
