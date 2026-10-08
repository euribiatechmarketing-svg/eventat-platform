# Build progress

Living log of the platform build. Newest state at the top of each section.

## Done
- **Foundation** (8 Oct): Next.js 15 app with three root layouts (site, panel, wizard); prototype CSS ported with a fluid/mobile layer;
  PostgreSQL 17 locally via `npm run db:up`; Better Auth (email + password, 6-digit email code, reset link, two-factor);
  email renderer, outbox and Postmark/Resend transports; payment-provider boundary (simulated + Stripe Connect);
  file storage (local / S3-R2); job queue + `/api/cron/tick`; formats; shells (SiteHeader, PanelShell, bell, menus, toasts).
- **Emails** (8 Oct): all 90 prototype emails as typed templates with samples; 99 tests.
- **Build contract** (8 Oct): `docs/SPEC.md`, `docs/DATA-MODEL.md`, `docs/SCREENS.md`, `docs/DESIGN-PORT.md`.

## In progress
- **Domain core** — workflow `wf_7f597fcf-733` (started 8 Oct 20:07):
  schema on main → four builders in git worktrees `../eventat-wt/{lifecycle,aftercare,catalogue,seed}` on branches `dom/*`,
  each followed by an adversarial verifier. Resume: `Workflow({scriptPath: <script>, resumeFromRunId: "wf_7f597fcf-733"})`.

## Next
1. Merge `dom/*` branches into main; run all tests; reset + seed the main database.
2. UI build (fan-out by area, prototype markup ported, real data):
   public & search · auth & client account · client booking flow · messaging & support ·
   partner onboarding wizard · partner panel (requests, bookings, calendar) · partner catalogue & money ·
   admin operations · admin money & cases.
3. End-to-end journeys with real clicks (client books → partner approves → client pays → event → payout; cancellation; dispute).
4. Responsive pass at 390 px; accessibility basics.
5. Deploy to a protected staging URL (needs Neon DB + Vercel Pro from the user).

## Waiting on people
- Nikola / client: approve new copy flagged in SPEC §17 (decisions marked [Nikola]).
- Accounts only a person can create: Neon (via Vercel Storage), Stripe, Postmark, Cloudflare R2.
