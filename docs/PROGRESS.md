# Build progress

Living log of the platform build. Newest state at the top of each section.

## Done
- **Foundation** (8 Oct): Next.js 15 app with three root layouts (site, panel, wizard); prototype CSS ported with a fluid/mobile layer;
  PostgreSQL 17 locally via `npm run db:up`; Better Auth (email + password, 6-digit email code, reset link, two-factor);
  email renderer, outbox and Postmark/Resend transports; payment-provider boundary (simulated + Stripe Connect);
  file storage (local / S3-R2); job queue + `/api/cron/tick`; formats; shells (SiteHeader, PanelShell, bell, menus, toasts).
- **Emails** (8 Oct): all 90 prototype emails as typed templates with samples; 99 tests.
- **Build contract** (8 Oct): `docs/SPEC.md`, `docs/DATA-MODEL.md`, `docs/SCREENS.md`, `docs/DESIGN-PORT.md`.

- **Domain core** (8 Oct, 20:07–21:50): 83-table schema; lifecycle (requests → payment → booking → completion),
  aftercare (cancellation engine, refunds, disputes, payouts, chargebacks), catalogue (partners, services, availability,
  search, reviews, saved, messaging, clients, team), demo seed. Each module adversarially reviewed (35 defects fixed).
  Merged to main: typecheck clean, 433 tests pass. Main DB reset + seeded (30 users, 80 pending jobs).
- **Panel chrome** (8 Oct): partner and admin layouts with guards, live rail counters, computed admin bell.

- **UI build** (8–9 Oct): every prototype screen ported on real data in 9 areas, each reviewed by a click-everything
  reviewer (180+ defects fixed); merged; shared fixes (page titles, guest return path, Bulgarian 404, deletion links).
  All 9 area e2e suites pass against the production build (`tools/e2e-all.sh`), 514 unit tests, `next build` clean.
- **Approval list** (9 Oct): `docs/review-list.md`, 154 numbered items for Nikola.

- **Cross-area journeys** (9 Oct): J1 booking → payout, J2 cancellations, J3 disputes, J4 new partner → first booking;
  ~30 more defects fixed. Full suite on the merged production build: 9 areas + 4 journeys all pass
  (`tools/e2e-all.sh`, local demo database `eventat_dev`), 529 unit tests, `next build` clean.

- **Security review** (9 Oct): 21 findings in 6 threat classes, 17 confirmed by adversarial verification, 14 fixed
  with tests (live reset/invite links hidden from the team outbox view; chargeback/refund/payout webhooks applied;
  stale checkouts can't confirm old prices; private files in a separate bucket; upload quotas; CSV formula escaping;
  open-redirect hole; DB-backed auth throttling; image proxy). After the merge: 569 unit tests, 13/13 e2e suites pass.

- **Auth/session review** (9 Oct): 9 findings, 8 confirmed; the serious one (Better Auth's unused email-code sign-in
  and reset routes were open — guessable codes) closed with an allow-list of auth routes; immediate session revocation;
  email-change limits; social sign-in only with a provider-confirmed email (Facebook hidden — decision 31).
- **Accessibility** (9 Oct): axe + keyboard audit of every route; keyboard menus/comboboxes/dialogs, labels, errors,
  focus ring, aria-current, landmarks. Only colour contrast remains (decision 157). Audits: `tools/a11y*.py`.
  After both merges: 586 unit tests, 13/13 e2e suites pass on the production build.

- **Production migration** (9 Oct): `db/migrations/0000_init.sql`, verified identical to the pushed schema.
- **Speed** (9 Oct): launch-year volume (`npm run db:perf-data`: 1 500 partners, 20 000 clients, 12 000 bookings…);
  every measured page < 300 ms on the production build (worst `/admin/klienti`: 3 s → 106 ms); 5 indexes; long lists
  capped with ‹Покажи още› (decision 158).

## In progress
- Nothing running.

## Next
2. Staging on Vercel (Euribiatech team, Pro): needs a Neon Postgres database created by a person; then env vars, cron, seed.
3. Answers to `docs/review-list.md` → apply.
4. Known intermittent issue: a rare React hydration warning (#418) seen twice in the production build during e2e
   (partner sign-up, admin money), never reproduced in dev — add error monitoring (Sentry) before launch.

## Waiting on people
- Production needs (from the security review): a second, private R2 bucket (`S3_PRIVATE_BUCKET`); a Stripe Connect
  webhook endpoint (`STRIPE_CONNECT_WEBHOOK_SECRET`); an admin screen for failed refunds / chargebacks (decision).
- Nikola / client: approve new copy flagged in SPEC §17 (decisions marked [Nikola]).
- Accounts only a person can create: Neon (via Vercel Storage), Stripe, Postmark, Cloudflare R2.

## Open items from the domain reviews
- Seed: dispute 2025-0509-СВ sits on a cancelled booking (SPEC X1 vs DATA-MODEL S9); seeded partners with < 3 paid bookings get the 5% intro rate when demo bookings are paid; no consent rows seeded.
- Lifecycle: K3 extension not clamped to the event start; client `withdrawn` status unused; `client-request-declined` always says the date is taken.
- Aftercare: K10 decline after the event leaves the booking `confirmed` (T13 already ran) — needs T13 re-arm; reminders not re-armed after `restore_price`; read-only finance functions rely on the page for permission checks.
- Catalogue: D55 email change has no attempt limit and no approved code email; `client-signout-all` falls back to „София“.
- Email copy needing approval: partial-refund / team-cancellation wording, deposit-mode emails (D5), offer screens (D60).
