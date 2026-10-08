# EventAT — SPEC (rule book)

This is the contract for the production build: the code in `lib/domain/` enforces these rules, and the pages render them. Where the prototype (`../eventat-app`) disagrees with itself, the resolution is in **§17 Decisions taken** (numbered `D1…`), and every rule that depends on one cites it.

Companion documents: `DATA-MODEL.md` (tables, enums, seed) and `SCREENS.md` (routes, actions, email catalogue).

**Notation.**
- `‹…›` is a Bulgarian UI string, copied exactly from the prototype.
- `snake_case` names are enum values or columns from `DATA-MODEL.md`.
- `domain.fn()` names a function in `lib/domain/<module>.ts`.
- Email keys (`client-request-approved`) are the prototype's `emails/emails.js` keys and the platform's `lib/email/templates` keys.
- ⚙ marks a value that is an **admin setting** (`platform_settings`, versioned by `effective_from`, §2). Everything else is a hard rule.

---

## 0. Conventions

| Topic | Rule |
|---|---|
| Time zone | All business dates and clock times are **Europe/Sofia**. A "day" is a Sofia calendar day. Instants are stored as `timestamptz`, event dates as `date`. Use `sofiaDate()`, `sofiaInstant()` and `daysBetween()` from `lib/format.ts`. |
| Clock | Business "now" is `now()` in `lib/clock.ts`. Never use `new Date()`. In demo environments (`ALLOW_TIME_TRAVEL=true`) the seed sets now = **Sunday 31 август 2025, 12:00** (Sofia) (D4). |
| Money | Integer euro cents. Rounding is half-up to the cent, applied once per computed amount. Currency is EUR only (`‹EUR (€)›`). Display: `‹1 450,00 €›` in tables, summaries and emails, `‹1 450 €›` in running text, cards and list rows (`money()` / `moneyShort()`). |
| Dates | `‹14 юни 2026›` (no leading zero, lower-case month). With a weekday: `‹14 юни 2026, неделя›` or `‹неделя›` in small text. Short form in lists: `‹12 авг›`, `‹19 дек 2026›`. Paid-on dates: `‹12.08.2025›`. Date-time: `‹13 август 2025, 11:06›`. |
| Countdown | `‹Остават HH:MM ч›` = deadline − now, as hours:minutes. Relative ages: `‹преди 2 часа›`, `‹вчера›`, `‹преди 4 месеца›`; `‹след 287 дни›` for days ahead. |
| Numbers | Booking/request numbers are `YYYY-MMDD-XX`: the event date plus two Cyrillic capitals (D2). The number is assigned when the request (or brief offer) is created and stays the same through booking, invoice line, dispute and payout line. Each partner booking has its own number. |
| URLs | Routes use the number exactly as stored, URL-encoded (D3), e.g. `/akaunt/rezervacii/2026-0614-ЕА`. |
| Copy | Formal „Вие“; "ви/вашата/вашия" lower-case mid-sentence. Buttons are short singular imperatives. No exclamation marks or emoji. Nothing on screen that is not product copy. New copy is never invented in code. Wherever this spec needs text the prototype does not have, it says **"new copy — needs Nikola's approval"** and the build must use an approved string. |
| Terminology | **заявка** = a request to one partner (catalogue package). **запитване** = an open request to many partners (the brief), and also the quote inquiry on a `‹По запитване›` service. **оферта** = a partner's priced answer to an запитване. **резервация** = an approved request once paid. **сигнал** (client and partner UI) = **кейс / спор** (admin UI) = `dispute`. **партньор** (internal and partner UI) = **изпълнител** (client UI). |

---

## 1. Actors and roles

### 1.1 Actors

| Actor | How identified | What they can do |
|---|---|---|
| Guest | no session | Browse every public page (§13). Saving a search, watching a date, sending a request or an open request all redirect to `/registratsiya?next=<full url with params>` (D46). |
| Client | `user.role = 'client'` | Own events, requests, briefs, bookings, payments, cancellations, disputes, reviews, messages, saved searches, date watches, settings. Sees only their own records. |
| Partner | `user.role = 'partner'` + `partner_member` row | Own partner profile, services, calendar, requests, offers, bookings, earnings, payout account, reviews (reply only), messages, disputes, settings. A partner user acts for exactly one partner. v1 has one member per partner, the owner (D52). |
| Admin (team) | `user.role = 'admin'` + `team_member` row with a `team_role` | Everything, limited by the permission matrix (§1.2). Always sees commission, both parties' contact details, and every record. |
| System | jobs (`lib/jobs`), cron tick every minute | Deadlines, reminders, payouts preparation, digests. Logged in `audit_log` as `actor_role = 'system'`. |
| Payment provider | webhook / `applyProviderEvent()` | Charge, refund and payout results and partner account status (§7). |

### 1.2 Team roles (admin/team.html „Какво може всяка роля“)

| Permission (`team_permission`) | Label | Администратор (`admin`) | Модератор (`moderator`) | Поддръжка (`support`) | Счетоводство (`accounting`) |
|---|---|---|---|---|---|
| `approve_partners` | ‹Одобрява изпълнители› — ‹Проверява профила и пуска обявите на живо› | ✓ | ✓ | — | — |
| `moderate_listings` | ‹Модерира обяви и снимки› — ‹Одобрява промените по вече публикувани обяви› | ✓ | ✓ | — | — |
| `resolve_disputes` | ‹Решава спорове› — ‹Взема решение за възстановяване и го изпраща до двете страни› | ✓ | ✓ | — | — |
| `message_users` | ‹Пише на клиенти и изпълнители› — ‹Отговаря на запитвания и свързва страните по резервация› | ✓ | ✓ | ✓ | — |
| `view_finance` | ‹Вижда плащания и комисиони› — ‹Отваря партидите, сметките и счетоводните справки› | ✓ | — | — | ✓ |
| `release_payouts` | ‹Пуска изплащанията› — ‹Потвърждава партидата към банката› | ✓ | — | — | — |
| `manage_team_settings` | ‹Управлява екипа и настройките› — ‹Кани хора, сменя роли и редактира политиките› | ✓ | — | — | — |

Actions not in the matrix (D39):
- Blocking a client (`‹Блокирай профила›`) and extending a payment deadline (`‹Удължи срока›`) need `admin`, or `moderator` while a dispute is open on that booking.
- Inviting a partner (`‹Покани изпълнител›`) needs `approve_partners`.
- Confirming a payout account needs `view_finance`.
- Cancelling a booking (team) needs `resolve_disputes`.

Money columns (GMV, commission) and the Плащания area render only with `view_finance`. Every admin mutation writes `audit_log`.

### 1.3 Session rules

| Rule | Value |
|---|---|
| Session length | `‹Запомни ме›` checked (the default): 30 days, sliding. Unchecked: a browser-session cookie (D48). |
| Sign-in redirect | Client → `next` if present, else `/tarsene`. Partner → the saved onboarding step `/partner/registratsiya/<onboarding_step>` while `partner.status ∈ {draft, returned}`, else `/partner`. Admin → `/admin`. |
| Role guards | `/akaunt/*`, `/zayavka/*`, `/plashtane/*` need a client. `/partner/*` needs a partner (onboarding routes allow `draft`, `returned` and `submitted`; the rest of the panel needs `approved` or `deactivated`, D24). `/admin/*` needs an admin. A wrong role is redirected to its own home. A guest is sent to `/vhod?next=`. |
| Blocked user | `user.banned = true` → sign-in refused and all sessions revoked. |
| Two-factor | When `two_factor_enabled`, sign-in from a new device needs an SMS code to `user.phone` (§11.4). Admins must turn it on (DEPLOY.md). |
| `/` | Guest: start page (start.html). Signed-in client → `/tarsene`; partner → `/partner`; admin → `/admin` (D47). |

---

## 2. Platform settings (⚙)

`platform_settings` is key → JSON value, versioned by `effective_from`. A setting's value at instant *t* is the row with the greatest `effective_from ≤ t`.

- **Snapshots:** values that govern a record are copied onto it when it is created. Deadlines are copied at creation or approval; the commission rate, deposit % and policy are copied at payment. Later setting changes never move existing records (`‹Промяната важи само за нови резервации.›`).
- **Who edits:** only `manage_team_settings`, in `/admin/nastroyki`.
- **Defaults:** the values below are the defaults the seed writes.

| Key | Default | Unit / shape | Used by | Notes |
|---|---|---|---|---|
| `commission.standard_bp` | `1000` | basis points | §6 | ‹Стандартна ставка 10 %› |
| `commission.intro_bp` | `500` | bp | §6 | ‹Първите 3 резервации 5 %› |
| `commission.intro_count` | `3` | bookings | §6 | |
| `commission.business_bp` | `1000` | bp | §6 | ‹Бизнес клиенти 10 %› |
| `request.response_hours` | `24` | h | §4.5 | ‹Срок за отговор от изпълнител› |
| `request.partner_reminder_before_h` | `6` | h | §4.5 | `vendor-request-reminder` |
| `brief.offer_window_hours` | `24` | h | §4.6 | ‹офертите идват … до 24 часа› |
| `offer.confirm_hours` | `24` | h | §4.6 | ‹Потвърдете до 24 часа› |
| `payment.window_hours` | `24` | h | §4.7 | ‹Срок за плащане след одобрение› |
| `payment.client_reminders_before_h` | `[6, 2]` | h | §4.7 | `client-payment-reminder` |
| `payment.partner_reminder_before_h` | `6` | h | §4.7 | `vendor-payment-reminder` |
| `payment.team_alert_before_h` | `4` | h | §4.7 | `team-payment-deadline` (open dispute only) |
| `payment.extension_hours` | `24` | h | §4.7 | ‹Удължи срока› |
| **`payment.provider`** | `simulated` in dev/demo; `stripe` in production | `simulated` \| `stripe` | §7 | You can only pick a provider whose credentials exist in the environment. A charge keeps the provider it was created with (D5). |
| **`payment.schedule`** | `{ "mode": "full", "deposit_percent": null, "balance_due_days": 30 }` | object | §7.2 | `mode`: `full` (prototype behaviour: the whole amount at payment) or `deposit_balance`. `deposit_percent`: `null` = the booking's policy deposit % (20–50), or a fixed platform %. `balance_due_days`: the balance is charged this many days before the event; must be ≥ 14 (§7.2). Legal/payment research says this must be configurable (D5). |
| **`payment.provider_max_hold_days`** | `null` (simulated); `90` (stripe) | days | §7.4 | The provider's limit on holding funds. Drives the early deposit release. |
| `payment.bank_transfer_enabled` | `true` | bool | §7.3 | ‹Банков превод› option. |
| `payout.days` | `[1, 15]` | days of month | §8 | ‹1-во и 15-то число› |
| `payout.hold_days_after_event` | `1` | days | §8 | ‹до деня след събитието› |
| `payout.prepare_time` | `"09:00"` | Sofia time, on the day before the batch | §8 | `team-batch-ready` |
| `payout.require_second_admin` | `false` | bool | §8 | Two-person release (D40) |
| `partner.approval_sla_hours` | `48` | h | §4.2 | Shown to partners |
| `partner.approval_target_hours` | `24` | h | §4.2 | Internal; ‹целта е 24 часа› |
| `partner.max_packages` | `5` | count | §4.4 | ‹до пет пакета› (fixed-price packages; on-request services and add-ons are not counted) |
| `partner.gallery_min` / `partner.gallery_max` | `4` / `8` | photos | §4.2 | |
| `partner.name_change_interval_months` | `1` | months | §4.2 | ‹Името се сменя веднъж месечно.› |
| `dispute.team_reply_hours` | `24` | h | §4.11 | Target shown to users |
| `dispute.position_hours` | `48` | h | §4.11 | |
| `reminders.client_event_days` | `[7, 1]` | days | §11 | |
| `reminders.partner_event_days` | `[7]` | days | §11 | |
| `reminders.send_time` | `"09:00"` | Sofia | §11 | Event reminders (D37) |
| `reviews.invite_days_after` / `reviews.invite_time` | `1` / `"10:00"` | days / Sofia time | §4.12 | (D37) |
| `reviews.paid_only` | `true` | bool, locked on in v1 | §4.12 | (D53) |
| `moderation.manual` | `true` | bool | §4.4 | ‹Ръчна модерация на всяка нова обява› |
| `digest.time` | `"09:00"` | Sofia | §11 | `team-daily-digest` |
| `saved_search.scan_time` | `"08:00"` | Sofia | §13.9 | (D21) |
| `cancellation.policies` | the three policies of §5 | object | §5 | ‹Политики за анулиране› · ‹Редактирай›. Snapshotted on the booking. |
| `locale.en_enabled` | `false` | bool | §11 | While false, `‹EN›` shows the toast ‹Английската версия идва скоро›. |
| `uploads.max_photos` / `uploads.max_mb` | `6` / `5` | count / MB | §14 | ‹До 6 снимки · JPG или PNG, до 5 MB всяка› |
| `support.email` / `sender.email` | `help@eventat.bg` / `no-reply@eventat.bg` | | | |
| `demo.bank_transfer_details` | `{ "recipient": "EventAT", "iban": "BG80 BNBG 9661 1020 3456 78" }` | | §7.3 | Simulated provider only. With a real provider the IBAN comes from the provider per charge (D6). |
| `clock_offset_ms` | `0` | ms | §0 | Demo only (`ALLOW_TIME_TRAVEL`). |
| `sms.transport` | `outbox` | `outbox` \| provider id | §11.4 | SMS recorded only until a provider is contracted |
| `platform.legal_entity` | — (to be supplied) | object: name, ЕИК, VAT no., address | §9 | Issuer of commission invoices (D41) |

Settings UI (`/admin/nastroyki`) shows commission, policies, deadlines, moderation, review gating, languages and categories (prototype). It also needs a „Плащания“ block for `payment.provider`, `payment.schedule` and `payment.bank_transfer_enabled`. Those labels are new copy and need Nikola's approval (D5).

---

## 3. Deadlines and timers (Europe/Sofia)

Every timer is a `job` row with a `dedupe_key`. Handlers re-check state and are idempotent: a job whose situation has changed does nothing. Re-scheduling the same key moves `run_at`.

| # | Timer | Fires at | Condition re-checked | Effect | Job kind / dedupe key |
|---|---|---|---|---|---|
| T1 | Partner response reminder | `request.response_due_at − 6 h` | request `pending` | `vendor-request-reminder` | `request.reminder` / `request:<id>:reminder` |
| T2 | Request lapse | `request.response_due_at` (= `sent_at + 24 h`) | request `pending` | → `expired`; `client-request-expired`, `vendor-request-expired`; bell to both | `request.expire` / `request:<id>:expire` |
| T3 | Brief invitation lapse | `invitation.offer_due_at` (= brief `sent_at + 24 h`) | invitation `invited` | → `lapsed` (no email) | `brief.invitation_expire` |
| T4 | Chosen-offer confirmation lapse | `request.response_due_at` (= `chosen_at + 24 h`) for `kind = brief` or `quote` in `awaiting_confirmation` | still `awaiting_confirmation` | → `expired`; `client-request-expired`, `vendor-request-expired` (D23) | `request.expire` |
| T5 | Client payment reminders | `booking.payment_due_at − 6 h` and `− 2 h` | booking `awaiting_payment` | `client-payment-reminder` (optional; subject shows the hours left) | `booking.client_pay_reminder` / `booking:<id>:payrem:6`, `:2` |
| T6 | Partner payment reminder | `payment_due_at − 6 h` | `awaiting_payment` | `vendor-payment-reminder` (optional) | `booking:<id>:vpayrem` |
| T7 | Team payment alert | `payment_due_at − 4 h` | `awaiting_payment` **and** an open dispute on the booking or its request | `team-payment-deadline` | `booking:<id>:teamalert` |
| T8 | Payment expiry | `payment_due_at` | `awaiting_payment` (bank transfers included, D6) | → `payment_expired`; hold released; `client-payment-expired`, `vendor-hold-expired`; date watches fire (`client-date-freed`) | `booking.payment_expire` |
| T9 | Balance charge (deposit mode) | `sofiaInstant(event_date − balance_due_days, 10:00)` | booking `confirmed`, `balance_cents > 0` and no `balance` charge succeeded | Off-session charge (§7.2) | `booking.balance_charge` |
| T10 | Balance retry / default | charge failed: retry every 24 h, up to 3 times; last check at `event_date − 7 days 10:00` | balance still unpaid | Cancelled for non-payment (§7.2) | `booking.balance_default` |
| T11 | Client event reminders | `sofiaInstant(event_date − 7, 09:00)` and `(event_date − 1, 09:00)` | Event has ≥ 1 `confirmed` booking | `client-event-reminder` (one per client event, listing every confirmed booking) | `event:<id>:remind:7`, `:1` |
| T12 | Partner event reminder | `sofiaInstant(event_date − 7, 09:00)` | booking `confirmed` | `vendor-event-reminder` | `booking:<id>:vremind` |
| T13 | Booking completion | `sofiaInstant(event_date + 1, 00:00)` | booking `confirmed` | → `completed`; funds released to the partner (ledger §7.5) unless a dispute holds them; payout item joins the next batch | `booking.complete` |
| T14 | Review invite | `sofiaInstant(event_date + 1, 10:00)` | booking `completed`, no review | `client-review-invite` (optional) | `booking:<id>:reviewinvite` |
| T15 | Dispute position deadline | `dispute.position_due_at` (= `position_requested_at + 48 h`) | dispute `collecting`, no statement from the other side | → `awaiting_decision`; `team-dispute-deadline` | `dispute:<id>:position` |
| T16 | Dispute compliance deadline | `dispute.compliance_due_at` | decision `enforce_terms` with fallback, and the team has not marked it complied | Fallback runs (cancel + full refund) | `dispute:<id>:compliance` |
| T17 | Payout batch preparation | `sofiaInstant(batch_date − 1, 09:00)` | — | Batch `scheduled → ready`; `team-batch-ready` | `payouts.prepare` / `batch:<date>` |
| T18 | Early deposit release (stripe) | `charge.succeeded_at + (provider_max_hold_days − 7) days` | booking still `confirmed`, event in the future, funds still held | Releases that charge's partner share (§7.4) | `charge:<id>:holdlimit` |
| T19 | Team daily digest | every day at 09:00 | ≥ 1 open task | `team-daily-digest` to every admin with `approve_partners`, `moderate_listings` or `resolve_disputes` | `digest:<date>` |
| T20 | Saved-search scan | every day at 08:00 | `saved_search.notify = true` | `client-saved-search-alert` when new matches appeared since `last_alerted_at` | `savedsearch:<date>` |
| T21 | Date-watch expiry | `sofiaInstant(watch.date + 1, 00:00)` | watch `watching` | → `expired` | `datewatch:<id>:expire` |
| T22 | Verification code expiry | `code.created_at + 10 min` | — | Code invalid (D49) | Better Auth |
| T23 | Password-reset link | 60 min | — | Link invalid (D50) | Better Auth |
| T24 | Account deletion link | 24 h | not confirmed | Request `expired`; the account stays active | `deletion:<id>:expire` |
| T25 | Team invite | 7 days | `pending` | → `expired` (D50) | `teaminvite:<id>:expire` |
| T26 | Email delivery retry | each tick | outbox `queued` | Up to 5 attempts | `deliverQueued()` |

