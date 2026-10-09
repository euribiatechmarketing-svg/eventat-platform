'use server';
// Client messages (SCREENS §4 /akaunt/saobshteniya): every action authenticates as the client
// and acts only on the client's own conversations (the domain checks the party).
import { saveMessageDraft, sendMessage, uploadMessageFile } from '@/lib/actions/messaging-support';

/** ‹Изпрати› → messages.send() → vendor-new-message; toast ‹Съобщението е изпратено›. */
export async function sendMessageAction(input: { conversationId: string; body: string; attachmentId: string | null }) {
  return sendMessage('client', input);
}

/** Typing → messages.saveDraft(). */
export async function saveDraftAction(input: { conversationId: string; body: string }) {
  return saveMessageDraft('client', input);
}

/** Attach → media.upload(); toast ‹Файлът е прикачен към съобщението›. */
export async function uploadMessageFileAction(formData: FormData) {
  return uploadMessageFile('client', formData);
}
