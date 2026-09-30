# Production readiness audit — 1 October 2026

**Launch recommendation: NOT READY.** Local fixes do not remove the need for a
verified backup/restore process, isolated deployed staging, coordinated
migration rollout and real provider/user-boundary verification. No production
deployments, data changes, migrations or remote configuration changes were made.

## Scope and environment

The working tree was clean at the start. Existing architecture and previous
hardening were preserved. Three focused reviews covered access/database
security, payments/jobs and frontend workflows; the root review covered
integration, operations, production observations and combined verification.
Source, SQL, configuration, CI and installed Next.js guides were inspected.
Previous audit reports informed investigation; their historical results are not
fresh passes.

“Cloud Play” is Cloudflare: Wrangler and the existing handoff identify Workers,
R2, Durable Objects and KV. `.env.local` targets the production Supabase
project, R2 buckets and app. `.env.production.local` neutralizes development
bypasses; it does not establish an isolated database. Configured staging shares
production services and is not deployed. Remote inspection used GET requests and
catalog SELECTs in read-only transactions; sensitive records and credential
values were not included in evidence.

## Architecture and trust boundaries

- Next.js 16.3 App Router/React frontend, server pages and API handlers;
  middleware refreshes/gates sessions and applies security headers. OpenNext
  packages the application for Cloudflare Workers. The installed adapter retains
  middleware compatibility; migration to experimental proxy support was avoided.
- Supabase Auth supplies cookie sessions. Request clients enforce RLS;
  server-only service-role clients bypass RLS and therefore require explicit
  ownership, account-state, role, capability and MFA checks. Migrations provide
  staff authority, enforcement guards, private KYC access, column grants and
  atomic RPCs.
- Marketplace, business and promotion APIs validate content, posting
  entitlements, media ownership and server permissions. Public discovery is
  separated from owner/admin mutations. The browser auth store is convenience
  state, not the authority for protected operations.
- Ozow hosted checkout and signed webhooks drive database-atomic payment
  fulfillment; provider amount/currency/reference checks and entitlement
  ownership are covered by existing route and isolated database tests. Browser
  redirects cannot alone authorize fulfillment.
- R2 stores public media and encrypted private evidence. Upload authorization,
  completion tracking, private downloads and quota bookkeeping cross the storage
  and database boundary; storage writes are not part of a PostgreSQL
  transaction.
- Resend and Africa's Talking handle email and SMS; Turnstile protects public
  auth. Production KYC uses manual review. Signed provider endpoints remain
  present.
- Companion Workers handle distributed rate limits, abandoned payments,
  retention/R2 cleanup and durable operation jobs. Cron schedules were observed
  for payment cleanup (every ten minutes), retention (daily) and jobs (every
  minute).
- GitHub CI runs quality/security, build, browser and isolated database checks;
  deployment validates configuration, packages OpenNext, deploys companion
  Workers and checks deep readiness with rollback support.

## Confirmed findings and local fixes

1. **High — OAuth admission failed open on account-status lookup failure.** The
   callback ignored lookup errors and missing profiles. An earlier profile
   lookup failure could also classify a returning restricted user as new. Every
   OAuth admission now requires an authoritative status; failure attempts
   sign-out and redirects to the existing unavailable-service UI. Regression
   cases cover errors, missing status, initial lookup failure and banned users.
2. **High — stale job runners could acknowledge newer claims.** The old
   completion RPC checked only `running`. The new migration checks the exact
   attempt and lease timestamp and rejects expired claims; the runner skips
   expired batch entries. The old signature's execution is revoked. This is a
   required, coordinated migration/application change, not a remotely applied
   fix.
3. **High/Medium — stale browser auth requests could restore old account data.**
   Shared request versioning prevents pending user/profile results from
   overwriting sign-out or a newer account. Account switches clear profile/trust
   state, and rejected subscription initialization is handled. Server
   authorization remains independent; this finding concerns client state/privacy
   and workflow integrity.
