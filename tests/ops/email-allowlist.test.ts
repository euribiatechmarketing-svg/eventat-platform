// EMAIL_ALLOWLIST (staging): only listed recipients get real email; everyone else's message is recorded only.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { emailOutbox } from '@/db/schema';
import { allowedRecipient, sendEmail } from '@/lib/email/send';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('EMAIL_ALLOWLIST', () => {
  it('matches whole addresses and @domains, case-insensitively; unset allows everyone', () => {
    expect(allowedRecipient('a@x.bg', undefined)).toBe(true);
    expect(allowedRecipient('Wmd4nd@Gmail.com', 'wmd4nd@gmail.com, @euribiatech.com')).toBe(true);
    expect(allowedRecipient('sales@euribiatech.com', 'wmd4nd@gmail.com, @euribiatech.com')).toBe(true);
    expect(allowedRecipient('maria.dimitrova@gmail.com', 'wmd4nd@gmail.com, @euribiatech.com')).toBe(false);
    expect(allowedRecipient('x@noteuribiatech.com', '@euribiatech.com')).toBe(false);
  });

  it('sends to an allowed address through the provider and only records the others', async () => {
    vi.stubEnv('EMAIL_TRANSPORT', 'resend'); vi.stubEnv('RESEND_API_KEY', 're_test'); vi.stubEnv('EMAIL_ALLOWLIST', 'tester@example.com');
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: { body: string }) => {
      calls.push(JSON.parse(init.body).to[0]);
      return new Response(JSON.stringify({ id: 'msg_1' }), { status: 200 });
    }));
    const a = await sendEmail({ key: 'client-verify-code', to: 'tester@example.com', vars: { code: '111222', email: 'tester@example.com' } });
    const b = await sendEmail({ key: 'client-verify-code', to: 'maria.dimitrova@gmail.com', vars: { code: '333444', email: 'maria.dimitrova@gmail.com' } });
    expect(calls).toEqual(['tester@example.com']);
    const [ra] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, a!));
    const [rb] = await db.select().from(emailOutbox).where(eq(emailOutbox.id, b!));
    expect(ra).toMatchObject({ status: 'sent', provider: 'resend' });
    expect(rb).toMatchObject({ status: 'sent', provider: 'outbox' });
  });
});
