# Production readiness follow-up — 30 September–1 October 2026

This follow-up covers the repository review and incremental fixes performed in
this chat. Existing work, including HTTP(S)-only external URL validation, was
preserved and tested. Changes are local; they have not been deployed. No
credentials, production records, grants, or indexes were modified.

**Code checks: PASS. Recorded release gate: PASS (17/17 steps; optional launch
bundle executed). Production sign-off: NO-GO pending deployed staging
verification and ordered rollout of the new quota migration.** Supplemental
full-application Linux Cloudflare build, production/staging packaging dry runs,
and real PostgreSQL concurrency checks passed. The corrected read-only staging
secrets check fails because the configured staging Worker does not exist;
production secret bindings pass. This is a newly verified readiness blocker
outside the recorded canonical gate, not a suppressed failure.

## 1. Problems discovered

- **Medium: staging configuration and its verification diverged from
  production.** Staging omitted strict startup validation and explicit manual
  KYC selection. The staging secrets-check script also passed the production
  Worker name, causing Wrangler to inspect the wrong target. Correcting that
  revealed there is no deployed `verifymzansi-staging` Worker in the configured
  account.
- **High: authentication could succeed without authoritative account-status
  verification.** `src/app/api/auth/login/route.ts` ignored failed/missing
  post-login user and account-profile lookups. A failed distributed brute-force
  counter write could also outlive the request.
- **Medium: background work could be lost after a Worker response.**
  `src/lib/utils/background-task.ts` registered request lifetime asynchronously;
  notifications, view tracking, and the phone-verification security SMS had
  additional detached calls.
- **Medium: media responses received the wrong cache policy.** `next.config.js`
  and `src/lib/middleware/security-headers.ts` forced immutable media caching
  regardless of the handler outcome, including temporary responsive fallbacks
  and errors.
- **Medium: storage quota checks failed open.** Both media upload routes
  swallowed lookup failures; `src/lib/commercial/settings.ts` accepted
  unavailable usage as zero.
- **Medium: concurrent uploads could pass the same quota preflight.** The
  allowance check and tracking insert were separate operations. Upload tracking
  failures also returned an already-deleted original URL and could leave
  generated variants behind.
