# Ozow One API payment repairs

Prepared on 3 October 2026. These changes are local; they have not been applied
to a remote database or deployed. The existing merchant payment methods and
commercial package are unchanged.

## Provider contracts

- Full `transaction.complete` payloads use `TransactionReference` as our
  merchant reference and `TransactionId` as the transaction ID. `SiteCode`,
  `Amount`, `CurrencyCode`, `Status` and `IsTest` are mapped explicitly. The
  original raw body is authenticated with Svix before parsing. A test-mode
  mismatch, wrong site, wrong currency or non-exact amount cannot fulfill a
  purchase.
  [Full schema](https://hub.ozow.com/api-reference/one-api/schemas/transaction-complete-full-data/),
  [Signature guide](https://hub.ozow.com/integration-methods/apis/money-in/verify-a-webhook/)
- Thin notifications are resolved with authenticated
  `GET /v1/transactions/{id}`. Failed lookups return a retryable webhook
  response; neither the browser redirect nor the thin status alone grants
  access.
  [Transaction lookup](https://hub.ozow.com/api-reference/one-api/get-transactions-id/)
- `payments.provider_payment_id` continues to store the **payment-request ID**
  returned by checkout. The confirmed transaction ID is stored separately at
  `provider_data.transaction_id` and has a unique database index across Ozow
  payments. The merchant reference remains `provider_reference`.
- `confirm_ozow_payment` locks the payment, validates the stored request ID and
  merchant reference, calls the existing atomic fulfillment RPC and records the
  transaction ID in one transaction. A transaction collision rolls back
  benefits, invoices and payment completion. Duplicate confirmations cannot
  grant access twice. Notifications, reconciliation and the signed mock
  notification use the new confirmation RPC; the existing fulfillment RPC
  remains available for compatibility tests.
- Cancellation invokes `POST /v1/payments/{requestId}/cancel`, then checks
  transactions before releasing the local pending guard. Provider outages,
  in-progress transactions, a concurrent payment success and a zero-row local
  update do not report successful cancellation.
  [Cancellation contract](https://hub.ozow.com/api-reference/one-api/post-payments-id-cancel/)
- Reconciliation uses `GET /v1/payments/{requestId}/transactions` with required
  inclusive date filters, safe provider pagination and a bounded page limit.
  Each result must match reference, site, request, currency and amount. Only
  `Successful` can fulfill. A missing payment can return an empty list with HTTP
  200, so expiry additionally requires a matching `GET /v1/payments/{requestId}`
  response with `Expired`. `Pending` and `Incomplete` attempts retain the
  checkout guard.
  [Transaction list](https://hub.ozow.com/api-reference/one-api/get-payments-id-transactions/),
  [Request status](https://hub.ozow.com/api-reference/one-api/get-payments-id/),
  [Status guide](https://hub.ozow.com/integration-methods/statuses/)
- OAuth accepts the documented string lifetime and numeric lifetimes. Invalid
  lifetimes are not cached; short lifetimes are honored and existing
  early-refresh behavior is retained. Checkout response parsing no longer
  accepts a transaction ID as a payment-request ID.
  [Token contract](https://hub.ozow.com/api-reference/one-api/post-token/)

## Recovery and UI behavior

Authenticated payment status reads verify ownership before using the admin
client to reconcile. A database claim throttles each payment to one provider
lookup per minute across app isolates and cron. A provider failure preserves the
stored status.

The existing cleanup worker calls `/api/internal/payments/reconcile`. That
endpoint authenticates the worker with the main app's `RATE_LIMITER_API_KEY`,
which must match the companion worker's `WORKER_API_KEY`. It rotates through ten
unsettled payments created within the last seven days per invocation, including
failed and expired rows. The existing worker cron runs every ten minutes. Older
rows can still be reconciled through an authenticated status read; unmarked
legacy `processing` rows require operator investigation rather than benefit
replay.

The worker's `APP_URL` must point to the matching app/environment. The
production configuration is `https://verifymzansi.com`; override it when testing
a separate staging worker. The standalone worker never expires a provider-backed
payment by elapsed time. It preserves its existing fallback cleanup for rows
without a stored provider request.

Recovered successful purchases use atomic fulfillment, the existing payment
audit and receipt mechanism. Only the caller that completes or recovers the
payment queues the receipt; duplicate results do not. Receipt delivery remains
best effort, as in the webhook flow.

The billing result page checks failed/expired payments once for late
confirmation as well as polling pending purchases. After thirty minutes, polling
pauses with a pending message instead of inventing provider expiry.

Explicit mock mode skips provider reconciliation and cancellation calls. Its
signed notification carries the stored merchant reference, request ID and
configured site with a separate simulated transaction ID. The Playwright fixture
recognizes the confirmation RPC and checks transaction identity and reuse; it
remains a UI simulation rather than proof of database atomicity.

## Deployment order

1. Validate the migration against the intended nonproduction database with the
   existing commercial migration history present. Apply
   `supabase/migrations/20261003010000_ozow_transaction_confirmation.sql` before
   deploying the new app. Verify the transaction index, both RPC signatures and
   service-role-only execution through PostgREST. The wrapper deliberately
   leaves the existing fulfillment implementation intact.
2. Deploy the app with the correct Ozow environment, site, OAuth credentials and
   Svix secret. Missing RPCs fail closed. Confirm that `RATE_LIMITER_API_KEY`
   matches the cleanup worker's shared key.
3. Deploy the cleanup worker with the matching `APP_URL`. Confirm an
   authenticated reconciliation run reaches the app, rotates the batch and
   recovers a missed completion.
4. Complete the provider's staging test cases before accepting production
   traffic. Verify the hosted return, correct plan/add-on, one invoice,
   persisted completion and receipt. Exercise full and thin delivery, failure,
   pending, cancellation, duplicate delivery, wrong site/test
   flag/currency/amount, distinct request/transaction IDs, simultaneous
   confirmation/reconciliation and a lost RPC response.
   [Ozow staging test cases](https://hub.ozow.com/integration-methods/testing/payin-test-cases-one-api/)

The prior authenticated production secret lookup returned HTTP 404 even though
the configured subscription was listed. The implementation uses the currently
documented secret endpoint; this discrepancy cannot be corrected by guessing a
replacement secret. Confirm the subscription's signing secret through Ozow's
dashboard or a genuine staging delivery, and verify the deployed worker
configuration. No signing secret was rotated, webhook replay requested, real
payment created, production row reconciled or deployment performed here.

## Local validation

The focused suite covers real-shaped signed payloads, token expiry, safe
pagination, identity and amount rejection, cancellation races, provider outages,
persistent throttling and truthful payment UI. The PGlite suite executes the
migration and tests separate IDs, duplicate/colliding transactions, atomic
rollback and browser-role denial. The commercial suite exercises confirmation
with the current slot/invoice implementation.

The final repository test run passed 4,800 tests across 521 files, plus all 53
commercial database checks and 33 isolated payment database checks.

The final consolidated safety run recorded **FAIL**, with 12 of 13 steps
passing. Its sole failure was `pnpm typecheck`: the running development server
was generating a malformed `.next/dev/types/routes.d.ts` at that point. Next.js
subsequently regenerated that file, and the unchanged source passed
`pnpm typecheck` on recheck (`tmp/ozow-guide-review/fix-typecheck-recovery.log`,
exit 0). The original consolidated artifacts are preserved without altering
their verdict. Lint, dead-code/import/API/duplication checks, blocking tests,
preflight, secret scan, dependency audit, licensing and DB invariants all passed
in that run. The earlier dead-code failure was corrected and passed in the final
run.

Safety gate artifacts are under `tmp/safety-gate/`; execution evidence is under
`tmp/ozow-guide-review/fix-*`. Local tests establish code and SQL behavior; they
do not establish genuine provider delivery, deployed PostgREST grants or
multi-session production behavior.

The targeted Chromium checkout round-trip could not start because an existing
Next.js development server holds this checkout's development lock. That server
was preserved. The signed mock payload and Playwright confirmation fixture
passed their unit regression checks, but browser checkout remains to be verified
in an available test environment.
