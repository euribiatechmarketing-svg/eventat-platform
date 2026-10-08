# Demo seed

`npm run db:seed` writes the prototype's demo data (DATA-MODEL §3, S1–S14) into `DATABASE_URL`.

```bash
export PATH="$HOME/nodejs22/bin:$PATH"
npm run db:reset && npm run db:seed        # fresh schema + demo data
npm run db:seed -- --force                 # truncate every table, then seed again
```

- It only runs against a local database (`127.0.0.1`, `localhost`, `::1`). Both `DATABASE_URL` and the host of the open connection pool are checked, because the pool is created when `@/db` is first imported.
- It only runs with `EMAIL_TRANSPORT=outbox` (or unset). The records carry the prototype's addresses, several on real domains, and the first timers fall due minutes after "now", so demo email must stay in the outbox (docs/DEPLOY.md, Demo / staging).
- It refuses a database that already has users. `--force` truncates every table first. The seed itself is one transaction: if it fails, the database is left empty and the next run seeds it.
- `.env.local` fills in any variable the shell has not set.
- `ALLOW_TIME_TRAVEL=true` is needed for the demo clock. The seed stores `clock_offset_ms` so that `now()` reads **Sunday 31 August 2025, 12:00 Sofia** at the moment of seeding (S1, D4). Business time then runs on from there.
- Every demo user signs in with the password `eventat-demo` (Better Auth `credential` accounts, emails verified). The three main logins are `maria.dimitrova@gmail.com` (client), `studio.melodia@gmail.com` (partner owner, Мартин Стоянов) and `monika.kovacheva@eventat.bg` (admin, team owner).
- The seed is deterministic apart from ids. Generated booking numbers come from a fixed-seed generator, so the demo's URLs survive a reseed.
- `tests/seed.test.ts` seeds a test database and checks the key facts, the row counts, the ledger invariants, the logins and the timers.

| File | What |
|---|---|
| `data.ts` | The records, copied from DATA-MODEL §3 and the prototype screens it names. Values marked `(a)` are assumed. |
| `run.ts` | `seedDemo({ force })`: writes everything in one transaction. |
| `jobs.ts` | The SPEC §3 timers that the seeded states imply. |
| `photos.ts` | Reads the size and pixel dimensions of `public/photos/*.jpg` for the media rows. |

## What it writes

- **Reference data and settings.** These come from `ensureReferenceData()`. All 48 settings are in force from 1 July 2025, with `payment.provider = simulated` and `payment.schedule.mode = full`. A KPI snapshot (`metrics_snapshot`, months July and August 2025) is computed from the records, with `refreshed_at` 11:48.
- **People.**
  - 30 users: 11 clients, 15 partner owners and 4 team members.
  - Мария's profile: sessions, invoice data, search history, saved searches, date watches and bell.
  - 2 pending team invites.
- **Partners.**
  - 11 approved, 4 submitted (D17).
  - Each partner has its gallery, avatar and cover, all 6 checks, its decision, payout account, event types, tags and blocks.
  - Cached figures are computed the way the catalogue's `refreshPartner()` computes them: `search_text`, from-price, rating, review count and responsiveness.
- **Services.** 27 services. 4 revisions wait in moderation: 3 new services and 1 edit.
- **Requests and bookings.**
  - 15 client events and 28 requests: 21 of them became bookings; of the rest, 5 are pending and 2 declined.
  - Each paid booking has its charges and an invoice per charge (credit notes for refunds), with Студио Мелодия numbered 407–414 so that 2026-0614-ЕА is **0000000412**.
  - Each paid booking also has its payout line and its ledger postings.
- **Money.** The ledger postings follow SPEC §7.5:
  - L1 for each charge.
  - L3 at `event_date + 1`, or at the dispute decision when a holding dispute was open by then.
  - L2 for the two refunds.
  - L4 for the three paid batches (S8).

  The 1 September 2025 batch is `scheduled`, with no lines. The ledger reconciles: `provider_held` equals the client funds still held for the 11 confirmed bookings, and `partner_payable` is 0.
- **Disputes.** The 7 cases of admin/dispute.html `CASES`, verbatim. That includes facts, agreed terms, comparisons, notes, statements, options and decisions.
- **Conversations, reviews and notes.** 8 conversations with 21 messages (S10), 3 reviews (S11) and 4 team notes (S13).
- **Jobs.** The 80 pending timers the states imply (below).

Not written:
- the emails and `audit_log` rows of the history;
- legal documents (their PDFs do not exist yet);
- commission invoices (⚙ `platform.legal_entity` is not supplied yet, D41).

## Timers scheduled (SPEC §3)

