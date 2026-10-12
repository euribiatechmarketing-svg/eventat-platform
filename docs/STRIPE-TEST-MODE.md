# Running EventAT on Stripe test mode

What a person has to do to run the platform against a real Stripe account in test mode (no real money).
The automated checks need none of this: see the last section.

EventAT uses **Stripe Connect** with destination charges `on_behalf_of` the partner (the partner is the merchant of
record), EventAT's commission as the application fee, and **manual payouts** from each partner's connected account
on the 1st/15th (`lib/payments/stripe.ts`). The SDK (`stripe@23.0.0`) speaks API version **`2026-09-30.endive`**.

## 1. Account

1. Sign up at dashboard.stripe.com as the operating company (ЧЕРИ ЕСТЕЙТ ЕООД), country **Bulgaria**. Test mode needs
   no activation documents.
2. Use one Stripe **sandbox** (or test-mode account) per environment — staging, each developer. Every webhook endpoint
   of an account receives every event of that account, and an event about a payment another environment stored is
   answered 500 and retried for three days.

## 2. Connect settings (test mode)

1. Connect → Get started → **Platform or marketplace**.
2. Complete the platform profile and Branding (name EventAT, icon, colour): Stripe's hosted onboarding shows them.
3. Connected accounts: **Express** (Express Dashboard; the platform pays Stripe's fees and is responsible for losses),
   country **BG**. The platform sets this per account when it creates one (`controller` in `createPartnerAccount`).
4. Payouts: **manual**, controlled by the platform. Each account is created with `settings.payouts.schedule.interval =
   manual`; where the Dashboard's Connect settings offer a default payout schedule for connected accounts, set it to
   manual as well.
5. Capabilities requested per account: `card_payments`, `transfers`.

## 3. Webhook endpoints

Both at `https://<domain>/api/webhooks/stripe`, **API version `2026-09-30.endive`** (the SDK's; set it when creating
the endpoint).

1. **Your account** (platform) — events `checkout.session.completed`, `checkout.session.expired`,
   `payment_intent.succeeded`, `payment_intent.payment_failed`, `refund.created`, `refund.updated`,
   `charge.dispute.created`. Its signing secret → `STRIPE_WEBHOOK_SECRET`.
2. **Connected accounts** — events `account.updated`, `payout.paid`, `payout.failed`, `payout.canceled`. Its signing
   secret → `STRIPE_CONNECT_WEBHOOK_SECRET`.
3. On a laptop instead: the Stripe CLI (`stripe login`, then `stripe listen --forward-to localhost:3601/api/webhooks/stripe`)
   forwards the platform's and the connected accounts' events to that URL with one signing secret: put it in
   `STRIPE_WEBHOOK_SECRET`. Its events come in the account's default API version — keep that at `2026-09-30.endive`.

A request not signed with either secret is answered 400; an event the platform cannot apply yet is answered 500 and
Stripe delivers it again.

## 4. Environment variables

```
PAYMENT_PROVIDER=stripe
STRIPE_SECRET_KEY=sk_test_…          # Developers → API keys (test mode)
STRIPE_PUBLISHABLE_KEY=pk_test_…
STRIPE_WEBHOOK_SECRET=whsec_…        # platform endpoint (3.1)
STRIPE_CONNECT_WEBHOOK_SECRET=whsec_… # Connect endpoint (3.2)
APP_URL=https://<domain>             # checkout success/cancel and onboarding return links
```

- **Never set `STRIPE_API_BASE`** outside the tests: it sends the API calls to another server (stripe-mock). The
  platform refuses it with a live key or on a Vercel production deployment.
- Settings: **the demo seed stores `payment.provider = simulated`** (and no hold limit), whatever `PAYMENT_PROVIDER`
  says, and Админ → Настройки has no switch for it. On a seeded database:
  `update platform_settings set value = '"stripe"' where key = 'payment.provider';`
  `update platform_settings set value = '90' where key = 'payment.provider_max_hold_days';`
  Bank transfer is not offered with Stripe yet (D6).

## 5. Onboard a test partner

1. Register a new partner and complete the wizard; ‹Подай за одобрение› creates the partner's Express account at Stripe.
   (The seeded demo partners are on the simulated provider.)
2. Партньор → Сметка за изплащане (`/partner/smetka`) → ‹Потвърди данните при доставчика› opens Stripe's hosted
   onboarding. Stripe's Connect test data (docs.stripe.com/connect/testing): SMS code `000-000`, date of birth
   `1901-01-01` (identity verified), address line `address_full_match` (with a real city and postal code), ID number
   `000000000`, IBAN `BG80BNBG96611020345678` (payouts succeed) — or `BG89370400440532013002` to see a payout fail
   (`account_closed` → `payout.failed`).
3. `account.updated` arrives on the Connect endpoint; the partner is enabled when Stripe reports charges and payouts
   enabled.
4. EventAT's own checks still apply: the team approves the profile, and the partner's payout account (IBAN + bank
   document) must be confirmed in Админ → Плащания, or the payout is held (`account_check`).

## 6. Test cards (Stripe Checkout)

Any future expiry date, any CVC, any postal code.

| Card | Result |
|---|---|
| `4000 0000 0000 0077` | Paid, and the money is **available at once** — use it when a payout follows (otherwise the funds stay pending for days and the payout fails for lack of an available balance) |
| `4242 4242 4242 4242` | Paid (funds pending as usual) |
| `4000 0000 0000 0002` | Declined; the same checkout takes another card |
| `4000 0000 0000 9995` | Declined, insufficient funds |
| `4000 0027 6000 3184` | Asks for 3-D Secure every time (an off-session balance charge with it fails) |
| `4000 0000 0000 0259` | Paid, then disputed as fraudulent → `charge.dispute.created`, the booking's payout is frozen |

## 7. A full run

1. Client: request → partner approves → ‹Плати …› → Stripe Checkout with a test card → `checkout.session.completed` →
   booking confirmed.
2. Move the clock past the event (Админ → Настройки, with `ALLOW_TIME_TRAVEL=true`) and run `npm run tick`: the booking
   completes and the batch is prepared.
3. Админ → Плащания → ‹Пусни партидата›; `npm run tick` sends the payout from the partner's connected account.
4. In test mode Stripe reports `payout.paid` on the Connect endpoint; the batch shows paid.
5. Cancellations refund through Stripe (`refund.updated`); Developers → Events shows every event and its delivery.

## Automated checks (no Stripe account)

- `tests/payments/stripe.webhooks.test.ts` — every webhook event, signed with both secrets, through the route.
- `tests/payments/stripe.provider.test.ts`, `stripe.lifecycle.test.ts` — every provider call against **stripe-mock**,
  Stripe's mock server, which rejects parameters the API version does not know. Start it with `tools/stripe-mock.sh`
  (downloads the pinned release into `.tools/`, verifies its checksum, listens on `127.0.0.1:12111`), then `npm test`.
  Without it these tests are skipped. Another port: `tools/stripe-mock.sh 12611` and `STRIPE_MOCK_URL=http://127.0.0.1:12611`.
- Bump `VERSION` in `tools/stripe-mock.sh` with the `stripe` package: the test "stripe-mock speaks the API version the
  SDK pins" fails when they drift apart.