**Deadline clamps:**
- `request.response_due_at = min(sent_at + 24 h, event start instant − 1 h)`.
- `payment_due_at = min(approved_at + 24 h, event start instant)`.
- The event start instant is `sofiaInstant(event_date, start_time ?? 00:00)`.
- A request cannot be sent with fewer than the partner's lead-time days left (§12.6), so these clamps only bite on same-day partners.

**Working days** (bank-transfer copy, payout-account check ‹до два работни дни›): Monday–Friday, excluding Bulgarian public holidays, from the `public_holiday` reference table.

## 4. State machines

Each machine lists:
- **States:** the enum value and its label per audience. "—" means the state is not shown to that audience; "new copy" means the prototype has no label yet.
- **Transitions:** what moves the record between states. Only the listed domain function may perform a transition, inside one DB transaction, and that same transaction writes `audit_log`, queues the emails (`sendEmail(…, tx)`), adds the bell items (`notify(…, tx)`) and schedules or cancels the jobs.

**Bell rule (D54).** Every email to a client or partner also adds a bell item.
- **Title and body:** the prototype's notice pattern where one exists, otherwise the email's heading as title and its preheader as body.
  - `client-request-approved` → ‹{Партньор} одобри заявката ви› / ‹Платете до {срок}, за да запазите датата›
  - `client-offer-received` → ‹{Партньор} отговори на запитването› / ‹{оферта} · {сума}›
  - `client-booking-confirmed` → ‹Резервацията за {14 юни} е потвърдена› / ‹{Партньор} · {Пакет}›
  - `vendor-new-request` → ‹Нова заявка от {Клиент}› / ‹{Тип} · {дата} · отговорете до 24 часа›
  - `vendor-booking-confirmed` → ‹Плащане получено · {Получавате}› / ‹{Тип} · {14 юни} · {Домакини}›
  - `vendor-new-review` → ‹Ново ревю с {N} звезди› / ‹{Автор} · „{начало на текста}“›
- **Link:** the email's CTA route.
- **Suppressed emails:** a bell item is still added for an optional email the recipient switched off. Only the email is suppressed.
- **Admin bell:** computed live, not stored. Pending partners with the oldest wait, open disputes with the held total, and the next payout batch with partner count and net (`NOTICES.admin`).

### 4.1 Client account (`user` with role `client`)

| State | Stored as | Label (admin) |
|---|---|---|
| `unverified` | `email_verified = false` | — |
| `active` | verified, not banned, not deleted | ‹Активен› |
| `blocked` | `banned = true` | ‹Блокиран› |
| `deletion_requested` | open `account_deletion_request` | — |
| `deleted` | `deleted_at` set, personal data anonymised | — |

| # | From → To | Trigger (UI label / event) | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| A1 | ∅ → unverified | ‹Създай профил› on `/registratsiya` | guest | ‹Приемам Общите условия и Политиката за поверителност› ticked; email not taken; password ≥ 8 chars | `user` (role client, phone), `client_profile`, consent rows; 6-digit code → `client-verify-code` |
| A2 | unverified → unverified | ‹Поискайте нов› (after the countdown, 60 s) | guest | cooldown passed | New code (the old one is invalidated); `client-verify-code`; toast ‹Изпратихме нов код› |
| A3 | unverified → active | ‹Потвърди› with the correct code | guest | code valid (10 min, 5 attempts) | `email_verified = true`; session; `client-welcome`; toast ‹Профилът е създаден›; redirect `next` or `/tarsene` |
| A4 | ∅ → active | ‹Продължи с Google› / ‹Продължи с Facebook› | guest | provider email verified | `account` row; `client-welcome`; toast ‹Профилът е създаден› |
| A5 | active → active | ‹Смени паролата› / ‹Забравена парола?› | client | — | Reset link → `client-password-link` (same response whether or not the email exists) |
| A6 | active → active | New password saved via the link | client | token valid (60 min) | `password_changed_at`; all other sessions revoked; `client-password-changed` |
| A7 | active → active | Two-step toggle on | client | phone present | `two_factor_enabled = true`; `client-2fa-on`. Turning it off sends no email. |
| A8 | active → active | ‹Излез навсякъде› | client | — | Every session revoked; `client-signout-all`; redirect `/` |
| A9 | active → deletion_requested | ‹Изтрий профила› | client | — | `account_deletion_request` (24 h token); `client-delete-confirm`; toast ‹Изпратихме имейл за потвърждение на изтриването› |
| A10 | deletion_requested → deleted | ‹Потвърди изтриването› (email link) | client | — | Anonymise the profile (name → ‹Изтрит профил›, new copy; email → `deleted+<id>@eventat.invalid`; phone null). Confirmed bookings stay valid until the event. Payments, invoices and ledger are kept (legal retention). Sessions are revoked. |
| A11 | deletion_requested → active | link not used in 24 h | system | — | Request `expired` |
| A12 | active → blocked | ‹Блокирай профила› (`/admin/klienti/[id]`) | admin | §1.2 | `banned = true`; sessions revoked; `client-account-blocked`; toast ‹Профилът е блокиран›. Open requests stay as they are; blocked clients cannot send new ones. |
| A13 | blocked → active | not in the prototype (D39) | admin | — | — |

Changing the email in ‹Настройки› sends a verification code to the new address, and the email changes only after it is confirmed (D55, new copy).

### 4.2 Partner account (`partner.status`)

| State | Partner label | Admin label |
|---|---|---|
| `draft` | onboarding wizard (‹Стъпка N от 6›) | — |
| `submitted` | pending.html (‹Преглед от екипа›) | ‹Чака› |
| `returned` | onboarding, step 6 with the team's note | ‹Върнат за поправка› |
| `rejected` | — (cannot sign in to the panel; sees the rejection email) | ‹Отказан› |
| `approved` | panel | ‹Активен› |
| `deactivated` | panel (profile hidden) | ‹Деактивиран› |
| `deleted` | — | — |

Listing flags on `approved` partners (no email, take effect immediately):
- `is_listed`: ‹Профилът е активен› / ‹Виден в каталога и търсенето.›
- `accepting_requests`: ‹Приемам нови заявки› / ‹Изключете временно, ако сте заети.›

A partner is **publicly visible** iff `status = 'approved' AND is_listed`. It **can receive requests** iff publicly visible `AND accepting_requests`.

| # | From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| P1 | ∅ → draft | ‹Създай профил› on `/registratsiya?as=partner` | guest | consent ticked | `user` (role partner), `partner` (business_name, contact_name, phone, notification_email), `partner_member` (owner); `vendor-verify-code` |
| P2 | (email) | ‹Потвърди› / social sign-up | guest | code valid | `vendor-welcome`; toast ‹Имейлът е потвърден›; redirect `/partner/registratsiya/1` |
| P3 | draft → draft | ‹Продължи към …› / ‹Назад› / ‹Запази и продължи по-късно› / ‹Изход› / logo | partner | step validation (§12.1) only on ‹Продължи› | Fields saved, `onboarding_step`, `draft_saved_at`; toast ‹Черновата е запазена› on exit |
| P4 | draft/returned → submitted | ‹Подай за одобрение› | partner | All 6 steps valid; both checkboxes ticked (‹Приемам Условията за партньори и Политиката за поверителност.›, ‹Потвърждавам, че информацията е вярна и нося отговорност за нея.›) | `submitted_at`; consents; services → `ready`; the 6 `partner_check` rows created (`waiting`); provider account created (`createPartnerAccount`); `vendor-application-received`, `team-vendor-application`; redirect `/partner/registratsiya/podadeno` |
| P5 | submitted → approved | ‹Одобри› | team (`approve_partners`) | — | `approved_at`, `approved_by`; `ready` services → `active` (published); `partner_decision`; `vendor-application-approved`; toast ‹Профилът е одобрен›. The bank account may still be `waiting` (‹Може да одобрите и без банкова сметка.›); payouts wait for it (§8.3). |
| P6 | submitted → returned | ‹Върни за поправка› | team | note required | `partner_decision` with note; `vendor-application-returned`; toast ‹Профилът е върнат за поправка› |
| P7 | submitted → rejected | ‹Откажи заявката› | team | note (the reason) required | `partner_decision`; `vendor-application-rejected`; toast ‹Заявката е отказана› |
| P8 | approved → deactivated | ‹Деактивирай› (`/partner/nastroyki`) | partner | — | Hidden from every listing; confirmed bookings stay; pending requests stay answerable; `vendor-deactivated`; toast ‹Профилът е деактивиран — можете да го върнете по всяко време› |
| P9 | deactivated → approved | reactivate in settings (control not drawn; new copy) | partner | — | Listed again (D24) |
| P10 | approved/deactivated → deleted | ‹Изтрий› → email link ‹Потвърди изтриването› | partner | **no upcoming bookings** (`confirmed` with `event_date ≥ today`) and no open dispute | `vendor-delete-confirm` first; on confirm the user and partner are anonymised and services archived; ledger and invoices are kept. With upcoming bookings the button is disabled (D56). |
| P11 | (any) | `account.updated` webhook | provider | — | `partner.provider_status` updated (`charges_enabled`, `payouts_enabled`, requirements) |

**Profile checks** (`partner_check.kind` — admin/vendor.html; ‹профил N от 6› = number of `ok` checks):

| Kind | List label | Detail label | ok example |
|---|---|---|---|
| `company` | ‹Данни за фирмата› | ‹ЕИК проверен› | ‹ЕИК 207845112 · Лунна Фотография ЕООД · проверено в Търговския регистър› |
| `contacts` | ‹Контакти› | ‹Контакти потвърдени› | ‹Телефон и имейл потвърдени› |
| `gallery` | ‹Галерия› | ‹Собствени снимки› | ‹14 снимки · няма водни знаци от други студия› |
| `services` | ‹Услуги и цени› | ‹Услуги и цени› | ‹3 пакета · от 780 € до 2 400 €› (computed) |
| `cancellation_policy` | ‹Политика за анулиране› | ‹Политика за анулиране› | ‹Умерена · безплатно до 30 дни› (computed) |
| `bank_account` | ‹Банкова сметка› | ‹Банкова сметка› | waiting: ‹IBAN подаден, чака потвърждение от банката› |

`company`, `contacts` and `gallery` are set by the team. `services`, `cancellation_policy` and `bank_account` are computed (ok when ≥ 1 active fixed package, a policy is chosen, and the payout account is `confirmed`). ‹Провери› on a waiting check opens the partner page.

### 4.3 Payout account (`payout_account.status`)

| State | Partner label | Admin label |
|---|---|---|
| `pending_verification` | ‹Новата сметка чака проверка› | ‹чака проверка› |
| `confirmed` | ‹Потвърдена› | ‹Потвърдена› |
| `rejected` | new copy | new copy |
| `superseded` | — | — |

| # | From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| B1 | ∅ → pending_verification | ‹Запази сметката› (`/partner/smetka`) after ‹Качи документ› | partner | Valid BG IBAN (mod-97); holder = `partner.legal_name`; bank selected; document uploaded | `partner.payouts_paused = true`; `vendor-payout-account-submitted`, `team-payout-account`; toast ‹Сметката е изпратена за проверка›. Held amounts stay reserved. |
| B2 | pending_verification → confirmed | ‹Провери сметката› → confirm (`/admin/plashtaniya`) | team (`view_finance`) | — | Previous confirmed → `superseded`; the external account is set at the provider; `payouts_paused = false`; `bank_account` check ok; `vendor-payout-account-confirmed` |
| B3 | pending_verification → rejected | team rejects (control not drawn; new copy) | team | reason | Previous account stays confirmed; payouts resume on it (D57) |

### 4.4 Service and service revision

`service.status`:

| State | Partner label | Admin label |
|---|---|---|
| `draft` | ‹Чернова› | — |
| `pending_review` | ‹В преглед› | ‹нова услуга› (queue) |
| `returned` | ‹Върната с бележка› (new badge copy, D58) | — |
| `ready` | ‹Готов› (onboarding review) | — |
| `active` | ‹Активна› | — |
| `archived` | ‹Архив› (tab) | — |

`service_revision.status` (an edit of an `active` service): `pending` → `approved` | `returned`. While pending, the partner sees ‹Активна · промените чакат преглед›. The admin queue label is ‹редакция›.

| # | From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| S1 | ∅ → draft | ‹Запази като чернова› | partner | name present | toast ‹Черновата е запазена› |
| S2 | ∅/draft/returned → pending_review | ‹Изпрати за преглед› | partner | Valid (§12.2); partner `approved`; fixed packages ≤ 5 | `service_revision` (`type = new`, payload = full service); `vendor-service-submitted`; toast ‹Услугата е изпратена за преглед›. With `moderation.manual = false`: → `active` at once and `vendor-service-published` only. |
| S3 | pending_review → active | ‹Публикувай› | team (`moderate_listings`) | — | `published_at`; revision approved; `vendor-service-published`; toast ‹Обявата е публикувана› |
| S4 | pending_review → returned | ‹Върни с бележка› | team | note required (can pick ‹Чести бележки›) | `vendor-service-returned`; toast ‹Обявата е върната с бележка› |
| S5 | onboarding (draft partner) → ready | onboarding step 3 valid | partner | — | Listed with the profile on P5 (→ `active`). Not moderated separately. |
| S6 | active → active (revision pending) | ‹Запази промените› with content changes | partner | valid | `service_revision(type = edit, payload = field diff, status = pending)`; the live version stays bookable; `vendor-service-change-submitted`; toast ‹Промените са изпратени за преглед›. A second save replaces the pending revision. |
| S7 | revision pending → approved | ‹Одобри› | team | — | Payload applied to the service; `vendor-service-change-approved`; toast ‹Промяната е одобрена› |
| S8 | revision pending → returned | ‹Върни с бележка› | team | note | Live version unchanged; the note shows in the editor; `vendor-service-change-returned` |
| S9 | active ↔ draft | Visibility ‹Активна› / ‹Чернова› on the edit page | partner | → active only if `published_at` is set | Immediate, not moderated (D59) |
| S10 | active/draft → archived | ‹Архивирай› | partner | — | Hidden from the profile; existing requests and bookings unaffected; toast ‹Услугата е архивирана› |

Ordering (‹Подреди›) writes `sort_order`; the first active fixed package is ‹Препоръчан›. Toast ‹Подредбата е запазена›.

### 4.5 Request (`request.status`) — заявка to one partner

`request.kind`:
- `package`: a fixed-price service, catalogue ‹Избери› / ‹Изпрати запитване›.
- `quote`: a `‹По запитване›` service. The partner must answer with an offer.
- `brief`: created when the client chooses an offer on an open request (§4.6).

| State | Client label | Partner label | Admin label |
|---|---|---|---|
| `pending` | ‹Чака отговор› | ‹Нова› (`package`) / ‹Чака оферта› (`quote`) | ‹Чака отговор› |
| `offer_sent` | ‹Нова оферта› (email trigger label) | new copy | new copy |
| `awaiting_confirmation` | ‹Избрана оферта› (email trigger label) | ‹Избрана оферта› | ‹Избрана оферта› |
| `approved` | → see booking (§4.7) | → booking | → booking |
| `declined` | reason, e.g. ‹Датата е заета› · ‹отказана на {10 авг}› | ‹Отказана› | ‹Отказана› |
| `expired` | ‹Изтекла› | ‹Изтекла› | ‹Изтекла› |