The seed schedules each deadline job (expiry, completion, batch preparation, dispute position) even when it is already due. A reminder is scheduled only while it is still ahead of "now": one whose time has passed would have been sent already.

The kinds, dedupe keys and payloads match what the owning modules schedule:
- lifecycle: `lib/domain/bookings.ts` `jobKey`;
- aftercare: `disputes.ts` and `payouts.ts`;
- catalogue: `saved.ts`.

| SPEC | Kind | Dedupe key | Payload | Seeded for |
|---|---|---|---|---|
| T1 | `request.reminder` | `request:<id>:reminder` | `{ requestId }` | 3 pending requests (2 are past their reminder) |
| T2 | `request.expire` | `request:<id>:expire` | `{ requestId }` | 5 pending requests |
| T5 | `booking.client_pay_reminder` | `booking:<id>:payrem:<h>` | `{ bookingId, hours }` | 3 awaiting payment × 6 h, 2 h |
| T6 | `booking.partner_pay_reminder` | `booking:<id>:vpayrem` | `{ bookingId, hours }` | 3 |
| T7 | `booking.team_payment_alert` | `booking:<id>:teamalert` | `{ bookingId, hours }` | 3 (the handler checks for an open dispute) |
| T8 | `booking.payment_expire` | `booking:<id>:payexpire` | `{ bookingId }` | 3 |
| T11 | `event.client_reminder` | `event:<id>:remind:<d>` | `{ clientEventId, days }` | 7 events with a confirmed booking × 7 d, 1 d |
| T12 | `booking.partner_event_reminder` | `booking:<id>:vremind:<d>` | `{ bookingId, days }` | 11 confirmed bookings |
| T13 | `booking.complete` | `booking:<id>:complete` | `{ bookingId }` | 11 |
| T14 | `booking.review_invite` | `booking:<id>:reviewinvite` | `{ bookingId }` | 11 |
| T15 | `dispute.position` | `dispute:<id>:position` | `{ disputeId }` | 3 cases collecting |
| T17 | `payouts.prepare` | `batch:2025-09-01` | `{ batchDate }` | due 31.08 09:00, so the first tick prepares the batch |
| T19 | `digest.daily` | `digest:2025-09-01` | `{ date }` | starts the daily chain at ⚙ `digest.time` (team module: `team.ts`) |
| T20 | `savedsearch.scan` | `savedsearch:2025-09-01` | `{ date }` | starts the daily chain |
| T21 | `datewatch.expire` | `datewatch:<id>:expire` | `{ watchId }` | 2 watches |
| T25 | `teaminvite.expire` | `teaminvite:<id>:expire` | `{ inviteId }` | 2 invites (the team module must register this kind) |

T19 and T20 are daily chains: each run schedules the next day, so the seed writes only the next run.

## Values the seed had to assume (for `docs/review-list.md`)

DATA-MODEL S14 lists the expected assumptions. The seed adds the ones below, which it needed to write complete rows. Every one is marked `(a)` in `data.ts`.

**S14 items, with the value used**
1. The clock is 12:00, not 10:00, and every open request is re-dated (S7, D4).
2. Emails of clients other than Мария, Технолинк, Ивелина, Петя и Николай, Стефка and СУ „Христо Ботев“, and of every partner except Студио Мелодия and Лунна Фотография: `<slug>@example.invalid`.
   - Phones of everyone except Мария, Студио Мелодия and Лунна Фотография: placeholders `+3590000000NN`. These cannot be dialled: a Bulgarian number never starts with 0 after +359.
3. Registration and approval dates:
   - A client registered 2 days before their first request.
   - Every approved partner except Студио Мелодия was approved on 1 March 2025, 10:00. Each submitted 2 days before approval and registered 2 days before submitting.
   - Студио Мелодия was approved on 1 February 2025 at 10:00 (D86; the time is assumed).
4. Paid-at times follow one rule, the 2026-0614-ЕА pattern: sent 09:00, approved 11:00, paid 14:00 on the paid date. The paid time of 2026-0614-ЕА is 14:05. Paid dates:
   - 2026-0630-АБ 20.08.2025, Ана и Виктор 25.08.2025, 2026-0628-ФК 18.08.2025, 2026-0628-КТ 19.08.2025, 2026-0530-РД 21.08.2025, 2025-0424-СЛ 10.04.2025.
   - Also assumed: 2026-0607-СВ 14.08.2025 and 2025-0517-РД 01.04.2025.
   - The four past Студио Мелодия bookings, in invoice order 407–410: Нетера 10.02.2025, Деница и Иван 20.02.2025 (‹Датата беше блокирана от февруари›), Стефка 02.04.2025, Петя и Николай 15.04.2025.
   - 2025-0426-ФТ: 12.03.2025 14:00 and 14:00:40 (‹две еднакви тегления в рамките на минута›).
