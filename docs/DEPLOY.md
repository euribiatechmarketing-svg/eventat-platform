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
3. **Stripe webhook**: endpoint `https://<domain>/api/webhooks/stripe`, events: `checkout.session.completed`,
   `checkout.session.expired`, `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.created`,
   `refund.updated`, `charge.dispute.created` (secret → `STRIPE_WEBHOOK_SECRET`); and a second endpoint at the same
   URL for **connected accounts** with `payout.paid`, `payout.failed`, `account.updated` (secret →
   `STRIPE_CONNECT_WEBHOOK_SECRET`). An event the platform has not stored yet answers 500, so Stripe retries it.
4. **Email DNS** at SuperHosting for `eventat.bg`: the SPF, DKIM and return-path records Postmark shows, plus
   `_dmarc TXT "v=DMARC1; p=none; rua=mailto:help@eventat.bg"` to start.
5. **Domain**: add the production domain in Vercel → Domains and the CNAME at SuperHosting.
6. **First admin**: sign up normally, then promote: `update "user" set role = 'admin' where email = '…';`
   and turn on two-factor in the admin settings.

## Demo / staging

A staging deployment runs the seed and the shifted clock, on its own database (never the production one):
1. Env vars on the staging environment: `ALLOW_TIME_TRAVEL=true`, `PAYMENT_PROVIDER=simulated`, `EMAIL_TRANSPORT=outbox`
   (demo data uses real-looking addresses — no mail may leave), plus the usual auth/cron secrets.
2. From a laptop, once and after each schema change:
   `STAGING_DB_HOST=<staging db hostname> DATABASE_URL=<staging url> npm run db:reset && npm run db:seed`
   The reset/seed scripts refuse every non-local host except the one named in `STAGING_DB_HOST`.
3. Keep staging password-protected (Vercel → Settings → Deployment Protection).
