# VerifyMzansi production-readiness repair review

9 October 2026 · Local repair verification complete · Production verdict:
**NO-GO**.

Local executable checks passed after the repairs below. Production readiness is
still blocked by disabled native breached-password protection, missing deployed
commit/CI evidence, unavailable Docker/PostgreSQL verification, missing Worker
runtime-binding integration coverage and unverified genuine Ozow delivery.

## Scope

Reviewed the Next.js 16.3.8 application, Supabase client and database
boundaries, Cloudflare Workers, Ozow billing, manual KYC, uploads, retention,
staff access, account changes, privacy exports, configuration and maintained
audit tooling. Source review concentrated on critical workflows and the repaired
modules; automated checks cover the broader repository. This is not a claim that
every file received exhaustive manual inspection.

The initial working tree contained traffic-query migrations, database tests and
Supabase-review evidence. Those changes were preserved. No production data,
credentials, provider configuration or deployments were modified.

## Problems, root causes and repairs

1. **Profile data loss** —
   [profile update](C:/Users/SENZO/Documents/verifymzansi/src/app/api/profile/update/route.ts:172)
   treated absent optional bio/province/city fields as explicit clears. Updates
   now write only supplied fields; explicit empty values still clear them.
   Location history agrees with the actual write.
2. **Avatar ownership-check bypass** — raw URL prefixes accepted dot segments,
   encoded traversal and backslashes leading to another member's public avatar.
   [avatar validation](C:/Users/SENZO/Documents/verifymzansi/src/lib/validations/profile.ts:45)
   now checks parsed origin and normalized pathname, rejects encoded paths and
   credentials, and enforces the caller's folder. This prevents cross-member
   avatar references; it was not a private storage read or write vulnerability.
3. **Broken server-error recovery** — all 13 Next.js route/global error
   components used `reset()`, which clears the boundary without fetching fresh
   server data in the installed framework. Buttons now use `retry()`; root chunk
   recovery retains its existing full-navigation behavior. The installed
   [Next.js error guide](C:/Users/SENZO/Documents/verifymzansi/node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/error.md)
   and runtime implementation establish this distinction.
4. **False empty affiliation results** — the
   [API](C:/Users/SENZO/Documents/verifymzansi/src/app/api/affiliations/route.ts:44)
   and
   [dashboard](C:/Users/SENZO/Documents/verifymzansi/src/app/dashboard/affiliations/page.tsx:58)
   ignored returned database errors. They now log failures and return a safe 503
   or invoke the dashboard error boundary. The member API explicitly prevents
   caching. Existing owner/applicant filters remain active.
5. **Upload retry cancellation** —
   [fetch retries](C:/Users/SENZO/Documents/verifymzansi/src/lib/utils/fetch-retry.ts:119)
   ignored the signal on Request inputs and kept retry delays alive after
   cancellation. It now observes that signal, aborts backoff promptly, removes
   listeners and clears each attempt's timer before waiting.
6. **Avatar cleanup ordering and hidden failures** —
   [cleanup](C:/Users/SENZO/Documents/verifymzansi/src/app/api/profile/avatar/route.ts:170)
   ran before the new profile URL was saved, so a failed save could remove the
   previous avatar. Cleanup now follows successful persistence and reports
   Supabase's returned storage errors. Same-format uploads still use the
   existing overwrite behavior.
7. **Orphan image variants** — the
   [retention Worker](C:/Users/SENZO/Documents/verifymzansi/workers/retention-cleanup.ts:594)
   deleted abandoned originals and tracking rows but left derived WebP files. It
   now deletes the original and its variants together, deduplicates keys, and
   retains tracking on storage failure.
   [Shared variant rules](C:/Users/SENZO/Documents/verifymzansi/src/lib/media/variant-keys.ts:13)
   share the existing key rules between generation, explicit cleanup and the
   Worker without importing image-decoding dependencies into the Worker.
   Private-bucket and legal-hold behavior is retained.
8. **KYC session state loss on lookup failure** —
   [session start](C:/Users/SENZO/Documents/verifymzansi/src/app/api/verification/session/start/route.ts:83)
   treated failed step reads as empty progress, potentially clearing submitted
   artifact links during expiry reset. It now stops with a safe 503 before that
   reset or session creation, and refuses to report empty progress when the
   final read fails.

