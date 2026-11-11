# Branch protection and deployment checks

The repository's default branch is `main`. **Merging into `main` releases to
production**: CI runs on the merge commit and `.github/workflows/deploy.yml`
deploys once that CI run succeeds. Changes therefore reach `main` only through a
pull request whose required checks pass.

## What is enforced

| Date       | State                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-02 | Ruleset "Protect main" (id 24360296) blocks deleting `main` and force pushes. Pull requests and status checks are **not** required.                                           |
| 2026-11-07 | Reviewed ruleset file `.github/rulesets/protect-main.json` prepared. It adds "require a pull request" and the required checks below. Not enforced until the owner applies it. |
| 2026-11-10 | Ruleset file adds `Visual regression (chosen frontend)` and `foundation-native` to the required checks. Not enforced until the owner applies it.                              |

Update this table when GitHub's enforced ruleset changes. Verify at any time,
read-only:

```bash
pnpm check:branch-ruleset -- --live
```

It passes only when the live ruleset matches the reviewed file.

## The reviewed ruleset

Source of truth: `.github/rulesets/protect-main.json`. A unit test
(`scripts/branch-ruleset.test.mjs`, part of `pnpm test:tooling`) fails when a
required check names a job that is renamed, removed or made push-only, because
such a check would block every pull request.

- **Target:** the default branch, `active`, **no bypass actors**, so nobody,
  including an administrator or an agent using an administrator's token, can
  push to `main` directly.
- **Pull request required,** with **0 required approvals**: the owner opens,
  reviews and merges from the same account, and GitHub does not let an author
  approve their own pull request. Merge methods: squash or merge commit.
- **No force pushes, no deletion** of `main`.
- **Required checks** (GitHub Actions only, `integration_id` 15368):
  - `foundation-replay`: rebuilds the production database schema from
    `database/foundation/` and compares its fingerprint, the readable
    `database/foundation/current/` snapshot and the API manifests and types
    (`database/foundation/README.md`).
  - `foundation-sql-lint`: runs plpgsql_check over every PL/pgSQL function of
    that rebuilt schema in a throwaway local Postgres 17 and compares the result
    with `database/foundation/lint-baseline.json`.
  - `lint-type-security`: lint, typecheck, OpenAPI/import checks, secrets,
    dependencies, licences and database invariants.
  - `knip`: dead code and dependencies.
  - `Duplication budget` (job `jscpd-advisory`; the historical ID does not make
    it advisory).
  - `Secret scan (Gitleaks)`, `Semgrep static analysis` (new findings only),
    `Dependency vulnerabilities (OSV-Scanner)`, and CodeQL's
    `Analyze (javascript-typescript)`.
  - `Foundation Worker runtime`: builds and exercises the Worker artifact.
  - `unit-api-contract`: every unit test once (the coverage run plus the few
    DOM-heavy suites it leaves out), PGlite lanes and contracts.
  - `payment-kyc-regressions`.
  - `audit-tooling-platforms (ubuntu-latest)` and
    `audit-tooling-platforms (windows-latest)`.
  - `build-route-verify`, `bundle-analysis`.
  - `db-rls`.
  - `e2e-smoke (chromium)`, `e2e-smoke (mobile-chrome)`, `launch-flows-bundle`,
    and `e2e-full-matrix` (chromium, firefox, mobile-chrome).
  - `Visual regression (chosen frontend)`: compares the main public screens with
    the approved pictures of the chosen frontend.
  - `foundation-native` (workflow "Foundation native"): the native database
    suite. It starts on every pull request to `main`; when a pull request does
    not touch the suite's inputs the job ends green without starting Docker, so
    the check never waits forever.
- **"Require branches to be up to date" is off.** Turning it on would force a
  rebase and a fresh CI run (about 48 minutes) after every merge. It is safe to
  leave off because the deploy also requires a successful CI run on the merge
  commit itself: if two green pull requests conflict in behaviour, `main`'s CI
  fails and nothing is deployed.

Every CI job that runs on a pull request is required, except
`lighthouse-advisory` (advisory, `continue-on-error`) and
`safety-gate-snapshot: plan only (runs no checks)` (a dry-run plan that executes
no checks). This keeps `main` deployable: the deploy needs the whole CI run on
`main` to succeed. `perf-baseline` and `k6-advisory` run only after a push to
`main` and cannot be required on pull requests; when no staging address
(`STAGING_APP_URL`) is configured they show as skipped, not as a success
(`Staging address configured` decides this in a job-level condition). Later
slices add their jobs here and to the ruleset file (foundation browser tests,
frontend ledger). `e2e-foundation` (workflow "E2E foundation") runs on every
pull request but stays optional until it has five green nights in a row. When it
becomes required, list only the aggregate check `e2e-foundation`: it passes only
when both per-project jobs, `e2e-foundation (chromium)` and
`e2e-foundation (mobile-chrome)`, passed.

## How the owner applies it

Either way takes a few minutes and can be undone in one click.

**GitHub website.** Settings → Rules → Rulesets → "Protect main" → replace its
rules with the ones in `.github/rulesets/protect-main.json`, or delete it and
use **New ruleset → Import a ruleset** with that file. Save.

**GitHub CLI** (updates the existing ruleset in place):

```bash
gh api -X PUT repos/verifymzansi-VM/verifymzansi-VM/rulesets/24360296 --input .github/rulesets/protect-main.json
```

Optional: Settings → General → "Allow auto-merge" lets a pull request merge
itself once every required check is green.

**Rollback:** Settings → Rules → Rulesets → "Protect main" → set enforcement to
"Disabled" (or re-apply the two original rules). No code changes.

## Coverage thresholds

The source of truth is `vitest.config.ts`. Regular core-coverage thresholds are
74% statements, 63% branches, 81% functions and 75% lines. Strict main-push
thresholds are 75%, 64%, 82% and 76%, respectively, selected by
`STRICT_COVERAGE`. The coverage lane excludes the sensitive UI suites listed in
`src/test/coverage-excluded-suites.ts`; CI runs them in their own lane
(`unit-coverage-excluded`) and the local blocking lane still runs them.

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

The "Update Visual Baselines" workflow pushes refreshed pictures to a
`bot/visual-baselines-<run>` branch for review; it never pushes to `main`.

## Evidence and secrets

Configure public build settings, Supabase service credentials and
deployment/provider secrets through GitHub Actions secrets; never place
privileged values in workflow source.

`STAGING_APP_URL` must identify an isolated environment. `PRODUCTION_APP_URL`
enables scheduled synthetic/deep-readiness monitoring. Missing configuration can
skip scheduled/advisory jobs, so confirm their actual execution rather than
interpreting an overall green workflow as proof of provider availability.

## Shared audit registry and required domain lanes

The maintained check policy is `scripts/lib/check-registry.ts`. CI partitions
must use its IDs and retain version-2 reports with skips and unavailable
results. There is no mutation testing; the former security canaries (four
assertions already made by unit tests) were removed. A missing/disabled CodeQL
job is explicitly unavailable security coverage. Required local omissions are
INCOMPLETE, never release GO.
