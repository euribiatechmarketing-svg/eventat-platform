export const meta = {
  name: 'eventat-ui-build',
  description: 'EventAT platform: build every screen from the prototype on real data, 9 areas in parallel worktrees, each verified by a click-everything reviewer',
  phases: [
    { title: 'Build', detail: '9 area builders in git worktrees' },
    { title: 'Verify', detail: 'click-everything review, prototype parity, mobile' },
  ],
}

const REPO = '/Users/nikoladamyanov/Desktop/Alexa/eventat-platform'
const PROTO = '/Users/nikoladamyanov/Desktop/Alexa/eventat-app'
const WT = '/Users/nikoladamyanov/Desktop/Alexa/eventat-wt'
const ENV = `Use Node 22: \`export PATH="$HOME/nodejs22/bin:$PATH"\`. PostgreSQL 17 runs on 127.0.0.1:54329 (eventat/eventat) — never stop it; use only your own database.`

const AREAS = [
  { name: 'public', port: 3201, rows: 'SCREENS.md §2 Public site (/, /kategorii, /kategorii/[slug], /tarsene, /sabitiya/[slug], /partnyori/[slug], /kak-raboti, /stani-partnyor, /pravila)', proto: 'client/start.html, client/categories.html, client/category.html, client/catalog.html, client/search.html, client/event-type.html, client/vendor.html, client/how-it-works.html, client/become-partner.html, client/legal.html', extra: 'Search UI is the most visible feature: the bar with its suggestion panel, dropdown cells with chevrons, facet filters with live counts, chips, the results sentence, sorting, busy cards with „Уведоми ме“, zero state with recovery buttons — all driven by lib/domain/search.ts and GET parameters (SPEC §13). Client components only where interaction needs it.' },
  { name: 'auth-account', port: 3202, rows: 'SCREENS.md §3 Auth (/vhod, /registratsiya, /potvarzhdenie, /vhod/nova-parola, deletion and email-change screens) and §4 rows /akaunt, /akaunt/nastroyki, /akaunt/zapazeni, /akaunt/sabitiya, /akaunt/sabitiya/[id]', proto: 'client/auth.html, client/register.html, client/verify.html, client/settings.html, client/saved.html, client/events.html, client/event.html', extra: 'Auth uses Better Auth (lib/auth.ts, lib/auth-client.ts): sign-up with role (client or partner — partner sign-up creates the partner draft via lib/domain/partners.ts), 6-digit email code (emailOTP plugin, overrideDefaultEmailVerification), sign-in with redirect rules SPEC §1.3 and ?next=, „Запомни ме“ (rememberMe), password reset link page, Google/Facebook buttons only when configured (otherwise hide them — no dead controls), 2FA toggle. Guard: signed-in users visiting /vhod or /registratsiya go to their home.' },
  { name: 'client-booking', port: 3203, rows: 'SCREENS.md §4 rows /akaunt/zayavki, /akaunt/zayavki/[nomer], /akaunt/rezervacii, /akaunt/rezervacii/[nomer] (+ /anulirane, /faktura, /revyu) and §5 Booking flow (/zayavka/[partnerSlug], /zayavka/otvorena, /plashtane/[nomer], /plashtane/[nomer]/potvardena; /plashtane/test/[chargeId] exists — restyle it to match)', proto: 'client/request.html, client/requests.html, client/request-status.html, client/brief.html, client/payment.html, client/confirmed.html, client/bookings.html, client/cancel.html, client/invoice.html, client/review.html', extra: 'Countdowns are live (client component ticking every minute from the server deadline). The cancel page shows the exact cancellation.quote() preview. Invoice page renders the invoice document; „Свали PDF“ serves a printable HTML/PDF via an API route. Brief/offers: SPEC says the offer screens need new copy — build the brief form (prototype exists) and its submission; for offers, show offers in Моите заявки only if lib/domain supports them, otherwise skip that group (no placeholder copy).' },
  { name: 'messaging-support', port: 3204, rows: 'SCREENS.md §4 rows /akaunt/saobshteniya(/[id]), /akaunt/poddrazhka (+ /nov, /[nomer]) and §7 rows /partner/saobshteniya(/[id]), /partner/poddrazhka (+ /nov, /[nomer])', proto: 'client/messages.html, client/dispute.html, vendor/messages.html, vendor/dispute.html', extra: 'Two-sided messaging with the contact-masking rule (SPEC §10), unread state, attachments via lib/storage, drafts; refresh new messages without reload (poll every 15 s with a server action or router.refresh). Disputes: opening, statements, evidence upload (≤ 6 photos), case page with countdown and the decision once made. You own both the (site) and (panel)/partner routes listed here.' },
  { name: 'partner-onboarding', port: 3205, rows: 'SCREENS.md §6 Partner onboarding (/partner/registratsiya/1…6, /partner/registratsiya/podadeno) and the wizard top bar', proto: 'onboarding/business.html, onboarding/profile.html, onboarding/services.html, onboarding/availability.html, onboarding/policy.html, onboarding/review.html, onboarding/pending.html', extra: 'Root layout is app/(wizard)/layout.tsx (wizard.css). Build app/(wizard)/partner/registratsiya/layout.tsx with the steps rail, top bar (saved-at status, „Запази и продължи по-късно“) and footer progress. Real uploads for avatar, cover and gallery (lib/storage + media rows), package editor, availability calendar blocking, policy choice, review summary with „Редактирай“ links, submit → pending page with live status.' },
  { name: 'partner-ops', port: 3206, rows: 'SCREENS.md §7 rows /partner (dashboard), /partner/zayavki, /partner/zayavki/[nomer], /partner/zapitvaniya/[id] (only if briefs are supported by lib/domain), /partner/rezervacii, /partner/rezervacii/[nomer], /partner/kalendar, /partner/tarsene', proto: 'vendor/dashboard.html, vendor/requests.html, vendor/request.html, vendor/request-approved.html, vendor/bookings.html, vendor/booking.html, vendor/calendar.html', extra: 'app/(panel)/partner/layout.tsx already exists on main (guard, rail with live count, account menu, bell). Replace the placeholder app/(panel)/partner/page.tsx with the dashboard. Change the layout only if a screen truly needs it, and report it. Add the topbar search (/partner/tarsene).' },
  { name: 'partner-catalogue', port: 3207, rows: 'SCREENS.md §7 rows /partner/uslugi, /partner/uslugi/nova, /partner/uslugi/[id], /partner/profil, /partner/revyuta, /partner/prihodi, /partner/smetka, /partner/nastroyki (+ deletion confirm)', proto: 'vendor/services.html, vendor/service-new.html, vendor/service-edit.html, vendor/profile.html, vendor/reviews.html, vendor/earnings.html, vendor/payout-account.html, vendor/settings.html', extra: 'Commission never appears on partner screens — only „Получавате“. Photo upload/reorder for services and the profile gallery. Earnings figures per SPEC §8.2.' },
  { name: 'admin-ops', port: 3208, rows: 'SCREENS.md §8 rows /admin (dashboard), /admin/partnyori, /admin/partnyori/[id], /admin/moderatsiya, /admin/klienti, /admin/klienti/[id], /admin/nastroyki, /admin/nastroyki/ekip, /admin/pokana/[token], /admin/tarsene', proto: 'admin/dashboard.html, admin/vendors.html, admin/vendor.html, admin/moderation.html, admin/clients.html, admin/client.html, admin/settings.html, admin/team.html', extra: 'app/(panel)/admin/layout.tsx already exists on main (guard, permission-gated rail, live counts, computed bell in lib/domain/views-panel.ts). Replace the placeholder app/(panel)/admin/page.tsx with the dashboard; gate each page by its permission (SPEC §1.2). Settings page writes versioned settings; include the demo clock control only when ALLOW_TIME_TRAVEL=true (shows the platform date/time and lets the admin move it forward by hours/days, then runs due jobs).' },
  { name: 'admin-money', port: 3209, rows: 'SCREENS.md §8 rows /admin/rezervacii, /admin/rezervacii/[nomer], /admin/sporove, /admin/sporove/[nomer], /admin/plashtaniya, /admin/plashtaniya/partidi/[id], /admin/imeyli, /admin/imeyli/[key], /admin/imeyli/[key]/preview', proto: 'admin/bookings.html, admin/booking.html, admin/disputes.html, admin/dispute.html (the CASES object shows every case variant), admin/payouts.html, admin/emails.html, emails/email.html', extra: 'The case page is the richest admin screen: both statements, evidence, money, options with the decision form and mandatory reasoning, reminders, info requests. Payout release respects release_payouts and the optional second approver. The emails area lists lib/email/templates CATALOGUE with sent counts from email_outbox, previews each template with its sample vars, and also lists the real outbox (latest sent emails, filterable) so the team can see what went out. app/(panel)/admin/layout.tsx exists on main; gate your pages by permission (view_finance for Плащания, resolve_disputes for Спорове).' },
]