Client list groups (`/akaunt/zayavki`):
- ‹Одобрени · чакат плащане›: request `approved` and booking `awaiting_payment`.
- ‹Чакат отговор›: `pending`, `awaiting_confirmation`.
- Offers group: `offer_sent`; the group title is new copy (D60).
- ‹Приключени›: `declined`, `expired`, and requests whose booking is `payment_expired` or `approval_withdrawn`.

Confirmed bookings are listed under ‹Резервации›.

| # | From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| R1 | ∅ → pending | ‹Изпрати заявката› (`/zayavka/[partner]`) | client | Partner can receive requests; the service is `active` and accepts requests; the date passes the availability rules (§12.6); guests ≤ `max_guests` if set; no other active request from this client to this partner for this date; client verified and not blocked | Number allocated (D2); snapshots: event fields, service, `amount_cents` (`package`) or null (`quote`), contact phone; `response_due_at` (§3); `client_event` matched or created (D15); conversation created; attachments; jobs T1, T2; `client-request-sent` + `vendor-new-request` (`package`) or `vendor-new-inquiry` (`quote`) |
| R2 | pending → pending | ‹Поискай още информация› | partner | — | A message from the partner in the request's conversation; `client-new-message`; toast ‹Въпросът е изпратен на клиента›. The 24 h clock keeps running (D61). |
| R3 | pending → approved | ‹Одобри заявката› (`package`) | partner | Date still free (§12.6, holds included); `now < response_due_at`; with stripe, `provider_status.charges_enabled` (D62) | Booking created (§4.7 K1); `client-request-approved`, `vendor-request-approved`; jobs T1/T2 cancelled; T5–T8 scheduled |
| R4 | pending → offer_sent | ‹Изпрати оферта› (`quote`; control new copy, D60) | partner | amount > 0, title; before `response_due_at` | `offer` row (`amount_cents`, `title`, `description`); `client-offer-received`; T2 cancelled. No date hold. |
| R5 | offer_sent → awaiting_confirmation | client chooses the offer (new copy, D60) | client | offer still valid (§4.6) | `response_due_at = chosen_at + 24 h` (T4); `vendor-offer-chosen` |
| R6 | awaiting_confirmation → approved | ‹Потвърди офертата› (rendered as ‹Одобри заявката› on the request page, D60) | partner | as R3 | `amount_cents` = the offer amount; as R3 |
| R7 | pending / awaiting_confirmation → declined | ‹Откажи› + reason | partner | — | `decline_reason` (‹Датата е заета› or free text, D63); `client-request-declined`; toast ‹Заявката е отказана›; jobs cancelled. Client CTA ‹Виж подобни› and the date-watch offer. |
| R8 | pending / awaiting_confirmation → expired | T2 / T4 | system | still in that state | `client-request-expired`, `vendor-request-expired`. Counts against `partner.responsiveness`. |
| R9 | pending → declined (auto) | another booking for that partner and date became `confirmed` and capacity is now full (§12.6) | system | — | reason ‹Датата е заета›; `client-request-declined` (D64) |
| R10 | offer_sent → expired | the offer lapses (§4.6 O5) | system | — | No email (D60) |

A client cannot withdraw a pending request in v1 (no control in the prototype).

### 4.6 Open request (brief), invitation, offer

**`brief.status`**:

| State | Client label |
|---|---|
| `open` | appears under ‹Моите заявки› with its offers |
| `offer_chosen` | the chosen offer continues as a `request` (`kind = brief`) |
| `closed` | — |

**`brief_invitation.status`**: `invited`, `offered`, `declined`, `lapsed`.

**`offer.status`** (offers on briefs and quote requests):

| State | Client | Partner |
|---|---|---|
| `sent` | offer card (new copy) | new copy |
| `chosen` | → request | ‹Избрана оферта› |
| `not_chosen` | — | ‹Неизбрана оферта› (email trigger label) |
| `lapsed` | — | — |
| `withdrawn` | — | — |

| # | From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| O1 | ∅ → brief `open` | ‹Изпрати запитването› (`/zayavka/otvorena`) | client | ≥ 1 category (‹изберете поне една›), date, city, guests, event type | Matching (below) creates one `brief_invitation` per partner; T3 per invitation; `client-brief-sent` to the client; `vendor-new-inquiry` to each partner; toast ‹Запитването е изпратено — потвърждението е на имейла ви, а офертите идват в „Моите заявки“›; redirect `/akaunt/zayavki` |
| O2 | invitation `invited` → `offered`, offer ∅ → `sent` | partner submits an offer (control new copy) | partner | before `offer_due_at`; the date is still free | Number allocated for the offer (D2); `client-offer-received` |
| O3 | invitation `invited` → `declined` | ‹Откажи› | partner | — | No email (D60) |
| O4 | invitation `invited` → `lapsed` | T3 | system | — | No email |
| O5 | offer `sent` → `lapsed` | the partner's date becomes unavailable (another booking or a manual block), or `event_date` passes | system | — | No email (D60) |
| O6 | offer `sent` → `chosen`; the brief's other `sent` offers → `not_chosen`; brief → `offer_chosen` | client chooses (new copy) | client | offer `sent` | `request` created with `kind = brief`, the offer's number, `amount = offer.amount_cents`, `status = awaiting_confirmation`, `response_due_at = now + 24 h` (T4); `vendor-offer-chosen` to the chosen partner; `vendor-offer-not-chosen` to the others (‹Нищо не се променя в календара ви.›) |
| O7 | brief `open` → `closed` | `event_date` passes with no choice | system | — | Remaining offers `lapsed` |

**Matching (O1).** A partner gets an invitation iff ALL hold:
- publicly visible and accepting requests;
- has an `active` service in one of the chosen categories (or that category is its primary);
- serves the brief's city (§13.4 city rule);
- free on the date (§12.6);
- `max_guests` is null or ≥ guests;
- the date is within lead time and horizon.

Budget does not filter (D65).

### 4.7 Booking (`booking.status`)

A booking is created when a request is approved. It carries the money. Number = the request's number.

| State | Client label | Partner label | Admin label |
|---|---|---|---|
| `awaiting_payment` | ‹Одобрена · чака плащане› / ‹Остават HH:MM ч› | ‹Чака плащане› / ‹Одобрена · чака плащане› | ‹Чака плащане› |
| `confirmed` | ‹Потвърдена · платена› (hero) / ‹Потвърдена› | ‹Потвърдена› / ‹Датата е блокирана› | ‹Платена› |
| `cancellation_requested` | ‹Потвърдена› (unchanged for the client until the team acts) | ‹Искане за анулиране› (new badge copy, D58) | ‹Искане за анулиране› |
| `completed` | ‹Минали› group; ‹Чака вашето ревю› if no review | ‹Приключила› | ‹Приключила› |
| `payment_expired` | ‹Изтекъл срок за плащане› | ‹Неплатена заявка — датата е освободена› | ‹Изтекъл срок за плащане› |
| `approval_withdrawn` | ‹Оттеглено одобрение› | — | ‹Оттеглено одобрение› |
| `cancelled` | ‹Анулирана› | ‹Анулирана› | ‹Анулирана› |

`booking.cancelled_by`: `client` | `partner` (completed by the team) | `team` | `non_payment` | `dispute`.

| # | From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| K1 | ∅ → awaiting_payment | R3 / R6 | partner | — | `approved_at`; `payment_due_at` (§3 clamp); date hold (§12.6); payment plan computed (§7.2) as `due_now_cents` and `balance_cents`; snapshots: `cancellation_policy`, `deposit_percent` (the commission is snapshotted at payment, §6); jobs T5–T8 |
| K2 | awaiting_payment → awaiting_payment | ‹Напомни на клиента› | partner | — | `client-payment-reminder`; toast ‹Напомнянето е изпратено› |
| K3 | awaiting_payment → awaiting_payment | ‹Удължи срока› / ‹Удължи срока с 24 часа› | team | §1.2 | `payment_due_at += 24 h`; `payment_extension` row; T5–T8 rescheduled; `client-payment-extended`, `vendor-payment-deadline-extended`; toast ‹Срокът е удължен с 24 часа› (list) / ‹Срокът за плащане е удължен с 24 часа› (case page) |
| K4 | awaiting_payment → approval_withdrawn | ‹Отмени одобрението› | partner | no charge `succeeded` or `pending` | Hold released; jobs cancelled; `client-approval-withdrawn`; date watches → `client-date-freed` |
| K5 | awaiting_payment → confirmed | the first charge `succeeded` (card, or bank transfer received) | provider | — | `paid_at`; commission rate snapshot (§6); hold → booked; contact phone revealed to the partner (§10); invoice issued (§9); ledger posting L1; T5–T8 cancelled; T9 (deposit mode), T11, T12, T13, T14 scheduled; R9 auto-declines; O5 offers lapse; `client-booking-confirmed`, `client-invoice`, `vendor-booking-confirmed` |
| K6 | awaiting_payment → payment_expired | T8 | system | no `succeeded` charge; an `awaiting_transfer` charge does not stop it (D6) | Hold released; open charge → `expired`; `client-payment-expired`, `vendor-hold-expired`; date watches → `client-date-freed` |
| K7 | confirmed → cancelled | ‹Анулирай резервацията› (`/akaunt/rezervacii/[nomer]/anulirane`) | client | `days_before ≥ 0` (§5); no open dispute | Cancellation quote (§5) stored in `cancellation`; refund (§4.9) for `refund_cents`; booking `cancelled_by = client`; date released; pending jobs cancelled; the retained amount stays held until `event_date + 1`, then is released to the partner (§8, D11); `client-cancel-confirmed`, `vendor-client-cancelled`; `client-refund-sent` when the refund succeeds; date watches → `client-date-freed`; toast ‹Резервацията е анулирана — изпратихме ви потвърждение по имейл› |
| K8 | confirmed → cancellation_requested | ‹Анулиране› (`/partner/rezervacii/[nomer]`) | partner | event in the future | `partner_cancellation_request`; `vendor-cancel-requested`, `team-vendor-cancel`; toast ‹Изпратихме искането за анулиране — екипът се свързва с клиента› |
| K9 | cancellation_requested → cancelled | ‹Анулирай резервацията› on `/admin/rezervacii/[nomer]` (D66) | team (`resolve_disputes`) | — | Full refund of everything paid; the partner receives 0,00 € and commission 0; `cancelled_by = partner`; date released; `client-vendor-cancelled`, `vendor-cancel-completed`; `client-refund-sent` when the refund succeeds; date watches fire |
| K10 | cancellation_requested → confirmed | team declines the partner's request (control new copy) | team | — | No email in the prototype (D66) |
| K11 | confirmed → cancelled | team cancels directly (`‹Анулирай резервацията›`, D66) | team | reason required | Refund amount chosen by the team (default: the §5 quote as if the client cancelled today); `cancelled_by = team`; emails as K9 |
| K12 | confirmed → cancelled | T10 (deposit mode, balance unpaid) | system | — | `cancelled_by = non_payment`; computed as a client cancellation on that date limited to the amount paid (§5.4); new email keys needed (D5) |
| K13 | confirmed → completed | T13 | system | — | Ledger L3 release, unless an open dispute with `holds_payout` (then the release waits for the decision); payout item (§4.10); T14 |
| K14 | confirmed/completed → (dispute) | a dispute is opened (§4.11) | client / partner / team | — | `payout_hold` while the dispute holds the payout |
| K15 | awaiting_payment / confirmed → cancelled | dispute decision `cancel_*` (§4.11) | team | — | As K11, refund per the decision |
| K16 | awaiting_payment → awaiting_payment | dispute decision `restore_price` / `accept_new_price` | team | — | `amount_cents` changed; `restore_price` resets `payment_due_at = decided_at + 24 h` |

A booking cannot be moved to another date in v1. The partner's `reschedule_policy` is shown but no reschedule flow exists in the prototype (D35).

### 4.8 Charge (`charge.status`) — one payment attempt for a booking

`charge.kind`: `full` | `deposit` | `balance`. `charge.method`: `card` | `bank_transfer`.

