# VerifyMzansi production change review — not applied

No deployment, production migration, subscription change, live credential
rotation, production export or customer-data mutation was performed.

## Required release order

1. Establish a verified, consistent database/Auth backup and an isolated restore
   procedure, plus separate R2 object and encryption-key recovery. The REST
   export in scripts/backup-supabase.ts is supplemental and is not a restorable
   database backup. Record RPO/RTO, backup identifier, storage access controls
   and restoration results before any production schema change.
2. Provision genuinely isolated staging: a separate Supabase project/branch,
   separate private/public R2 buckets, separate limiter/KV/DO state and
   test-only merchant credentials. The current checked-in staging values point
   at production resources. Do not deploy them unchanged. Use schema and
   synthetic users only; do not copy customer records.
3. Confirm operator and reviewer MFA enrollment and a tested lost-factor
   recovery procedure. Ensure independent staff can reach /staff/two-step using
   valid sessions. Removing production grace must not strand the only
   administrator. Cloudflare, GitHub, Supabase, Ozow, email/SMS operator
   accounts need separate MFA/IAM review; GitHub's available MFA field was null,
   not evidence of MFA being disabled.
4. Review and apply in staging the proposed
   supabase/migrations/20261009205230_require_staff_mfa_without_exceptions.sql
   from branch codex/prelaunch-security-fixes. It creates service-only
   staff_session_is_active(uuid,uuid), requires current_staff_role to have AAL2
   and a matching unexpired auth.sessions row, and preserves service-only
   role/enrollment helpers. Verify grants, auth.sessions.not_after
   compatibility, AAL1 denial despite grace/off flags, valid AAL2 success,
   absolute expiry and revocation. Re-attest changed helper hashes in
   scripts/security-reviews/supabase-controls.json after inspecting the actual
   deployed definitions; do not reuse old body attestations.
5. Deploy the rate-limiter policy in staging before the application:
   admin:evidence:view and admin:evidence:metadata each use 20/minute and
   200/hour per staff user. Review these budgets against normal queue work. Then
   deploy the application changes. Evidence access fails closed when shared
   protection is unavailable, requires recent MFA, and denies
   expired/unlinked/closed evidence. Session publication failure now returns 503
   and requires resubmission rather than reporting success. Legacy missing links
   must be deliberately repaired and reauthorized; do not re-enable
   historical-file fallbacks.
6. Repeat the native database, browser and focused security tests in the staged
   Cloudflare runtime with runtime bindings. An isolated Next.js/Node build does
   not attest OpenNext Worker binding integration. Verify ordinary users,
   revoked staff, distinct organisations, held/expired evidence and normal
   reviewer/governance flows. Hosted owner-token revocation and provider Auth
   settings remain a separate required test.
7. Only after evidence and explicit operator approval: apply the reviewed
   production migration, verify grants/functions, deploy the limiter policy and
   application, then verify production with read-only observations. Roll back
   the application using the recorded prior Worker version if needed; prefer a
   reviewed forward database correction. Never restore a whole database
   automatically, because later payments/user changes need reconciliation.

## Configuration changes requiring review

- Cloudflare Worker logging: the branch prepares redact_query_string=true under
  both top-level and production observability. Current live setting is false.
  Inspect request/error/replay telemetry separately; stripping Worker query
  strings does not prove that every Sentry event or provider error is scrubbed.
- Public media TLS: raise minimum TLS from 1.0 to at least 1.2 on
  media.verifymzansi.com and the staged media domain after it is isolated.
  TLS1.0 and1.1 handshakes succeeded on the production media hostname. Repeat
  read-only handshake tests after change; preserve valid1.2/1.3 clients. This
  finding concerns public media, not exposure of the private KYC bucket.
- Supabase Auth: verify password minimum/composition policy, all
  reset/update/signup pathways, breached-password protection, OAuth redirect
  allowlist, factor enrollment/recovery, JWT lifetime, inactivity/absolute
  timeout and other-session revocation. Native leaked-password protection is
  disabled. Application HIBP checks do not attest direct Auth calls. Enable a
  provider-wide equivalent when available or resolve the architecture/plan
  constraint with an explicit decision; no subscription change is authorized.
- Supabase database patches: hosted engine reports17.6.1.063, while upstream
  security fixes include17.11. Obtain provider backport/patch attestation or
  schedule a supported upgrade after verified backup, extension checks, staging
  tests and a maintenance window. Exploitability through this API surface was
  not tested. Do not infer an exploitable CVE solely from the base version
  string.
- GitHub: active Protect main only prevents deletion/force pushes. Require
  review and the relevant actual CI jobs; consider a protected production
  environment and scoped deployment credentials. Current CodeQL Analyze was
  skipped while coverage-unavailable succeeded. Enable supported CodeQL analysis
  and verify its actual analysis job, rather than relying on the workflow's
  aggregate green status.
- Monitoring: configure PRODUCTION_APP_URL and the applicable worker URLs.
  Current scheduled production smoke/worker steps skipped despite green jobs.
  Use bounded GET/HEAD checks and assert that required checks actually ran. The
  existing test:smoke can issue POST probes; do not enable those on production
  without separate authorization or a read-only replacement. Verify alert
  delivery to a named responder with synthetic events.
- File safety: design and stage a genuine antivirus/CDR or equivalent isolated
  processing/quarantine service. The custom byte/PDF-pattern scanner is not an
  antivirus engine. Do not send identity documents to a new third party without
  reviewing data flow, access and retention. Keep manual KYC; this plan adds no
  identity vendor.

## External verification still required

Provider signing-secret origin/value and genuine Ozow delivery; merchant
test/live/site configuration; production IAM/MFA and scoped key permissions;
consistent backup inventory and restoration including Auth/R2/keys; real
deletion and backup tombstones; alert delivery/incident rehearsal; comprehensive
authenticated cross-user/cross-organisation and expired/revoked access checks in
isolated staging; native Cloudflare runtime-binding integration. These are
launch gates, not passed controls.

## Additional reviewed policy and local boundary

User selected90 days inactivity for linked incomplete KYC.
Review20261009225604_expire_inactive_incomplete_kyc.sql with the MFA migration
before staging: it expires linked pending/partial-approved evidence through the
daily function, preserves verified accounts, profile/decision holds, recent
submissions/reviews, active claims and current proposals, clears identity
submission fields/links, and queues bytes while keeping hashes/audit metadata.
Prove concurrency and actual object/backup deletion externally; dry-run
inventory must use authorized metadata only. No production execution is
authorized.

Existing local development Docker targets live Supabase/R2 with privileged
credentials, runs root and publishes3000on all interfaces. Do not use it for
security fixtures. A branch guard retains production staff security for this
backend; resource/network/credential isolation still needs review. Bind dev
loopback and scope credentials only after operator review.

Reviewed local patch commit:880758e3cbb9db81e751dc2ef28773c580907236,
baseline:da5787db24fe9ad36c5968d04c7519ae6b7b3079. Exact patch and final local
validation receipts are retained with the assessment. No hosted configuration or
application changes have been applied.
