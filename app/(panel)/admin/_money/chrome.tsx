// Per-page chrome of the admin money screens: the topbar title and the flash toast after an action.
import { randomUUID } from 'node:crypto';
import { readFlash } from '@/lib/flash';
import { FlashAgain, TopbarTitleText } from './ui';

export async function PageChrome({ title, short }: { title: string; short?: string }) {
  const flash = await readFlash();
  return (
    <>
      <TopbarTitleText text={title} short={short} />
      <FlashAgain message={flash?.message ?? null} kind={flash?.kind} nonce={randomUUID()} />
    </>
  );
}
