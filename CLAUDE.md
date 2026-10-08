# EventAT platform — working notes for Claude

The production build of EventAT, a Bulgarian two-sided marketplace for event services (weddings, birthdays, corporate events).
Clients find and book partners ("партньори"); a licensed payment provider holds the money until after the event.
Built by Euribia Tech for ЧЕРИ ЕСТЕЙТ ЕООД. All UI copy is Bulgarian.

The approved design is the clickable prototype in `../eventat-app` (static HTML, see its CLAUDE.md).
**The prototype is the design source of truth**: markup, class names, copy and flows are ported from it.
The build contract is in `docs/`:

- `docs/SPEC.md` — rule book: state machines, deadlines, cancellation engine, commission, payouts, search semantics.
- `docs/DATA-MODEL.md` — tables, enums and the demo seed.
- `docs/SCREENS.md` — every prototype screen → production route, data, actions, emails; the email catalogue.

## Run it

```bash
export PATH="$HOME/nodejs22/bin:$PATH"     # Node 22 lives here; the system Node 20 is too old
npm run db:up                               # PostgreSQL 17 on 127.0.0.1:54329 (leave running; skip if already up)
npm run db:reset && npm run db:seed         # fresh schema + demo data
npm run dev                                 # http://localhost:3000
```

- Env: `.env.local` (copy of `.env.example`). Load it into the shell for scripts: `set -a; . ./.env.local; set +a`.
- **Own database per worker.** Parallel workers use their own database on the shared server:
  `export DATABASE_URL=postgres://eventat:eventat@127.0.0.1:54329/eventat_<name>` then `npm run db:create && npm run db:reset && npm run db:seed`.
- Demo users (password `eventat-demo`): `maria.dimitrova@gmail.com` (client), `studio.melodia@gmail.com` (partner), `monika.kovacheva@eventat.bg` (admin).
- Clock: business time comes from `now()` in `lib/clock.ts`. With `ALLOW_TIME_TRAVEL=true` the seed sets it to the prototype's "today", **Sunday 31 август 2025, 12:00** (Sofia), so all demo data is coherent. Never use `new Date()` / `Date.now()` for business time.
- Timers: `npm run tick` runs due jobs once (production: Vercel Cron → `/api/cron/tick` every minute).

## Checks (all must pass before you hand work back)

```bash
npm run typecheck
npm test                                    # vitest: domain rules
npm run build                               # catches server/client boundary errors
python3 tools/shoot.py OUT /route --as client|partner|admin [--full]   # look at the images
```

Look at screenshots at both widths (1440 and 390). Test interactions with real clicks (Playwright `page.click`, `page.fill`), not `el.click()`.

## Architecture

| Path | What |
|---|---|
| `app/(site)/` | Root layout for the public site and the client account (`client.css`, `public.css`) |
| `app/(panel)/partner/`, `app/(panel)/admin/` | Root layout for the panels (`app.css`, `admin.css`) |
| `app/(wizard)/` | Partner sign-up wizard (`wizard.css`) |
| `app/api/` | Auth, cron tick, payment webhooks, private files |
| `db/schema/*.ts` | Drizzle tables. Until launch there are no incremental migrations: `npm run db:reset` pushes the current schema and runs `db/sql/*.sql` (triggers, constraints). Tests clone a template database built the same way |
| `lib/domain/*.ts` | **All business rules.** State transitions, money, policies. Pages and actions call these; they never write business tables directly |
| `lib/email/` | Templates (keys match the prototype's `emails/emails.js`), renderer, outbox, transports |
| `lib/payments/` | Provider boundary: `simulated` (test checkout) and `stripe` (Connect). EventAT never holds client money itself |
| `lib/jobs/` | Deadline/reminder jobs; handlers registered in `lib/jobs/handlers.ts` |
| `lib/format.ts` | Money and date formats. Always use these |
| `lib/session.ts` | `currentUser()`, `requireUser()`, `requireRole()` |
| `components/` | Shells (`site/SiteHeader`, `panel/PanelShell`) and shared UI (`ui/Icon`, `ui/client` menus/toasts) |
| `styles/` | Prototype CSS copied verbatim + `platform.css` (fluid pages, runtime UI, mobile shells). Module CSS goes in `styles/m-<module>.css`, imported by that module's layout or page |

### Rules for code
1. **Port, don't redraw.** Open the prototype screen, copy its markup into JSX with the same classes, replace the fake data with real queries. Keep the Bulgarian copy exactly unless data makes it wrong.
2. **Real behaviour only.** No fake data, no dead controls. Every button does what it says (server action, link, or client state). Lists have real empty states.
3. **Server actions** live next to the page (`actions.ts`, `'use server'`). Each one: authenticate with `requireRole`, validate with zod, call a `lib/domain` function inside `db.transaction`, `revalidatePath`, then `setFlash()` + `redirect()` or return `{ ok, error }`.
4. **Authorisation** in every page/layout and every action: a client only sees their own requests/bookings; a partner only their business; admins everything.
5. **Money** is integer euro cents. **Event dates** are `date` columns (`'2026-06-14'`), instants are `timestamptz`. Display with `lib/format.ts`, in Europe/Sofia.
6. **Emails** only via `sendEmail({ key, to, toUserId, vars, dedupeKey }, tx)` with keys from the prototype. **Bell** via `notify()`.
7. **Audit**: admin actions and money moves write `audit_log`.
8. **Phone rule:** a partner sees the client's phone only after a confirmed (paid) booking. Before that, message text is masked for phone numbers and emails.
9. **Commission** (10%, 5% for a partner's first three bookings) is shown only on admin screens. Partners see what they receive.

### Copy and design rules (from the prototype; the client raised each one)
- Formal "Вие"; "ви/вашата/вашия" lowercase mid-sentence. Buttons are short singular imperatives. No exclamation marks or emoji.
- Money "1 450,00 €" (running text "1 450 €"); dates "14 юни 2026".
- Digits inside display-font headings go in `<span className="num">` (Constantia draws old-style figures).
- Nothing wraps to a second line in buttons, pills, tabs, chips, labels. Every dropdown shows a chevron. Looks clickable ⇔ is clickable. No purple text on purple backgrounds.
- Nothing on screen that isn't product copy: no notes, "MVP", "TODO" or placeholder markers.
- Never invent facts in copy. Demo data comes from the prototype (seed only).

## Deploy

GitHub `euribiatechmarketing-svg/eventat-platform` (private). Commit as:
```
git config user.name  "Euribia Tech"
git config user.email "273058418+euribiatechmarketing-svg@users.noreply.github.com"
```
Production needs: Neon Postgres (Frankfurt), Vercel Pro (per-minute cron), an email provider (Postmark), a payment provider account, R2 bucket. See `docs/DEPLOY.md`.