## Cleanup, performance and database impact

Coverage runs exposed the same cold PGlite bootstrap timeout across four
different migration suites (about 11–13 seconds against a 10-second deadline).
[Vitest configuration](C:/Users/SENZO/Documents/verifymzansi/vitest.config.ts)
now gives setup hooks a bounded 30-second allowance only in the instrumented
coverage lane. The earlier per-file changes were removed; normal unit hook
deadlines, assertion deadlines and coverage thresholds remain unchanged. The
original failed runs remain in evidence. Full coverage passed with this
consistent setup policy.

Removed the unused settings-name schema and two private type aliases after a
repository reference search. Consolidated variant key generation/expansion into
one dependency-free helper. Cancellation releases timers/listeners and avoids
further attempts; orphan cleanup prevents accumulating abandoned derived files.
No latency or storage-cost improvement was benchmarked.

The initial repair pass introduced no migrations or schema changes. The
follow-up below adds one local service-only OTP RPC migration. Existing
uncommitted traffic-query migrations were inspected and included in the
database/unit checks; their authorship and performance evidence remain separate
from these repairs.

## Verification

- Full unit run: **571 files / 5,240 tests passed**. Later changes were
  separately verified by the focused runs below.
- Final repair tests: **128 tests in 14 files passed** across profile/avatar,
  all error boundaries, affiliations, retry/uploads and media/retention.
- KYC follow-up: **72 tests in 3 files passed**, including session-start failure
  cases, verification UI and KYC engine. New regressions were first demonstrated
  against the original behavior before repairs.
- PGlite fixture follow-up: **10 tests in 2 files passed**, verifying promotion
  ownership enforcement and business-verification privacy. The final coverage
  run also passed these and the other previously timed-out suites.
- All **13 isolated PGlite database lanes passed**. These supplement, and do not
  replace, independent-session PostgreSQL/PostgREST verification.
- Retention Worker bundles successfully with esbuild for a neutral ES2022
  target. This is compilation evidence, not a deployed R2-binding test.
- Final whole-repository format, lint, types, dead-code, import, duplication and
  strict secret checks passed. Targeted KYC lint and the final Vitest config's
  lint/format checks also passed; final type checking passed after that change.
- Final instrumented coverage: **569 files / 5,191 tests passed**, with no
  skipped tests. Coverage: **77.51% statements, 67.65% branches, 84.33%
  functions, 79.30% lines**; existing thresholds passed. The maintained coverage
  lane excludes six DOM-heavy suites from instrumentation, covered by the full
  unit and affected UI runs. Local CodeQL was unavailable; this is not a formal
  exhaustive Codex Security scan or proof of zero vulnerabilities.
- Final strict secret scan: **11,389 text files, zero read failures**, passed.
  Its 241 binary and 847 compiler-cache exclusions remain verification limits.
- Isolated **Next.js 16.3.8 production build passed**, with generated critical
  routes and bundle budgets verified. The bundle check measures entry chunks,
  not total first-load JavaScript; largest reported entry was 108 KB against the
  unchanged 275/325 KB warning/failure budgets.
- Browser lane: **69 passed, 15 skipped, zero unexpected failures or flaky
  results**. Desktop Chrome passed 40 and skipped 2; mobile Chrome passed 29 and
  skipped 13. Every skipped scenario passed in the other selected project. All
  three required authenticated KYC scenarios passed in both projects: synthetic
  document/private-evidence/resubmission, selfie/final approval/name
  locking/retention, and independent high-risk governance approval. Firefox was
  not selected; WebKit/mobile Safari remain quarantined. Fixtures do not attest
  real PostgreSQL or genuine provider delivery.
- Read-only deployed checks passed for required Cloudflare secret names,
  Cloudflare posture, schema and deep health. Secret names do not attest values.
- Production preflight passed its configuration and read-only service checks,
  including Ozow API access. It sent no payments, SMS or emails and does not
  verify signed webhook delivery.
- Dependency audit: WARN for the existing verified `braces` depth-guard
  backport.
- Supabase strict security advisor: FAIL because native leaked-password
  protection is disabled and plan-blocked. Nineteen intentionally exposed
  controls retained exact implementation/privilege attestations.
