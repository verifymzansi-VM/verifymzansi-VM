# Production audit rollout — 1 October 2026

These steps are a reviewable plan, not permission to deploy. The audit made no
remote data changes, migrations, configuration changes, or deployments.

## Prerequisites

1. Provision an isolated staging Worker, database and storage. The configured
   `verifymzansi-staging` Worker is absent and its current configuration shares
   production Supabase, R2 buckets and the rate limiter. Do not run
   mutation-based staging tests against those shared services.
2. Obtain a restorable, consistent PostgreSQL backup and rehearse restoration in
   an isolated database. Supabase's backup API reported zero managed backups and
   PITR disabled during this audit. Verify any independent backup separately.
   `pnpm supabase:db:backup` is explicitly a supplemental REST export; neither
   it nor `supabase:db:push:safe` proves database recoverability. Include Auth
   users, schema, roles, triggers and functions in the recovery plan. Back up R2
   objects and encryption keys separately, in access-controlled storage outside
   Git.
3. Complete staging provider journeys: recovery/confirmation email, Google OAuth
   account restrictions, two-user isolation, staff MFA, OTP delivery, payment
   creation and signed settlement, quota rejection/cleanup and jobs.
4. Obtain approval for the exact production changes below. Build and package the
   Worker on Linux using the frozen lockfile. Record the previous deployed
   version and a reviewed backup identifier before starting.
5. Configure `main` protections using `docs/branch-protection.md`. Both
   effective branch rules and repository rulesets were empty. Review the deploy
   workflow change requiring exact-commit CI; tag/manual deployments must use a
   commit with a successful main-push CI result.

## Operation-job fencing migration and application

The new runner calls the five-argument `complete_operation_job` RPC, so it needs
`20261001130000_operation_job_attempt_fencing.sql`. The migration revokes the
old three-argument signature; old application runners cannot complete jobs
afterward.

1. Pause the operations Worker cron and any other callers of
   `/api/webhooks/ops-jobs`. Prevent new claims while draining existing runners.
2. Wait for existing runners to finish (the current claim lease is five
   minutes). Inspect `operation_jobs` and confirm no active runner remains;
   merely waiting five minutes is not proof that an external effect stopped.
3. Apply the reviewed fencing migration through the normal database process.
4. Deploy the matching application, verify deep readiness, and verify the new
   PostgREST RPC is visible and restricted to `service_role`.
5. Resume the operations trigger and observe an isolated staging/test job
   through claim, effect and completion. Confirm expired/stale claims cannot
   acknowledge a newer attempt, and monitor retries/dead jobs.

Resend deduplicates stable job keys for 24 hours. That improves crash/retry
handling but does not establish permanent exactly-once delivery. Receipts remain
best-effort background effects; investigate failed receipt delivery separately.

## Pending media-quota migration

Production's latest migration was `20260930180000`. The ledger/trigger from the
existing `20260930190000_atomic_media_storage_quota.sql` were absent in live
read-only catalog checks.

Deploy the application's already-reviewed quota-error handling before applying
the quota migration. Review its table-lock/backfill impact and use a migration
window appropriate to the actual data volume. Apply it after a verified backup;
compare ledger totals with original/pending tracking bytes. In isolated staging,
verify simultaneous uploads, exact-limit rejection, rejected-object cleanup,
deletions and reduced quotas through real PostgREST/R2 paths. Do not apply every
pending migration blindly: inventory and review them individually.

## Rollback

- For ordinary application changes, restore the recorded prior Worker version
  and re-run deep readiness. Keep failed-launch evidence for diagnosis.
- For job fencing, pause and drain triggers again. Restore the prior application
  and use a reviewed forward migration granting `service_role` execution on
  `public.complete_operation_job(uuid, boolean, text)`. The new overload can
  remain. This reopens the old stale-runner race; record the temporary exposure
  before resuming jobs. Do not delete queued jobs or user records.
- For quota enforcement, use a reviewed forward migration dropping the
  `media_storage_quota` trigger and restoring the prior service-only aggregate
  implementation of `media_storage_used`. Preserve tracking rows, objects and
  the ledger. This restores advisory quota enforcement and its concurrency risk.
- Local Supabase TOTP now matches production. Reverting the local flags disables
  the local staff step-up workflow; it does not change production Auth settings.

## Reference documentation

- [Cloudflare environment isolation](https://developers.cloudflare.com/workers/wrangler/environments/)
- [Supabase backups](https://supabase.com/docs/guides/platform/backups)
- [Supabase MFA](https://supabase.com/docs/guides/auth/auth-mfa)
- [Resend idempotency window](https://resend.com/blog/engineering-idempotency-keys)
