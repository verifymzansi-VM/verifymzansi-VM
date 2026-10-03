# VerifyMzansi audit tools

The policy source is `scripts/lib/check-registry.ts`. `safety:review`,
`safety:ci-review`, `safety:release`, `payments:audit` and `kyc:audit` use it.
`audit:inventory` writes a plan with commands, scopes, exclusions,
prerequisites, tests and evidence locations. CI partitions select registry IDs
with `--checks=`. Within one audit a check runs once; full unit execution
subsumes domain unit lanes.

Reports use schema version 2 and preserve `verdict`, timestamps, results/steps,
failedSteps, softFailedSteps and the existing artifact directories. Each run has
a unique ID, commit, working-tree snapshot, selected IDs, target description,
tool versions, skips, warnings and redacted log locations. Timestamped reports
are preserved alongside latest JSON/Markdown/blocker files. `stepsExecuted`
counts attempted subprocesses, including warnings, failures and timeouts. Each
in-progress run also writes `progress.json` with pending checks and an
INCOMPLETE assessment, so an interruption cannot leave a success claim.

## Interpretation

- PASS: the selected executable check completed successfully.
- FAIL: a required executable check found a defect.
- WARN: an approved advisory failure or a visible command warning.
- SKIPPED: explicit omission or fail-fast remainder; reason recorded.
- UNAVAILABLE: missing executable/configuration/evidence or child exit 2.
- TIMED_OUT: the process tree exceeded its bounded execution time.
- DRY_RUN: a plan; zero executed checks, zero verified controls.

Required missing/skipped/timed-out checks produce INCOMPLETE and nonzero exit.
FAIL takes precedence when both a defect and incomplete checks exist. A scoped
`--checks=` run attests only those checks and cannot establish release
readiness. `--local-only` keeps omitted external requirements visible.
`--skip-optional` cannot omit payment, KYC, contract, browser or isolated
database requirements. `--fail-fast`, `--dry-run`, `--help` and bounded
`--timeout-ms=` are also supported; unsupported flags fail with a report.
Credentials are never written into reports.

## Quality baseline

The license check records Remotion 4.0.529 separately in
`scripts/license-reviews/remotion.json`. The owner confirmed a one-person
company on 3 October 2026, and the installed
[Remotion terms](https://www.remotion.dev/license) permit its marketing
video/image rendering use under the free license. The exception requires the
recorded eligibility, exact reviewed package names and version, and an unchanged
license-text hash. Sentry CLI 2.58.6 has a separate package/use-specific review
in `scripts/license-reviews/sentry-cli.json`: its FSL terms permit this internal
build/source-map use. Exact package names, versions and installed terms are
verified; competing use, changed terms and other FSL packages remain blocked.

`braces@3.0.3` uses the reviewed depth-guard backport in `patches/`, pinned to
[upstream proposal 72](https://github.com/micromatch/braces/pull/72) and its
immutable commit. The audit preserves the raw registry advisory and reports WARN
only after verifying patch registration, provenance, installed source hashes and
depth rejection for every discovered installed copy. Missing, modified or
additional unpatched copies keep the finding blocking. Other advisories,
inconsistent counts and network failures cannot use this mitigation.

Security defects are never baselined. Existing duplication is recorded in
`scripts/audit-baselines/duplication.json`, including fragment/file-pair hashes
and budgets. A fresh scan must cover src, scripts and workers. Empty/malformed
reports, nonfinite totals, missing roots, new fragments and budget regressions
block both local and CI gates. Baseline updates require review of exact debt;
environment variables cannot increase the budget. Lint/Knip failures remain
visible until a precise non-security baseline or correction is reviewed.

License reports fail closed on JSON/shape errors, unknown expressions and
restricted license terms. The existing FFmpeg 0.12.9 exception requires the
vendored notice and corresponding-source URL. Unknown/custom Remotion licenses
and FSL packages require policy review; they are not silently approved.
Networkless dependency checks exit 2 even with the legacy opt-out enabled.
Secret scans stream text files, enumerate NUL-delimited Git filenames and fail
on unreadable paths. Binary exclusions and inline fixture exceptions remain
limited evidence rather than proof of no secrets anywhere on disk.

## Verification boundaries

PGlite tests execute selected schema/functions and supplement static migration
checks. `test:db:isolated` starts a uniquely named local Supabase stack, applies
the complete migration history and checks final RPC grants, PostgREST RLS and
independent HTTP session races. It never uses application database credentials.
Docker absence is INCOMPLETE. The new full-state lane needs execution on Linux;
its local non-execution is not PostgreSQL proof.

`test:browser:isolated` snapshots the working tree into a detached checkout
under `tmp/isolated-browser`, installs the frozen dependencies there, builds and
runs critical Chromium flows with deterministic providers, and records bundle
checks at the same 275/325 KB budgets as CI. Desktop and mobile Chrome execute
the same selected suite. It retains the checkout and artifacts for review. Skips
without a passing instance of the same scenario in another project produce
UNAVAILABLE. KYC browser coverage currently exercises anonymous and callback
boundaries; authenticated submission/reviewer decisions remain incomplete.
WebKit/mobile-safari remain quarantined and are not inferred covered. The active
checkout's `.next` directory is not built by this audit runner.

Lighthouse and k6 remain advisory and cannot replace security or functional
gates. CodeQL is opt-in through `ENABLE_CODEQL`; a skipped workflow is no
analysis. Read-only deployment observations need credentials and say nothing
about a genuine signed Ozow delivery. No audit performs a payment, production
migration, customer document submission, deployment or remote configuration
change.

The Cloudflare build calls `sanitize:cloudflare-env` after OpenNext generation
and before strict scanning. OpenNext reads `.env*` files into its generated
fallback module; the sanitizer retains only public settings and removes private
server configuration. Supply server settings through Worker runtime bindings.
The Wrangler build hook also sanitizes and strictly scans cached artifacts
before reusing them; missing or malformed fallback exports block reuse.
`cloudflare-adapter` validates local configuration without writes;
`cloudflare-build` remains required incomplete until an isolated Worker build
and binding integration have been verified. Do not infer this from the ordinary
Next.js browser build.
