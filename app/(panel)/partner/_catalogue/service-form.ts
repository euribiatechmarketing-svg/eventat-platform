import 'server-only';
// The service editor's payload (hidden `payload` field, JSON) → the domain's ServiceInput.
// Field messages are shown under the fields; the domain re-checks every rule (§12.2).
import { z } from 'zod';
import { parseMoney } from '@/lib/format';
import type { ServiceInput } from '@/lib/domain/services';

export type EditorState = { error?: string; fields?: Record<string, string> };

const payload = z.object({
  kind: z.enum(['package_fixed', 'on_request', 'addon']),
  name: z.string().max(200),
  categoryId: z.string().max(64),
  description: z.string().max(2000),
  eventTypeIds: z.array(z.string().max(64)).max(20),
  inclusions: z.array(z.string().max(300)).max(30),
  price: z.string().max(30),
  priceUnit: z.enum(['per_event', 'per_guest']),
  minGuests: z.string().max(10),
  durationLabel: z.string().max(200),
  extraHourEnabled: z.boolean(),
  extraHourPrice: z.string().max(30),
  travelFeeEnabled: z.boolean(),
  coverMediaId: z.string().max(64).nullable(),
  showInProfile: z.boolean(),
  acceptingRequests: z.boolean(),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse the editor. `complete` (‹Изпрати за преглед› / ‹Запази промените›) requires the fields of §12.2;
 * a draft (‹Запази като чернова›) needs only the name.
 */
export function readEditor(formData: FormData, complete: boolean): { input: ServiceInput | null; fields: Record<string, string> } {
  let raw: unknown;
  try { raw = JSON.parse(String(formData.get('payload') ?? '')); } catch { return { input: null, fields: { form: 'Проверете попълнените полета.' } }; }
  const r = payload.safeParse(raw);
  if (!r.success) return { input: null, fields: { form: 'Проверете попълнените полета.' } };
  const d = r.data;
  const fields: Record<string, string> = {};
  const name = d.name.trim();
  const description = d.description.trim();
  const inclusions = d.inclusions.map(s => s.trim()).filter(Boolean);
  const price = d.price.trim() ? parseMoney(d.price) : null;
  const extra = d.extraHourPrice.trim() ? parseMoney(d.extraHourPrice) : null;
  const minGuests = d.minGuests.trim() ? Number(d.minGuests.trim()) : null;

  if (!name) fields.name = 'Въведете име на услугата.';
  else if (name.length > 80) fields.name = 'До 80 знака.';
  if (description.length > 600) fields.description = 'До 600 знака.';
  if (d.price.trim() && (price == null || price <= 0)) fields.price = 'Въведете цена.';
  if (d.extraHourPrice.trim() && (extra == null || extra <= 0)) fields.extraHour = 'Въведете цена за допълнителния час.';
  if (d.minGuests.trim() && !(Number.isInteger(minGuests) && minGuests! > 0)) fields.minGuests = 'Въведете брой гости.';
  if (inclusions.some(s => s.length > 120)) fields.inclusions = 'До 120 знака на точка.';
  if (inclusions.length > 12) fields.inclusions = 'До 12 точки.';
  if (complete) {
    if (!UUID.test(d.categoryId)) fields.categoryId = 'Изберете категория.';
    if (!description) fields.description = 'Въведете кратко описание.';
    if (!d.eventTypeIds.length) fields.eventTypeIds = 'Изберете поне едно събитие.';
    if (d.kind !== 'on_request' && price == null) fields.price = 'Въведете цена.';
    if (d.kind !== 'on_request' && d.extraHourEnabled && extra == null) fields.extraHour = 'Въведете цена за допълнителния час.';
    if (d.kind !== 'on_request' && d.priceUnit === 'per_guest' && minGuests == null) fields.minGuests = 'Въведете брой гости.';
  }
  if (Object.keys(fields).length) return { input: null, fields };

  const perGuest = d.kind !== 'on_request' && d.priceUnit === 'per_guest';
  const input: ServiceInput = {
    kind: d.kind, name, categoryId: UUID.test(d.categoryId) ? d.categoryId : (undefined as unknown as string), description,
    priceCents: d.kind === 'on_request' ? null : price, priceUnit: perGuest ? 'per_guest' : 'per_event', minGuests: perGuest ? minGuests : null,
    durationLabel: d.durationLabel.trim() || null,
    extraHourEnabled: d.kind !== 'on_request' && d.extraHourEnabled, extraHourPriceCents: d.kind !== 'on_request' && d.extraHourEnabled ? extra : null,
    travelFeeEnabled: d.travelFeeEnabled, coverMediaId: d.coverMediaId && UUID.test(d.coverMediaId) ? d.coverMediaId : null,
    showInProfile: d.showInProfile, acceptingRequests: d.acceptingRequests,
    inclusions, eventTypeIds: d.eventTypeIds.filter(id => UUID.test(id)),
  };
  if (!input.categoryId) delete (input as Partial<ServiceInput>).categoryId;
  return { input, fields };
}