5. Service names:
   - The four catering partners have one package each, named after the category, ‹Кетъринг›, at the card's from-price: 980 / 1 450 / 890 / 1 100 €.
   - Вкусна История's ‹Коледно меню за 40 гости› is 1 980,00 €.
   - The three other applicants also have one package each, named after their category, at the card's from-price: Балон Градина ‹Декорация› 320 €, DJ Живко ‹DJ и озвучаване› 520 €, Тортите на Мими ‹Торти и десерти› 290 €. DATA-MODEL lists no services for them, but they need ≥ 1 package to have been submitted, and two of them show 6 of 6 checks.
6. Bank details:
   - Bank name ‹Обединена банка› for every account not shown in Плащания.
   - IBAN last4 `0000` for Флора Студио, Мед и мляко, Трапеза & Co, Фолклорна Трапеза, Градина и Маса, Бяла Покривка, Балон Градина, Тортите на Мими and Лунна Фотография (Пощенска банка, pending).
   - Deposit 30 % for every partner except Студио Мелодия.
   - Балон Градина and Тортите на Мими have confirmed accounts, because their 6 of 6 checks include `bank_account`.
7. Venues, cities and guests:
   - Ресторант „Тера“ is in София.
   - Past events and 2026 events without a venue: city София, no venue.
   - Guests: Петя и Николай 2025 100, Стефка 2025 and 2026 40, Нетера 120, Деница и Иван 100, Ралица и Георги 100.
8. Reviews:
   - Published at 12:00 the day after the event; replies one day later.
   - Criteria ratings equal the overall rating.
   - The bell item ‹Ново ревю с 5 звезди› is at 18.05.2025 12:00, read.
9. Invoice numbers other than 0000000412. Each issuer counts from 1 in payment order, credit notes included. Студио Мелодия runs 407–414 (S7).
10. DJ Живко's waiting checks are `gallery` and `bank_account`.
11. ‹Струнен дует за церемония› was submitted on 30.08.2025 at 15:00.

**Further assumptions the rows needed**
- **Contacts and legal data.**
  - Partners with no named contact (every approved partner except Студио Мелодия) use the business name as contact and as user name.
  - Legal names: `<business name> ЕООД`, legal form ЕООД, no ЕИК.
- **Partner checks.**
  - Unverified approved partners have `company` waiting and `contacts` ok (`is_verified` = both ok).
  - Check details are stored for Лунна Фотография (all six, from admin/vendor.html) and for Студио Мелодия's three team checks. Студио Мелодия's are not in the prototype: they follow the SPEC §4.2 ok examples with its own data (‹ЕИК 204512389 · Студио Мелодия ЕООД · проверено в Търговския регистър›, ‹Телефон и имейл потвърдени›, ‹5 снимки · няма водни знаци от други студия›).
- **Partner photos.**
  - The avatar and cover of every partner except Студио Мелодия are its catalogue photo.
  - Лунна Фотография's gallery has the 7 photos admin/vendor.html shows, in that order (D77). Position 0 is v1-photographer-mod; the catalogue card shows photographer.
- **Service descriptions.** Empty (`''`) where the prototype shows none. That covers every service of the approved partners except Студио Мелодия's four and the three in moderation.
- **Service event types and covers.**
  - A service's event types are its partner's, except the ones the prototype shows:
    - Пакет „Цял ден“: Сватба;
    - Пакет „Вечер“: Рожден ден and Абитуриентски бал, from its description;
    - Фирмени събития: Фирмено събитие;
    - Сватбена арка „Пастел“: Сватба.
  - Services without a cover in the prototype have none.
- **Service times.** Студио Мелодия's services were last changed on 27.08.2025 (‹преди 4 дни›). The profile was last changed on 25.08.2025 (‹преди 6 дни›). Both times are 12:00.
- **Team.**
  - Моника joined on 15.01.2025 and Красимир on 01.03.2025.
  - ‹В екипа от май / юли 2025› is stored as the 1st of the month.
  - Георги was last active at 11:35 (‹Преди 25 минути›) and Даниела at 09:00 (‹Преди 3 часа›).
- **Мария's account.**
  - Password changed at 12:00.
  - The iPhone session was last active on 29.08.2025 at 21:00.
  - Search history times (newest first): 31.08 09:30, 30.08 18:10, 29.08 20:15.
  - Saved searches were created at 12:00 on their dates.
  - The watches were created on 10.08 at 10:05 and 09.08 at 09:05, just after the declines.
