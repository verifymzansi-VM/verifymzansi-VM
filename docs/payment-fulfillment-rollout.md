# Atomic payment fulfillment rollout

Status: prepared locally; not applied to any remote database or deployed.

## Contract and compatibility

`20260909090000_atomic_payment_fulfillment.sql` adds a service-role-only,
security-invoker `fulfill_ozow_payment` RPC. It changes no table shape and
backfills no payment records. It requires the existing provider-neutral payment
fields, `processing`/`expired` statuses, `pending_verification` entitlement
status, `member` audit role, and unique indexes on
`entitlements(user_id, area, type)` and `invoices(payment_id)` from earlier
migrations. The normal migration history must already be present. Owner columns
may be `owner_id` or the legacy `seller_id`; missing tables/columns fail the
transaction.

The application verifies the signed provider event, amount, currency and
canonical catalog. The RPC locks and rereads the payment, checks the provider
transaction ID, amount and metadata, and rechecks the plan and target ownership.
Entitlement/add-on writes, invoice creation and payment completion commit in one
transaction. A failed transaction rolls back all its writes. A callback whose
response was lost can retry; the locked completed payment returns `duplicate`
without writing benefits again.

New successful callbacks move eligible pending/failed/expired payments directly
to complete within the transaction. They never leave a durable processing claim.
Refunds are not resurrected. Delayed older subscription payments cannot replace
an entitlement with a later start date; add-ons cannot shorten an already later
end date. Subscription and add-on durations remain anchored to payment creation,
as in the existing behavior. Receipts now use that same subscription date. No
renewal-extension policy is introduced.

The RPC has no generic SQL/table input and no security-definer elevation.
PUBLIC, anonymous and authenticated roles have no execute permission.
Service-role credentials must remain server-only. A missing RPC fails closed
with a retryable response; there is no fallback to the old separate writes.

## Validation before release

Local checks: `pnpm test:payments:db` executes the actual migration in an
in-memory PGlite database built from core schema definitions plus later
compatibility fields. It tests role denial, rollback on invoice/audit failure,
duplicate responses, stable dates/VAT, plan-change reactivation, restricted
accounts, cross-owner access for all ten add-ons, older purchases,
invoice-number collision and legacy recovery. It is part of the blocking test
command and has a dedicated blocking CI step.

This is not a full migration replay or a multi-session PostgREST test. Browser
checkout uses an explicitly simulated subscription RPC; it does not certify
database integration. Complete these checks against a disposable, deliberately
selected nonproduction stack:

1. Replay the actual migration history and verify the function signature,
   grants, indexes, target columns, enums and service-role table privileges.
   Confirm the PostgREST schema cache exposes the RPC and browser-role calls are
   denied.
2. With separate connections, hold the payment lock while a second identical
   callback and cleanup run. After release, exactly one callback applies
   effects; the other reports duplicate and cleanup changes no completed record.
   Repeat with the first transaction rolled back and with a failure callback
   waiting for the lock.
3. Terminate a request after sending the RPC but before receiving its response,
   then redeliver the callback. Assert one invoice, correct entitlement/add-on
   and complete payment regardless of whether the first transaction committed.
4. Inject an invoice constraint error and an add-on/audit error. Verify payment
   state, benefits and invoice all roll back; restore the dependency and retry
   successfully.
5. Test a newer plan completing before an older checkout, cross-account targets,
   provider ID substitution, invalid amounts and restricted accounts. Verify
   both database results and billing/entitlement state in the UI.
6. Complete a sandbox provider checkout/callback, then build the actual
   Cloudflare artifact and validate the webhook/worker in staging. Record
   timeouts and retry delivery behavior. No production payments or live load
   testing are required.

## Ordered deployment

An operator must coordinate this release; the app must not overlap with old
handlers that write benefits outside the transaction. Automatic deployment must
be held until these steps and staging checks are complete.

1. Pause checkout and webhook delivery using the deployment/provider controls,
   keeping callbacks queued for redelivery. Pause payment-cleanup scheduling.
   Drain all old checkout requests, webhook invocations and any other payment
   reconciliation jobs. Take a restorable database backup and record the current
   application/worker versions.
2. Inventory processing records without exposing provider payloads or personal
   data in general logs. Reconcile their provider outcome, invoices and benefits
   while delivery is paused. A timestamp alone never proves fulfillment failed.
3. Apply the additive migration through the normal reviewed migration process
   and verify its grants/signature/cache. Deploy the matching application and
   cleanup worker while delivery remains paused; smoke-test with isolated
   staging data.
4. Resume queued webhook delivery, then checkout and cleanup. Monitor retryable
   500s, reconciliation alerts, duplicate provider IDs and payment/benefit
   discrepancies.

No rollout controls, migrations or external actions were executed during this
review.

## Legacy reconciliation and recovery

Legacy `processing` with `fulfillment_completed_at` may finalize without
replaying effects. Legacy processing without that marker returns a retryable
error and cleanup logs
`Legacy payment requires reconciliation; status preserved`. Cleanup records a
batch reconciliation count but does not change those payment rows. The existing
in-flight checkout uniqueness guard therefore remains in force for affected
users.

Operators must examine the provider result, matching invoice and exact benefit
state under a maintenance window. If all effects are verified complete, record
that evidence and set the completion marker through a reviewed, audited
reconciliation; normal callback recovery can then finalize. If no effects
committed, only reset the row to a retryable state after all old handlers are
drained. For partial effects, reconcile them against newer purchases and
cancellations before choosing a repair. Do not blindly clear processing, set a
timeout failure, delete invoices or replay old writes. This change does not
automate repair of historical inconsistencies.

If the new code must be rolled back, first pause delivery/checkout/cleanup and
drain new handlers. Keep the additive function installed: its presence is
harmless to the old version. Restore only under a documented incident decision,
since the old version reintroduces the known non-atomic race. Prefer a forward
fix. Do not reopen old processing claims or discard completed invoices/benefits
to make rollback easier.

Payment email/audit notifications after the RPC remain best effort. If the
process ends after commit, a retry sees duplicate and does not guarantee a
receipt is resent. A durable notification outbox remains separate work. Cleanup
still scans a bounded page of records; reconcile legacy backlog and monitor it
during rollout.

Transaction references:
[PostgREST transaction scope](https://docs.postgrest.org/en/stable/references/transactions.html)
and
[PostgreSQL row locks](https://www.postgresql.org/docs/current/explicit-locking.html).
