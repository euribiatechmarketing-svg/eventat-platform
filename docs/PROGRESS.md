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

## In progress
- **UI build** — workflow `wf_7e7cb6de-c1a` (started 8 Oct 21:55), script `tools/workflows/ui-build.js`:
  9 area builders in worktrees `../eventat-wt/ui-<area>` on branches `ui/<area>`, each followed by a click-everything reviewer.
  Resume: `Workflow({scriptPath: "<repo>/tools/workflows/ui-build.js", resumeFromRunId: "wf_7e7cb6de-c1a"})`.
  8 Oct ~22:35: 9 agents stopped on the account's spend limit. Finished before that: messaging-support and
  partner-catalogue builds (committed on their branches); partner-ops had committed part of its work.
  9 Oct 12:50: relaunched from the same run ID; the other areas continue from the files left in their worktrees.

## Next
1. Merge the nine `ui/*` branches; typecheck, tests, `next build`.
2. Open items from the domain reviews (see below).
3. End-to-end journeys with real clicks (client books → partner approves → client pays → event → payout; cancellation; dispute).
4. Responsive pass at 390 px; accessibility basics.
5. Deploy to a protected staging URL (needs Neon DB + Vercel Pro from the user).

## Waiting on people
- Nikola / client: approve new copy flagged in SPEC §17 (decisions marked [Nikola]).
- Accounts only a person can create: Neon (via Vercel Storage), Stripe, Postmark, Cloudflare R2.

## Open items from the domain reviews
- Seed: dispute 2025-0509-СВ sits on a cancelled booking (SPEC X1 vs DATA-MODEL S9); seeded partners with < 3 paid bookings get the 5% intro rate when demo bookings are paid; no consent rows seeded.
- Lifecycle: K3 extension not clamped to the event start; client `withdrawn` status unused; `client-request-declined` always says the date is taken.
- Aftercare: K10 decline after the event leaves the booking `confirmed` (T13 already ran) — needs T13 re-arm; reminders not re-armed after `restore_price`; read-only finance functions rely on the page for permission checks.
- Catalogue: D55 email change has no attempt limit and no approved code email; `client-signout-all` falls back to „София“.
- Email copy needing approval: partial-refund / team-cancellation wording, deposit-mode emails (D5), offer screens (D60).
