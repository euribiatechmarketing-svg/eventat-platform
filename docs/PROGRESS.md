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

## In progress
- **Cross-area journeys** — workflow `wf_f1aa8721-d03` (9 Oct 15:20): booking→payout, cancellations, disputes,
  new partner→first booking; worktrees `../eventat-wt/journey-*`, branches `test/journey-*`.

## Next
1. Merge the journey branches; rerun `tools/e2e-all.sh` and the journeys.
2. Staging on Vercel (Euribiatech team, Pro): needs a Neon Postgres database created by a person; then env vars, cron, seed.
3. Answers to `docs/review-list.md` → apply.
4. Known intermittent issue: a rare React hydration warning (#418) seen twice in the production build during e2e
   (partner sign-up, admin money), never reproduced in dev — add error monitoring (Sentry) before launch.

## Waiting on people
- Nikola / client: approve new copy flagged in SPEC §17 (decisions marked [Nikola]).
- Accounts only a person can create: Neon (via Vercel Storage), Stripe, Postmark, Cloudflare R2.

## Open items from the domain reviews
- Seed: dispute 2025-0509-СВ sits on a cancelled booking (SPEC X1 vs DATA-MODEL S9); seeded partners with < 3 paid bookings get the 5% intro rate when demo bookings are paid; no consent rows seeded.
- Lifecycle: K3 extension not clamped to the event start; client `withdrawn` status unused; `client-request-declined` always says the date is taken.
- Aftercare: K10 decline after the event leaves the booking `confirmed` (T13 already ran) — needs T13 re-arm; reminders not re-armed after `restore_price`; read-only finance functions rely on the page for permission checks.
- Catalogue: D55 email change has no attempt limit and no approved code email; `client-signout-all` falls back to „София“.
- Email copy needing approval: partial-refund / team-cancellation wording, deposit-mode emails (D5), offer screens (D60).
