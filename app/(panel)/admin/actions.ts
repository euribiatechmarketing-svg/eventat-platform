'use server';
// /admin — ‹Експорт› (D68: report_job + toast; the ready email needs a new team key).
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requestAdminExport } from '@/lib/domain/views-admin-ops';
import { requireTeam } from './_ops/guard';
import { failure, toastBack } from './_ops/act';

const schema = z.object({ period: z.enum(['month', 'quarter', 'year']).default('month'), grad: z.string().max(40).optional(), back: z.string().max(300) });

export async function requestDashboardExportAction(fd: FormData) {
  const { actor } = await requireTeam();
  const d = schema.safeParse({ period: fd.get('period') || undefined, grad: fd.get('grad') || undefined, back: fd.get('back') ?? '/admin' });
  if (!d.success) return { error: failure('validation') };
  try {
    await requestAdminExport(actor, { kind: 'admin_dashboard', params: { period: d.data.period, city: d.data.grad ?? null } });
  } catch (e) { return { error: failure(e) }; }
  revalidatePath('/admin');
  await toastBack('Справката се подготвя — ще я получите по имейл', d.data.back);
}
