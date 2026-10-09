'use server';
// /partnyori/[slug]: the widget's date check (SCREENS §2: date change → availability.check()).
// Public information — anyone may ask whether a partner is free; a client also learns whether
// they already watch that date.
import { z } from 'zod';
import { widgetAvailability } from '@/lib/domain/views-public';
import { currentUser } from '@/lib/session';

export async function checkDateAction(input: { partnerId: string; date: string }) {
  const parsed = z.object({ partnerId: z.string().uuid(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).safeParse(input);
  if (!parsed.success) return null;
  const u = await currentUser();
  return widgetAvailability(parsed.data.partnerId, parsed.data.date, u?.role === 'client' ? u.id : null);
}
