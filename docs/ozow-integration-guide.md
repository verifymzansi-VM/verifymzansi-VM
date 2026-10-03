# Ozow One API integration guide

Reviewed 2026-10-03 against current code and current official Ozow Hub pages.
Historical reviews remain historical evidence; this guide supersedes their
implementation instructions. Run `pnpm payments:audit` and read
[audit policy](audit-tools.md) before interpreting a payment result.

## Provider contract and configuration

The adapter in `src/lib/payments/ozow.ts` uses OAuth client credentials at
`POST /v1/token`, payment scope `payments`, and `POST /v1/payments` to obtain a
hosted redirect. Production uses `one.ozow.com`; staging uses
`stagingone.ozow.com`. `OZOW_ENV`, site code, client credentials and configured
base URL must identify the same environment. The adapter allowlists HTTPS hosts,
uses bounded requests, caches the declared token lifetime and retries one 401
with refreshed credentials. See
[Ozow's hosted flow](https://hub.ozow.com/integration-methods/apis/money-in/redirect-to-ozow/).

Keep three identifiers distinct: the application UUID/merchant reference, One
API payment-request ID, and transaction ID. The request ID stays in
`payments.provider_payment_id`; the transaction ID is stored separately in
`provider_data.transaction_id` under the same database transaction as
fulfillment. Server prices, plan/add-on eligibility and ownership determine the
quote. The client cannot choose an amount. Only confirmed fulfillment activates
purchased features and produces one invoice; restricted accounts retain
restricted entitlements. Check all paid plan and add-on route tests and truthful
pending, failed, cancelled and confirmed billing UI states.

## Notifications

One API events are JSON envelopes with `type`, `timestamp` and `data`. A
`transaction.complete` event can contain full data or a thin transaction
reference. The
[full schema](https://hub.ozow.com/api-reference/one-api/schemas/transaction-complete-full-data/)
uses string-valued `SiteCode`, `TransactionId`, `TransactionReference`,
`Amount`, `Status`, five optional strings, `CurrencyCode`, `IsTest`,
`StatusMessage` and `Hash`, plus optional banking/risk details. The stored
contract fixture includes these fields and keeps merchant and transaction IDs
distinct. The
[thin schema](https://hub.ozow.com/api-reference/one-api/schemas/webhook-event-data/)
provides `id`, `status` and an optional nullable reason. Tests use synthetic
values only; sensitive banking details must not appear in ordinary logs.

`/api/webhooks/ozow` verifies the raw body using Svix headers before parsing or
looking up payment records. Invalid signatures and timestamps fail. Full
notifications are validated against site, test/live state, reference, exact
cents and currency. Thin events trigger an authoritative transaction lookup;
lookup outages return retryable failures. The One API full payload's legacy hash
does not replace Svix verification. See
[One API migration and notification guidance](https://hub.ozow.com/integration-methods/apis/deprecated-integrations/migrating-to-one-api/).

## Cancellation and recovery

The application cancels the provider payment request using
`POST /v1/payments/{requestId}/cancel`; it does not send a transaction ID as the
request ID. Local cancellation and webhook confirmation race through guarded
state transitions. Already completed payments must not be downgraded by a late
failure. A successful late confirmation for cancelled/refunded state must not
silently restore entitlements. Duplicate transaction identifiers cannot fulfill
a second payment.

Payment-status reconciliation lists attempts with inclusive date filters and
bounded pagination. Provider links must remain on the approved origin under
`/v1/`. A persistent database claim limits repeated reconciliation across app
isolates. Missed notifications can be recovered from authoritative transaction
results; outages preserve retryable state. A lost RPC response after commit must
resolve as an idempotent retry, with no duplicate invoice or paid effect.

## Rollout order and verification boundary

Apply and verify the fulfillment migration first, then
`20261003010000_ozow_transaction_confirmation.sql` with its transaction-ID
index, `confirm_ozow_payment` and `claim_ozow_reconciliation`. Verify
service-role-only RPC grants and final RLS in an isolated PostgreSQL/PostgREST
stack before a separately authorized application rollout. Do not substitute
static regex matches or a subset of PGlite migrations for final deployed
database behavior.

The hosted checkout may offer methods enabled for this merchant/site; the app
uses the hosted response and does not establish that every method advertised by
Ozow is available to this account. Inspect merchant configuration read-only to
confirm the actual enabled methods. Card/PayShap/EFT availability must not be
claimed from local mocks.

Signing-secret correctness and genuine webhook delivery remain explicitly
unverified unless authenticated read-only access supplies evidence. A deployed
secret name is not proof of its value, origin or delivery. This audit does not
create webhook subscriptions, send real payments, submit customer documents,
apply production migrations or change provider configuration. Missing access,
Docker, authenticated browser coverage or genuine delivery is INCOMPLETE, not
release readiness. Preserve
[the historical repair rollout](ozow-payment-repair-rollout.md) as context and
record fresh evidence separately.