- **High: installed OpenNext predates a Next 16.3 Worker runtime fix.** OpenNext
  1.20.7 fixes orphaned bindings in `loadCustomCacheHandlers` that can cause
  request-time failures despite successful builds. The adapter was updated from
  1.20.6 to 1.20.7, bringing its AWS core from 4.1.4 to 4.1.6.
  [Upstream release notes](https://github.com/opennextjs/opennextjs-cloudflare/releases/tag/%40opennextjs%2Fcloudflare%401.20.7).
- **Medium: middleware authentication lacked the shared network deadline.** The
  Supabase timeout wrapper also discarded cancellation carried by a `Request`
  and dropped its own deadline on runtimes without `AbortSignal.any` when caller
  cancellation was present.
- **Medium: unnecessary media buffering and abandoned streams.** The media
  serving route buffered full images, retained unused fallback bodies, and could
  select an error before a successful fallback.

## 2. Root causes

The recurring causes were detached promises without synchronous lifetime
registration, fail-open handling of authoritative lookups, and conflicting
header ownership between framework configuration, middleware, and route
handlers. Media tests also assigned an object to `process.env`, which coerced it
to a string and failed to exercise the intended native R2 path. Wrangler does
not inherit top-level variables into named environments, and an explicit
`--name` overrides the environment's configured name.

## 3. Changes made

- Register observed background promises synchronously with Next.js `after`,
  which the installed OpenNext adapter connects to request `waitUntil`. Updated
  ten route modules covering content submissions/edits/resubmission, billing
  cancellation, reports, business/promotion view tracking, and OTP verification.
  Registration failures in production are logged.
- Await distributed failed-login recording. Sign out and return a safe 503 when
  post-login session or account-status verification is unavailable; existing
  suspended/banned/deleted-account denial remains active.
- Give middleware Supabase requests the shared 15-second timeout. Compose caller
  and timeout cancellation across supported runtimes and remove fallback
  listeners when fetch settles.
- Let the media handler own cache decisions. Successful originals retain
  one-year immutable caching; responsive fallbacks use five minutes; errors,
  throttling, and redirects default to private/no-store. Other APIs retain their
  private cache policy.
- Stream native R2 and S3 image bodies. Cancel unused conditional/fallback
  bodies, prefer successful fallback probes, and preserve metadata-derived
  content length, MIME safeguards, and SVG download restrictions.
- Reject failed or malformed storage usage; return a safe 503 before uploading
  or issuing a presigned URL. Existing over-quota responses remain 413. Added
  realistic storage-usage behavior to the Playwright stub.
- Add a private usage ledger and database trigger to arbitrate tracking inserts
  and size changes atomically, including pending presigned uploads. Track
  originals before generating variants or returning their URLs; clean up
  rejected originals and expose safe 413/503 responses for database quota
  errors. Rejected promises during tracking also enter cleanup.
- Update OpenNext to the released Next 16.3 runtime fix without downgrading Next
  or Sharp. The full application subsequently built and packaged successfully in
  Linux/WSL.
- Add `STRICT_ENV_STARTUP_BLOCK=1` and `KYC_PROVIDER=manual` to
  `env.staging.vars` in `wrangler.toml`. Let
  `scripts/cloudflare-worker-secrets-check.mjs` resolve the Worker name from
  Wrangler's environment configuration unless explicitly overridden. Existing
  shared service bindings and staging runtime-mode settings were preserved.

## 4. Security issues fixed

Closed the login account-status lookup bypass and upload quota failure bypass.
Failed-login writes now complete before the response. Security SMS/background
notifications have request lifetime registration and rejection observation.
Staging now explicitly enables fail-closed startup validation, and its secrets
check inspects the actual configured target. Regression checks retain staff
role/MFA, RLS, webhook signature, private-media, CSRF, and unauthorized-payment
controls.

## 5. Performance improvements

Media serving no longer requires whole-image buffering in the two production
storage paths. Discarded probes release their streams, and successful probes are
no longer masked by sibling errors. HTTP-level tests verify that cache policy
permits normal asset caching without persisting temporary fallbacks or failures
for a year. The quota migration replaces repeated media-size sums with one
account-row lookup. No sustained-load benchmark or measured latency improvement
is claimed.

## 6. Cleanup

Removed the detached dynamic context-registration implementation and the
duplicate upload wrappers that silently swallowed quota errors. Consolidated
background lifetime/error observation and response cache ownership.
Dead-code/import-graph checks passed; no uncertain-use files or database indexes
were deleted.

## 7. Database changes

Added **`supabase/migrations/20260930190000_atomic_media_storage_quota.sql`**,
not applied to a remote database. It locks tracking writes during backfill,
counts existing originals and pending direct-upload rows, and maintains
`media_storage_usage` transactionally on insert, delete, and size changes. A
conditional row update serializes writers for the same account and rejects
growth beyond the configured allowance; conflicting higher-isolation
transactions abort rather than overspend.
[PostgreSQL isolation semantics](https://www.postgresql.org/docs/current/transaction-iso.html).

The ledger has RLS and no client access. Service-role uploads invoke the
private, pinned-search-path trigger; service-role callers can read usage but
cannot edit the ledger directly. Existing over-quota files are preserved,
reductions/deletions remain possible, and ownership transfers are rejected.
Invalid quota settings stop growth with `PT503`; missing settings retain the
documented 500 MB default. `media_storage_used` keeps its existing service-only
RPC contract.

`pnpm test:media:db` now includes an isolated PGlite suite covering legacy
backfill/reapplication, stale preflights, exact limits, account isolation,
pending rows, size updates/deletion/cascade, transaction rollback, malformed
settings, lowered quotas, and role restrictions. A separate local PostgreSQL
17.10 cluster subsequently passed **19 concurrency cases with eight independent
service-role sessions**, including held locks, first-ledger creation,
commit/rollback, concurrent deletion, multi-row rollback, independent accounts,
and ten eight-writer races. Read Committed rejected competing growth with
`PT413`; Repeatable Read and Serializable aborted the competing transaction with
`40001`. Ledger totals matched tracking sums and stayed within allowance. This
does not certify deployed PostgREST or storage-provider behavior. Live read-only
schema checks also passed the checked table, account-profile, ownership-column,
and legacy-table-absence contracts.

The final database rerun additionally verified integer-valued JSON numeric
representations (`50.0` and `5e1`) remain valid while fractions are rejected
before bigint conversion. This small validation refinement was made after the
canonical gate's database step and both media suites were rerun successfully
(`tmp/audit-20260930/final-quota-db.log`); application code and unit-test counts
were unchanged.

## 8. Tests and checks

- **Full application `pnpm build:cloudflare` passed on Linux/WSL**, including
  strict generated-artifact secret scanning and the normal OG-path patch. The
  isolated source copy excluded private environment files; build configuration
  used only existing public variables. Explicit production and staging
  `wrangler deploy --dry-run` checks passed after the staging variable
  correction, with no configuration warnings. The compressed Worker is
  **7,099.45 KiB (6.93 MiB)**; no deployment/upload occurred. Evidence:
  `tmp/audit-20260930/full-worker-build.log`,
  `full-worker-production-dry-run.log`, and `full-worker-staging-dry-run.log`.
- The full Worker started locally and served a static asset with **HTTP 200**.
  `/api/health` returned **500 at strict instrumentation validation because
  private credentials were deliberately absent**. This verifies basic startup,
  asset serving, and rejection of missing secrets; authenticated application
  workflows remain unverified in that runtime. Evidence:
  `tmp/audit-20260930/full-worker-local.log`; the local server was stopped.
- **PostgreSQL concurrency: 19 cases passed**, with eight distinct backend
  sessions and confirmed lock waits before the first transaction was released.
  The disposable local server was stopped. Evidence:
  `tmp/audit-20260930/postgres-concurrency-results.json`,
  `postgres-concurrency.log`, and the reproducible local harness
  `postgres-concurrency.mjs`.
- Supplemental configuration validation, script lint, production secrets
  inspection, and `git diff --check` passed.
  **`pnpm cloudflare:secrets:check:staging` failed** with Cloudflare code
  `10007`: `verifymzansi-staging` does not exist. Evidence:
  `tmp/audit-20260930/production-secrets-check.log` and
  `staging-secrets-check.log`. These checks followed the recorded release gate;
  that earlier PASS does not include the missing-staging finding.
- Final configuration/startup/KYC/deployment-binding regression run: **six
  files, 61 tests passed**
  (`tmp/audit-20260930/final-cloudflare-guards-tests.log`). Strict
  source/generated-artifact secret scan also passed after the last changes
  (`final-delivery-secret-scan.log`). No full gate rerun is claimed after these
  staging-only configuration and read-only inspection-script changes; affected
  checks and live production metadata inspection were rerun.
- Continuation completed-tree Vitest run: **497 files, 4,587 tests passed**. The
  targeted upload/quota run also passed **54 tests**, and both media database
  suites passed. The fresh full gate is recorded in
  `tmp/audit-20260930/continued-release.log`.
- **Local workerd lifetime probe passed on Linux/WSL**, using Next 16.3.6,
  OpenNext Cloudflare 1.20.7/AWS 4.1.6, Wrangler 4.143.0, and an exact copy of
  the repository helper (SHA-256 matched). Cold response: **466 ms**; warm
  response: **19 ms**. In both cases a three-second task was initially
  incomplete after the response and completed at the later probe. The fixture
  used the repository's custom image loader and Webpack build convention, with
  no remote service bindings or credentials. Its Worker built successfully; the
  temporary local server was stopped. Evidence:
  `tmp/audit-20260930/worker-lifetime-results.json`,
  `linux-worker-build-native.log`, and `linux-worker-runtime.log`.
- Final lint with zero-warning threshold, typecheck, dead-code scan, secret
  scan, and `git diff --check` passed. The Next configuration and new browser
  test were also linted explicitly.
- Production build passed. Desktop Chromium and mobile Chrome smoke: **41
  passed, 3 skipped (44 selected)**; all ten new media-cache checks passed.
  Optional launch billing/DSAR bundle: **233 unit tests and 4 browser tests
  passed**. Browser tests include the real Next.js header pipeline and mock Ozow
  payment confirmation/session recovery.
- Launch environment validation and production edge preflight passed. Dependency
  audit, license policy, OpenAPI drift, import graph, duplication budget, and
  database invariants passed in the release run.
- Live deployed-site smoke: **8 checks passed**, including unsigned webhooks and
  unauthenticated checkout denied with 401. This verifies the previously
  deployed system, not deployment of these local changes.
- Initial review gate passed. The continuation `pnpm safety:release` **passed
  all 17 steps with no failures or soft failures** (23 minutes 36 seconds),
  including the optional launch bundle. Its generated report is
  `tmp/safety-gate/safety-release-20260930-214457.json`; full command output is
  `tmp/audit-20260930/continued-release.log`. The final quota
  numeric-representation refinement was verified by the supplemental media
  database rerun described above.

Canonical review artifacts (initial baseline):
[JSON](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review.json),
[Markdown](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review.md),
[blockers](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review-blockers.txt).
The fresh release gate re-executes all review checks:
[JSON](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-release.json),
[Markdown](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-release.md),
[blockers](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-release-blockers.txt).
Supporting command logs are under `tmp/audit-20260930/` (local, ignored
artifacts).

## 9. Remaining risks and limits

- `pnpm supabase:advisor:security:strict` still fails with **11
  elevated-function grant warnings** and **one plan-blocked native
  leaked-password protection warning**; nothing was suppressed. Read-only
  catalog inspection independently compared all six live function bodies,
  security-definer flags, pinned search paths, and anon/authenticated grants
  with repository migrations; every comparison matched
  (`tmp/audit-20260930/live-function-comparison.json`). `current_staff_role`
  enforces current-user/MFA constraints; `intro_trial_offer` and
  `is_current_organisation_admin` use caller identity; `organisation_directory`,
  `organisation_public_stats`, and `public_business_affiliations` explicitly
  filter public visibility/live business status, with sponsorship windows and a
  200-ID cap where applicable. These are intentional exposed/RLS helpers, not
  eleven demonstrated exploits. No blanket revocation is justified by the
  findings. Application breached-password checks remain active; the native
  Supabase feature is unavailable on the free plan.
- `pnpm supabase:advisor:performance:strict` reports **7 unused-index
  findings**; **37 others were accepted** as foreign-key support or documented
  guardrails. Read-only catalog checks found all seven had zero scans and
  occupied **80 KiB total**. At least the content restriction index supports
  active restriction reversal queries; expiry deletion is currently disabled to
  preserve posts for renewal. Retain the indexes pending representative query
  plans; a database-wide statistics reset timestamp does not establish how long
  each index has existed. Evidence:
  `tmp/audit-20260930/live-unused-indexes.json`.
- The new migration enforces the allowance against tracked original bytes,
  including pending presigned uploads. Multipart originals reach R2 before
  tracking and rejected objects are cleaned up; process crashes or cleanup
  failures can still leave untracked objects. Derived variants remain outside
  the existing logical allowance. This is not a hard physical-bucket-size
  guarantee or a durable storage reservation service.
- Local OpenNext probes on Windows fail while bundling Sharp 0.35.4 native
  binaries, including after the adapter update and alignment with the
  repository's custom-loader/external-package settings. This matches
  [upstream issue 1394](https://github.com/opennextjs/opennextjs-cloudflare/issues/1394).
  Both the isolated fixture and full application built successfully on Linux
  with the same Next/Sharp/adapter versions. Use the Linux deployment
  environment; do not downgrade dependencies or bypass build errors to make the
  Windows probe pass.
- The configured staging Worker is absent. Its configuration deliberately shares
  OTP KV, rate-limiter service, storage bucket names, and the Supabase project
  with production. Review that existing isolation policy before staging
  deployment or mutation-based testing; the audit did not change shared service
  identifiers or create a deployed environment. Existing staging
  development-mode validation also means staging is not an exact production
  launch-validation rehearsal.
- Next still warns about the deprecated middleware convention and
  adapter/dependency Node APIs in the Edge compilation. Full Worker packaging
  also reports a suspicious-nullish-coalescing warning in generated
  dependency/schema code. These were not silenced or patched in generated
  output. Changing the security boundary to experimental adapter proxy support
  was outside a safe incremental fix.
- Deployed Cloudflare request lifetime, actual payment settlement, and live
  SMS/email delivery were not exercised. Browser coverage here is Chromium
  desktop/mobile; no sustained load test was performed.
- Request lifetime protection is not a durable delivery queue. Guaranteed
  notification delivery across process crashes would require an outbox or queue
  with retry tracking.

## 10. Recommended next work

1. Provision the intended staging environment through the normal deployment
   process after reviewing its shared-service policy. Re-run
   `pnpm cloudflare:secrets:check:staging`, then verify full-application
   authentication, post-response completion, conditional media requests,
   provider integrations, and production-mode launch validation in the deployed
   Worker. Full Linux build, both packaging dry runs, Worker size measurement,
   and isolated lifetime probes already passed.
2. **Roll out route code before applying the quota migration.** The previous
   route could return a deleted URL when tracking failed; the fixed route
   handles the trigger's rejection safely. Apply only the reviewed new migration
   through the normal database deployment process after the code is deployed.
   The isolated PostgreSQL concurrent-session checks already passed; validate
   deployed backfill against `SUM(file_size)`, exact-limit rejection, cleanup,
   size reductions and deletion through actual application/PostgREST paths. The
   ledger is private; public clients must remain unable to modify it.
3. If the trigger must be rolled back, use a reviewed forward migration that
   drops the `media_storage_quota` trigger and restores `media_storage_used` to
   the prior service-only aggregate implementation. Keep tracking rows, objects
   and the ledger; do not delete user files or revoke required RLS/public helper
   grants. This restores advisory-only enforcement, so record the temporary race
   exposure.
4. Preserve reviewed intentional function grants, keep strict advisor findings
   visible, and reassess native breached-password protection if the Supabase
   plan changes. Profile the seven indexes before removal. Retention cleanup
   already expires abandoned direct-upload tracking rows; monitor cleanup
   failures and reconcile untracked R2 objects. Validate actual provider
   settlement/delivery and sustained load before claiming those guarantees.
