# Production readiness review — 30 September 2026

Release decision: **HOLD** until the pending migrations are applied before
deploying the updated handler and the remaining operational findings are
reviewed. Changes are local; no production migration, deployment, charge,
credential rotation, or destructive operation was performed.

## 1. Problems discovered

- **High: KYC callbacks could be silently lost.**
  `src/lib/services/kyc-webhook-store.ts` queried `updated_at` on
  `kyc_provider_results`, but that column exists in neither the checked-in
  schema nor the live database. The database error was treated as an unknown
  reference, returning HTTP 200 without applying the callback.
- **High: KYC updates were not atomic or reliably idempotent.**
  `src/app/api/webhooks/kyc/provider/route.ts` committed provider status before
  step risk, discarded callbacks arriving within two seconds, and could skip a
  retry after a partial failure. Separate reads and writes also permitted
  repeated risk changes and changes to already reviewed steps.
- **KYC upload publication race:** even the initial atomic replacement could
  finalise provider evidence before upload created the step or published its
  canonical artifact. An immediate callback then became a duplicate on retry
  without ever applying step risk. Independent review reproduced this case.
- **Medium: request limits did not bound buffering.** Shared JSON parsing,
  drafts and CSP reports buffered the complete request before checking its
  JavaScript character count. KYC and Ozow callbacks had no application body
  limit. Multibyte input could exceed the intended byte limit.
- **Medium: sensitive values could enter logs.** CSP URL fields and CSRF request
  URLs could include recovery tokens or personal information. Rate limit
  warnings included keys containing email addresses or phone numbers.
- **Validation gaps:** draft steps accepted fractional/out-of-range values
  incompatible with PostgreSQL INTEGER, draft data accepted arrays, and KYC
  signatures accepted malformed odd-length hex suffixes that Node discarded.
- **Security tooling gap:** `scripts/secret-scan.ts` scanned tracked files only,
  overlooking secrets in new, unstaged source files.
- **Privilege excess:** three caller-scoped role/listing predicates used
  SECURITY DEFINER despite needing only caller-visible data or guarded helpers.
- **Build safety:** Cloudflare preflight deleted `src/proxy.ts` automatically
  and could write environment overrides before rejecting native Windows. The
  preview command also bypassed the normal build's OG patch step.
- **Tooling correctness:** typed ESLint rules applied to JavaScript configs
  without a TypeScript parser. Performance-advisor metadata treated PostgreSQL
  `name[]` as a JavaScript array and did not recognise safe non-null FK indexes.

## 2. Root causes

Schema drift was hidden by error-to-not-found conversion. Callback state changes
spanned independent requests, with a timing heuristic standing in for durable
idempotency. Body validation happened after allocation and used characters
instead of UTF-8 bytes. Logging included raw request identifiers and URLs. Draft
validation did not match database types, and hex decoding was more permissive
than the signature format. Git file enumeration excluded untracked source.

## 3. Changes made

- Replaced separate KYC store operations with one service-only transactional
  RPC. Database failures return HTTP 500 for provider retry; terminal duplicate
  deliveries return HTTP 200 without reapplying changes. Unknown references
  retain the existing acknowledgement behavior.
- Callbacks during incomplete upload publication now raise a retryable database
  error without committing provider state or audit. A retry after publication
  applies once. Artifact-first locking matches retention's deletion cascade;
  newer/superseded uploads and staff decisions remain protected.
- Added a shared bounded stream reader, cancellation on oversize input, and
  byte-based limits. Applied it to shared JSON parsing, drafts, CSP reports, KYC
  callbacks and Ozow callbacks. Signed body content remains unchanged.
- Added database-compatible draft validation and exact 64-character HMAC
  validation. Production environment configuration also blocks the explicit
  unsigned local development bypass.
- Sanitized CSP URLs, removed full URLs from CSRF failure logs, and removed raw
  rate-limit keys from warnings.
- Included untracked, non-ignored source files in secret scans. Git enumeration
  errors now fail the scan instead of yielding an empty pass.
- Changed the Sentry build configuration to its supported config import.
- Scoped typed ESLint rules to TypeScript extensions, preserving their checks.
- Made Cloudflare preflight reject unsupported proxy entrypoints without
  deleting them, and reject Windows before writing overrides. Preview now uses
  the full Cloudflare build pipeline.
- Corrected advisor metadata extraction to JSON arrays of index keys, excluding
  INCLUDE columns and preserving expression positions. Accept only valid
  single-column FK partial indexes with the exact indexed-column IS NOT NULL
  predicate; keep all raw findings and unresolved findings actionable.
