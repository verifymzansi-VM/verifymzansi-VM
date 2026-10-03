# Branch protection and deployment checks

The repository's default branch is `main`. Read-only checks on 1 October 2026
found no classic protection on `main`, no effective branch rules, and no
repository rulesets. This document describes required configuration; it does not
assert that GitHub has enforced it.

## Required configuration

Create a branch rule/ruleset for `main`. Require pull requests, approval from
another reviewer, resolved conversations, up-to-date status checks, and no force
pushes or branch deletion. Review and restrict administrator/bypass privileges.
Remote settings changes require the repository owner's approval.

Require the current CI jobs that run for pull requests:

- `lint-type-security`: lint, typecheck, OpenAPI/import checks, secrets,
  dependencies, licenses and database invariants.
- `knip`: dead-code/dependency scan.
- `jscpd-advisory`, displayed as `Duplication budget`: required reviewed budget;
  the historical job ID does not make it advisory.
- `unit-api-contract`: full unit/core coverage, PGlite, contracts and security
  canaries.
- `payment-kyc-regressions`: required domain units and payment/KYC PGlite lanes.
- `audit-tooling-platforms`: Windows/Linux runner regression matrix; confirm
  both displayed matrix contexts.
- `build-route-verify`: production build and critical route presence.
- `db-rls`: isolated Supabase database checks.
- `e2e-smoke`: desktop/mobile browser smoke.
- `launch-flows-bundle`: isolated critical browser build, routes and bundle
  budgets.

`safety-gate-snapshot` records a dry-run plan with zero executed checks. It is
not blocking-test or database verification evidence.

Confirm the exact displayed check contexts in GitHub before saving the rule. Do
not require push-only jobs on pull requests; that would prevent merging. The
full browser matrix runs in CI; the staging performance baseline runs after main
pushes. Advisory Lighthouse/k6 results do not replace mandatory checks. Do not
point staging load tests at shared production services.

## Coverage thresholds

The source of truth is `vitest.config.ts`. Regular core-coverage thresholds are
74% statements, 63% branches, 81% functions and 75% lines. Strict main-push
thresholds are 75%, 64%, 82% and 76%, respectively, selected by
`STRICT_COVERAGE`. The coverage lane excludes documented sensitive UI suites;
the blocking lane still runs those tests. This audit did not lower thresholds or
expand exclusions.

## Deployment enforcement

`.github/workflows/deploy.yml` requires successful main-push CI for the exact
target commit, including tag and manual deploys.
`scripts/check-deployment-ci.ts` reads GitHub's workflow API with
`actions: read`; missing, failed, cancelled, unrelated or unfinished CI fails
closed. A newer failed attempt is not hidden by an older successful run. Rerun
CI successfully before retrying deployment.

The automatic `workflow_run` path additionally checks source repository, branch,
event and conclusion. A release tag must target a commit already checked by main
CI. Direct manual CLI deployment remains an operator-controlled path and must
follow the launch/approval runbook. Restrict Cloudflare and GitHub credentials
to the intended deployment operators.

## Evidence and secrets

Retain `tmp/safety-gate/latest-ci-review-blockers.txt`, the JSON step results
and the uploaded CI artifacts for sign-off. Configure public build settings,
Supabase service credentials and deployment/provider secrets through GitHub
Actions secrets; never place privileged values in workflow source.

`STAGING_APP_URL` must identify an isolated environment. `PRODUCTION_APP_URL`
enables scheduled synthetic/deep-readiness monitoring. Missing configuration can
skip scheduled/advisory jobs, so confirm their actual execution rather than
interpreting an overall green workflow as proof of provider availability.

## Shared audit registry and required domain lanes

The maintained check policy is `scripts/lib/check-registry.ts`. CI partitions
must use its IDs and retain version-2 reports with skips and unavailable
results. Require `payment-kyc-regressions`, `db-rls` and the critical isolated
browser lanes in addition to static, coverage and blocking tests.
`test:mutation` remains an alias for security canaries and must not be presented
as mutation coverage. A missing/disabled CodeQL job is explicitly unavailable
security coverage. Required local omissions are INCOMPLETE, never release GO.
