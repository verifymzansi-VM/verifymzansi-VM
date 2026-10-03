# VerifyMzansi audit findings and coverage — 3 October 2026

**Assessment: FAIL / release NO-GO.** The tooling upgrade and confirmed local
fixes are implemented. Security/license findings and required missing evidence
remain blocking. This report synthesizes separate scoped runs; it does not
represent a successful full release gate.

## Follow-up double check

The follow-up review found and corrected seven gaps: the Git-ignored lint
baseline, quoted credential assignments missed by the scanner, unreviewed custom
SPDX references, cached Worker output bypassing sanitization, a
platform-dependent metadata-image lint suppression, an incorrect coverage
artifact reference, and unrecognized workerd/esbuild warning prefixes.
Regression fixtures cover the policy/scanner/build-hook changes; full lint now
reports the same 30 existing warnings on Windows and Linux.

The refreshed application run passed 4,844 tests across 524 files, with one
platform-specific skip. Core coverage passed 4,766 tests across 519 files, with
one skip, at 79.22% statements, 69.29% branches, 85.57% functions and 80.77%
lines. All 13 PGlite lanes passed again. Final tooling tests passed 21/21 on
both platforms. Type checking, OpenAPI drift, Knip, imports, duplication,
contracts, canaries and strict secret scanning passed; format retains its 15
exact existing findings.

The isolated Linux Cloudflare build completed with synthetic configuration. Its
sanitizer removed 12 private/config names and the strict scan examined 12,387
text files with zero read failures. Build warnings remain visible, including
adapter compatibility/DO warnings, Sentry Edge warnings and generated
nullish-coalescing warnings. Build completion does not verify Worker runtime
bindings or genuine provider delivery. The prior 50-scenario isolated browser
result remains applicable: this follow-up changes tooling and removes a lint
comment from the metadata image, without changing application behavior.

Dependency and license gates still fail, and the refreshed read-only Supabase
security-advisor gate still fails. Docker, authenticated KYC browser coverage,
genuine Ozow delivery, Worker binding integration and deployment provenance
remain incomplete. No commit or push was performed because the user's condition
for doing so has not been met. See
[the follow-up machine-readable evidence](audit-evidence/double-check-2026-10-03.json)
for source runs, superseded attempts, final regression logs and remaining
blockers. The earlier snapshot below is retained as historical evidence.

Base commit at final verification: `a4a0c5f24f09e023e755b1b12a3268817e1a55f8`,
with the recorded working-tree changes. The original inspection/baselines used
`5d03fba1296db20cab7e456fbe51ba294f6439d9`. Two commits made during the
usage-limit pause were preserved. Linux application tests were refreshed from
the current commit and working snapshot; later reporting, registry, scanner and
Cloudflare tooling edits received focused tooling/static verification. No
production state was changed.

## Deliverables and interpretation

CI follow-up on commit `1abcb0748eb31e93ec959bfe35312eda3ba4666a` corrected the
Supabase status parser to handle trailing CLI update notices and reordered the
commit hook so Prettier runs after ESLint fixes. Six changed files were
formatted rather than expanding their debt baseline. All 22 tooling tests passed
on Windows and Linux, locally and in CI. The isolated PostgreSQL job then passed
the full 198-migration history, PostgREST RLS, final RPC grants and independent
reconciliation/KYC callback races. Real PostgreSQL payment
fulfillment/cancellation races remain a separate coverage limitation. The static
job now fails only on dependency and license findings; format and lint match
their remaining reviewed baselines. See
[the CI evidence](audit-evidence/ci-verification-2026-10-03.json).

[Machine-readable evidence](audit-evidence/audit-evidence-2026-10-03.json)
contains the complete registry inventory, all package command classifications,
scope/exclusion/dependency/test/policy references, latest scoped observations,
source run IDs, platforms, timestamps, skips and residual backlog. Timestamped
runner reports and redacted raw logs remain under `tmp/safety-gate`,
`tmp/isolated-browser`, `tmp/isolated-db`, and the domain audit directories.

The [inventory canvas source](audit-evidence/audit-inventory.canvas.tsx) and
[offline interactive inventory](audit-evidence/audit-inventory.html) allow
filtering and examination of each check. The shared Canvas skill targets a
managed `.cursor` directory/native renderer absent on this host. Its source was
type-checked against the bundled SDK; the HTML companion provides a working
local view. Neither artifact makes network requests.