const BUILD = (a) => `You are a senior front-end + full-stack engineer on the EventAT production platform. Repo ${REPO} — read its CLAUDE.md (rules!), then docs/SCREENS.md (your rows), the docs/SPEC.md sections those rows cite, and docs/DESIGN-PORT.md (how the prototype CSS/markup is ported). ${ENV}

Set up your own worktree and database:
\`\`\`
cd ${REPO} && git worktree add ${WT}/ui-${a.name} -b ui/${a.name} main
cd ${WT}/ui-${a.name} && cp ${REPO}/.env.local .env.local && npm ci --no-audit --no-fund
export DATABASE_URL=postgres://eventat:eventat@127.0.0.1:54329/eventat_ui_${a.name.replace(/-/g, '_')}
# put that DATABASE_URL and APP_URL/BETTER_AUTH_URL=http://localhost:${a.port} into .env.local
npm run db:create && npm run db:reset && npm run db:seed
npx next dev -p ${a.port}   # run in the background, log to a file
\`\`\`
(Reuse the worktree if it exists.) Demo logins (password eventat-demo): maria.dimitrova@gmail.com (client), studio.melodia@gmail.com (partner), monika.kovacheva@eventat.bg (admin). The platform clock is the prototype's "today" (31 Aug 2025 12:00).

YOUR AREA: ${a.name}
Screens: ${a.rows}
Prototype source (in ${PROTO}): ${a.proto}
${a.extra}

How to build each screen:
1. Open the prototype HTML file and its per-page <style> block, and find its behaviour in ${PROTO}/proto.js (search the file name: ROUTES, FILTERS, PROTO_LISTS, CONFIRM, MENUS, toasts). Screenshot the prototype page for reference: \`cd ${PROTO} && python3 -m http.server 52${a.port % 100} &\` then \`python3 tools/shoot.py OUTDIR client/x.html\` (prototype tool) — or open it with Playwright at 1920×1080.
2. Port the markup to JSX with the SAME class names and structure (className, self-closing tags, inline SVGs as JSX or components/ui/Icon). Per-page <style> rules go to styles/m-${a.name}.css, imported from your route layout or page. Drop prototype-only artefacts (#frame zoom script, Figma capture, proto.js, data-go/data-toast attributes).
3. Replace every piece of fake data with real data from the database through lib/domain functions (read models: add query functions in lib/domain/views-${a.name}.ts if the domain modules don't already provide them). Keep the Bulgarian copy word for word; numbers, names, dates and amounts come from data and lib/format.ts.
4. Every control works: links navigate, forms are real <form>s with server actions (actions.ts next to the page: requireRole → zod → domain function → revalidatePath → setFlash(toast text from the prototype) → redirect, or return {error} shown inline), toggles/menus/tabs/filters are real (URL params for list filters so pages are shareable). Dropdowns show a chevron. No dead buttons; if the domain has no support for an action, implement the domain function (in your views file or the owning module) rather than faking it. Toast texts = the prototype's.
5. Guards per SCREENS §0 (client sees only own records → notFound()).
6. Responsive: must work at 390 px wide (no horizontal page scroll, readable tables → stacked rows or horizontal scroll inside a wrapper, grids collapse, bars stack). Add the rules to styles/m-${a.name}.css under @media (max-width: 960px / 640px).
7. Do not edit shared files (components/site/*, components/panel/*, components/ui/*, styles/platform.css, app/(site|panel|wizard)/layout.tsx root layouts, other areas' routes). If you need a shared change, make the smallest local alternative and list the needed shared change in your reply.

Verify before you finish:
- npm run typecheck passes; npm test passes.
- Every route of your area loads without server errors for the right role, and redirects for the wrong role/guest.
- Screenshots at 1440 and 390 of every route (python3 tools/shoot.py OUT /route --as client|partner|admin --full --base http://localhost:${a.port}); LOOK at them and compare with the prototype screenshot: same layout, same copy, nothing broken, no wraps in buttons/pills/chips, digits in display headings wrapped in .num.
- A Playwright script tests/e2e/${a.name}.py that signs in and exercises every action with real clicks/typing (page.click/page.fill), asserting the visible result (toast, new state, redirect) and the database effect where useful. It must pass against your dev server.
Commit on branch ui/${a.name} (author "Euribia Tech <273058418+euribiatechmarketing-svg@users.noreply.github.com>", message ending "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"). Stop your dev server. Do not push or merge.
Reply with: routes built, domain functions added/changed (file + name), shared changes you need, anything not built and why, e2e result.`

