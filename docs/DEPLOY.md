# Deploying EventAT

Production runs on Vercel (Frankfurt, `fra1`) with a Neon PostgreSQL database in Frankfurt.
Everything the app needs comes from environment variables (`.env.example` lists them all).

## Accounts the operator must own

These belong to the operating company, not to Euribia. Each one needs a person to sign up and accept terms.

| Service | Why | Plan |
|---|---|---|
| Vercel (team "Euribiatech" or the operator's own) | Hosting, per-minute cron | **Pro** — Hobby runs cron once a day and is non-commercial only |
| Neon | PostgreSQL, region `aws-eu-central-1` (Frankfurt) | Launch: free/Launch; production: Scale (30-day restore) |
| Payment provider (Stripe Connect or Mangopay) | Holds client money, verifies partners, pays out | Needs the operating company's documents |
| Postmark (or Amazon SES) | Sending the 90 automatic emails | Postmark from $15/month |
| Cloudflare R2 | Photos, documents, dispute evidence | Pay as you go |

## Steps

1. **Database.** In Vercel → Storage → Create → Neon, region Frankfurt. Vercel adds `DATABASE_URL` to the project.
   Then run the migrations once from a laptop: `DATABASE_URL=<neon url> npm run db:migrate`
   (creates the extensions, applies `db/migrations/0000_init.sql`, then the triggers in `db/sql/`).
   Do **not** run `db:seed` against production: the seed is prototype demo data.
2. **Environment variables** (Vercel → Settings → Environment Variables), production:
   - `BETTER_AUTH_SECRET` (random 32+ bytes), `BETTER_AUTH_URL` and `APP_URL` = the public URL
   - `CRON_SECRET` (random)
   - `PAYMENT_PROVIDER=stripe` + `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_CONNECT_WEBHOOK_SECRET`
     (until the provider account exists, keep `PAYMENT_PROVIDER=simulated` on a non-public preview only)
   - `EMAIL_TRANSPORT=postmark` + `POSTMARK_TOKEN`, `EMAIL_FROM="EventAT <no-reply@eventat.bg>"`
   - `STORAGE_DRIVER=s3` + `S3_ENDPOINT`, `S3_BUCKET`, `S3_PRIVATE_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_PUBLIC_URL`.
     Two R2 buckets: `S3_BUCKET` with public access (custom domain `media.eventat.bg` = `S3_PUBLIC_URL`) for listing
     photos, and `S3_PRIVATE_BUCKET` with **no** public access (no r2.dev URL, no custom domain) for evidence,
     inspiration photos, bank proofs and documents. A bucket's public URL serves every object in it.
   - `ALLOW_TIME_TRAVEL` must be **unset** in production. `ALLOW_INDEXING=true` only at public launch.
   - `SENTRY_DSN` (optional): the DSN of a Sentry project (Sentry → Project settings → Client Keys). When set,
     every server error is also sent to Sentry; unset (the default), nothing is sent anywhere. See "Errors" below.
3. **Stripe webhook**: endpoint `https://<domain>/api/webhooks/stripe`, API version `2026-09-30.endive`, events: `checkout.session.completed`,
   `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.created`,
   `refund.updated`, `charge.dispute.created` (secret → `STRIPE_WEBHOOK_SECRET`); and a second endpoint at the same
   URL for **connected accounts** with `payout.paid`, `payout.failed`, `payout.canceled`, `account.updated` (secret →
   `STRIPE_CONNECT_WEBHOOK_SECRET`). An event the platform has not stored yet answers 500, so Stripe retries it.
   Connect settings, test mode and test partners: `docs/STRIPE-TEST-MODE.md`. `STRIPE_API_BASE` is for tests only — never set it.
4. **Email DNS** at SuperHosting for `eventat.bg`: the SPF, DKIM and return-path records Postmark shows, plus
   `_dmarc TXT "v=DMARC1; p=none; rua=mailto:help@eventat.bg"` to start.
5. **Domain**: add the production domain in Vercel → Domains and the CNAME at SuperHosting.
6. **First admin**: sign up normally, then promote: `update "user" set role = 'admin' where email = '…';`
   and turn on two-factor in the admin settings.
7. **Uptime monitor**: point it at `https://<domain>/api/health` (GET or HEAD, every 1–5 min).
   It answers `200 {"ok":true,"db":"up","time":"…"}` when the app can query the database, and
   `503 {"ok":false,"db":"down",…}` otherwise (no host or error text in the body; never cached).

## Production guards

A production server refuses to start (`instrumentation.ts` → `lib/env-check.ts`; every request answers 500 and the
log names each problem, never a value) when:
- `BETTER_AUTH_SECRET` is missing, shorter than 32 characters, or the `.env.example` placeholder;
- `CRON_SECRET` is missing or `change-me`;
- `ALLOW_TIME_TRAVEL=true` while `APP_URL` is `eventat.bg` / `www.eventat.bg`;
- `PAYMENT_PROVIDER=stripe` without `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`;
- the app runs on Vercel with `STORAGE_DRIVER` other than `s3`.

Staging (a Vercel preview, or `ALLOW_TIME_TRAVEL=true` with a `*.vercel.app` `APP_URL`) starts anyway and logs the
same findings as one warning line.

## Errors

Every server error (page, server action, route handler, middleware) is logged as one JSON line in the Vercel runtime
logs: `{"level":"error","msg":"request error","route":"/akaunt/rezervacii/[nomer]","routeType":"render","digest":"…","message":"…","cause":"…"}`
(the route pattern, never the address, which may hold a one-time token; the stack only outside production). The
`digest` is the code Next.js shows instead of the message in the browser. With `SENTRY_DSN` set the error also goes
to Sentry (a plain HTTPS post, no SDK), without a failed query's bound values. Errors inside the browser are not sent.
Visitors see ‹Нещо се обърка. Опитайте отново.› with ‹Към началото› / ‹Към таблото›.

## Security headers

`next.config.ts` (`lib/security-headers.ts`) sends HSTS (2 years, subdomains), `nosniff`, `strict-origin-when-cross-origin`,
a Permissions-Policy, `X-Frame-Options: DENY` and a Content-Security-Policy on every route. The policy is fixed when
the app is **built**: it allows images from `media.eventat.bg` and the host of `S3_PUBLIC_URL`, and, when those sign-ins
are configured, Google / Facebook profile pictures and sign-in pages; changing these variables needs a redeploy.
HSTS with `includeSubDomains` binds every `*.eventat.bg` host to HTTPS for two years once a browser has seen it.
`python3 tools/csp-check.py --base <url>` visits the app as each role and fails on any violation; `tools/e2e-all.sh`
runs every suite under the same check.

## Demo / staging

A staging deployment runs the seed and the shifted clock, on its own database (never the production one):
1. Env vars on the staging environment: `ALLOW_TIME_TRAVEL=true`, `PAYMENT_PROVIDER=simulated`, `EMAIL_TRANSPORT=outbox`
   (demo data uses real-looking addresses — no mail may leave), plus the usual auth/cron secrets.
2. From a laptop, once and after each schema change:
   `STAGING_DB_HOST=<staging db hostname> DATABASE_URL=<staging url> npm run db:reset && npm run db:seed`
   The reset/seed scripts refuse every non-local host except the one named in `STAGING_DB_HOST`.
3. Keep staging password-protected (Vercel → Settings → Deployment Protection). An uptime monitor then needs
   Vercel's protection bypass for automation to reach `/api/health`.