- **Declines.** 2026-0614-ФТ was declined on 10.08.2025 at 10:00, 2026-1219-ФК on 09.08.2025 at 09:00.
- **Booking times.**
  - Георги Колев sent his request on 30.08.2025 at 20:00. Технолинк sent 2026-0621-ТЛ on 30.08.2025 at 10:00.
  - Деница и Иван cancelled on 05.05.2025 at 10:00, with reason ‹Събитието се отменя› (‹по семейни причини›).
  - The refund of 2025-0517-РД went through on 21.05.2025 at 10:00.
- **Quote bookings.**
  - Мария's ‹Парти програма, 5 часа›: request on 04.08 at 10:00, offer on 04.08 at 16:00, chosen on 05.08 at 09:00.
  - Нетера: request on 08.02 at 10:00, offer on 09.02 at 09:00 (inside the 24 hours, R4), chosen on 10.02 at 09:00.
  - Нетера's offer and booking title is ‹Фирмени събития›.
- **Booking service titles.**
  - 2026-0621-ТЛ: ‹Кетъринг · меню „Градина“› with ‹100 гости› (the case's agreed terms). Its request keeps the approved 3 200,00 €; the booking is at 3 600,00 €.
  - 2026-0628-КТ and 2025-0517-РД: ‹Кетъринг›, linked to Меню „Градина“.
  - 2026-0530-РД: the 4-hour Snap360 package (560 €).
- **Payout batches.** Released and paid at 10:00 on the batch date, by Моника. The 1 September batch has no rail label.
- **Messages.** A read message without a reply is read 5 minutes after it arrived. Otherwise it is read when the other side replies.
- **Team-written history.** The seed writes no team message for ‹Поискахме позиция› or ‹Писахме на училището›, because their text is not in the prototype. The timeline comes from `position_requested_at`.

## Files to supply

The dispute documents the prototype names have no files. Their media rows are `seed/disputes/<number>/<party>-<n>.(pdf|png)` with size 0:

| Case | Document |
|---|---|
| 2026-0607-СВ | ‹Правила на залата · PDF› |
| 2026-0614-ФК | ‹Съобщение от Snap360 · снимка на екрана› |
| 2026-0621-ТЛ | ‹Одобрена оферта · 30 август› |
| 2026-0630-АБ | ‹Разговор в платформата · 4 съобщения без отговор› |
| 2025-0517-РД | ‹Маршрут · снимка на екрана› |
| 2025-0426-ФТ | ‹Извлечение от банката · PDF› |

The legal documents ‹Условия за партньори (PDF)› and ‹Договор за услуга (PDF)› are not seeded until the PDFs exist.

## Where the prototype disagreed, and what the seed did

- **Message texts.** The vendor and client screens differ on two Студио Мелодия messages: ‹…настроим звука спокойно› and ‹ще ги заключим в плейлиста›. The seed uses DATA-MODEL S10, which follows client/messages.html.
- **Booking numbers.** DATA-MODEL marks Мария's two Коледно парти bookings as generated. admin/client.html shows **2026-1219-ЕА** (Студио Мелодия) and **2026-1219-ТД** (Мед и мляко), so the seed uses those.
- **Пакет „Вечер“ description.** The seed uses the full text from vendor/services.html. DATA-MODEL quotes the first sentence only.
- **‹Активна от юни 2025›.** service-edit.html shows this for Пакет „Цял ден“. S6 says `published_at = approved_at` (February 2025), which the May 2025 bookings need, so the seed follows S6.
- **Годежи.** S6 calls ‹Годежи› a partner tag, so Студио Мелодия's tags are Озвучаване, Диско осветление and Годежи. The profile screen shows only the first two.
- **Вкусна История's from-price.** D34 expects ‹от 28 € на гост›. With the active per-event package ‹Коледно меню за 40 гости› (1 980 €), §12.4 gives ‹от 1 980 €›.
- **Лунна Фотография's moderation note.** It is dated 29.08.2025 16:20, as in DATA-MODEL. admin/vendor.html shows 31.08 16:20, which is later than "now".
- **Меню „Градина“ edit.** It is submitted at 04:40, per the dispute timeline and DATA-MODEL. The moderation card says ‹преди 5 часа›.
- **Conversations.** They exist only where the prototype shows messages. The messaging module creates the others on demand.
  - A conversation links its latest request and, when one exists, its booking. Флора's 2026-1219-ДК awaits payment, and its ‹Виж заявката› label comes from the booking's status.
- **Responsiveness.** It is computed as `responsiveness()` computes it, counting pending requests as not answered. Студио Мелодия reads 78 % (7 of its 9 requests since March were answered in time; Ивелина's and Технолинк's are still inside their 24 hours), not the prototype's typed 96 % (D18).
