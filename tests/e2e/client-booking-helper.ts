// Helper for tests/e2e/client-booking.py: the partner's side of a flow (no
// partner screens in this area) and read-only checks of the database effect.
//   npx tsx --conditions=react-server tests/e2e/client-booking-helper.ts <command> [args]
// Prints one JSON value. Local databases only.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const envFile = fileURLToPath(new URL('../../.env.local', import.meta.url));
if (existsSync(envFile)) process.loadEnvFile(envFile);
if (!/127\.0\.0\.1|localhost/.test(process.env.DATABASE_URL ?? '')) { console.error('local databases only'); process.exit(1); }

const { sql } = await import('../../db');
const { now } = await import('../../lib/clock');
const { addDays, sofiaDate } = await import('../../lib/format');

async function partnerActor(slug: string) {
  const [r] = await sql<{ partner_id: string; user_id: string }[]>`
    select p.id partner_id, m.user_id from partner p join partner_member m on m.partner_id = p.id where p.slug = ${slug} limit 1`;
  return { userId: r.user_id, role: 'partner' as const, partnerId: r.partner_id };
}

async function watching([email, slug, d]: string[]) {
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from date_watch w join partner p on p.id = w.partner_id
    join "user" u on u.id = w.client_id where u.email = ${email} and p.slug = ${slug} and w.date = ${d} and w.status = 'watching'`;
  return n;
}

const [cmd, ...args] = process.argv.slice(2);
let out: unknown = null;
switch (cmd) {
  case 'free-date': {
    // The first date ≥ today + 40 days the partner can take (SPEC §12.6).
    const { checkPartnerDate } = await import('../../lib/domain/bookings');
    const [p] = await sql`select * from partner where slug = ${args[0]}`;
    const { db } = await import('../../db');
    const { partner } = await import('../../db/schema');
    const { eq } = await import('drizzle-orm');
    const [row] = await db.select().from(partner).where(eq(partner.id, p.id));
    const today = sofiaDate(await now());
    for (let i = 40; i < 400; i++) {
      const d = addDays(today, i);
      const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from request where partner_id = ${p.id} and event_date = ${d}`;
      if (n) continue;
      if ((await checkPartnerDate(db, row, d, { today })).requestable) { out = d; break; }
    }
    break;
  }
  case 'approve': {
    const { approveRequest } = await import('../../lib/domain/requests');
    out = await approveRequest(await partnerActor(args[0]), { number: args[1] });
    break;
  }
  case 'quote': {
    const { sendQuote } = await import('../../lib/domain/requests');
    out = await sendQuote(await partnerActor(args[0]), { number: args[1], title: args[2], amountCents: Number(args[3]) });
    break;
  }
  case 'request': {
    const [r] = await sql`select r.number, r.kind, r.status, r.amount_cents, r.space_type, r.note, r.guests,
      (select count(*)::int from request_attachment a where a.request_id = r.id) photos, b.status booking_status
      from request r left join booking b on b.request_id = r.id where r.number = ${args[0]}`;
    out = r ?? null;
    break;
  }
  case 'latest-request': {
    const [r] = await sql`select r.number from request r join "user" u on u.id = r.client_id where u.email = ${args[0]} order by r.created_at desc limit 1`;
    out = r?.number ?? null;
    break;
  }
  case 'booking': {
    const [b] = await sql`select b.number, b.status, b.cancelled_by, b.review_state,
      (select json_agg(json_build_object('id', c.id, 'method', c.method, 'status', c.status, 'last4', c.card_last4) order by c.created_at) from charge c where c.booking_id = b.id) charges,
      (select row_to_json(x) from (select reason, reason_text, refund_cents, retained_cents from cancellation where booking_id = b.id) x) cancellation,
      (select json_build_object('rating', rv.rating_overall, 'tags', rv.tags, 'photos', (select count(*)::int from review_photo rp where rp.review_id = rv.id)) from review rv where rv.booking_id = b.id) review
      from booking b where b.number = ${args[0]}`;
    out = b ?? null;
    break;
  }
  case 'outbox': {
    const [{ n }] = await sql<{ n: number }[]>`select count(*)::int n from email_outbox where template_key = ${args[0]} and to_email = ${args[1]}`;
    out = n;
    break;
  }
  case 'latest-brief': {
    const [b] = await sql`select b.id, b.status, b.guests, b.budget_band, b.event_date::text, c.slug city,
      (select count(*)::int from brief_invitation i where i.brief_id = b.id) invited,
      (select count(*)::int from brief_category bc where bc.brief_id = b.id) categories,
      (select count(*)::int from brief_attachment ba where ba.brief_id = b.id) photos,
      (select count(*)::int from job j where j.dedupe_key like 'invitation:%' and j.payload->>'invitationId' in (select i.id::text from brief_invitation i where i.brief_id = b.id)) jobs
      from brief b join city c on c.id = b.city_id join "user" u on u.id = b.client_id where u.email = ${args[0]} order by b.created_at desc limit 1`;
    out = b ?? null;
    break;
  }
  case 'remove-watch': {
    // The client stops watching a partner's date (saved.removeWatch, the ‹Запазени› page's control), so the
    // declined request offers ‹Уведоми ме, ако се освободи› again. Prints the number of watches left.
    const { removeWatch } = await import('../../lib/domain/saved');
    const [w] = await sql<{ id: string; client_id: string }[]>`select w.id, w.client_id from date_watch w join partner p on p.id = w.partner_id
      join "user" u on u.id = w.client_id where u.email = ${args[0]} and p.slug = ${args[1]} and w.date = ${args[2]} and w.status = 'watching'`;
    if (w) await removeWatch({ userId: w.client_id, role: 'client' }, { id: w.id });
    out = await watching(args);
    break;
  }
  case 'watching': out = await watching(args); break;
  case 'foreign-records': {
    // Another client's unpaid request, confirmed booking (with an invoice and a charge) and completed booking.
    const pick = async (status: string) => (await sql<{ number: string }[]>`
      select b.number from booking b join "user" u on u.id = b.client_id where u.email <> ${args[0]} and b.status = ${status}
      and exists (select 1 from invoice i where i.booking_id = b.id) = ${status !== 'awaiting_payment'} order by b.number limit 1`)[0]?.number ?? null;
    const confirmed = await pick('confirmed');
    const [ids] = await sql<{ invoice: string; charge: string }[]>`
      select (select i.id from invoice i where i.booking_id = b.id limit 1) invoice, (select c.id from charge c where c.booking_id = b.id limit 1) charge
      from booking b where b.number = ${confirmed}`;
    out = { unpaid: await pick('awaiting_payment'), confirmed, completed: await pick('completed'), invoiceId: ids?.invoice ?? null, chargeId: ids?.charge ?? null };
    break;
  }
  case 'foreign-request': {
    const [r] = await sql`select r.number from request r join "user" u on u.id = r.client_id where u.email <> ${args[0]} order by r.created_at limit 1`;
    out = r?.number ?? null;
    break;
  }
  default:
    console.error(`unknown command ${cmd}`);
    process.exit(2);
}
console.log(JSON.stringify(out));
await sql.end();
process.exit(0);