4. **Medium — token-hash password recovery was rejected after valid
   redemption.** The endpoint expected `recovery` AMR; Supabase's OTP redemption
   path issues generic `otp` AMR. A signed, one-hour callback proof now binds
   recovery to the exact user and session. Forged, expired, future and
   mismatched proofs fail closed; generic OTP without proof stays rejected. PKCE
   recovery remains valid.
   [Supabase implementation](https://raw.githubusercontent.com/supabase/auth/master/internal/api/verify.go).
5. **Medium — confirmation cleanup lost the requested login destination.** URL
   cleanup now removes only `confirmed`, preserving `returnUrl` and history
   state. Regression coverage checks both retained destination and failure/retry
   behavior.
6. **Medium — notification jobs silently discarded temporary recipient
   failures.** Recipient lookup errors now enter normal retries. Moderation and
   DSAR-extension emails use stable job idempotency keys. Resend deduplication
   lasts 24 hours and requires the same payload; this is not permanent
   exactly-once delivery.
   [Resend behavior](https://resend.com/blog/engineering-idempotency-keys).
   Failed/zero-row DSAR delivery-record updates now retry with that same key;
   missing cases prevent sending. This avoids marking a job successful while its
   notice remains permanently unrecorded.
7. **Medium — dependency readiness could pass during rate-limiter outages.**
   Network failures and every non-401 status previously passed. Production
   readiness now requires a successful JSON `ok: true` response. Tests cover
   403/429/500/503, invalid JSON, unsuccessful payloads and network failures.
   Scheduled monitoring now invokes the same deep-readiness checker used by
   deploys.
8. **Medium — local MFA configuration diverged from enforced workflows.** Local
   TOTP enrollment/verification were disabled. Both flags now match production,
   whose enabled configuration was verified read-only.
9. **High — tag/manual deployment could bypass CI.** The successful-CI condition
   previously protected only the automatic workflow-run entry path. Every deploy
   now verifies successful main-push CI for the exact target commit; failures,
   missing runs, other branches/repositories and cancelled/in-progress attempts
   fail closed. The check passed read-only against the current committed HEAD;
   unpublished changes still require their own CI after review.
   Branch-protection documentation now matches the actual branch, jobs and
   coverage thresholds.

## Live observations and unresolved launch blockers

- **High: recoverability is not demonstrated.** Supabase reports zero managed
  backups and PITR disabled on the free plan. No independent backup/restore
  evidence was established. The existing REST export explicitly is not a
  consistent, restorable database backup. Establish and rehearse recovery,
  including R2 objects and encryption keys. Supabase database backups do not
  contain stored object contents.
  [Official backup guidance](https://supabase.com/docs/guides/platform/backups).
- **High: isolated staging is absent.** The staging secrets check fails with
  Cloudflare `10007` because the Worker does not exist. Its current
  configuration shares production services. Provision genuine isolation before
  mutation-based journey testing.
  [Cloudflare environment behavior](https://developers.cloudflare.com/workers/wrangler/environments/).
- **High: required hardening remains unapplied.** The latest observed migration
  is `20260930180000`; live catalogs show no atomic media quota ledger/trigger.
  Review rollout of existing `20260930190000_atomic_media_storage_quota.sql` and
  the new operation-job fencing migration with the matching application.
- **High: deployed critical journeys remain unverified.** Real two-user
  isolation, recovery-email redemption, authenticated mobile/staff journeys,
  OTP/email delivery, Ozow settlement and deployed PostgREST/R2 quota/job
  behavior require an isolated environment and dedicated accounts. Synthetic
  success is not evidence that those production integrations work.
- **High: main has no enforced branch protection.** Classic protection reports
  `Branch not protected`; effective-rules and repository-ruleset APIs both
  return empty arrays. Configure the reviewed
  [branch controls](branch-protection.md) before routine release use; the local
  deploy fix does not modify remote rules.
- Production has RLS enabled on all 78 observed public tables. GET-only
  anonymous checks returned zero rows from 19 protected tables, denied
  `staff_roles`, and allowed six public queries. Empty anonymous results do not
  prove cross-user isolation or column visibility for authenticated sessions.
- Production's private R2 bucket has `r2.dev` disabled and no custom domains.
  Public R2 has active production and staging media domains on the same bucket,
  confirming that current staging media is not isolated. The job queue was empty
  at observation; an expiry heartbeat was current. This does not prove notice
  delivery or absence of errors under real workloads.
- Production TOTP enrollment/verification and refresh-token rotation are
  enabled; JWT lifetime is 3,600 seconds. Security Advisor reports eleven
  function-execution warnings and one plan-blocked native breached-password
  warning. Reviewed public predicates/directory helpers intentionally need
  execution grants; no blanket revocation was made. App breached-password checks
  remain present. Performance Advisor flags seven unused indexes; retain them
  pending representative plans.
- Nine production public/auth browser targets passed, including mobile login and
  business pages. Ten edge-posture checks and a production deep-readiness check
  passed. Email DNS checks have one DMARC `p=none` warning; DNS does not prove
  inbox delivery. These are observations of the deployed version, not these
  fixes.

## Verification evidence

Raw outputs are under `tmp/audit-20261001`; safety-gate artifacts are under
`tmp/safety-gate`. Logs and test artifacts are local and ignored by Git.

- Final `pnpm safety:release`: **PASS**, all **17 steps** executed, zero
  failures or soft failures, 2,008.5 seconds. Fresh artifacts:
  `tmp/safety-gate/latest-release.json` and `latest-release.md`; log:
  `tmp/audit-20261001/final-release.log`. Desktop/mobile browser smoke: **41
  passed, three skipped**. Billing/DSAR browser flows: **four passed**; their
  accompanying unit suite: **233 passed**. Provider fixtures are deterministic
  local test infrastructure, not live settlement/delivery proof.
- Supplemental desktop/mobile matrix: **80 passed, four skipped**, covering
  light/dark accessibility scans, auth interruption/retry and expired recovery,
  unauthorized API/KYC/admin boundaries, fixture dashboard states, posting and
  200% mobile text. Two skips require real seeded auth credentials; two are
  intentional dashboard project exclusions. Evidence:
  `tmp/audit-20261001/browser-matrix-final.log`. The first matrix had two test
  selector failures because an alert locator also matched Next.js's route
  announcer. Scoping it to the expected error text fixed the ambiguity; the
  entire matrix then passed without app changes or weakened deadlines.
- Full blocking Vitest run: **499 files, 4,613 tests passed**, in 1,095.72
  seconds with two workers. Late OAuth/DSAR/deployment-gate changes were
  additionally verified by scoped final suites (50 auth/readiness tests and 49
  deployment/jobs/ email tests; overlapping suites, not additive full-suite
  totals). The new CI regression file was created after the full run began and
  is covered separately.
- Final full-tree typecheck, affected-source ESLint, workflow YAML parsing and
  `git diff --check` passed.
- Final Linux production application `build:cloudflare` and explicit production
  `wrangler deploy --dry-run` passed. Strict source/generated-artifact secret
  scan passed. The compressed Worker is **7,100.38 KiB (6.93 MiB)**. The source
  copy excluded private environment files; build configuration contained public
  settings, with no remote upload or deployment. Evidence:
  `final-worker-build.log`.
- Bundle budget passed its configured CI limits (2,750/3,000 KiB). The largest
  reported App Router entry was 107 KiB. The script explicitly used an
  entry-chunk fallback; this does not measure complete first-load JavaScript or
  load latency.
- Real local PostgreSQL 17.10 concurrency checks passed with **three independent
  sessions**, including observed lock waits, stale success/failure rejection,
  preserved newer claims and exactly-once completion of the current claim. The
  disposable server stopped. Production table/claim/completion definitions were
  used, with only a decision FK target and ops-event sink stubbed. Evidence:
  `postgres-job-leases-results.json`.
- Production public browser checks: **nine targets passed**; deep readiness
  passed on the first attempt; edge posture: **ten pass, zero
  warnings/failures**. Read-only deployment-CI verification passed for the
  current committed HEAD. Pending local changes still need their own committed
  CI before deployment.

The initial uncapped baseline passed lint, typecheck, OpenAPI drift, dead-code,
import-graph and duplication checks, then was interrupted during the full unit
run because of local worker/resource contention. It is not a passing full gate.
The final run caps Vitest workers at two through an existing environment option;
no checks, test deadlines or coverage requirements were weakened.

Focused checks observed before the combined gate: auth/MFA and callback
regressions, frontend auth races, payments/webhooks/cleanup (205 tests),
email/jobs (38 tests), isolated payment fulfillment (29 checks),
commercial/current fulfillment (42 checks), staff authority/MFA and sequential
lease fencing. One broad parallel UI run had a verification timeout; the same
test passed alone and the full combined blocking suite passed, resolving that
observed timeout in the verified two-worker run.

## Rollout, rollback and residual risks

Use
[the reviewed rollout runbook](runbooks/production-audit-rollout-2026-10-01.md)
for approvals, backups, staging, pause/drain sequencing and forward rollback
instructions. Do not apply the job migration while old runners are active, or
deploy its new caller before the RPC exists. The quota migration needs route
code first. No migration, provisioning or production deployment is authorized by
this report; obtain approval for the concrete plan.

No sustained production load test or measured latency improvement is claimed.
Current fixes target access control, workflow correctness and reliability;
unused dependencies/files/indexes were not removed without demonstrated non-use.
Physical R2 storage can still contain untracked objects after crashes/failed
cleanup, and derived variants are outside the logical quota. Payment receipts
remain best-effort background effects. Job fencing protects database completion,
not arbitrary external side effects against process crashes or prolonged
retries. These limitations need operational monitoring and honest launch
sign-off.