- Performance advisor: WARN, with 10 actionable unused-index observations and 47
  accepted findings. No indexes were removed based only on usage counters.
- Deployed-commit CI attestation: UNAVAILABLE because repository/target SHA/read
  token evidence was not supplied to its checker.
- Launch configuration and Cloudflare adapter validation: PASS.
- Email DNS: WARN for root MX routing and monitoring-only DMARC (`p=none`);
  return-path SPF/MX and DKIM checks passed. DNS alone cannot establish inbox
  delivery or Gmail alias configuration. No DNS settings were changed.
- Full PostgreSQL/PostgREST lane: UNAVAILABLE because Docker is not installed.
- Isolated Worker runtime-binding integration and genuine signed Ozow delivery:
  UNAVAILABLE; the maintained registry retains both as release blockers.
- Advisory Lighthouse, k6 and staging load checks were not run. No staging load
  target was supplied, and no production load test was performed.

## Remaining risks and prioritized follow-up

1. Resolve native breached-password protection and verify exact deployed-commit
   CI before launch. App password checks do not satisfy the native-provider
   gate.
2. Run full migrations, RLS and independent-session races on PostgreSQL; supply
   Worker-binding integration and genuine signed Ozow delivery evidence. Local
   authenticated desktop/mobile Chrome flows passed; Safari and Firefox coverage
   remain separate work. Manual KYC has no automated-vendor attestation.
3. Review index workload evidence before removing any index. Preserve
   foreign-key support and application guardrails.
4. Deploy and verify the follow-up OTP migration before its application route.
   Atomic finalization now has local SQL and independent-session PostgreSQL
   evidence, but full Supabase/PostgREST verification and rollout remain
   pending.
5. Consider upload idempotency for lost-response retries. Abandoned uploads now
   have complete derived-object cleanup, but retrying an uncertain POST can
   still create extra originals until the scheduled orphan sweep.

## Follow-up after continuation

The new changes below were verified separately from the initial counts above.
They have not been deployed or applied to the production database.

- **Profile recovery could overwrite existing account standing.**
  [Recovery helper](C:/Users/SENZO/Documents/verifymzansi/src/lib/account/ensure-profile.ts)
  ignored failed lookup results and used an upsert containing `active` and
  `incomplete` defaults. It now stops on lookup errors, inserts only when
  absent, and re-reads a creation conflict once. Verified, suspended or banned
  rows are preserved. Four new regression cases failed against the original
  implementation.
- **OTP completion was not transactional.**
  [OTP route](C:/Users/SENZO/Documents/verifymzansi/src/app/api/otp/verify/route.ts)
  consumed the challenge before separate profile, step and session writes. A
  later failure could leave partial verification and prevent recovery. The new
  [migration](C:/Users/SENZO/Documents/verifymzansi/supabase/migrations/20261009063011_atomic_otp_phone_finalization.sql)
  provides `finalize_otp_phone_verification` with `SECURITY INVOKER`, a fixed
  search path, and service-role-only execution. It locks and rechecks account
  standing, staging, challenge owner/hash, expiry, reserved attempts,
  verification eligibility and cooldown before committing all verification state
  and audit markers together. Duplicate committed calls return
  `already_verified` without restamping or duplicate notices. Same-phone
  verification preserves cooldowns.
- Removed the separate challenge-claim/sibling-update fallback implementations.
  Missing RPCs and malformed results fail closed. PBKDF2 comparison, CSRF,
  confirmed-email checks, shared rate limits and the five-guess budget remain.
  Attempt reservations deliberately remain consumed after infrastructure
  failures; an exhausted budget may require a fresh code. Security SMS/email
  remain best-effort external effects rather than database transaction
  participants.
- Challenge lookup outages now return safe retryable 503 responses rather than
  being misreported as an invalid code; no comparison attempt is consumed. The
  added route regression passed. Logs retain database error classification
  without including phone numbers, OTP values or stored hashes.
- Browser fixtures model the new RPC through the shared isolated fixture store;
  they are not PostgreSQL/RLS evidence. The full isolated database runner now
  requires the new RPC's service-only grants as well.