PASS attests the executed scope only. WARN retains advisory findings or exact
existing non-security debt. UNAVAILABLE, SKIPPED and TIMED_OUT do not attest
controls. Required incomplete checks produce INCOMPLETE/nonzero exit; a required
defect takes precedence as FAIL. Partial runs and dry runs cannot claim release
readiness. Progress checkpoints remain INCOMPLETE while checks are pending,
including after an interrupted process.

## Confirmed fixes and regression evidence

- Shared local/CI/release/payment/KYC registry replaces divergent gate lists. It
  deduplicates full versus domain unit execution, validates flags, bounds
  subprocesses, kills owned process trees on timeout, redacts sensitive output,
  records actual executed counts and preserves version-2 timestamped artifacts.
  Tooling fixtures cover missing tools, thrown execution, timeouts, partial and
  dry scopes, fail-fast remainders, warning propagation and required skips.
- License parsing rejects empty/malformed objects, malformed package rows,
  unknown expressions and restricted branches of compound SPDX expressions. The
  existing FFmpeg 0.12.9 exception is pinned to its corresponding-source notice,
  now Git-allowlisted so fresh CI checkouts retain its evidence.
- Dependency audits reject invalid/nonfinite counts and fail incomplete on
  network failure, including the legacy opt-out. Compatible dependency repairs
  removed the initially observed advisories. Jimp's only asset-tool use now uses
  the already-installed Sharp; synthetic watermark tests verify sizes,
  transparent containment and named variants. The destructive live-asset refresh
  command was not executed.
- Secret scanning uses NUL-delimited filenames and bounded streaming, detects
  large single-line fixtures, fails on read errors and limits fixture exceptions
  to the actual matched deterministic value. Binary files and transient Next
  compiler caches are explicitly counted exclusions. Compiled executable
  artifacts remain scanned. The legacy generated 64-hex hash exception is
  explicit; named encryption/HMAC assignments still block in compiled output,
  with a regression proving this. Baseline fingerprints use base64url digests to
  avoid masquerading as raw credential-like hexadecimal strings.
- The stronger named-key rule found configured encryption/HMAC values in an old
  `.open-next/cloudflare/next-env.mjs` artifact (file dated 25 July). OpenNext's
  installed extractor serializes `.env*` settings into that module. The
  maintained Cloudflare build now sanitizes it before the strict scan: only
  non-sensitive `NEXT_PUBLIC_` settings remain; server settings come from
  runtime bindings. The old local fallback was sanitized without displaying
  values or changing `.env*` files/remote keys. Parser/malformed-mode/private
  export fixtures passed. Cloudflare preflight now also preserves operator
  production settings while neutralizing development bypasses, rather than
  replacing their entire local environment file; an isolated fixture verifies
  preservation and unknown-flag rejection. A full isolated Worker build and
  runtime-binding integration remain unverified; the read-only adapter config
  check passed.
- Fresh duplication reports must have valid finite totals, actual src/scripts/
  workers coverage and current timestamps. Exact existing fragments and budgets
  are checked identically in local and CI runs. Deliberate Knip, import-cycle,
  duplication and secret fixtures fail and then pass after correction.
- Knip recognizes installed Next.js metadata and proxy conventions; workers and
  executable tooling participate in lint/import/duplication/security scans.
  JSX-specific ESLint rules apply to JSX files. CLI console output remains
  allowed. Security errors and new quality findings cannot be baselined.
- Bundle checks reject missing/unreadable files and malformed manifests. Local
  and CI use the same 275 KB warning / 325 KB failure entry budgets. This App
  Router fallback measures emitted entry chunks, not total first-load
  JavaScript. Performance and advisor parsers reject invalid/empty output;
  advisories remain visible. HTTP smoke cannot pass degraded health or an
  unsigned successful KYC callback. Live-page omissions exit incomplete.
  Public/dev probes validate flags/timeouts; dev-server cleanup runs on failure.
- Ozow preflight validates the official HTTPS origin against the selected
  environment before transmitting credentials, and rejects redirects for both
  token and payment-method requests. Six invalid-destination regressions prove
  no fetch occurs. Existing Ozow runtime repair behavior was preserved.
- Runtime and contract KYC callbacks now share a strict schema: finite 0–100
  scores, missing or nullable unknown scores, bounded references/reasons and
  bounded serialized UTF-8 metadata. Approved/rejected fixtures use the same
  semantics. Unsupported provider configuration fails explicitly; production
  bypass and stub restrictions retain regression coverage.