- Documented migration order and callback reconciliation in `docs/RUNBOOK.md`.

## 4. Security issues fixed

Reduced oversized-request memory exposure, malformed signature acceptance,
token/contact leakage in logs, and secret-scanner coverage gaps. The new KYC RPC
is SECURITY INVOKER with a fixed search path, and execution is revoked from
PUBLIC, anon and authenticated roles; only service_role can execute it. Existing
authentication, CSRF/origin checks, rate limits, payment signature checks, RLS
and staff MFA remain active.

Three predicate functions are converted to SECURITY INVOKER in a separate
migration. Tests preserve staff MFA checks, reject forged staff JWT claims and
protect private organisation columns. Other privileged RPCs retain elevation
because their filtered reads or restricted helper access require it.

## 5. Performance improvements

KYC evidence, step risk and audit updates use one database RPC rather than
multiple sequential network requests. Oversized bodies are rejected during
reading rather than after full buffering. No latency or load benchmark was
performed, so no measured speedup is claimed.

## 6. Cleanup

Removed the obsolete KYC lookup/update helpers, the two-second duplicate
heuristic, the unused logging helper, and duplicated body-limit implementations.
The email palette remains internal after removal of its unused export. Replaced
callback tests that mocked each database mutation with HTTP boundary tests and
executable SQL checks. Corrected rate-limit comments to describe the existing
local fallback/fail-closed behavior.

## 7. Database changes

`supabase/migrations/20260930170000_atomic_kyc_provider_webhook.sql` adds
`apply_kyc_provider_webhook`. It locks provider and step rows, rejects ambiguous
references, preserves staff decisions and already replaced uploads, commits
provider evidence/risk/audit together, and uses a valid system UUID for
auditing. It does not rewrite existing data or replay previously acknowledged
callbacks.

The live database does not yet contain this RPC. Read-only checks found zero
pending provider results and zero ambiguous references at review time. Apply the
migration through the existing backed-up migration workflow before the
application deployment. Keep manual review active and reconcile provider
delivery history if a real asynchronous provider has been used.

`supabase/migrations/20260930180000_role_predicates_security_invoker.sql`
changes `has_role`, `has_any_role` and `organisation_id_is_listed` to SECURITY
INVOKER while preserving EXECUTE grants. The listing lookup reads only public
predicate columns and preserves all six programme lifecycle outcomes. It
requires the preceding MFA and organisation column-privacy migrations. This
migration has also not been applied to production.

## 8. Tests and checks

The initial `pnpm safety:review` passed all 12 steps. The post-fix
`pnpm safety:release` completed all 17 steps: 16 passed, while its earlier
dead-code scan recorded an unused email-palette export. That export was removed
and `pnpm knip` passed on rerun. The aggregate release artifact correctly
retains **FAIL**; the complete release command was not repeated after that
repair.

- Full regression run: **492 files, 4,504 tests passed**, followed by all
  database suites, including the new KYC SQL suite.
- New secret-scanner CLI regression: **1 test passed**; it also checks failed
  Git enumeration. This was added after the full regression run and verified
  separately.
- Lint, type checks, OpenAPI drift, import graph, duplication budget, preflight,
  source secret scan, production dependency audit, license policy and migration
  invariants passed. Final type, dead-code, and affected TS lint checks were
  rerun after the last changes.
- Production build passed. The subsequent fixture builds also passed with the
  updated Sentry import. Next/Edge dependency warnings remain; webpack cache and
  test-runner colour warnings were also emitted.
- Chromium and mobile-Chrome smoke: **31 passed, 3 intentionally skipped**
  (mobile-only cases on desktop and the desktop-only OTP case on mobile).
- Launch-flow bundle: **233 tests across 18 files passed**, plus **4
  billing/DSAR browser cases passed**.
- Launch environment validation passed. Live production edge preflight passed
  **10 checks, no warnings or failures**.
- Bundle guard passed: largest measured App Router entry chunk **106 KB**,
  against a **325 KB** failure threshold. The available manifest fallback
  measures entry chunks, not total first-load JavaScript.
- `git diff --check` and source secret scanning passed.

Evidence:

- Baseline review:
  [JSON](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review.json),
  [report](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review.md),
  [blockers](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-review-blockers.txt).
- Release run:
  [JSON](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-release.json),
  [report](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-release.md),
  [blockers](C:/Users/SENZO/Documents/verifymzansi/tmp/safety-gate/latest-release-blockers.txt).
