# Ozow integration review

Reviewed on 3 October 2026 (Africa/Johannesburg).

**Original review verdict, before repairs: FAIL.** Payment creation broadly
matched the contract, but two high-severity defects prevented the documented
payment confirmation flow from fulfilling purchases. The findings below record
that original state. Code repairs have since been implemented locally; see
[repair and rollout notes](C:/Users/SENZO/Documents/verifymzansi/docs/ozow-payment-repair-rollout.md)
for the changes and deployment requirements. Genuine provider delivery and the
signing-secret discrepancy remain unverified. This review does not certify the
deployed application build.

## Scope and evidence

Visited [Ozow's website](https://ozow.com/) and its official developer hub.
Compared authentication, payment creation, webhooks, transaction IDs,
cancellation and outcome verification with checkout routes, the payment library,
cleanup worker, tests and fulfillment SQL. The provider guide identifies One API
as the recommended integration; this repository uses that API rather than the
older Payments API.
[Official redirect guide](https://hub.ozow.com/integration-methods/apis/money-in/redirect-to-ozow/)

Read-only authenticated provider checks used the credentials already configured
on this workstation. No payment was created, charged, cancelled, refunded or
replayed. No webhook configuration, deployment, database rows or application
payment code was changed. Secrets and customer information are absent from the
evidence artifacts. The repository had unrelated uncommitted work before this
review.

Four isolated local tests reproduced the defects using synthetic payloads and a
synthetic signing secret. They assert the observed broken behavior, so their
passing result confirms the reproductions, not provider compliance.

## High: the configured full webhook cannot be parsed

Ozow's full notification has an envelope with `type` and a `data` object
containing PascalCase fields. Map `TransactionReference` to the merchant
reference, `TransactionId` to the transaction ID, and `Amount`, `Status`,
`CurrencyCode` to their payment fields. The parser at
[ozow.ts:610](C:/Users/SENZO/Documents/verifymzansi/src/lib/payments/ozow.ts:610)
accepts camelCase/snake_case alternatives but does not read those documented
fields.
[Official full payload schema](https://hub.ozow.com/api-reference/one-api/schemas/transaction-complete-full-data/)

**Observed:** a valid, locally signed full-format success notification returns
HTTP 400 with `Missing merchantReference` at
[route.ts:318](C:/Users/SENZO/Documents/verifymzansi/src/app/api/webhooks/ozow/route.ts:318),
before any database lookup or fulfillment. Reference, transaction ID, amount,
currency and status all normalize to null.

**Production configuration relevance:** the read-only subscription list returned
one `transaction.complete` subscription with `messageType: full`, targeting
`https://verifymzansi.com/api/webhooks/ozow`. The configured webhook ID matches
that listed subscription. Therefore this is the format the configured production
client requests. We did not capture an actual delivery or establish that the
live deployed source is identical to this checkout.

The default thin event only supplies a transaction ID, status and reason. Our
signed thin-format reproduction also returns `Missing merchantReference`; there
is no API detail lookup. Switching the subscription to thin would not fix this
handler.
[Official transaction event contract](https://hub.ozow.com/api-reference/one-api/webhooks/transaction-complete/)

**Recommended fix:** implement the documented full schema explicitly; preserve
signature, exact amount and currency validation. Validate the site code and
test/live flag appropriately. Either support thin events by fetching
authoritative transaction details or document and enforce the full-message
requirement. Add signed contract fixtures shaped from both official schemas.

## High: payment-request and transaction identifiers are conflated

The creation response's `id` is stored as `provider_payment_id` at
[checkout.ts:130](C:/Users/SENZO/Documents/verifymzansi/src/lib/payments/checkout.ts:130).
It identifies the payment request. The incoming normalization selects a
transaction reference/transaction ID/transaction object ID as that same field at
[ozow.ts:622](C:/Users/SENZO/Documents/verifymzansi/src/lib/payments/ozow.ts:622).
The route then insists on equality at
[route.ts:408](C:/Users/SENZO/Documents/verifymzansi/src/app/api/webhooks/ozow/route.ts:408).
The fulfillment RPC independently repeats the equality check at
[atomic_payment_fulfillment.sql:43](C:/Users/SENZO/Documents/verifymzansi/supabase/migrations/20260909090000_atomic_payment_fulfillment.sql:43).

These are distinct resource identifiers: transactions belong to a payment
request, and the API exposes them through `/payments/{id}/transactions`. A
transaction's own `id` identifies the transaction.
[Payment creation reference](https://hub.ozow.com/api-reference/one-api/post-payments/),
[transaction schema](https://hub.ozow.com/api-reference/one-api/schemas/transaction/),
[transactions for a payment](https://hub.ozow.com/api-reference/one-api/get-payments-id-transactions/)

**Observed:** a signed synthetic event carrying API-shaped transaction details,
with a transaction ID different from the saved payment-request ID, returns HTTP
400 `Payment ID mismatch`. This isolates the second defect: correcting the full
payload mapping alone would still leave the ID model wrong.

**Recommended fix:** keep payment-request ID, transaction ID and merchant
reference separate. Verify their relationship, including the transaction's
membership in the stored payment request when querying the provider. Adjust the
route and atomic RPC together, and preserve uniqueness/idempotency checks on the
correct identifier. Plan compatibility for existing records; simply removing the
mismatch check would discard a useful integrity control.

## Medium: cancellation only changes local state

[cancel-pending/route.ts:74](C:/Users/SENZO/Documents/verifymzansi/src/app/api/billing/cancel-pending/route.ts:74)
updates a pending payment to `failed` with `failure_reason: user_cancelled`. It
never cancels the Ozow payment request. Ozow documents
`POST /payments/{id}/cancel` for that operation.
[Official cancellation endpoint](https://hub.ozow.com/api-reference/one-api/post-payments-id-cancel/)

**Consequence:** our in-flight checkout guard is released while an existing
provider payment link can remain usable. A user can start a replacement checkout
and still complete the previous one. After the webhook defects are fixed, the
SQL's intentional recovery of failed payments permits a late successful purchase
to fulfill.

**Recommended fix:** cancel the matching provider request and handle races with
an already completed transaction before presenting the payment as cancelled and
allowing a replacement. Keep cancellation of a prepaid plan separate from
cancellation of an outstanding payment request. No provider cancellation was
attempted during this review.

## Medium: there is no provider reconciliation fallback

[payment-status/route.ts:59](C:/Users/SENZO/Documents/verifymzansi/src/app/api/billing/payment-status/route.ts:59)
reads our database only; after 30 minutes it presents an unsettled local record
as expired.
[payment-cleanup.ts:230](C:/Users/SENZO/Documents/verifymzansi/workers/payment-cleanup.ts:230)
expires pending records without checking Ozow's transactions. A repository
search found no runtime payment/transaction status retrieval from Ozow.

**Consequence:** missed or permanently rejected notifications cannot be
independently recovered by these paths. A paid customer can see expired/pending
until a valid notification arrives or an operator intervenes. The SQL does allow
later success to recover an expired record; expiration does not permanently
prohibit fulfillment.

Webhook-only confirmation is a supported integration choice, so the absence of
polling is a reliability gap rather than a universal API-contract violation.
Ozow also supports checking transactions through the API.
[Official quick start](https://hub.ozow.com/getting-started/quick-start/)

**Recommended fix:** add a bounded server-side reconciliation job using the
stored payment-request ID. Confirm transaction status, merchant reference, site,
currency and exact amount, then use the existing atomic fulfillment mechanism.
Do not infer payment outcome solely from elapsed time or a browser redirect.

## Low: the OAuth expiry contract is read incorrectly

[ozow.ts:357](C:/Users/SENZO/Documents/verifymzansi/src/lib/payments/ozow.ts:357)
only accepts a numeric `expires_in`. Ozow documents that response property as a
string. The authenticated production token response observed in this review was
a string representing 14,400 seconds. The application therefore substitutes its
3,600-second default.
[Official token response](https://hub.ozow.com/api-reference/one-api/post-token/)

**Current effect:** tokens are refreshed earlier than necessary. If Ozow
supplies a lifetime below the hard-coded fallback, an expired token can be
reused; the synthetic 120-second reproduction demonstrated this. The existing
one-time authentication retry reduces the impact.

**Recommended fix:** parse and validate both documented string and numeric
representations, honor the returned lifetime with a small safety margin, and
test short lifetimes using a fake clock.

## What follows the guide

- OAuth uses server-side client credentials, form encoding and the `payments`
  scope; authenticated production token requests succeeded.
- API hosts match Ozow's production/staging hosts. Hosted requests supply site
  code, ZA region, ZAR amount in rand, merchant reference, beneficiary
  reference, expiry and return URL. The generated UUID-derived references fit
  the documented limits.
  [Request Payment](https://hub.ozow.com/api-reference/one-api/post-payments/)
- The browser uses Ozow's returned redirect URL. A return to the billing page
  reads persisted payment state rather than granting access by trusting URL
  parameters.
- Webhook verification uses the raw request body and all three Svix headers
  before JSON parsing. Missing secrets fail closed. The Svix library supplies
  signature and timestamp validation.
  [Signature guide](https://hub.ozow.com/integration-methods/apis/money-in/verify-a-webhook/)
- Successful fulfillment requires the expected amount and ZAR currency.
  Authentication, origin checks, server-side pricing and owned-resource checks
  protect checkout.
- Fulfillment is designed to lock the payment and commit invoice, benefit and
  completion changes atomically. Unique constraints and duplicate outcomes
  prevent repeated benefit creation. These are appropriate controls once the
  incoming provider contract and IDs are corrected.
  [Ozow security guide](https://hub.ozow.com/getting-started/building-a-secure-integration/)
- Plans are prepaid purchases with explicit no-automatic-renewal wording. A
  provider recurring-subscription integration is not required for that business
  model.
- The absence of `notifyUrl` is acceptable because an independently configured
  Svix webhook is used. A separate `cancelUrl` is not a documented One API
  payment-request field; the provider uses `returnUrl` for the result.
  [Redirect guide](https://hub.ozow.com/integration-methods/apis/money-in/redirect-to-ozow/)

## Read-only provider and database observations

- Workstation configuration selects production and has the required Ozow
  credential/site/secret variables. The explicit mock switch is disabled.
- Token requests for `payments` and `webhooks` returned HTTP 200; listing
  subscriptions returned HTTP 200.
- One full transaction completion subscription points to the expected HTTPS
  endpoint; the configured subscription ID matches.
- Retrieving its signing secret returned HTTP 404 with `NotFound`. This does
  **not** establish that the stored secret is wrong. Its correspondence to the
  live subscription remains unverified and needs investigation through Ozow's
  dashboard/support or a genuine staging delivery.
  [Get Webhook Secret](https://hub.ozow.com/api-reference/one-api/get-webhooks-id-secret/)
- The correctly parameterized payment-method lookup returned HTTP 200 and listed
  Bank API and Pay By Bank as available. Card was absent from this response;
  card acceptance cannot be promised from the evidence collected. Merchant-side
  enablement must be confirmed if it is wanted.
  [Payment-method lookup](https://hub.ozow.com/api-reference/one-api/get-paymentmethods/)
- Authenticated read-only database OpenAPI metadata exposes
  `/rpc/fulfill_ozow_payment`. This confirms existence in the database
  configured on this workstation, but not browser-role denial, concurrent
  behavior or matching deployment. The older rollout document's statement that
  it was prepared locally should not be treated as fresh deployment evidence.

## Validation

- Existing focused payment tests: **101 passed**, across Ozow, checkout,
  fulfillment, webhook and pending-payment cancellation suites.
- Official-contract defect reproductions: **4 reproduced**. Their positive
  assertions confirm the observed failures described above.
- Isolated PGlite payment-fulfillment checks: **29 passed**; see
  `tmp/ozow-guide-review/payment-db-tests.log` for the result. These execute
  local SQL, not production transactions.
- Repository safety gate: **PASS**, all 13 steps completed in approximately 15
  minutes, including **4,749 passing tests across 518 files**, the local
  database suites, lint, typecheck, preflight, secret scan, dependency security
  audit, license policy and migration invariants. No steps failed or were
  skipped. The full Vitest run took just over ten minutes and finished normally;
  it was not stopped.

Gate evidence:
[Markdown result](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review.md),
[JSON result](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review.json),
[blocker summary](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review-blockers.txt).
The detailed execution log is `tmp/ozow-guide-review/safety-review.log`.

The repository gate PASS and provider-integration FAIL measure different things.
The generic gate does not validate the official provider contract against
real-shaped webhook fixtures. No failed repository command requires repair in
this review; the first actionable integration repair is the full payload mapping
and identifier separation described above.

The existing test named "normalizes full transaction webhooks" supplies a
camelCase object with a nested amount at
[ozow.test.ts:335](C:/Users/SENZO/Documents/verifymzansi/src/lib/payments/ozow.test.ts:335),
rather than the official full webhook. Green tests therefore do not establish
provider-contract compatibility. Add contract fixtures and the provider's
success, failure, cancellation, pending and duplicate-delivery scenarios.
[Ozow test cases](https://hub.ozow.com/integration-methods/testing/payin-test-cases-one-api/)

Evidence files are under `tmp/ozow-guide-review/`: `provider-config.json`,
`database-schema.json`, `reproductions.json`, `provider-contract.test.ts`,
`vitest.config.ts`, `existing-payment-tests.json`, and the read-only inspection
scripts. They contain synthetic examples and sanitized summaries, not secrets.

## Recommended repair and acceptance order

1. Correct the documented full-webhook mapping and separate the three
   identifiers across checkout, notification processing and the RPC. Require
   passing contract tests with different request/transaction IDs before release.
2. Resolve the secret-lookup discrepancy and verify actual signed delivery in an
   isolated staging flow. Confirm the production Worker uses the intended
   environment, site, credentials and signing secret.
3. Complete a staging hosted payment end to end: provider success, exactly one
   invoice, the purchased plan/add-on activated, persisted complete status and
   truthful billing UI. Repeat failed, pending, cancelled and duplicate
   notification cases.
4. Add provider cancellation and reconciliation; test concurrent
   cancellation/completion and missed notification recovery.
5. Fix expiry parsing and strengthen the existing fixtures. Re-run the
   appropriate repository gates and coordinate any identifier migration with
   deployment.

No real payment round trip, deployment, refund operation, notification replay,
customer-row reconciliation or production concurrency test was performed. The
unresolved high-severity defects block an integration PASS regardless of generic
test results.

## Follow-up: current products and package recommendation

**Recommendation: keep Ozow and the current One API hosted checkout; expand the
enabled payment methods after repairing confirmation.** There is no technical
need to replace this integration to accept cards. Our payment request at
[ozow.ts:460](C:/Users/SENZO/Documents/verifymzansi/src/lib/payments/ozow.ts:460)
does not restrict the institution or payment method. Ozow enables additional
methods on the merchant account and exposes them through the hosted page.
[Payment-method guide](https://hub.ozow.com/payment-methods/)

### What is available for our configured site

A fresh authenticated production lookup on 3 October 2026 at 00:26 SAST returned
HTTP 200, with a complete one-page result for region ZA:

- **Bank API:** Payshap, available.
- **Pay By Bank:** Absa, Bidvest Bank Grow, FNB, Investec, Nedbank and Standard
  Bank, all available.
- **Absent from this response:** Card, Apple Pay, Google Pay, Capitec Pay,
  dedicated Absa Pay/Nedbank Direct EFT/FNB Payment Requests, vouchers, BNPL and
  crypto. The Absa/Nedbank/FNB bank-list entries do not establish activation of
  their separate direct API products.

No institution-specific conditions were returned. This is availability evidence
for the site selected by workstation credentials; it does not establish that the
deployed application uses identical credentials, nor does it test actual
checkout rendering or completed payments. It cannot reveal our
Standard/Enterprise contract, negotiated fees, monthly processing volume,
payout/refund approvals or settlement terms. Sanitized evidence:
[current-offerings.json](C:/Users/SENZO/Documents/verifymzansi/tmp/ozow-guide-review/current-offerings.json).
[Lookup contract](https://hub.ozow.com/api-reference/one-api/get-paymentmethods/)

### What to enable next

1. **Visa/Mastercard, followed by Apple Pay and Google Pay.** Request enablement
   through our Ozow account manager. Card is not self-service; Ozow must confirm
   the business category is supported. Each wallet needs separate activation
   after Card. They can use our existing hosted checkout. Before release, verify
   successful payments, failure/cancellation and duplicate notifications through
   fulfillment; retain purchase and delivery records for card disputes.
   [Card guide, updated 27 September 2026](https://hub.ozow.com/payment-methods/money-in/card/)
2. **Capitec Pay.** Request availability for our site. Review direct Absa Pay,
   Nedbank Direct EFT and FNB Payment Requests if customer demand justifies
   them. The individual bank API products are separately enabled by Ozow.
   [Bank API guide](https://hub.ozow.com/payment-methods/money-in/pay-by-bank/)
3. **Keep Pay By Bank and PayShap.** They are already returned as available;
   verify their actual hosted checkout experience during acceptance testing.

For the platform's prepaid listing plans, BNPL, crypto, vouchers and payouts are
lower priorities. This is a product-fit recommendation, not a claim that Ozow
does not offer them. Its catalogue also includes refunds and recurring payments.
Recurring is currently a limited approved rollout using Capitec Pay VRP; our
fixed-term prepaid purchases do not require it.
[Recurring guide](https://hub.ozow.com/payment-methods/recurring-payments/)

### Which commercial package fits

Standard has no minimum processing amount. Enterprise requires R1.5 million or
more processed per month and offers tailored rates and priority support. Both
advertise access to major payment methods. **Cards alone are not a reason to
move to Enterprise.** Below that volume, Standard is the practical default; at
or above it, request an Enterprise quote and compare the signed terms. Our
current package and actual rates remain unverified.
[Published pricing](https://ozow.com/pricing)

Public entry rates are 1.5% for Pay By Bank/PayShap and 2.85% for local cards,
each with a R1 minimum. For the repository's default R50, R140 and R250 retail
prices, illustrative bank fees are R1.00, R2.10 and R3.75; card fees are R1.43,
R3.99 and R7.13. These calculations apply the published minimum, rounded to
cents, and exclude tax, extra fees and negotiated terms. Database plans may
override the repository defaults.
[Default prices](C:/Users/SENZO/Documents/verifymzansi/src/lib/constants/pricing.ts:69),
[Published fees](https://ozow.com/pricing)

Before signing enablement terms, obtain the existing package/rate schedule, card
and wallet rates, any monthly fees, chargeback costs and reserves, supported
business classification, and settlement schedule in writing. Public marketing
mentions next-day settlements, but the Hub explicitly says settlement timing
varies by payment method and our onboarding arrangement governs it. Do not
assume bank and card funds arrive on the same cycle.
[Settlement guide](https://hub.ozow.com/payment-methods/settlements-and-float/settlements/)

No merchant settings or commercial package were changed, no account manager was
contacted, and no payment was created during this follow-up. The webhook mapping
and identifier defects above should be fixed before promoting additional payment
methods.