## Local application and database evidence

- Refreshed Linux unit run: **4,841 passed across 524 files**, one Windows-only
  Cloudflare preflight test skipped. Core coverage: **4,763 passed across 519
  files**, the same platform skip. Coverage statements/branches/functions/lines:
  **79.22 / 69.29 / 85.57 / 80.77%**. Existing thresholds were retained.
- All **13 PGlite lanes passed**: trials, commercial, payments, media/quota,
  visits, staff roles, decisions, queue claims, operation jobs, DSAR, dashboard,
  admin lists and KYC. Coverage-excluded domain suites execute in the full unit
  lane and required CI payment/KYC lanes. These are selected-schema regression
  results, not independent-session PostgreSQL or deployed migration proof.
- Final tooling regression command passed on Windows and WSL/Linux, **19 tests**
  on each. Windows/Linux runner behavior covers command invocation, errors,
  timeouts and dry plans. CI adds both platform lanes.
- Isolated production build and required route-manifest checks passed. Critical
  Chromium desktop/mobile flows: **50 passed, zero failed or flaky**. Two
  mobile-only scenarios skipped on desktop passed on mobile. No selected
  scenario remained skipped across both projects.
- Billing/add-on/DSAR browser scenarios use synthetic providers and local test
  identities. KYC browser coverage proves anonymous and callback boundaries;
  authenticated document submission, evidence access and reviewer decisions
  still need expanded isolated fixtures. `kyc-auth-browser` records this as a
  required unavailable release/domain check. WebKit/mobile Safari remain
  quarantined; the full Firefox matrix was not executed locally.
- Original bundle budgets passed; largest measured entry was **95 KB**. The
  actual emitted FFmpeg worker loaded self-hosted WASM and converted a synthetic
  MOV to a 1,964-byte MP4 without uploads.
- Lighthouse audited four isolated public pages. Accessibility, best practices
  and SEO scored **1.00** on all four. Performance scores **0.37 / 0.55 / 0.61 /
  0.59** were below the existing 0.70 advisory minimum. These synthetic local,
  resource-contended measurements do not describe production performance.
- Static format/lint/types/OpenAPI/Knip/import/duplication/contracts/database
  invariant/canary checks passed apart from visible existing non-security
  baselines: **15 formatting files, 30 lint warnings, 34 clone pairs / 820
  duplicate lines**. The raw `jscpd` command generates a report; `jscpd:check`
  enforces the budget. Legacy `stability:check` intentionally keeps its stricter
  zero-warning lint behavior.

Ozow contracts include the official full and thin `transaction.complete`
envelopes and distinct merchant/request/transaction identifiers. Examined unit
and PGlite suites cover timestamp/signature/site/environment/amount/currency
rejection, duplicates, cancellation and reconciliation, pagination, token
refresh, lost RPC responses, outages, server pricing, ownership, entitlements
and invoices. This is synthetic evidence, not genuine provider delivery.

The KYC trace follows session creation, upload validation and cleanup, envelope
encryption, HMAC ID hashing, fraud signals, callback fencing, reviewer roles,
high-risk decisions, private evidence access/logging, retention and recovery.
See [the KYC guide](kyc-audit-guide.md) and
[encryption/recovery guide](encryption-recovery.md) for concrete source and
operational boundaries. Manual review remains the configured workflow; no KYC
vendor was introduced.

## Read-only observations and release blockers

Production-mode workstation preflight passed authenticated service reachability,
including Ozow OAuth/payment-method access. Launch config, Cloudflare
secret-name/posture checks, deployed schema and deep deployment health passed.
These observations do not establish deployed secret values, exact migration
grants, signed notification delivery or current-commit rollout.

1. **Dependency follow-up:** the registry still lists `braces@3.0.3` under
   [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). Its
   parser and all AST walkers now use the reviewed upstream depth-limit
   backport, with 904 upstream tests passing. Source/patch hashes, registration
   and runtime guards are verified for installed copies; a missing or modified
   fix still blocks. Raw registry evidence is retained and the verified fix is
   reported as WARN. Other security findings still block. Replace the backport
   with a reviewed official release when available.