const VERIFY = (a, built) => `You are the toughest reviewer on the EventAT platform: the client's designer "clicks everything" and rejects anything that looks clickable but isn't, any text that wraps in a button, any made-up copy, anything that differs from the approved prototype, and anything broken on a phone. Repo ${REPO} (read CLAUDE.md). ${ENV}
Area "${a.name}" was built in worktree ${WT}/ui-${a.name} (branch ui/${a.name}); its .env.local has its DATABASE_URL and port ${a.port}. The builder reported:
---
${built}
---
Work in that worktree. Start its dev server on ${a.port} (npm run db:reset && npm run db:seed first for a clean state).
1. Parity: for every route, screenshot it (tools/shoot.py, both widths, --full) and the matching prototype screen in ${PROTO} (${a.proto}); list every visual or copy difference that isn't explained by real data, and fix it.
2. Click everything: with Playwright and real input, click every link, button, tab, chip, toggle, dropdown and form control on every route as the right role. Anything that does nothing, errors, or leads to a 404 is a defect — fix it. Check toasts and redirects match the prototype's.
3. Rules: CLAUDE.md copy/design rules (no wraps, chevrons, .num digits, formats, formal Вие, no purple on purple, no notes/placeholder text), authorisation (try another user's ids/numbers → 404; guest → sign-in), SPEC behaviour behind each action.
4. Phone (390 px): no horizontal scroll (document.documentElement.scrollWidth <= 390), nothing cut off, tap targets usable. Fix with CSS in styles/m-${a.name}.css.
Extend tests/e2e/${a.name}.py with a check for each defect you fixed. Run npm run typecheck && npm test && the e2e script until green. Commit on the same branch (same author/trailer). Stop the dev server.
Reply with: defects found and fixed (one line each), remaining issues you could not fix, e2e result.`

const results = await pipeline(
  AREAS,
  a => agent(BUILD(a), { label: `ui:${a.name}`, phase: 'Build' }),
  (built, a) => agent(VERIFY(a, built), { label: `check:${a.name}`, phase: 'Verify' }).then(v => ({ area: a.name, built, verified: v })),
)
return results