| # | From → To | Trigger | Actor | Side effects |
|---|---|---|---|---|
| C1 | ∅ → pending | ‹Плати 1 450 €› (card) on `/plashtane/[nomer]` | client | `createCheckout()` (the provider's hosted card form, never our own card fields); redirect. Re-pressing reuses the open checkout. |
| C2 | ∅ → awaiting_transfer | ‹Банков превод› selected and confirmed | client | The provider's transfer instructions (IBAN and reference = booking number); `client-bank-transfer`; booking stays `awaiting_payment` until it succeeds or T8 fires (D6) |
| C3 | pending/awaiting_transfer → succeeded | provider `charge.succeeded` | provider | `card_brand`, `card_last4`, `provider_ref`, `customer_ref`, `payment_method_ref` (deposit mode); booking K5 (first success) or the balance is paid; ledger L1 |
| C4 | pending → failed | provider `charge.failed` | provider | The booking stays `awaiting_payment`; the payment page shows the failure (new copy) |
| C5 | pending/awaiting_transfer → expired | T8, or the checkout session expired | system / provider | — |
| C6 | succeeded → partially_refunded / refunded | refund `succeeded` (§4.9) | provider | `refunded_cents` increased |
| C7 | (balance) ∅ → pending → succeeded/failed | T9 `chargeOffSession()` | system | Failure → T10 retries (§7.2) |

Duplicate charges (e.g. case 2025-0426-ФТ ‹Двойно плащане›) are possible with bank transfers or provider retries. A second `succeeded` charge on an already fully paid booking is flagged `duplicate = true` and shown to the team; the remedy is a dispute decision `refund_duplicate`.

### 4.9 Refund (`refund.status`)

`refund.reason`:
- `client_cancel` ‹Анулиране в срок›
- `partner_cancel` ‹Анулиране от изпълнителя›
- `team_cancel`
- `dispute_decision` ‹Решение по сигнал›
- `duplicate_charge` ‹Двойно плащане›

| # | From → To | Trigger | Side effects |
|---|---|---|---|
| F1 | ∅ → pending | K7, K9, K11, K12, K15, D-decisions | `refund()` against the original charge(s), newest first, until the amount is covered; `refund_application_fee = true` in proportion |
| F2 | pending → succeeded | provider `refund.succeeded` (or the synchronous result) | Ledger L2; `client-refund-sent` (details: ‹Платено›, ‹Върнати›, ‹Карта›) |
| F3 | pending → failed | provider `refund.failed` | Team bell + `audit_log`; no client email (D67) |

Refunds always go back to the card or account that paid. For bank-transfer payers the provider returns the money to the sending account (D6).

### 4.10 Payout item and batch

**`payout_item.status`** (one line per partner per batch; it contains one or more `payout_line`s, one per booking):

| State | Partner label (earnings) | Admin label |
|---|---|---|
| `awaiting_event` | ‹Очаква събитие› | — (counted in ‹Задържани до събитията›) |
| `ready` | ‹Очаква събитие› until paid | ‹Готово› |
| `held` | ‹Очаква събитие› | ‹Задържано› + reason (`dispute` ‹Виж спора›, `account_check`, `provider_disabled`, `returned`) |
| `sent` | ‹Очаква събитие› | ‹Пусната› |
| `paid` | ‹Изплатено› | ‹Изплатена› (batch) |
| `failed` | new copy | ‹Неуспешен превод› (email trigger label) |
| `released_early` | new copy (D5) | new copy |

**`payout_batch.status`**: `scheduled` → `ready` → `released` → `paid` (or `partially_failed`).

| # | Transition | Trigger | Actor | Side effects |
|---|---|---|---|---|
| Y1 | line created `awaiting_event` | K5 (`batch_date` computed, §8) | system | — |
| Y2 | line → `ready` | K13 (or K7 release at `event_date + 1`) | system | Partner share = retained − commission |
| Y3 | batch `scheduled` → `ready` | T17 | system | Lines with `batch_date ≤ this date`, `ready`, not held → grouped into one item per partner; held lines stay out; totals (gross, commission, net, held); `team-batch-ready` |
| Y4 | item `ready` → `held` | open dispute with `holds_payout`, `partner.payouts_paused`, or the provider's payouts disabled | system | Held items move to the next batch once cleared |
| Y5 | batch `ready` → `released` | ‹Пусни партидата› / ‹Пусни изплащанията› | team (`release_payouts`; plus a second admin if `payout.require_second_admin`) | Not before `batch_date` 00:00; `payout()` per item; items → `sent`; toast ‹Партидата е пусната› / ‹Изплащанията са пуснати› |
| Y6 | item `sent` → `paid` | provider `payout.paid` (simulated: immediately) | provider | Ledger L4; `vendor-payout-sent` **per payout line** (one per booking) |
| Y7 | batch → `paid` | all items `paid` | system | `team-batch-paid` |
| Y8 | item `sent` → `failed` | `payout.failed` | provider | Ledger L4 reversed; amount back in `partner_payable`; `partner.payouts_paused = true` until a new account is confirmed; `team-transfer-failed` |
| Y9 | — | ‹Счетоводна справка›, a history row click, ‹Експорт› | team | `report_job`; `team-batch-report` for batch reports; other exports need a new team email (D68) |

### 4.11 Dispute (`dispute.status`) — сигнал / кейс

| State | All audiences |
|---|---|
| `collecting` | ‹Събираме данни› |
| `awaiting_decision` | ‹Чака решение› |
| `resolved` | ‹Решен› |
| `withdrawn` | ‹Оттеглен› (new copy) |

The same label shows everywhere (D69). The flag `urgent` shows ‹Спешно›.

`dispute.opened_by`: `client` | `partner` | `team`.

Reasons:
- **client:** `no_show` ‹Изпълнителят не се яви›, `not_as_described` ‹Услугата не беше по описание›, `payment_problem` ‹Проблем с плащането›, `other` ‹Друго›.
- **partner:** `client_unresponsive` ‹Клиентът не отговаря›, `terms_changed_on_site` ‹Промени условията на място›, `payment_problem` ‹Проблем с плащането›, `other` ‹Друго›.

| # | From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| X1 | ∅ → collecting | ‹Изпрати сигнала› (`/akaunt/poddrazhka/nov`) | client | The booking is the client's, `awaiting_payment`/`confirmed`/`completed`, and `event_date ≥ today − 30 days` (D70); no open dispute on it | `holds_payout = true`; booking `payout_hold`; `team_reply_due_at = +24 h`; `position_requested_at = opened_at`, `position_due_at = +48 h` (T15, D14); `client-dispute-opened`, `vendor-ticket-client-opened`, `team-dispute-new`; toast ‹Сигналът е изпратен — екипът отговаря до 24 часа› |
| X2 | ∅ → collecting | ‹Изпрати сигнала› (`/partner/poddrazhka/nov`) | partner | own booking, `awaiting_payment` or later | `holds_payout = false` for `client_unresponsive`, true for the other reasons (D13); `position_from = client`, `position_due_at` = opened_at + 48 h (the team may change it); `vendor-ticket-received`, `client-ticket-vendor-opened`, `team-dispute-new` |
| X3 | ∅ → collecting | ‹Отвори спор› (`/admin/rezervacii/[nomer]`) | team | — | `holds_payout = true`; toast ‹Спорът е отворен›; no email exists for a team-opened case (D68) |
| X4 | collecting → collecting | ‹Поискай още информация› + question text | team | — | `dispute_message` (team question, to both sides); `client-dispute-info-request`, `vendor-ticket-info-request`; toast ‹Въпросът е изпратен до двете страни› |
| X5 | collecting → collecting | ‹Напомни на изпълнителя› / ‹Напомни на клиента› | team | — | `vendor-ticket-reminder` / `client-ticket-reminder`; toast ‹Напомнянето е изпратено на {страна}› |
| X6 | collecting → awaiting_decision | the other side submits a position (‹Изпрати позицията› / ‹Отговори на екипа›) | client / partner | — | `dispute_message` with evidence; `team-dispute-reply` |
| X7 | collecting → awaiting_decision | T15 | system | — | `team-dispute-deadline` |
| X8 | collecting/awaiting_decision → resolved | ‹Приложи решението› (an option plus ‹Мотив към двете страни›) | team (`resolve_disputes`) | motive required; deciding while `collecting` is allowed with the warning | Decision applied (below); `client-dispute-decision`, `vendor-ticket-decision`; `client-refund-sent` if a refund is made; toast ‹Решението е изпратено до двете страни› |
| X9 | collecting → withdrawn | the filer withdraws (control new copy) | filer | — | The payout returns to its normal schedule; no email exists (D68) |
| X10 | (any open) | ‹Удължи срока с 24 часа› | team | booking `awaiting_payment` | As K3 |

**Decision kinds (`dispute.decision_kind`) and their money effects:**

| Kind | Example option label | Booking effect | Money |
|---|---|---|---|
| `enforce_terms` | ‹Задължи Флора Студио да потвърди монтажа› / ‹Задължи Snap360 да осигури 4 часа› | none; optional `compliance_due_at` + `fallback = cancel_full_refund` (T16) | Hold released at the decision; payout on schedule |
| `partial_refund` | ‹Върни разликата — 140 €› / ‹Частично възстановяване — 30%› | none | Refund the amount (or % of the paid amount); commission on what the partner keeps |
| `cancel_full_refund` | ‹Анулирай с пълно възстановяване› | → `cancelled` (`cancelled_by = dispute`) | Refund everything paid; partner 0 |
| `cancel_unpaid` | ‹Анулирай заявката без такси› | `awaiting_payment` → `cancelled` | Nothing paid, nothing refunded; date released |
| `restore_price` | ‹Върни одобрената цена› | `amount_cents` = the approved amount; new 24 h payment window | — |
| `accept_new_price` | ‹Приеми новата цена› | `amount_cents` = the new amount | — |
| `no_refund` | ‹Без възстановяване› / ‹Затвори без промяна› | none | Hold released |
| `refund_duplicate` | ‹Пълно възстановяване на второто плащане› | none | Refund the duplicate charge in full |
| `mediate` | ‹Свържи страните чрез екипа› | none | — |
| `close` | ‹Затвори сигнала› | none | — |

The option list on each case is composed by the team from these kinds (the prototype pre-composes 3 per case).

### 4.12 Review (`review` existence + `booking.review_state`)

| State | Client label |
|---|---|
| `not_due` | — |
| `invited` | ‹Чака вашето ревю› |
| `published` | — |
| `replied` | — |

| # | From → To | Trigger | Actor | Guards | Side effects |
|---|---|---|---|---|---|
| V1 | not_due → invited | T14 (`event_date + 1`, 10:00) | system | booking `completed` | `client-review-invite` (optional) |
| V2 | invited → published | ‹Публикувай ревюто› | client | One review per booking; comment ≥ 40 chars (‹поне 40 символа›); overall and 4 criteria 1–5; ≤ 6 photos | Contacts masked in the text (§10); `partner.rating_avg` / `review_count` recomputed; `vendor-new-review`; toast ‹Ревюто е публикувано› |
| V3 | published → replied | ‹Отговори› → publish reply | partner | one reply; ≥ 1 char | `reply_text`, `reply_published_at`; `client-review-reply`; toast ‹Отговорът е публикуван под ревюто› |

Partners cannot delete or edit reviews. There is no review expiry in v1 (the prototype shows a review pending 4 months after the event).

### 4.13 Calendar date (derived per partner and date)

| State | Calendar label | Source |
|---|---|---|
| `free` | ‹Свободно› | none of the below |
| `held` | ‹Запазена дата (24ч)› / chip ‹Запазена до {11:06}› | booking `awaiting_payment` |
| `booked` | ‹Потвърдено събитие› / chip ‹{Тип} · {N} гости› | booking `confirmed`/`cancellation_requested`/`completed` |
| `blocked` | ‹Блокирана ръчно› / chip ‹Блокирана› | `availability_block` covering the date, or a non-working weekday |
| `closed` | — | outside lead time or horizon, or `only_selected_dates` on and the date not opened |

The date is **busy** for search, requests and briefs iff the number of held + booked bookings ≥ capacity (1 with ‹Само едно събитие на ден›, else `max_bookings_per_date`), or it is `blocked` or `closed`.

- Partner clicks a free day, or ‹Блокирай дата› / ‹Блокирай период›: `availability_block` created; toasts ‹Датата е блокирана›, ‹Датата е блокирана в календара›, ‹Периодът е блокиран в календара›.
- Partner clicks a blocked day or × in the list: block removed; toast ‹Датата е освободена›; date watches fire.

### 4.14 Date watch and saved search

**Date watch** (`date_watch.status`): `watching` ‹Датата е заета› / ‹следим от {10 авг}› → `notified` → `closed`; also `expired` (T21) and `removed`.

- **Create:** ‹Уведоми ме› / ‹Уведоми ме, ако се освободи› / ‹Уведоми ме при свободна дата›. A guest is sent to sign-in. One active watch per client, partner and date. Toast ‹Ще ви известим, ако датата се освободи›.
- **Notify:** when the partner's date stops being busy (K4, K6, K7, K9, K11, a block removed), every `watching` watch for that partner and date → `notified`; `client-date-freed` at once (D21).
- **Close:** the client sends a new request to that partner for that date, or the date passes.
- **Remove:** a stop control on the row (new copy, D21).

**Saved search** (`saved_search.notify` on/off, deleted):

| Control | Effect | Toast |
|---|---|---|
| ‹Запази търсенето› | Creates the saved search, notify on | ‹Търсенето е запазено в профила ви› |
| ‹Изключи известията за това търсене› | notify off | ‹Известията за това търсене са изключени› |
| ‹Включи известията за това търсене› | notify on | ‹Ще ви известим при нови резултати› |
| ‹Изтрий запазеното търсене› | Deleted | ‹Търсенето е изтрито› |

T20 sends `client-saved-search-alert` when partners matching the saved filters were approved or listed after `last_alerted_at`.

### 4.15 Team member and invite

| Machine | States | Transitions |
|---|---|---|
| `team_invite.status` | `pending` ‹Чака отговор› → `accepted` / `revoked` / `expired` | ‹Изпрати покана› (Имейл, Роля) → `team-invite`, toast ‹Поканата е изпратена›. ‹Оттегли› → `revoked`, toast ‹Поканата е оттеглена›. ‹Приеми поканата› (`/admin/pokana/[token]`) + password → `accepted`, `user` (role admin) + `team_member`. T25 → `expired`. |
| `team_member.status` | `active` ‹Активен› → `removed` | ‹Премахни› (not on the owner) → sessions revoked; toast ‹Премахнато› |

### 4.16 Conversation and message read state

- One conversation per (client, partner, client event). Its context link is the latest booking (‹Виж резервацията›), else the latest request (‹Виж заявката›).
- Opening a conversation marks the other side's messages read: the unread dot goes, and the sender's last message shows ‹· прочетено›.
- Each side keeps its own unsent draft.
- ‹Изпрати›: message stored (contacts masked per §10); recipient email `client-new-message` (optional) or `vendor-new-message` (mandatory); toast ‹Съобщението е изпратено›.

### 4.17 Report export

`report_job.status`: `requested` → `ready` | `failed`.

| Trigger | Toast | Email when ready |
|---|---|---|
| ‹Изтегли справка› (partner earnings) | ‹Справката се подготвя — ще я получите по имейл› | `vendor-report-ready` |
| ‹Експорт› (partner requests/bookings) | same | `vendor-report-ready` |
| ‹Експорт› / ‹Счетоводна справка› (admin) | same | new team email key needed (D68) |
| Batch history row | ‹Отчетът за партидата се подготвя — ще го получите по имейл› | `team-batch-report` |

## 5. Cancellation policy engine

`cancellation.quote(booking, onDate, initiatedBy)` is a pure function in `lib/domain/cancellation.ts`. The client page, the admin preview, K7/K9/K11/K12 and the emails all use it.

### 5.1 Inputs (all snapshotted on the booking at K1/K5)

- `total` = `booking.amount_cents` + `booking.booking_fee_cents`. The booking fee is always 0 (‹Такса резервация 0,00 €›).
- `paid` = Σ succeeded charges − Σ succeeded refunds.
- `policy` ∈ {`flexible` ‹Гъвкава›, `moderate` ‹Умерена›, `strict` ‹Строга›}: the partner's policy at approval.
- `deposit_percent` ∈ {20, 30, 40, 50}: the partner's setting at approval (‹Обичайният депозит в бранша е 20–30%.›).
- `deposit` = round_half_up(total × deposit_percent / 100). The deposit is a **part of the total**, not a separate fee (‹Каква част от общата цена се смята за депозит при анулиране.›).
- `days_before` = `daysBetween(sofiaDate(cancel instant), event_date)`. Cancellation by the client is allowed while `days_before ≥ 0`. After the event only a dispute is possible.

### 5.2 Table (boundaries are inclusive, D9)

| Policy | Window | Retained by policy | Refund (before cap) |
|---|---|---|---|
| Гъвкава | `days_before ≥ 7` | 0 | total |
| | `1 ≤ days_before ≤ 6` | deposit | total − deposit |
| | `days_before = 0` (event day) | total | 0 |
| Умерена | `days_before ≥ 30` | 0 | total |
| | `7 ≤ days_before ≤ 29` | deposit | total − deposit |
| | `0 ≤ days_before ≤ 6` | total | 0 |
| Строга | `days_before ≥ 14` | deposit | total − deposit |
| | `0 ≤ days_before ≤ 13` | total | 0 |

**Cap by what was paid (deposit schedule, §7.2):** `retained = min(retained_by_policy, paid)` and `refund = paid − retained`.

### 5.3 Who cancels

| Initiator | Retained | Refund |
|---|---|---|
| Client (K7) | §5.2 | §5.2 |
| Partner, completed by the team (K9) | 0 | everything paid (`refund_application_fee` in full) |
| Team directly (K11) | default §5.2 as if the client cancelled now; the team may change the refund amount (0 ≤ refund ≤ paid), and must give a reason | |
| Non-payment of the balance (K12) | §5.2 on the default date, capped by paid | |
| Dispute decision | per §4.11 decision kind | |

### 5.4 After cancellation

- The partner's date is released at once, and date watches fire.
- The **retained** amount stays held until `event_date + 1` and is then released to the partner with commission at the booking's rate (L3). It is paid out in the normal batch for that event date (D11). The partner's email shows ‹Получавате› = retained − commission (0,00 € when retained = 0).
- The client's other bookings for the same date are unaffected (‹Другите ви резервации за … остават непроменени.›).
- The reason (‹Промяна в датата›, ‹Намерихме друг изпълнител›, ‹Събитието се отменя›, ‹Друга причина› + text) is visible only to the partner and the team, and is never published (‹Причината се вижда само от изпълнителя и не се публикува като ревю.›).

### 5.5 Display strings generated from the table (D9)

| Where | Policy | String |
|---|---|---|
| Free-cancel date | Гъвкава | `event_date − 7` |
| | Умерена | `event_date − 30` |
| | Строга | none. ‹остатъкът› refundable until `event_date − 14`. |
| Bookings hero | Умерена (example) | ‹Безплатно анулиране до 15 май 2026 — 30 дни преди събитието.› |
| Cancel page (policy box) | Умерена | ‹Умерена политика› + ‹Безплатно анулиране до {дата} — 30 дни преди събитието. След това се задържа депозитът.› |
| Policy descriptions | all three | client/legal.html #cancel (canonical): ‹Пълно възстановяване до 7 дни преди събитието› · ‹Пълно възстановяване до 30 дни; после се задържа депозитът, а в последните 7 дни — цялата сума› · ‹Депозитът не се връща; остатъкът се възстановява до 14 дни преди събитието› |
| Onboarding cards and timelines | all three | onboarding/policy.html texts verbatim |
| Vendor widget | Умерена | ‹Анулиране: умерена политика — безплатно до 30 дни преди събитието.› |

- The payment-summary line must state all tiers. The prototype's shorter line drops the last-7-days clause, so the full line is new copy that needs approval.
- The admin settings summary is generated as ‹Гъвкава (до 7 дни) · Умерена (до 30 дни) · Строга (депозитът не се връща)›. The prototype's ‹(без връщане)› is wrong per canonical (D9).
- Cancel page cells: ‹Платено› = paid; ‹Връща се› = refund (‹пълната сума› when refund = paid); ‹Задържа се› = retained (‹без удръжки› when 0).
- The h-sub for the full-refund case is ‹До събитието остават {N} дни — анулирането е в безплатния срок и сумата се възстановява изцяло.› The partial and no-refund h-sub variants are new copy.

### 5.6 Worked examples (computed; booking 2026-0614-ЕА: total 1 450,00 €, Умерена, deposit 30% = 435,00 €, commission 10%)

| Cancelled on | days_before | Refund | Retained | Partner receives |
|---|---|---|---|---|
| 31 август 2025 | 287 | 1 450,00 € | 0,00 € | 0,00 € |
| 15 май 2026 | 30 | 1 450,00 € | 0,00 € | 0,00 € |
| 16 май 2026 | 29 | 1 015,00 € | 435,00 € | 391,50 € |
| 8 юни 2026 | 6 | 0,00 € | 1 450,00 € | 1 305,00 € |
| partner cancels (any date) | — | 1 450,00 € | 0,00 € | 0,00 € |

Example cancellation reason (seed): ‹Залата ще осигури собствено озвучаване.›

---

## 6. Commission

| Rule | Value |
|---|---|
| Standard rate | 10% (`commission.standard_bp` ⚙) |
| Introductory rate | 5% for the partner's **first three bookings** (`commission.intro_bp`, `commission.intro_count` ⚙). "First three" = the partner's first three bookings to reach `confirmed`, ordered by `paid_at`. A later cancellation does not give the slot back (D7). |
| Business client | 10% (`commission.business_bp` ⚙) when `client_profile.client_type = 'business'`. The intro rate wins over the business rate (D7). |
| Snapshot | At **payment** (K5: the first succeeded charge) → `booking.commission_bp`. Settings changes affect only bookings paid after `effective_from`. |
| Base | The amount the partner keeps: `amount` normally, `retained` after a cancellation or partial refund. |
| Amounts | `commission_cents = round_half_up(base × commission_bp / 10 000)`; `partner_amount_cents = base − commission_cents`. Examples: 1 450 → 145 / 1 305; 640 → 64 / 576; 1 980 → 198 / 1 782; 560 → 56 / 504; 1 900 → 190 / 1 710. |
| Before payment | Partner screens and emails show a **projected** ‹Получавате›, computed with the rate the booking would get if paid now (e.g. ‹Получавате 1 305,00 €› in `vendor-new-request`). |
| Visibility | Commission percentages and amounts appear **only on admin screens**: booking splits ‹Комисиона (10%)›, tables, KPIs, payouts. Partners see ‹Сума› and ‹Получавате›. Clients never see commission. Emails to partners show ‹Получавате› only. The public marketing pages (`/stani-partnyor` rules and payout example, `/pravila` FAQ ‹Колко струва на изпълнителите?›) keep the approved prototype copy, with the numbers read from settings (D8). |
| Provider | The application fee on each charge = commission on that charge at the snapshot rate (`applicationFeeCents`). Fee refunds are proportional to refunds. Reconciled at release (L3). |
| Admin label | The rate in the label (‹Комисиона (10%)›) shows the booking's own rate. Aggregates show ‹Комисиона› without a fixed % (D7). |

---

## 7. Payments and money flow

### 7.1 Principles

- EventAT never holds client money in its own account. A licensed provider holds it (legal research, Oct 2026).
- The provider is chosen by ⚙ `payment.provider`:
  - `simulated`: a built-in test checkout at `/plashtane/test/[chargeId]`; no money moves.
  - `stripe`: Stripe Connect destination charges with `on_behalf_of` (the partner is the business of record), application fee = commission, connected accounts on **manual payouts** so the funds stay in the partner's balance until EventAT releases them on the 1st/15th.
- Card data never touches EventAT. Only `card_brand`, `card_last4` and provider refs are stored. The prototype's card fields are replaced by the provider's hosted form, and the payment page shows a saved card only if the provider returns one.
- The client pays only after approval. Pending, declined, expired or withdrawn requests cost nothing.

### 7.2 Payment schedule (⚙ `payment.schedule`)

| Mode | At approval (K1) | Later |
|---|---|---|
| `full` (default; prototype) | `due_now = total` within the 24 h window | — |
| `deposit_balance` | If `days_before(approval date) ≤ balance_due_days`: `due_now = total`. Otherwise `due_now = deposit_pay` = round_half_up(total × p / 100), where p = `deposit_percent` setting ?? the booking's policy deposit %; the card is saved for later (`saveCard`). | T9 charges `balance = total − deposit_pay` off-session at 10:00 on `event_date − balance_due_days`. If that fails or needs authentication, it retries every 24 h up to 3 times. The client can also pay from `/plashtane/[nomer]` (balance mode). If unpaid at `event_date − 7`: K12. |

**Validation of the setting:**
- `balance_due_days ≥ 14`. This guarantees the retained amount never exceeds what was paid under any policy (the longest "whole amount retained" window is Строга's 14 days).
- With a provider hold limit, also `balance_due_days + payout.hold_days_after_event + 15 ≤ provider_max_hold_days`. The balance is then held at most until the payout following the event.

**Rollout gate:** deposit mode needs new client and partner copy. This covers the payment-page rows for deposit and balance, plus the emails for balance charged, balance failed and booking cancelled for non-payment. The admin cannot switch to `deposit_balance` until those templates exist (D5).

### 7.3 Bank transfer (⚙ `payment.bank_transfer_enabled`)

- Offered as ‹Банков превод› — ‹Потвърждението отнема до 2 работни дни› next to ‹Карта› — ‹Visa, Mastercard, Maestro›.
- The instructions come **from the provider** for that charge (a provider IBAN). EventAT's own account is never used (D6). The demo values `‹Получател: EventAT›` and `‹IBAN: BG80 BNBG 9661 1020 3456 78›` are used only by the simulated provider.
- `client-bank-transfer` details:
  - ‹Сума›
  - ‹Получател›
  - ‹IBAN›
  - ‹Основание› = the booking number
  - ‹Платете до› = `payment_due_at`
- The booking confirms when the provider reports the funds (C3). If they have not arrived by `payment_due_at`, T8 expires the booking. The team can extend by 24 h (K3).

### 7.4 Provider hold limit (stripe: 90 days)

When `payment.provider_max_hold_days` is set, T18 runs for each charge at `succeeded_at + (max − 7) days`. If the booking is still `confirmed` and the event is in the future:
1. That charge's partner share (charge − commission) is released early (ledger L3 for that charge).
2. It is paid in the next batch as a `payout_line` with status `released_early`.
3. A later refund beyond the funds still held reverses the transfer from the partner's provider balance. Any shortfall becomes `partner_receivable`, netted from the partner's next payouts (L6).
4. Admin booking and payout screens show the early release. The labels are new copy (D5).

### 7.5 Ledger (double entry)

Every money movement is one `ledger_transaction` whose `ledger_entry` lines balance (Σ debit = Σ credit). Lines carry `booking_id` and `partner_id` dimensions.

**Accounts (`ledger_account`):**

| Account | Type | Meaning |
|---|---|---|
| `provider_held` | asset | money the provider holds for bookings |
| `client_funds` | liability | client money not yet earned by the partner |
| `partner_payable` | liability | released to the partner, not paid out |
| `partner_receivable` | asset | owed by the partner |
| `commission_revenue` | income | EventAT's commission |
| `platform_cash` | asset | EventAT's own balance at the provider (application fees) |

**Postings:**

| Posting | When | Lines |
|---|---|---|
| L1 charge | C3 | Dr `provider_held` A · Cr `client_funds` A |
| L2 refund | F2 | Dr `client_funds` R · Cr `provider_held` R. If `client_funds` for the booking < R (after an early release): the rest is Dr `partner_payable` (unpaid share), then Dr `partner_receivable`; the commission part of a refund after release is Dr `commission_revenue` · Cr `platform_cash`. |
| L3 release | K13, a cancellation's retained amount at `event_date + 1`, a dispute decision, T18 | Dr `client_funds` B · Cr `partner_payable` (B − C) · Cr `commission_revenue` C; and Dr `platform_cash` C · Cr `provider_held` C |
| L4 payout | Y6 | Dr `partner_payable` P · Cr `provider_held` P (minus any netted receivable: Cr `partner_receivable`) |
| L4r payout failed | Y8 | reverse L4 |
| L6 receivable netting | Y3 | Dr `partner_payable` · Cr `partner_receivable` |

**Invariants (checked by tests):**
- Per booking, `client_funds` balance ≥ 0.
- Per partner, `partner_payable` ≥ 0.
- Σ `provider_held` = what the provider reports for the platform plus its connected accounts.
- Every transaction balances (a deferred constraint trigger).

---

## 8. Payouts

| Rule | Value |
|---|---|
| Hold | Money is held until the day after the event: `hold_until = event_date + payout.hold_days_after_event (1)` ⚙. |
| Batch date | The first day `d ∈ payout.days {1, 15}` ⚙ with `d ≥ hold_until`. Examples: event 14.06.2026 → 15.06.2026 (‹Изплащане 15 юни 2026 — първата партида след събитието›); 30.06.2026 → 01.07.2026; 31.08.2025 → 01.09.2025. |
| Batch label | 15th: ‹Партида {месец} · първа половина›. 1st: ‹Партида {предишен месец} · втора половина› (e.g. 15.08.2025 ‹Партида август · първа половина›, 01.08.2025 ‹Партида юли · втора половина›). Rail label from the provider, e.g. ‹Обединена банка · SEPA› (historical seed value). |
| Grouping | One `payout_item` per partner per batch (one provider payout). One `payout_line` per booking in it. `vendor-payout-sent` is sent **per line** (‹Изплатихме 1 305,00 € за сватбата на 14 юни 2026›). |
| Release | Manual: ‹Пусни партидата› / ‹Пусни изплащанията›, permission `release_payouts`, not before 00:00 on `batch_date`. With ⚙ `payout.require_second_admin`, a second admin (not the preparer) confirms (D40). Unreleased batches carry over. |
| Disputes | An open dispute with `holds_payout` keeps its lines `held` (‹Задържано› · ‹Виж спора›). After the decision they join the next batch with the decided amount. |
| Bookings released late | Lines become `ready` after the event (or after a dispute decision) and join the next batch whose date ≥ the ready date. |

**8.1 Admin KPIs** (all computed, for the selected period, Sofia time):

| KPI | Definition |
|---|---|
| ‹Задържани до събитията› | Σ `client_funds` balance of `confirmed` bookings with `event_date ≥ today`; ‹по N предстоящи резервации› |
| ‹За изплащане тази седмица› | Net of the next batch; ‹N изпълнители› |
| ‹Комисиона {месец}› | Σ commission at the snapshot rate of bookings with `paid_at` in the month; ‹↗ +22% спрямо юли› = round((cur / prev − 1) × 100) |
| ‹Възстановено› | Σ refunds `succeeded` in the period; ‹N кейса› = number of distinct disputes with a refund in the period |
| ‹Следваща партида› | ‹Изпълнители›, ‹Бруто› (Σ base), ‹Комисиона› (Σ commission), ‹За превод› (Σ net) |

**8.2 Partner earnings** (`/partner/prihodi`):

| Figure | Definition |
|---|---|
| ‹Приходи · {месец}› | Σ partner amount of bookings with `paid_at` in that month; delta vs the previous month; bars for the last 5 months |
| ‹За изплащане› · ‹задържани до събитията› | Σ partner amount not yet paid out (`awaiting_event`, `ready`, `held`) |
| ‹Изплатени за {година}› · ‹по N резервации› | Σ and count of paid lines in the calendar year |
| ‹Средно на резервация› | That sum / N, rounded to whole € |

**8.3 Payout holds:**
- `partner.payouts_paused` (payout account pending verification, or a failed transfer).
- The provider's `payouts_enabled = false`.
- No confirmed payout account.

Held items stay `held` until the condition clears, then join the next batch.

---

## 9. Invoices and documents

| Rule | Value |
|---|---|
| Client invoice | Issued automatically for every succeeded charge (deposit and balance separately). Issued **through EventAT in the partner's name** (‹Документът е издаден през EventAT от името на изпълнителя.›). Valid without signature or stamp (‹Фактурата е издадена по електронен път и е валидна без подпис и печат.›). |
| Numbering | A per-issuer (partner) sequence, 10 digits zero-padded (‹№ 0000000412›), with no gaps. Allocated in the same transaction as the charge success. |
| Fields | ‹Дата на издаване› = payment date; ‹Дата на плащане›; ‹Място на издаване› = the partner's city; ‹Валута› EUR. ‹Издател›: the partner's legal name, ЕИК, address, manager and email. ‹Получател›: from `client_invoice_profile` (‹Частно лице› + name, or ‹Фирма› + company name, ЕИК, МОЛ). Lines: ‹№›, ‹Описание›, ‹Количество›, ‹Ед. цена›, ‹Сума›. ‹Сума по услуги›, ‹Общо по фактурата›. Status ‹Платена›; ‹Карта Visa •••• 4242›. |
| VAT | `partner.vat_registered` and the VAT rate are stored. VAT lines print only for VAT-registered issuers. The legal invoice content must be confirmed before launch (D41). |
| Refunds | A credit note (`invoice.type = credit_note`) referencing the invoice is created for every refund (Bulgarian practice; not in the prototype, D41). |
| Commission invoice | EventAT → partner, one per paid payout item (‹Банков превод, с фактура от платформата.›). Issuer data comes from ⚙ `platform.legal_entity` (the operator's details, not in the prototype, D41). |
| Actions | ‹Свали PDF› (toast ‹Файлът се изтегля›); ‹Изпрати по имейл› → `client-invoice` again (toast ‹Изпратихме документа на имейла ви›). |
| Company invoice | The client sets ‹Издавай фактура на› in settings. ‹За фирмена фактура добавете ЕИК и МОЛ — фактурите се издават автоматично след всяко плащане.› The profile at the moment of payment is snapshotted onto the invoice. |

---

## 10. Contact masking and the phone rule

| Rule | Detail |
|---|---|
| Phone rule | The partner sees the client's phone (`request.contact_phone` snapshot, from the client profile) **only when the booking is `confirmed`, `cancellation_requested` or `completed`**, labelled ‹Телефон за деня на събитието›. It appears on the partner booking page, `vendor-booking-confirmed` and `vendor-event-reminder`. Before that the partner sees ‹Телефонът на клиента се показва след потвърдена резервация. Дотогава си пишете в платформата.› A cancelled booking hides it again. |
| Client hint | Request form: ‹От профила ви. Изпълнителят го вижда едва след потвърдена резервация — дотогава си пишете в платформата.› Brief: ‹От профила ви. Вижда го само изпълнителят, когото изберете, след потвърдена резервация.› The phone is not editable on these forms. |
| Never shown | The client's email to partners. The partner's phone or email to clients. Payment data to anyone but the payer. |
| Team | Admins see everything, e.g. `team-vendor-cancel` lists ‹Клиент› and ‹Изпълнител› with their phones. |
| Masking | Contact details are replaced with `•••` (no words) when shown to the other party (D19), in: (a) **messages**, both directions, while the conversation has no booking in `confirmed` / `cancellation_requested` / `completed`; (b) **review text and replies**, always (‹Без лични данни и телефонни номера.›); (c) **public partner profile and service descriptions** at render, as a safety net (moderation rule 3 also rejects them). The original text is stored (`body_original`) and visible to admins, e.g. as dispute evidence. |
| Detection | Emails: `[\w.+-]+@[\w-]+\.[\w.-]+`. Phones: any run of digits, with optional `+`, spaces, `-`, `.`, `/` or parentheses, that contains ≥ 7 digits (covers `+359 88 412 7730`, `0884127730`, `088 412 77 30`). Dates (`14.06.2026`), money (`1 450,00 €`) and booking numbers (`2026-0614-ЕА`) are excluded by their formats. The social handle field (‹Instagram / Facebook›) is not masked. |
| Agreements | ‹Разговорите остават в платформата — така всичко договорено е записано.› Dealing outside the platform removes dispute protection (legal #terms). |

---

## 11. Notifications

### 11.1 Channels

- **Email**: `sendEmail()`, from `no-reply@eventat.bg`, reply-to `help@eventat.bg`.
- **Bell**: `notify()` (§4 bell rule).
- **SMS** (§11.4).

Emails go out in the user's interface language (BG only in v1).

### 11.2 Client switches (`/akaunt/nastroyki` › ‹Известия›, columns ‹Имейл›, ‹SMS›)

| Row | Description (exact) | Pref key | Email default | SMS default | Emails it controls |
|---|---|---|---|---|---|
| ‹Отговор по заявка› | ‹Изпълнителят одобри или отказа› | `client.request-response` | on, **locked** | on | `client-request-approved`, `client-request-declined` (email always sent) |
| ‹Срок за плащане› | ‹Напомняне 6 и 2 часа преди изтичане› | `client.payment-deadline` | on | on | `client-payment-reminder` |
| ‹Потвърдена резервация› | ‹Разписка и детайли за събитието› | `client.booking-confirmed` | on, **locked** | off | `client-booking-confirmed` (always sent) |
| ‹Съобщение от изпълнител› | ‹Ново съобщение в разговора› | `client.messages` | on | off | `client-new-message` |
| ‹Напомняне преди събитието› | ‹7 дни и 1 ден преди датата› | `client.event-reminder` | on | on | `client-event-reminder` |
| ‹Покана за ревю› | ‹На следващия ден след събитието› | `client.review-invite` | on | off | `client-review-invite` |

- A locked switch shows the toast ‹Този имейл е служебен — идва винаги, за да имате потвърждение и разписка›.
- The footer note reads: ‹Имейлите за регистрация, отговор по заявка, плащане, анулиране и сигнали до екипа идват винаги — те са служебни и съдържат потвърждения и разписки.›
- ‹Маркетингови съобщения› (‹Идеи и оферти за предстоящи събития, максимум веднъж месечно›) defaults off. It is stored as `client.marketing`, with the opt-in timestamp. No template exists; marketing goes through an external tool (D71).

### 11.3 Partner switches (`/partner/nastroyki`)

| Row | Description | Pref key | Default | Emails |
|---|---|---|---|---|
| ‹Нова заявка› | ‹Имейл и известие в платформата веднага щом клиент изпрати заявка.› | `partner.new-request` | on | `vendor-new-request`, `vendor-new-inquiry`. The bell item is always added. |
| ‹Напомняне за 24-часовия срок› | ‹Съобщение, ако клиентът не е платил 6 часа преди изтичане.› | `partner.payment-reminder` | on | `vendor-payment-reminder` |
| ‹Ново ревю› | ‹Известие при получена оценка.› | `partner.new-review` | on | `vendor-new-review` |
| ‹Новини от EventAT› | ‹Съвети за профила и промоции. Максимум веднъж месечно.› | `partner.news` | off | none (external tool, D71) |

Note shown: ‹Имейлите за одобрение на профила и на услугите, потвърдени и анулирани резервации, изплащания и сигнали идват винаги — те са служебни.›

### 11.4 Per-item switches, SMS and 2FA

- **Saved-search alert** (`client-saved-search-alert`): controlled by `saved_search.notify` (the bell button on the row). The email footer link goes to `/akaunt/zapazeni` (D21).
- **Date freed** (`client-date-freed`): controlled by the watch's own status (stop control on the row). Footer link `/akaunt/zapazeni`.
- **SMS** (client only): for each SMS switch that is on, the same event sends an SMS whose text is the **email subject** followed by the CTA link (shortened). Approved subjects only; no new copy (D20). Transport ⚙ `sms.transport` = `outbox` (recorded only) until an SMS provider is contracted.
- **Two-factor SMS code:** its text is new copy and needs Nikola's approval (D20).
- **Everything else** in the email catalogue is a service email and is always sent (`optional = false`).

### 11.5 Team recipients

| Email | Sent to |
|---|---|
| `team-vendor-application` | members with `approve_partners` |
| `team-dispute-new`, `team-dispute-reply`, `team-dispute-deadline`, `team-payment-deadline`, `team-vendor-cancel` | `resolve_disputes` |
| `team-payout-account`, `team-batch-ready`, `team-batch-paid`, `team-transfer-failed` | `view_finance` |
| `team-batch-report` | the requester |
| `team-daily-digest` | `approve_partners` ∪ `moderate_listings` ∪ `resolve_disputes` |
| `team-invite` | the invitee |

## 12. Partner-side rules

### 12.1 Onboarding (6 steps, `/partner/registratsiya/1…6`; progress = step / 6; save status ‹Запазено току-що› / ‹Запазено преди N мин›)

| Step | Title | Required (validated on ‹Продължи›) | Optional |
|---|---|---|---|
| 1 ‹Бизнес информация› | ‹Да започнем с основите.› | ‹Име на бизнеса›; ‹Тип на бизнеса› (`legal_form`); ‹ЕИК / Булстат› (9 or 13 digits with a valid checksum, or 10 digits for a Булстат of a свободна професия); ‹Основна категория›; ‹Основен град› (from `city`); ‹Радиус на работа›; ‹Опит›; ‹Езици на работа› (multi-select); ‹Лице за контакт›; ‹Имейл за известия›; ‹Телефон› (E.164); ‹Instagram / Facebook› | ‹Уебсайт› |
| 2 ‹Профил и галерия› | ‹Покажете се отблизо.› | Profile photo (JPG/PNG ≤ 5 MB, ≥ 400 × 400); cover photo (recommended 1600 × 900); ‹Кратко описание› ≤ 140 chars; ‹Дълго описание› ≤ 600 chars; gallery 4–8 photos (first = ‹Главна›); ≥ 1 event type among the specialisations (D74) | Video link (YouTube or Vimeo only); more specialisations |
| 3 ‹Пакети и услуги› | ‹Какво предлагате?› | ≥ 1 fixed-price package with name, category, short description and price; ≤ 5 packages | On-request services; inclusions; extras |
| 4 ‹Наличност› | ‹Кога сте свободни?› | ‹Резервации на ден› mode (and N ≥ 2 for ‹Лимит на ден›); ‹Минимум дни предварително›; ‹Максимум напред във времето›; ≥ 1 working day | Blocked dates |
| 5 ‹Политика за анулиране› | ‹Какво се случва при анулиране?› | Policy; ‹Депозит›; ‹Промяна на датата› | — |
| 6 ‹Преглед и подаване› | ‹Готови ли сте?› | Both checkboxes (start unticked) | — |

- Sidebar step meta once a step is done:
  - ‹{Име} · {Град}›
  - ‹Представяне и {N} снимки›
  - ‹{N} пакета · {M} по запитване›
  - ‹Една резервация на ден›
  - the policy label
- Clicking a step goes to it only if it is done or is the next unfinished step.
- While `submitted`, the wizard is read-only.
- The payout account is not part of the wizard. It is added later at `/partner/smetka`.

### 12.2 Service validation (create and edit)

| Field | Rule |
|---|---|
| ‹Вид› | `package_fixed` ‹Пакет с фиксирана цена› · `on_request` ‹По запитване› · `addon` ‹Допълнителна услуга› |
| ‹Име на услугата› | required, ≤ 80 |
| ‹Категория› | required, from `category` (visible ones) |
| ‹Кратко описание› | required, ≤ 600 (‹N / 600 знака›) |
| ‹Подходящи събития› | ≥ 1 event type |
| ‹Какво е включено› | 0–12 items, each ≤ 120 |
| ‹Цена› | required for `package_fixed` and `addon` (> 0); null for `on_request` (card ‹—› / ‹По оферта›) |
| Price unit | `per_event` (default) or `per_guest` with ‹минимум N гости› (D42; new form copy) |
| ‹Продължителност› | free text, e.g. ‹До 10 часа› |
| ‹Допълнителен час: +150 €› | checkbox + amount |
| ‹Пътуване извън {град}: + пътни разходи› | checkbox. The moderator checks it against rule 2 (D42). |
| Cover | from the gallery (‹Избери от галерията›) or upload (‹Качи снимка›) |
| ‹Показвай в профила ми› / ‹Приемам заявки за нея› | booleans (default on) |
| Limit | ≤ `partner.max_packages` (5) `package_fixed` services not archived |

### 12.3 Public profile (`/partner/profil`)

- **Saved immediately**, not moderated (D59).
- **Business name:** changes at most once per calendar month. ‹Последна промяна на {12 август} — следваща от {12 септември}›. The name field is read-only on the profile, and ‹Смени името› in settings is enabled once the month has passed (D83).
- **Fields:** ‹Описание› ≤ 600, ‹Instagram / Facebook› required, ‹Основен град›, ‹Работя и в радиус› (km), ‹Умения и специализации›, gallery (4–8; the first is the catalogue photo).
- **Toggles:** ‹Профилът е активен› (`is_listed`), ‹Приемам нови заявки›.
- **Policy:** changing it affects only bookings approved afterwards (snapshot at K1).

### 12.4 Partner metrics (computed)

| Metric | Definition |
|---|---|
| Responsiveness ‹96% отзивчивост› | Share of the partner's requests and brief invitations with `sent_at` in the last 180 days that were answered (approved, declined or offered) before their deadline, rounded to a whole %. Hidden when there are 0 such requests. |
| Rating ‹4,9› | Average `rating_overall` of published reviews, 1 decimal with a comma; count ‹38 ревюта›; distribution 5→1 as counts and %. Hidden when 0 reviews (no stars, no ‹ревюта›). |
| From-price ‹от 640 €› + ‹за събитие› / ‹на гост› | Lowest `per_event` price among active, profile-visible `package_fixed` services. If there are none, the lowest `per_guest` price with ‹на гост›. If only on-request services exist, no price is shown. |
| ‹Проверен› badge | `partner.is_verified` = the checks `company` and `contacts` are `ok` |
| Bookings and turnover (admin) | Count and Σ `amount_cents` of the partner's `confirmed`, `completed` and `cancelled`-with-retained bookings |

### 12.5 Bell and dashboard for partners

- **KPIs** (computed):
  - ‹Нови заявки› = `pending` requests;
  - ‹Чакат плащане› = `awaiting_payment` bookings;
  - ‹Предстоящи събития› = `confirmed` bookings with a future date;
  - ‹Приходи този месец› = §8.2 for the current month.
- **Sidebar counter** on ‹Заявки›: number of `pending` requests (open invitations included).

### 12.6 Availability

A date *d* is **requestable** for a partner iff ALL hold:

| Check | Rule |
|---|---|
| Lead time | `d ≥ today + lead_time_days`; ‹Същия ден› = 0. Options: 0, 1, 3, 7, 14, 30. |
| Horizon | `d ≤ today + horizon_months`. Options 3, 6, 12, 24 (D75). |
| Working day | weekday(d) ∈ `working_days` (ISO 1–7). Non-working weekdays show as busy to clients. |
| Manual blocks | no `availability_block` covering d |
| Only selected dates | if `only_selected_dates`, then d ∈ `availability_open_date` |
| Capacity | count(bookings `awaiting_payment` / `confirmed` / `cancellation_requested` on d) < capacity. Capacity = 1 for ‹Една на ден› (and for the calendar toggle ‹Само едно събитие на ден›); N for ‹Лимит на ден› / ‹Максимум резервации за дата› (stepper 1–9); ∞ for ‹Без лимит›. |

- **Busy** = not requestable. Busy partners are hidden from search on that date unless ‹Предлагат друга дата› is ticked, and they are not invited to briefs.
- On the profile, the busy variant replaces ‹Изпрати запитване› with ‹Заета дата: изпълнителят вече има ангажимент на {14 юни 2026} г. Ще ви известим, ако датата се освободи.› + ‹Уведоми ме, ако се освободи›.
- **Clients choose a date, without a time:** ‹Клиентите избират дата, без час.› / ‹Резервациите са по дати, без часови интервали.›

---

## 13. Search and public browsing

### 13.1 Query parameters (`/tarsene`, `/kategorii/[slug]`; all GET, so the URL fully describes the view)

| Param | Values | Bar / facet |
|---|---|---|
| `q` | free text | ‹Търсете по име, услуга или категория› / ‹Всички услуги› |
| `kategoriya` | category slug | picked from the suggestion panel, or the `/kategorii/[slug]` route |
| `vid` | subtype slug | sub-type pills (category page) |
| `sabitie` | event type slug, repeatable | ‹Тип събитие› |
| `grad` | city slug, repeatable | ‹Локация› / ‹Град› |
| `data` | ISO date | ‹Дата› (neutral ‹Всяка дата›) |
| `gosti` | `do-50`, `50-100`, `100-150`, `nad-150`, or an integer | ‹Гости› (neutral ‹Без значение›) |
| `reyting` | `4.5`, `4.0` (repeatable; the lowest wins) | ‹Рейтинг› |
| `politika` | `gavkava`, `umerena`, `stroga` (repeatable) | ‹Политика за анулиране› |
| `svobodni` | `1` | ‹Свободни на {дата}› |
| `druga-data` | `1` | ‹Предлагат друга дата› |
| `otgovor24` | `1` | ‹Отговаря до 24 часа› |
| `cena-ot`, `cena-do` | whole euros | ‹Цена за събитие› pills (default 400 € — 2 000 €) |
| `podredi` | `preporachani` (default), `reyting`, `tsena`, `novi` | ‹Подреди: …› |

Every change re-queries at once (the prototype's sort and price lag is a bug). Event context (a client's event) is applied only by explicit links (event pills, ‹Добави услуга към събитието›, event-type CTAs). Plain `/tarsene` never pre-fills.

### 13.2 Base set

Publicly visible partners (§4.2) that accept requests (D72).

### 13.3 Query matching (production port of `searchEngine`)

1. Lower-case `q` and split on whitespace and punctuation.
2. Drop tokens of length ≤ 1, purely numeric tokens, and stop words: за, в, във, на, и, с, със, от, до, по, при, към.
3. **Stem:** tokens longer than 4 characters lose their last character; shorter tokens stay whole (сватба→сватб, софия→софи, кетъринг→кетърин, юни→юни).
4. **Haystack per partner** (a generated, lower-case `search_text` column): business name + primary category name + names of the categories of its active services + base city name + names of its event types.
5. A stem is **known** if it occurs in at least one base-set haystack. Unknown stems are ignored.
6. A partner matches iff its haystack contains **every** known stem (AND).
7. If `q` is non-empty and **no** stem is known → zero results.

Examples:
- ‹кетъринг коледно парти› → only "кетърин" is known.
- ‹xyz абв› → 0.

### 13.4 Filters (AND across groups, OR within a group)

| Group | Rule |
|---|---|
| Category | `kategoriya` → the partner has an active service in it, or it is the primary category. Exact match; the query never becomes a category by itself. |
| Subtype | `partner_subtype` contains `vid` |
| Event type | the partner's event types ∩ selected ≠ ∅ |
| City (D73) | The partner's base city ∈ selected, OR `serves_nationwide`, OR the distance between the base city and a selected city ≤ `service_radius_km` (city centroids, haversine). Picking ‹Локация› ticks exactly that city; ‹Всички градове› clears the group. |
| Date | With `data`: busy partners (§12.6) are excluded, unless `druga-data=1`, which shows **only** the busy ones (greyed, ‹Зает на {14 юни}› + ‹Уведоми ме›). Without a date, `druga-data` is ignored. |
| ‹Свободни на {дата}› | Shown only when no `data` is chosen and the signed-in client has an upcoming event: the label uses that event's date, and ticking it filters to partners not busy on it. With a `data` chosen, the facet is hidden (implied) (D27). |
| Guests | need = the band's upper bound (до 50→50, 50–100→100, 100–150→150), `nad-150`→151 (D28), or the integer. Partners with `max_guests < need` are excluded; `max_guests` null is never excluded. |
| Rating | `rating_avg ≥ min(selected)`. Partners without reviews are excluded when a rating filter is on. |
| Policy | `cancellation_policy ∈ selected` |
| Price | Applied only when `cena-ot`/`cena-do` is present. The from-price is compared within [min, max] inclusive. A per-guest from-price is multiplied by the guests need when `gosti` is set, otherwise not filtered. Partners without a price are never excluded (D29). |
| ‹Отговаря до 24 часа› | Partners with no request that lapsed unanswered (R8) in the last 90 days (D44) |

### 13.5 Facet counts (computed, never typed)

Each item's count = the number of base-set partners matching all **other** active groups plus that item (D43). Counts are shown next to items (‹Сватба 11›).

### 13.6 Output strings

| Element | Rule |
|---|---|
| Count line (initial render with a date) | ‹**N** изпълнители за {тип} в {град} · **M** свободни на {14 юни 2026}›. N ignores the date filter; M = those not busy. |
| Count line (otherwise) | ‹**N** › + (`изпълнител` if N = 1 else `изпълнители`) + suffix + city part. Suffix: ‹ за „q“› if q; else ‹ · {Категория}› if a category; else ‹ за {типове, lower-case, ", "}›. City part: ‹ в › or ‹ във › (before В/Ф) + cities joined ", ". |
| Results sentence `.results-say` | ‹Търсите **{какво}** в **{град}** за **{дата} г.**, събитие за **{N} гости**.› What: „q“ / lower(category) / ‹изпълнители за {типове}›. Guests: bands ‹събитие до 50 гости› / ‹събитие над 150 гости›, else ‹събитие за N гости›. Missing parts are dropped; hidden when empty. |
| Context line `.h-sub--ctx` | ‹{градове или „цялата страна“} · {дата} · {N} гости› |
| H1 | ‹Изпълнители за {тип lower-case}› with a single event type; ‹Търсене› otherwise |
| Chips | One per active filter: ‹„q“›, type, city, ‹рейтинг 4,5 и нагоре›, ‹{Умерена} политика›, other facets, category, date, ‹{N} гости›, ‹цена›. Each removes only its own filter. ‹Изчисти филтрите› resets all to ‹Всички услуги› / ‹Всички градове› / ‹Всяка дата› / ‹Без значение›. |
| CTA block (≥ 1 result) | ‹Не намирате точно това, което търсите?› + ‹Опишете събитието си веднъж и изпълнителите, които са свободни на {14 юни}, ще ви отговорят с оферта.› Without a date, the clause ‹, които са свободни на …,› is dropped. Buttons ‹Изпрати запитване› (→ brief with params) and ‹Виж какво още ви трябва за {сватба}› (→ `/sabitiya/[slug]`, only with a single event type). |
| Zero state | ‹Няма изпълнител за това търсене›. If dropping the date would give results: ‹С избраните филтри никой изпълнител[ в/във {градове}] не е свободен на {дата} г.›, else ‹С избраните филтри никой изпълнител не съвпада с търсенето ви.› Buttons: ‹Разшири датата› (only when the date is the cause; toast ‹Показваме изпълнители за всяка дата›), ‹Търси в друг град› (only with a city filter; toast ‹Показваме изпълнители от цялата страна›), ‹Опиши заявката› (always), ‹Уведоми ме при свободна дата› (date-caused only; creates watches for every matching partner busy on that date). Zero state and CTA block never show together. |
| Busy card | Greyed cover and price; red-dot badge ‹Зает на {14 юни}› (no year); button ‹Уведоми ме› (does not open the card) |
| Default state (`/tarsene`, no params) | ‹Търсете, за да видите резултати› + ‹Може да търсите по име на изпълнител, по услуга или по категория.› For a signed-in client with upcoming events: ‹Търсене за вашето събитие› pills (‹Сватба · 14 юни 2026 · 120 гости›) that apply **type, city, date and guests** (D45). ‹По тип събитие› pills go to `/sabitiya/[slug]`. |

### 13.7 Suggestions panel (first bar cell)

- **Empty field:** ‹Последни търсения› (the client's 3 latest distinct `search_history` queries, meta ‹предишно търсене›; none for guests) and ‹Категории› (the first 5, meta ‹категория›).
- **While typing:**
  - ‹Категории› (≤ 3 whose name contains a known stem; meta ‹N изпълнител/изпълнители›);
  - ‹Изпълнители› (≤ 6 matching all known stems; meta ‹{Категория} · {Град}› + ‹ · свободен на {д}› / ‹ · зает на {д}› when a date is set);
  - if neither: ‹Няма съвпадение› + ‹Опишете събитието си› (meta ‹изпълнителите ви отговарят с оферта›).
- **Picking a category** sets `kategoriya`; the field shows the category name. Typing anything else clears it.
- Escape or an outside click closes the panel. Enter or blur runs the search.
- For a signed-in client each run writes `search_history`.

### 13.8 Sorting (no paid ranking, ‹няма плащане за по-добра позиция в резултатите›)

| Option | Order |
|---|---|
| ‹Подреди: Препоръчани› | free on the chosen date first; then `is_verified` desc, `rating_avg` desc (nulls last), `review_count` desc, `approved_at` asc. Ties by `id`. |
| ‹Подреди: Най-висок рейтинг› | `rating_avg` desc, `review_count` desc |
| ‹Подреди: Най-ниска цена› | from-price asc (per-guest × guests need when set), unpriced last |
| ‹Подреди: Най-нови› | `approved_at` desc |

### 13.9 Saved searches, date watches, history

- **Saved search:** stores the full parameter set plus generated texts. Title: ‹Изпълнители за сватба · София · 14 юни 2026 · 120 гости›. Summary: ‹Всички услуги · свободни на датата · рейтинг 4,5 и нагоре›. A guest is sent to sign-in first.
- **Saved-search row (computed):**
  - ‹Резултати› = live count with the category noun (‹29 изпълнители›, ‹8 кетъринг фирми›);
  - ‹N нови от вчера› / ‹N нови тази седмица› / ‹Без нови› = partners that started matching since `seen_at` (‹от вчера› if ≤ 1 day, else ‹тази седмица›, D79);
  - ‹N свободни на {дата}› ≤ results, or ‹последна проверка днес› when there is no date;
  - ‹Отвори› restores all filters and resets `seen_at`.
- **Date watch row:** partner, ‹{Категория} · щом {дата} се освободи, ви известяваме веднага›, ‹Следим›, ‹Събитие›, badge ‹Датата е заета›, ‹следим от {10 авг}›. The hint is ‹Проверяваме наличността всеки ден — щом се освободи, можете да заявите отново›; its replacement wording, reflecting immediate notification, is new copy (D21).

### 13.10 Public pages (computed blocks)

| Page | Block | Rule |
|---|---|---|
| `/kategorii` | Card footer | Per selected city (default София; for a signed-in client, their next event's city): ‹N партньори› = visible partners of the category serving weddings in that city (§13.4 city rule), ‹1 партньор›, or ‹Няма партньори› (no price); ‹от X €› / ‹от X € на гост› = the lowest from-price among them. The dropdown button keeps the prefix ‹Град: {град}›. |
| `/kategorii/[slug]` | Hero | H1 = ‹{Категория} за {сватби}›; count = ‹N проверени {plural noun} в цялата страна›, computed; tips heading ‹Какво да питате {…}›. The sub-heading count word is generated from the tip count (‹Три въпроса…›, D16). |
| `/sabitiya/[slug]` | Tiers | ‹Задължително› / ‹Често добавяно› / ‹Не сте се сетили за това› from `event_type_service`. Card footer: ‹N партньори› = visible partners in the category, in the city, serving the type, **free on the date**; ‹от …›. The count line ‹**N** услуги за {сватба} · показваме само партньорите, свободни на {дата} в {град}› uses N = COUNT(`event_type_service`). |
| `/sabitiya/[slug]` (client with an event) | Event panels | ‹Вашето събитие› line; ‹Вече уредено› = the event's requests and bookings not declined or expired, with a status badge (‹Потвърдена›, ‹Чака отговор›). ‹Още липсва› = tier categories without an active request: ‹{Партньор} отказа› if the latest request was declined, else ‹Няма изпратена заявка›, + ‹N партньори са свободни›. |
| `/partnyori/[slug]` | Widget | Defaults from the client's chosen or next event: date, type, guests, package. Changing the date re-checks availability and swaps in the busy variant. ‹Не плащате сега. Изпълнителят потвърждава до 24 часа, след което плащате през платформата.› Cancellation line from §5.5. |
| `/stani-partnyor` | Payout example | ‹Пример за пакет от 1 450 €›: price, ‹Комисиона (10%) − 145 €›, ‹Получавате 1 305 €›, from settings (D8) |
| `/kak-raboti`, `/pravila` | Numbers in text | 24 h, 24 h, ‹до деня след събитието›, 1st/15th, from settings. The hero's ‹до деня на събитието› is corrected to ‹до деня след събитието› (canonical). |

---

## 14. Uploads and limits

| Upload | Types | Size | Count | Visibility |
|---|---|---|---|---|
| Request inspiration photos | JPG, PNG | ≤ 5 MB each | ≤ 6 | Client, the partner, the team |
| Brief photos | JPG, PNG | ≤ 5 MB | ≤ 6 | Client, invited partners, team |
| Dispute evidence | JPG, PNG (+ PDF for documents, e.g. ‹Правила на залата · PDF›) | ≤ 5 MB | ≤ 6 photos | Team **and the other side** (‹Прикачените файлове се виждат от екипа и от другата страна по случая.›) |
| Review photos | JPG, PNG | ≤ 5 MB | ≤ 6 | Public |
| Message attachments | JPG, PNG, PDF | ≤ 5 MB | 1 per message | The conversation's parties and the team |
| Partner avatar | JPG, PNG | ≤ 5 MB | 1 | Public; ≥ 400 × 400 |
| Partner cover | JPG, PNG | ≤ 5 MB | 1 | Public; recommended 1600 × 900 |
| Gallery | JPG, PNG | ≤ 5 MB | 4–8 | Public |
| Bank proof (payout account) | PDF, JPG, PNG | ≤ 5 MB | 1 | Partner and the team (private) |

- **Storage:** private files are served only through `/api/files/[id]` after an authorisation check.
- **Text limits:**
  - review ≥ 40 chars;
  - service description ≤ 600;
  - profile short description ≤ 140, long ≤ 600;
  - request note and brief description ≤ 2 000;
  - message ≤ 4 000.

---

## 15. Reference data (seeded; editable only where stated)

| List | Values (`slug` / value → label) |
|---|---|
| **Categories** (`category`; admin can add and hide) | `zali-i-lokatsii` Зали и локации · `ketaring` Кетъринг (per guest) · `dj-i-ozvuchavane` DJ и озвучаване · `fotografiya` Фотография · `videozasnemane` Видеозаснемане · `dekoratsiya` Декорация · `fotokabini` Фотокабини · `torti-i-deserti` Торти и десерти · `muzikanti` Музиканти · `transport-za-gosti` Транспорт за гости (hidden, ‹скрита от каталога›). The "not thought of" services on `/sabitiya/svatba` are hidden categories too: Транспорт за гостите, Количка за сладолед, Студени фойерверки, Бар с коктейли и барман, Караоке, Късна закуска за гостите, Кът за деца с аниматор, Калиграф за табелки (D16). |
| Catering subtypes | Бюфет, Сервирано меню, Коктейл, Барбекю на открито, Веган опции (‹Всички› = none) |
| Catering tips | ‹Какво влиза в цената на гост›, ‹Кога идват на място›, ‹Има ли дегустация› (texts in DATA-MODEL seed) |
| **Event types** (`event_type`) | `svatba` Сватба (plural ‹сватби›) · `rozhden-den` Рожден ден · `firmeno-sabitie` Фирмено събитие · `abiturientski-bal` Абитуриентски бал · `drugo` Друго (hidden from filters, D15) |
| **Cities** (`city`, with centroid) | `sofia` София · `plovdiv` Пловдив · `varna` Варна · `burgas` Бургас (preposition ‹във› before В/Ф) |
| Cancellation policies | `flexible` Гъвкава (‹Най-щадяща›; ‹Подходяща за по-малки събития›) · `moderate` Умерена (‹Най-често›, ‹Препоръчана›; ‹Балансирана защита и за двете страни›) · `strict` Строга (‹Сезонни дати›; ‹Подходяща за сватби и големи фирмени събития›) |
| Deposit % | 20 · 30 · 40 · 50 |
| Reschedule rules | `free_if_available` ‹Безплатно, ако има свободна дата› · `one_free` ‹Една безплатна промяна› · `not_allowed` ‹Не се допуска› |
| Legal forms | `freelancer` Свободна професия · `sole_trader` ЕТ · `eood` ЕООД · `ood` ООД · `other` Друго |
| Radius | 50 · 100 · 150 km · ‹В цялата страна› (seed values 60/80/120/200 stay as data, D76) |
| Experience | `lt_1` ‹До 1 година› · `y1_3` ‹1 – 3 години› · `y3_5` ‹3 – 5 години› · `y5_10` ‹5 – 10 години› · `gt_10` ‹Над 10 години› |
| Bookings per day | `one` ‹Една на ден› · `limit` ‹Лимит на ден› · `unlimited` ‹Без лимит› |
| Lead time | ‹Същия ден› 0 · ‹1 ден› · ‹3 дни› · ‹7 дни› · ‹14 дни› · ‹30 дни› |
| Horizon | 3 · 6 · 12 · 24 months (D75) |
| Specialisations | Event-type chips: Сватби, Рождени дни, Детски рождени дни, Фирмени събития, Абитуриентски балове (new chip copy, D74). Tags: Озвучаване, Диско осветление, Годежи, Моминско парти, Ергенско парти, Парти изненада, Кръщенета, Тематични партита, ‹Друго› (free text). |
| Space types | `indoor` Закрита зала · `garden_hall` Градина и зала · `outdoor` На открито · `undecided` Още не е решено |
| Budget bands (brief) | `lt_1000` до 1 000 € · `b1000_2000` 1 000 – 2 000 € · `gt_2000` над 2 000 € · `unknown` Още не знам (default) |
| Guest bands | Без значение · до 50 · 50 – 100 · 100 – 150 · над 150 |
| Sort | Препоръчани · Най-висок рейтинг · Най-ниска цена · Най-нови |
| Payment methods | `card` ‹Карта› (Visa, Mastercard, Maestro) · `bank_transfer` ‹Банков превод› |
| Client cancellation reasons | `date_change` Промяна в датата · `other_vendor` Намерихме друг изпълнител · `event_cancelled` Събитието се отменя · `other` Друга причина (+ text) |
| Decline reasons | `date_taken` ‹Датата е заета› · `other` + text (D63) |
| Dispute reasons | §4.11 |
| Review criteria | Комуникация · Точност · Качество · Съотношение цена |
| Review tags | + Спазиха часа · + Точно като по снимките · + Лесна комуникация · + Добра цена · + Бих ги наела пак |
| Review verdicts | 5 → ‹Отлично — бих ги препоръчала› (1–4: new copy; the feminine forms need a neutral variant, D30) |
| Invoice recipient | `individual` Частно лице · `company` Фирма (ЕИК, МОЛ) |
| Client type | `private` Частно лице · `business` Бизнес клиент |
| Team roles | §1.2 |
| Moderation common notes | Липсва обхват на цената · Снимка с чужд воден знак · Телефон в описанието · Няма продължителност |
| Moderation criteria | 1 ‹Снимките са собствени.› ‹Без стокови кадри и без водни знаци на друго студио.› 2 ‹Цената е пълна.› ‹Без „от“ без обхват и без скрити такси за транспорт.› 3 ‹Без контакти в текста.› ‹Телефони и имейли в описанието заобикалят платформата.› 4 ‹Описанието казва какво влиза.› ‹Часове, брой хора, какво носи изпълнителят.› |
| Languages | ‹Български› (primary) · ‹English› |
| Currency | EUR (€) |
| Public holidays | Bulgarian official holidays per year (for working-day counts) |
| Acquisition sources (admin) | `organic` Органично търсене · `meta` Instagram и Facebook · `referral` Препоръка · `other` Друго (set from UTM / referrer at sign-up) |

---

## 16. Client-side rules

| Topic | Rule |
|---|---|
| Sign-up | Client fields: ‹Име и фамилия›, ‹Имейл›, ‹Телефон›, ‹Парола›. Partner fields: ‹Име на бизнеса›, ‹Лице за контакт›, ‹Имейл›, ‹Телефон›, ‹Парола›. Password ≥ 8 characters. Strength meter with 4 segments; 4/4 = ‹Силна парола› (other levels are new copy). Consent required. `?as=partner` preselects the partner role; `?next=` is carried across ‹Вход› ↔ ‹Регистрация› ↔ confirmation. With `next` and the client role, the lead reads ‹Ще изпратите запитването веднага след регистрацията.› / ‹…веднага след като влезете.› |
| Verification | 6 digits; 10 min; 5 attempts; resend after 60 s (‹Поискайте нов след 0:42›) (D49). ‹Сменете имейла› invalidates the code. |
| Display name | ‹Мария Д.› = first name + last-name initial; initials ‹МД›. |
| Client event (folder) | Created or matched when a request or brief is sent: the client's event with the same event type and date; otherwise a new one. Name = the event type name, or the brief's title. ‹Добави услуга към събитието› links search with `sabitie-id`, and requests sent from there attach to that event (D15). |
| Event status | ‹Предстоящо› if `date ≥ today`, else ‹Минало събитие› (client) / ‹Приключило› (admin). Past events lose ‹Добави услуга към събитието›. |
| Folder counts | ‹N заявки› = the event's requests without a booking that is `confirmed`/`completed` (declined and expired included). ‹N резервации› = the event's bookings `confirmed`/`completed`. ‹N заявка чака плащане› = bookings `awaiting_payment`. |
| Folder money | ‹Платено до момента› = Σ paid on the event's bookings (net of refunds). ‹още X € по чакащите заявки› = Σ amount of `pending` requests + `awaiting_payment` bookings. |
| Notes | ‹Виждат ги само вие — изпълнителите нямат достъп›; ‹Последна промяна: {12 авг, 18:20}›; ‹Запази бележката› → toast ‹Бележката е запазена›. |
| Request form | Fields: ‹Тип събитие›, ‹Дата на събитието›, ‹Начален час›, ‹Край (ориентировъчно)› (may be past midnight), ‹Брой гости›, ‹Локация›, ‹Град / село›, ‹Тип пространство›, ‹Избран пакет›, ‹Бележка към изпълнителя›, inspiration photos. Phone read-only. The summary reflects the choices; ‹Плащате едва след одобрение от изпълнителя.› Steps ‹Детайли за събитието› → ‹Преглед› → ‹Изпратено›: v1 renders the step indicator and goes straight to the status page in ‹Чака отговор›. The ‹Преглед› step is not built (D45). |
| Brief form | Categories (multi, ≥ 1), event type (default ‹Сватба›), date, guests, city, phone (read-only), budget (default ‹Още не знам›), description, photos. Prefill from `?cat=&type=&city=&date=&guests=` (slugs). |
| Bookings page | Hero = the nearest future `confirmed` booking: ‹{N} дни до събитието›, policy line, ‹Пиши на изпълнителя›, ‹Свали фактура›, ‹Анулиране›. ‹Предстоящи› = the other future bookings. ‹Минали› = completed. Tab counts: ‹Заявки› = all requests not converted to a confirmed/completed booking; ‹Резервации› = all confirmed and completed bookings (D78). |
| Messages | List ordered by `last_message_at`; times ‹HH:MM› today, else ‹29 авг›; day separators ‹Днес›, ‹Вчера›, ‹Петък, 29 август›; search ‹Търсене по изпълнител или събитие›; attach toast ‹Файлът е прикачен към съобщението›. |
| Review form | Overall 1–5 + four criteria 1–5, comment ≥ 40, tags, ≤ 6 photos. ‹Ревюто се публикува само от клиенти с платена резервация — затова оценките тук са реални.› |
| Settings | Profile fields; ‹Смени снимката› (toast ‹Снимката е обновена›); security; language ‹Български›; ‹Валута EUR (€)›; notifications (§11.2); invoice data; ‹Изтрий профила›. ‹Откажи› → toast ‹Промените са отменени›; ‹Запази промените› → toast ‹Промените са запазени›. |
| Active sessions | Each shows ‹{устройство} · {град} · активна сега› / ‹преди 2 дни›. Device and city come from the user agent and IP (approximate). |

---

## 17. Decisions taken

Each entry has a fixed shape:
- **Problem:** where the prototype conflicts with itself, or what it leaves undefined.
- **Decision:** what this spec enforces.
- Entries marked **[Nikola]** need his confirmation. Until then the decision stands, but no user-facing copy beyond what is approved may be invented.

| # | Problem | Decision |
|---|---|---|
| D1 | Some screens treat request and booking as one row; the email CTAs use both `requestId` and `bookingId`. | Separate `request` and `booking` tables. The booking is created on approval and owns all money. Both share one number. |
| D2 | Numbers are `YYYY-MMDD-XX` but the two letters have no rule. The review booking reads 2026-0424-СЛ for a 24 април 2025 event. | XX = two random capitals from АБВГДЕЖЗИКЛМНОПРСТУФХЦЧШЮЯ, unique per event date via the `booking_number` registry. Offers on briefs get their number when submitted, and a chosen offer keeps it. The year always comes from the event date, so the seed uses **2025-0424-СЛ**. |
| D3 | Cyrillic numbers in URLs: an id or a transliteration? | URLs use the number as-is, URL-encoded. |
| D4 | The prototype anchors countdowns on 12 Aug 2025 while "today" is 31 Aug 2025; 2026-0614-ЕА appears both unpaid and paid. Its "now" is also inconsistent: message times up to 11:42 and Флора's 07:40 approval with ‹Остават 19:40 ч› imply 12:00, while a few labels imply 10:00 or 14:20. | The seed clock is **31 Aug 2025 12:00** (the platform CLAUDE.md says 10:00 and must be updated). 2026-0614-ЕА is paid (canonical). Open requests are re-dated relative to "now" so every countdown holds (DATA-MODEL §3 S7). **[Nikola]** |
| D5 | Legal and payment research: the provider holds the money, and Stripe outside the US holds funds at most 90 days. The prototype charges the full amount up to 10 months ahead. | ⚙ `payment.provider` and ⚙ `payment.schedule` are admin settings. The default is `full`, which matches the prototype and is used with `simulated`. Production on Stripe needs `deposit_balance` plus the early deposit release (§7.4). Deposit mode is **gated** until new copy is approved: payment-page rows, and the emails `client-balance-charged`, `client-balance-failed`, `client-booking-cancelled-unpaid` and `vendor-booking-cancelled-unpaid` (proposed keys). The settings form labels for these are new too. **[Nikola]** |
| D6 | Bank transfer to EventAT's own IBAN would mean EventAT holds client money. The 24 h deadline also conflicts with ‹до 2 работни дни›. | The transfer goes to provider-issued instructions; the static IBAN is simulated/demo only. The deadline stays `payment_due_at` (24 h), and the team can extend it by 24 h. An awaiting transfer does not stop expiry. Refunds go back to the paying account. **[Nikola]** to confirm whether transfers should be offered only for events more than N days away. |
| D7 | The intro 5% is ignored in some totals; the intro and business rates may overlap. | The intro rate applies to the partner's first 3 bookings to reach `confirmed` (by `paid_at`); later cancellations do not free a slot. Intro wins over business. Aggregates show ‹Комисиона› without a %. The flat "10%" in the payout rules card stays as approved copy. |
| D8 | CLAUDE.md rule 11 (commission only on admin screens) vs the public `/stani-partnyor` and FAQ, which show 10%/5%. | Rule 11 covers the panels, booking screens and emails. The public marketing and legal pages keep the approved prototype copy, with values from settings. **[Nikola]** |
| D9 | Гъвкава has two tiers in the legal copy and three in onboarding. The admin summary ‹Строга (без връщане)› is wrong. Boundaries are unclear ("над 30" vs "до 30"). | The §5.2 table: boundaries inclusive; Гъвкава uses the onboarding 3 tiers; Строга and Умерена per canonical. All policy strings are generated from one table; the admin summary is corrected. **[Nikola]** for the Гъвкава tail. |
| D10 | Partner-initiated cancellation. | The team completes it. Full refund, the partner receives 0,00 €, commission 0. |
| D11 | Who gets a late client cancellation's retained amount, and is it commissioned? | The partner, at the normal payout for the event date, minus commission at the booking's rate. **[Nikola]** |
| D12 | admin/settings says an unanswered request ‹отива при следващия свободен›; canonical says it lapses. | It lapses. The admin helper line needs new wording (proposal: ‹След това заявката отпада.›); until Nikola approves it, the line is omitted. **[Nikola]** |
| D13 | A partner-filed ‹Клиентът не отговаря› case does not touch money; the generic copy says any signal stops the payout. | `dispute.holds_payout`: default true; false for partner `client_unresponsive`. The team can toggle it on the case page (control is new copy). |
| D14 | Does the 48 h position clock start at filing or when the team asks? | At filing: the other side is notified automatically by `vendor-ticket-client-opened` / `client-ticket-vendor-opened`. The seed keeps the prototype's case times literally. |
| D15 | ‹Коледно парти› and ‹Годишнина› are not event types; ‹Кръщене› exists only in proto.js. | `event_type` table: 4 public types + `drugo` ‹Друго› (hidden from filters). Коледно парти → Фирмено събитие (event.html), Годишнина → Друго. `client_event.title` is free text. Кръщене is not seeded. **[Nikola]** |
| D16 | Category names differ (‹Зала и локация› / ‹Зали и локации›, ‹Фотокабина› / ‹Фотокабини›, ‹Торта и десерти› / ‹Торти и десерти›, admin ‹Фотография и видео›, ‹Декорация и цветя›). There are 9 vs 7 vs 8 lists. | One `category` table with the 9 client categories (plural names, the majority). `event_type_service.display_name` may override only the label on `/sabitiya/*`. Pickers use slugs. Onboarding ‹Друго› becomes a free-text "suggest a category" note. The ‹Четири въпроса› sub-heading becomes count-driven. |
| D17 | The 4 partners in the approval queue (Лунна Фотография, Балон Градина, DJ Живко, Тортите на Мими) also appear as catalogue cards with ratings. | They are seeded `submitted`, so they are not public and have no rating. |
| D18 | Typed totals do not reconcile (38 reviews, 269 partners, 84 320 € GMV, 46 210 € held, facet counts 79/96/…). | Every count and sum is computed from records. The seed reproduces records only, so the demo shows what those records add up to. |
| D19 | Masking is not defined in the prototype. | §10: `•••`, originals kept for the team. |
| D20 | SMS switches exist but no SMS copy does. | The SMS text = the email subject + link. The 2FA code text is new copy. **[Nikola]** |
| D21 | Two optional emails have no settings switch; the date-watch hint says "daily" while the email says "immediately". | Per-item switches (the saved-search bell; a stop control on the watch row, new copy). Date-freed is event-driven and immediate. The saved-search scan runs daily at 08:00. The email footer links go to `/akaunt/zapazeni`. |
| D22 | No offer validity is defined. | An offer stays open until chosen or not chosen, until the partner's date becomes unavailable, or until the event date passes. There is no client deadline. |
| D23 | No rule for a chosen partner who never confirms. | After 24 h the request expires (`client-request-expired`, `vendor-request-expired`). |
| D24 | Deactivation vs the ‹Профилът е активен› toggle. | Deactivation is a status with an email, reversible. The toggle is a silent soft pause. A deactivated partner keeps panel access. The reactivate control is new copy. |
| D25 | The wedding card shows ‹2 резервации · 1 300 € · 1 заявка чака плащане›. | Computed (§16). With the seed: 3 резервации, 2 750 € paid, no awaiting-payment badge. |
| D26 | Responsiveness is undefined. | §12.4. |
| D27 | ‹Свободни на 14 юни› is hard-wired and is a no-op once a date is chosen. | §13.4: shown only without a chosen date, for a client with an event. |
| D28 | ‹над 150› gives a need of 200 in the prototype. | 151. |
| D29 | The price filter vs per-guest prices. | §13.4. |
| D30 | Review copy is DJ- and wedding-specific and feminine (‹бих ги препоръчала›, ‹Бих ги наела пак›, ‹следващите двойки›). | Kept as approved for now; neutral variants are new copy. **[Nikola]** |
| D31 | Студио Мелодия's Коледно парти booking (‹Парти програма, 5 часа›, 680 €) matches no package. | Seeded literally as a `quote` booking on its ‹Фирмени събития› service. **[Nikola]** |
| D32 | ‹Мед и мляко› vs ‹Сладкарница „Мед и мляко“›. | The full name everywhere. |
| D33 | Градина и Маса and Бяла Покривка: the data city differs from the printed city. | Seeded with the data city (София / Варна). **[Nikola]** |
| D34 | Вкусна История: ‹от 1 200 €› vs ‹от 24 € на гост› vs Меню „Градина“ 28 € на гост. | Services are seeded from the moderation and booking data. The card from-price is computed, so it will read ‹от 28 € на гост›. **[Nikola]** |
| D35 | ‹Промяна на датата› has no flow. | Stored and displayed only; there is no reschedule flow in v1. |
| D36 | EN is "84% translated" but the switch says it is coming. | `locale.en_enabled = false`: ‹EN› shows ‹Английската версия идва скоро›. |
| D37 | Reminder times are not given. | Event reminders at 09:00, review invite at 10:00, digest at 09:00, batch preparation at 09:00 on the previous day. **[Nikola]** |
| D38 | Countdown subjects need singular forms. | ‹Остава 1 час›, ‹Остава 1 ден›, ‹1 звезда› are grammatical variants of approved copy. **[Nikola]** |
| D39 | Actions missing from the role matrix. | §1.2. There is no client unblock in v1. |
| D40 | A two-person release was asked for in the brief but is absent from the prototype. | ⚙ `payout.require_second_admin`, default false. |
| D41 | Invoices: VAT, credit notes, the commission invoice and EventAT's legal entity are not in the prototype. | Fields exist; legal content must be confirmed before launch. The numbering sequence is per issuer. **[Nikola + accountant]** |
| D42 | Per-guest pricing and minimum guests are used but not editable; the travel fee has no amount. | `service.price_unit` + `min_guests` added to the form (labels are new copy). The travel checkbox stays as designed; moderation enforces rule 2. |
| D43 | Facet counts in the prototype ignore other filters. | Counts under all other active groups. **[Nikola]** |
| D44 | ‹Отговаря до 24 часа› filters nothing. | Partners with no unanswered lapse in the last 90 days. **[Nikola]** |
| D45 | Search bugs (‹Търси› drops filters, abbreviated dates, event pill applies only date and guests; the request form shows a ‹Преглед› step that does not exist). | All bars submit GET params. Full month names. Event pills apply type, city, date and guests. The ‹Преглед› step is not built. |
| D46 | Guests lose their search choices on the way to sign-up. | `next` carries the full URL with params. |
| D47 | What `/` does for signed-in users. | Redirect by role (§1.3). **[Nikola]** |
| D48 | ‹Запомни ме› behaviour. | Unchecked = a browser-session cookie. |
| D49 | Code lifetime and limits are not given (only ‹0:42› on screen). | 10 min, 5 attempts, 60 s resend cooldown. |
| D50 | Token lifetimes. | Reset 60 min, deletion 24 h, team invite 7 days. |
| D51 | Sign-in for rejected partners. | Rejected partners cannot open the panel; signing in shows `/partner/registratsiya/podadeno` in its rejected variant (new copy). |
| D52 | Partner members. | One owner per partner in v1. `partner_member` exists for later. |
| D53 | ‹Ревюта само от платени резервации› would be a switch with no off-mode. | Rendered `is-on is-locked`; the toast text is new copy. **[Nikola]** |
| D54 | Bell content. | §4 bell rule; the admin bell is computed. |
| D55 | Changing the email has no re-verification. | A code goes to the new address before it switches (new copy). |
| D56 | ‹Изтрий› toasts ‹Изтрито› even with 9 upcoming bookings. | Blocked when there are upcoming bookings; otherwise the confirmation email is sent and the toast reads ‹Изпратихме имейл за потвърждение на изтриването› (client copy reused). |
| D57 | Payout account rejection has no screen. | §4.3 B3 (new copy). |
| D58 | Badges are missing for a returned service and for a partner cancellation request. | ‹Върната с бележка›, ‹Искане за анулиране› (taken from email wording). **[Nikola]** |
| D59 | Profile edits save at once while service edits are moderated. | Kept: profile and visibility are immediate, service content is moderated. **[Nikola]** |
| D60 | Offers have no UI on either side: no ‹Изпрати оферта›, no client "choose", no offers group; the partner button reads ‹Одобри заявката› where the email says ‹Потвърди офертата›. | The behaviour is specified (§4.5–4.6). The screens need design and copy before build. Until then, **quote and brief flows ship only after Nikola approves the copy**. Offer lapses send no email. |
| D61 | Does ‹Поискай още информация› pause the clock? | No. |
| D62 | Stripe needs the partner's provider onboarding before charges. | ‹Одобри заявката› is disabled until `charges_enabled`; the explanation text is new copy. The simulated provider is always enabled. |
| D63 | A decline has no reason input, but the email shows ‹Причина›. | The decline dialog offers ‹Датата е заета› or ‹Друга причина› + text. |
| D64 | What happens to other pending requests when a date fills. | Auto-declined with ‹Датата е заета›; brief offers for that date lapse. |
| D65 | Budget in a brief. | Informational only; not a matching filter. |
| D66 | admin/booking.html has no cancel or extend control, but the emails assume the team cancels there. | Add ‹Удължи срока› (only while awaiting payment) and ‹Анулирай резервацията› with a refund preview to `/admin/rezervacii/[nomer]`. Declining a partner's cancellation request uses new copy. **[Nikola]** |
| D67 | A failed refund has no email. | A team bell item and the audit log only. |
| D68 | Missing emails: admin export ready, team-opened dispute, dispute withdrawn. | Proposed new keys `team-report-ready`, `client-ticket-team-opened`, `vendor-ticket-team-opened`, `*-ticket-withdrawn` (copy needed). Until then those actions toast only and record the event. **[Nikola]** |
| D69 | The client shows ‹Чака решение› where the admin shows ‹Събираме данни›. | The same state label everywhere. |
| D70 | No window for opening a dispute after the event. | Up to 30 days after `event_date`. **[Nikola]** |
| D71 | Marketing and news emails have switches but no templates. | Preference stored; sending is done by an external tool, never through the transactional outbox. |
| D72 | ‹Приемам нови заявки› off: is the partner still listed? | Excluded from search and briefs; the profile page stays reachable with the request widget disabled (new copy). |
| D73 | The city filter compared only the base city. | Base city, nationwide, or within the radius (city centroids). Facet counts will differ from the prototype's typed values. **[Nikola]** |
| D74 | Specialisations mix event types and skills; ‹Абитуриентски бал› is missing. | Split into `partner_event_type` (feeds search) and `partner_tag`. Add the chip ‹Абитуриентски балове› (new copy). |
| D75 | ‹24 месеца› appears twice in the horizon list. | Options 3 / 6 / 12 / 24. |
| D76 | The radius list is 50/100/150, but cards show 60/80/120/200 km. | Stored as an integer km. Seed values are kept as data; the select offers the 4 options. **[Nikola]** |
| D77 | The gallery cap of 8 vs Лунна Фотография's 14 photos. | Cap 8 (⚙ `partner.gallery_max`). The seed uses only photos that exist in `public/photos`. |
| D78 | Tab count ‹Резервации 5› vs 6 bookings. | All confirmed and completed bookings (6 for Мария). |
| D79 | A saved search shows ‹38 свободни› > ‹29 изпълнители›. | Computed. Free-on-date ≤ results by construction. |
| D80 | ‹7 партньори са свободни› ignores a booked photographer. | Computed from availability. |
| D81 | ‹Контакти потвърдени› implies phone verification. | Phone is not code-verified; `contacts` is a manual team check. |
| D82 | The payout account is reviewed but not collected in the wizard. | It is added in `/partner/smetka` after approval; approval is allowed without it. |
| D83 | The business name is editable on the profile but limited in settings. | Read-only on the profile; ‹Смени името› in settings. |
| D84 | Reused figures (18 940 €, 8 432 €, 21) mean different things on different screens. | All computed; nothing is seeded as an aggregate. |
| D85 | Петя и Николай appear in two weddings (May 2025, June 2026). | Seeded as in the prototype; open question in review-list. **[Nikola]** |
| D86 | ‹партньор от февруари 2026› is in the future. | Derived from `approved_at`. The seed uses **1 февруари 2025** for Студио Мелодия (same month, previous year). **[Nikola]** |
| D87 | Квартет „Адажио“: booking time 16:00 vs a 17:00 ceremony in the messages. | Seeded 16:00 (bookings.html). **[Nikola]** |
| D88 | 2026-0614-ДК has three meanings. | A pending direct request from Мария to Флора Студио. The email examples are illustrations, not seed. |
| D89 | The bell says Вкусна История answered 2026-1219-КТ while the lists say pending. | Pending; the bell item is seeded as a ‹Ново съобщение от …›-style message notice. |
| D90 | Абитуриентски бал (70 гости, Хотел „Маринела“) has four dates and two clients. | Seed 2026-0630-АБ: 30 юни 2026, СУ „Христо Ботев“, paid, 640,00 €. Надежда Стоянова's request is not seeded. **[Nikola]** |
| D91 | Технолинк ЕООД ↔ Студио Мелодия is shown as both a new inquiry and awaiting payment at 2 100 €. | A `pending` `quote` request with no amount. The 2 100 € is not seeded. Технолинк ↔ Вкусна История (2026-0621-ТЛ) is a separate booking. |
| D92 | Ивелина Тодорова ↔ Студио Мелодия is shown as both new and confirmed (05.06 / 06.06 / 28.06). | A `pending` request for 28 юни 2026 (Пакет „Вечер“, 640 €). Her paid bookings with Snap360 and Вкусна История on 28 юни 2026 stay (admin data). **[Nikola]** |
| D93 | ‹Изпълнителят не потвърди› (admin attention row, 2026-0530-РД) matches no rule: a paid booking needs no further partner confirmation. | The attention list shows only payment deadlines ≤ 4 h and open disputes; 2026-0530-РД is seeded as a normal confirmed booking. **[Nikola]** |
| D94 | ‹Към таблото› on the pending page leads into a panel that cannot work before approval. | The button renders only once the partner is `approved`; while `submitted` the page shows the timeline only. **[Nikola]** |
| D95 | The partner request page shows a client rating (‹4,9 Оценка›), but no flow lets anyone rate clients. | Dropped. The client card shows bookings count and ‹Клиент от {година}› only. **[Nikola]** |
| D96 | The admin client-list badge mixes type and status (‹Бизнес› vs ‹Отворен спор›). | Type is shown in the sub-line. The badge is a computed status: ‹Блокиран› > ‹Отворен спор› > ‹Активен› (the ‹Блокиран› label is new copy). |