2. **P1 — License policy:** the owner confirmed a one-person company, so the 11
   Remotion records are now reviewed under its free license for marketing
   video/image rendering. `scripts/license-reviews/remotion.json` records the
   eligibility and terms; the gate limits this approval to reviewed package
   names, version 4.0.529 and the unchanged license text. All 23 tooling tests
   pass on Windows and Linux, including ineligible companies, changed terms,
   unreviewed packages and future versions. Sentry CLI 2.58.6 has now also been
   reviewed for its permitted internal build/source-map use, with fixed package
   names and unchanged installed terms. The license check passes on Windows and
   Linux; other restricted/custom licenses have no blanket exception.
3. **P1 — Supabase advisor:** 17 observations: three RLS tables without
   policies, 13 anon/authenticated SECURITY DEFINER grants and one plan-blocked
   leaked password protection finding. Examination shows intentional
   deny-by-default tables and public/caller-scoped RPCs with pinned search paths
   and visibility/ role checks. Advisor observations are not automatically 17
   exploitable defects. Exact live definitions/grants still need final
   PostgreSQL review; strict advisor remains FAIL with no hidden security
   baseline. See
   [structured observations](audit-evidence/supabase-security-observations.json).
4. **P1 — PostgreSQL payment race coverage:** Docker remains absent locally and
   in WSL, but CI has now passed the isolated full-migration, grants/RLS and
   independent HTTP callback/claim checks. Real-PostgreSQL fulfillment and
   cancellation race fixtures still need expansion. No production SQL was
   replayed; the separate migration verification confirmed all 198 migrations
   already applied remotely.
5. **P1 — Genuine Ozow delivery and authenticated KYC browser evidence:**
   Signing-secret provenance/genuine signed delivery remain unverified.
   Authenticated synthetic KYC browser fixtures require expansion. Both are
   explicit required missing evidence.
6. **P1 — Worker bindings and artifact history:** the follow-up isolated Linux
   Cloudflare build passed, including sanitization and strict scanning. Verify
   runtime bindings without compiling private settings into the fallback module.
   Review whether prior artifacts containing local keys were distributed and
   plan any necessary rotation with encrypted-data recovery evidence. A local
   build artifact alone does not prove public exposure; no rotation was
   performed here.

Deployment commit/CI verification is UNAVAILABLE without a deployed SHA,
repository and GitHub read token. CodeQL is unavailable locally and conditional
in CI; a disabled job does not count as coverage. HTTP/perf/k6/live-browser load
probes were excluded where they require POSTs, authenticated side effects or a
dedicated load target. Email DNS has visible MX/DMARC warnings; advisor index
findings remain advisory. Missing tools/configuration never become PASS.

## Skills, CI and residual work

Four project skills are maintained and Git-allowlisted: security review, release
readiness, payments and KYC. Their names, commands, scope reporting and guide
references are regression-tested. Shared personal skills and vendored
next-browser instructions were inspected without editing them. The vendored
next-browser package remains 0.2.0 with an older canary dependency snapshot; the
installed CLI was already 0.7.1. `skills-lock.json` retains upstream
`vercel-labs/next-browser` provenance. The old vendor snapshot and Canvas host
path assumptions are reported separately from executable CLI results. Several
shared authoring/configuration skills also reference Cursor `.cursor` paths and
tool names; they need host-specific verification before use here. The Automate
skill assumes an editor handoff. These shared instructions were reported rather
than rewritten or invoked for this repository audit.

CI uses shared registry partitions, strict license/dependency gates, required
duplication budgets, full unit/coverage/PGlite lanes, isolated database/browser
lanes, payment/KYC regressions and Windows/Linux tooling tests. YAML parsed
successfully. A pushed CI run and branch-protection changes were not performed.
The legacy mutation command remains an alias for security canaries; no mutation
coverage score is claimed.

The machine-readable backlog records priority, owner and acceptance criteria.
Resolve the P1 groups above first. P2 work is deployment provenance,
CodeQL/browser coverage, advisory performance/DNS/index follow-up, reduction of
exact non-security debt, and separately planned major upgrades. Sentry, ESLint,
Vite/Vitest, Svix, Tailwind and TypeScript major migrations were deferred.
Refresh vendor skills through their upstream mechanism, without hand editing.
Wrangler is pinned to a compatible version permitted by the existing minimum
release-age policy; that install guard was retained.

No real payment, customer document submission, deployment, production migration
or remote configuration mutation was performed. Any later rollout or provider
test requires a separate, concrete scope.