- Repaired dead-code check:
  [final Knip log](C:/Users/SENZO/Documents/verifymzansi/tmp-audit-knip-final.log).
- Test details:
  [release log](C:/Users/SENZO/Documents/verifymzansi/tmp-audit-release-final.log),
  [scanner regression](C:/Users/SENZO/Documents/verifymzansi/tmp-audit-secret-cli-tests.log).

Additional checks already completed:

- Live schema verification and eight live smoke checks passed, including
  unauthenticated checkout and unsigned callback rejection.
- The isolated KYC SQL suite reproduces the missing-column bug and verifies
  migration reapplication, rollback/retry, duplicate deliveries, risk caps,
  stale uploads, staff decisions, audit writes and service-only access. PGlite
  serializes connections; this is not a multi-client PostgreSQL load test.
- Additional SQL regressions cover callback-before-step, callback-between-step
  and-session, missing canonical pointer, no audit on retry, successful retry
  after publication and superseded-artifact evidence handling.
- The permanent secret-scanner CLI regression uses a temporary Git repository to
  confirm that unstaged synthetic secrets are detected, ignored credential files
  stay excluded, matched values are not printed, and Git errors fail closed.

## 9. Remaining risks and limitations

- Strict live Supabase security advisors reported 17 actionable findings
  concerning exposed SECURITY DEFINER functions. The new privilege migration
  addresses six grants across three functions once applied. Remaining staff
  helpers enforce current-user/MFA access; organisation helpers intentionally
  filter public/authorised data. Live findings remain unchanged until rollout;
  remaining elevation must be assessed against these policy boundaries.
- Provider-native leaked-password protection is plan-blocked. Application routes
  use the existing HIBP check, but this does not establish protection for direct
  calls to Supabase Auth.
- The corrected strict performance advisor retains all 44 findings: 37 accepted,
  seven actionable (15 nullable-FK false positives corrected). One unresolved
  restriction index has a matching query; six have no current consumer found,
  including three expired-content indexes whose former retention deletes are now
  intentionally disabled. No exact duplicate public indexes were found and no
  indexes were dropped. Usage history and representative query plans are needed
  before proposing removal.
- Real paid checkout, vendor callback delivery, outbound SMS/email delivery,
  sustained load and every browser were not exercised. Local browser suites use
  the repository's test fixtures. The production service still runs the previous
  code until deployment.
- A real asynchronous KYC adapter is not implemented. It must persist a pending
  reference before callback delivery is possible; unknown references still
  receive the deliberate existing acknowledgement. Publication-window tests
  apply once the provider reference exists.
- Next.js still warns about the middleware convention. The installed Cloudflare
  adapter marks Node middleware/proxy support experimental; migrating this
  authentication boundary requires adapter and deployed-runtime validation.
- Historical member restriction/effect queries lack matching history/owner
  indexes. This is a concrete query/index mismatch at scale; no current slowdown
  has been measured. Benchmark representative plans before adding indexes.
- Review combined targeted workflow tracing with repository-wide automated
  checks; it does not prove the absence of all defects in every source file.

## 10. Recommended follow-up

1. Regenerate a complete passing release report, apply the pending migrations,
   deploy through the normal release process, and run post-deployment smoke
   tests. Monitor callback HTTP 500s and reconcile any previously acknowledged
   provider deliveries.
2. Recheck remaining SECURITY DEFINER findings against the access policy and
   enable provider-native leaked-password protection when the plan permits.
3. Observe index usage over a representative workload before proposing removal;
   measure request latency and query plans before further performance changes.
4. Exercise signed provider callbacks, SMS/email delivery and payment settlement
   in authorised integration environments, followed by a multi-client callback
   replay test against PostgreSQL.

## 11. Migration rollout — 30 September 2026

Both pending migrations (`20260930170000` and `20260930180000`) were applied
successfully to the linked remote database using `pnpm supabase:db:push:safe`. A
subsequent `db push --dry-run` reports the remote database is up to date, with
no pending migrations. The workflow completed a supplemental public-data REST
export before applying the migrations; this is not a consistent,
restoration-verified database backup.

The isolated KYC SQL suite passed, and all 121 targeted regression tests passed.
The PGlite query-plan regression needed a larger startup timeout on this Windows
host; its timeout is now 30 seconds, with its assertions unchanged. The earlier
HOLD and unapplied-migration statements describe the original audit state.
Deployment verification and the operational limitations above remain separate
from the completed database migration rollout.