- **Native PostgreSQL 17.11:** six checks passed, including two independent
  backend sessions (one verification, one idempotent replay), rollback/retry for
  session and audit failures, browser-role execution denial and staging changes
  rechecked after waiting for another transaction's account lock. The cluster
  used only synthetic rows and a private Unix socket; the temporary server was
  stopped.
  [Native evidence](C:/Users/SENZO/Documents/verifymzansi/docs/audit-evidence/otp-atomic-finalization-native-2026-10-09.json)
  covers a minimal isolated schema, not full Supabase migrations or PostgREST.
- Nine static checks passed in `tmp/production-review-follow-up-final/`.
  Affected functional/SQL/UI tests: **109 tests in nine files passed**. The
  subsequent OTP route run passed **39 tests**, including the added lookup
  failure case. Updated OAuth and catalog fixtures passed **40 tests**; cold
  PGlite startup is now performed in setup hooks, not inside assertion windows.
- Latest full coverage: **571 files / 5,217 tests passed**, with no skips or
  failures. Coverage: **77.54% statements, 67.68% branches, 84.35% functions,
  79.34% lines**. Existing thresholds and assertion deadlines remain unchanged.
  Evidence:
  `tmp/production-review-follow-up-coverage-complete/latest-review.json`.
- The follow-up isolated Next.js production build, critical generated routes,
  browser scenarios and bundle budget passed. The final cached rebuild/browser
  rerun after the last error-handling change also passed: **69 expected, 15
  project-specific skips, no unexpected or flaky results**, with all six
  mandatory authenticated KYC scenario/project instances passing. The same
  browser/platform and provider limitations described above apply. Evidence:
  `tmp/production-review-follow-up-runtime/latest-release.json`,
  `tmp/follow-up-final-browser.json`, `tmp/follow-up-final-browser.log`, and
  `tmp/follow-up-final-bundle.log`.
- Final format/lint/type recheck passed after the route change:
  `tmp/production-review-follow-up-last-static/latest-review.json`. Previous
  failed/interrupted reports are retained rather than overwritten with invented
  successes. No reviewed security/quality baseline was relaxed.

### Follow-up rollout order

1. Execute full migrations and HTTP/RLS races in an isolated Supabase stack.
2. Apply and verify `20261009063011_atomic_otp_phone_finalization.sql` before
   deploying the OTP route. Confirm service-only execute grants and PostgREST
   schema-cache visibility. No non-transactional fallback is provided.
3. Deploy the corresponding application and verify phone setup, change,
   duplicate retry and failure recovery. Until the migration exists,
   verification returns a retryable 503 rather than writing partial state.

The deployment, database rollout and genuine provider-delivery steps remain
outside this read-only production review. The overall **NO-GO** verdict
persists.

## Evidence

- Broad local release run: `tmp/safety-gate/2026-10-08T23-56-27-704Z-b87efe15/`
- Final static run:
  `tmp/production-review-final/2026-10-09T00-14-59-302Z-7684a826/`
- Separate read-only deployed run:
  `tmp/production-review-remote/2026-10-09T00-07-22-684Z-bdb26735/`
- Production preflight: `tmp/production-review-preflight/latest-release.json`
- The broad local run was interrupted before it wrote a final report; use its
  per-run progress/log evidence rather than an older
  `tmp/safety-gate/latest-release.json`. Subsequent scoped runs attest their own
  checks only. The combined assessment is **NO-GO**, not a passing full release
  gate.
- Coverage retry: `tmp/production-review-coverage/latest-review.json`
- Successful production build/browser/bundle evidence:
  `tmp/isolated-browser/checkout-3YOFfU-playwright.json` and
  `tmp/isolated-browser/latest.json`.
- The earlier build/browser and coverage retry processes stopped before writing
  final reports. Their partial evidence remains incomplete. On continuation,
  only the unfinished lanes were restarted:
  `tmp/production-review-completion/2026-10-09T05-30-35-428Z-608d5cfd/` and
  `tmp/production-review-coverage-resumed/2026-10-09T05-30-35-427Z-d6079f36/`.
- Coverage with the consistent setup budget:
  `tmp/production-review-coverage-final/2026-10-09T05-51-21-220Z-8105796b/coverage.log`
  and `tmp/production-review-coverage-final/latest-review.json` (**PASS**).
