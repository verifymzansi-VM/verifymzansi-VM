# Branch protection and deployment checks

The repository's default branch is `main`. **Merging into `main` releases to
production**: CI runs on the merge commit and `.github/workflows/deploy.yml`
deploys once that CI run succeeds. Changes therefore reach `main` only through a
pull request whose required checks pass.

## What is enforced

| Date       | State                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-02 | Ruleset "Protect main" (id 24360296) blocks deleting `main` and force pushes. Pull requests and status checks are **not** required.                                                                                                                                                                                                               |
| 2026-11-07 | Reviewed ruleset file `.github/rulesets/protect-main.json` prepared. It adds "require a pull request" and the required checks below. Not enforced until the owner applies it.                                                                                                                                                                     |
| 2026-11-10 | Ruleset file adds `Visual regression (chosen frontend)` and `foundation-native` to the required checks. Not enforced until the owner applies it.                                                                                                                                                                                                  |
| 2026-11-11 | The owner has applied the reviewed file: `pnpm check:branch-ruleset -- --live` reports that the live ruleset matches it, so pull requests and the required checks below are enforced.                                                                                                                                                             |
| 2026-11-11 | CI clean-up: removed the checks of deleted jobs (`Foundation Worker runtime`, `db-rls`, `payment-kyc-regressions`, `e2e-smoke (chromium)`, `e2e-smoke (mobile-chrome)`, `launch-flows-bundle`), each just before the pull request that deleted its job merged.                                                                                    |
| 2026-11-11 | Added `Workflow lint (actionlint)` and `Browser test build` after both jobs had run on `main`.                                                                                                                                                                                                                                                    |
| 2026-11-11 | Ruleset file adds `e2e-foundation` (it had passed on 11 consecutive `main` runs). Not enforced until the owner applies it, after the release-gate change is on `main`.                                                                                                                                                                            |
| 2026-11-11 | Stub browser suite retired (owner decision): the ruleset file removes `e2e-full-matrix (chromium)`, `e2e-full-matrix (firefox)`, `e2e-full-matrix (mobile-chrome)` and `Browser test build`; `e2e-foundation` stays required. The owner edits the live ruleset just before that pull request merges (see "Switching the required browser check"). |

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
- **Pull request required,** with **0 required approvals**: pull requests are
  opened and merged from the same account, and GitHub does not let an author
  approve their own pull request. A pull request merges only when its required
  checks pass and its independent review has no open blocker. The owner merges
  it, or the coordinator (the one agent session the owner designates) does under
  the owner's standing approval, given in writing and withdrawable at any time.
  That approval does not cover a pull request with a pending database update,
  which merges only after the owner approved the update (and, for an apply-first
  update, after it is applied in production), nor a frontend change, which still
  needs the owner's sign-off (`AGENTS.md`). Merge methods: squash or merge
  commit.
- **No force pushes, no deletion** of `main`.
- **Required checks** (GitHub Actions only, `integration_id` 15368):
  - `foundation-replay`: rebuilds the production database schema from
    `database/foundation/` and compares its fingerprint, the readable
    `database/foundation/current/` snapshot and the API manifests and types
    (`database/foundation/README.md`). It also checks access-policy invariants
    on the rebuilt schema: row level security on every table, no PUBLIC execute,
    no SECURITY DEFINER in `api`, a fixed `search_path` on every function,
    `anon`/`authenticated` execute on an `internal` function only when an `api`
    function reaches it (reviewed exceptions listed), and no functions in
    `private` (`scripts/lib/foundation-replay.mjs`).
  - `foundation-sql-lint`: runs plpgsql_check over every PL/pgSQL function of
    that rebuilt schema in a throwaway local Postgres 17 and compares the result
    with `database/foundation/lint-baseline.json`. Like `foundation-native`,
    when a pull request touches none of its inputs (listed in `ci.yml`; a
    tooling test keeps the list covering every file its scripts import or read)
    the job ends green without starting Postgres. On `main` it always runs in
    full.
  - `lint-type-security`: lint, typecheck, OpenAPI/import checks, secrets,
    dependencies and licences.
  - `knip`: dead code and dependencies.
  - `Duplication budget` (job `jscpd-advisory`; the historical ID does not make
    it advisory).
  - `Secret scan (Gitleaks)`, `Semgrep static analysis` (new findings only),
    `Dependency vulnerabilities (OSV-Scanner)`, and CodeQL's
    `Analyze (javascript-typescript)`.
  - `Workflow lint (actionlint)`: checks the workflow files themselves.
  - `unit-api-contract`: every unit test once (the coverage run plus the few
    DOM-heavy suites it leaves out) and contracts.
  - `audit-tooling-platforms (ubuntu-latest)` and
    `audit-tooling-platforms (windows-latest)`: the tooling tests
    (`pnpm test:tooling`) on Linux and Windows.
  - `build-route-verify`: builds the Worker, starts it in workerd, checks its
    size and routes (including the payment and KYC callbacks, verification start
    and pricing in the route manifest), and keeps the runtime proof (artifact
    `foundation-worker-runtime`). `bundle-analysis`.
  - `e2e-foundation` (workflow "E2E foundation"): the browser tests of the
    restored website against the private local foundation test copy
    (`e2e/foundation/`, `playwright.foundation.config.ts`), in chromium and
    mobile-chrome. Only the aggregate job is required: it passes only when both
    per-project jobs, `e2e-foundation (chromium)` and
    `e2e-foundation (mobile-chrome)`, passed. It replaced the retired stub
    suite's `e2e-full-matrix` and its `Browser test build` on 2026-11-11.
  - `Visual regression (chosen frontend)`: compares the main public screens with
    the approved pictures of the chosen frontend, served from the private local
    foundation test copy, with the browser in the pinned Playwright image
    (`scripts/foundation-visual.mjs`).
  - `foundation-native` (workflow "Foundation native"): the native database
    suite. It starts on every pull request to `main`; when a pull request does
    not touch the suite's inputs the job ends green without starting Docker, so
    the check never waits forever.
- **"Require branches to be up to date" is off.** Turning it on would force a
  rebase and a fresh CI run (about 48 minutes) after every merge. It is safe to
  leave off because the deploy also requires a successful CI run on the merge
  commit itself: if two green pull requests conflict in behaviour, `main`'s CI
  fails and nothing is deployed.

A newer push to a pull request cancels that pull request's older CI run; a run
on `main` is never cancelled, so every release commit gets a complete result.
Every job has a time limit of about one and a half times its usual longest run.

Every CI job that runs on a pull request is required, except
`Workflow security audit (zizmor, advisory)` (advisory, `continue-on-error`) and
the `(draft, not run)` names that `foundation-sql-lint`, `foundation-native` and
`e2e-foundation` report under on a draft (see "Draft pull requests"), which must
never be required. The Lighthouse audit is an advisory step inside
`bundle-analysis`. This keeps `main` deployable: the deploy needs the whole CI
run on `main` to succeed. `perf-baseline` and `k6-advisory` run only after a
push to `main` and cannot be required on pull requests; when no staging address
(`STAGING_APP_URL`) is configured they show as skipped, not as a success
(`Staging address configured` decides this in a job-level condition). Later
slices add their jobs here and to the ruleset file (foundation browser tests,
frontend ledger).

**Release gate.** On `main`, CI calls the workflows "Foundation native" and "E2E
foundation" (jobs `Release gate (foundation native)` and
`Release gate (e2e foundation)`), so the deploy, which needs the whole `main` CI
run to succeed, waits for both suites. They are not called on pull requests,
where the two workflows run on their own and report `foundation-native` and
`e2e-foundation`. Each caller job has a concurrency group per commit and is
never cancelled, so a later merge cannot cancel an earlier commit's gate. A
failed `main` or scheduled run of any workflow opens or updates one GitHub issue
(workflow "Failure alert").

## Draft pull requests

To save Actions capacity, the three slowest lanes, `foundation-sql-lint`,
`foundation-native` and `e2e-foundation`, do not run their work while a pull
request is a draft. GitHub counts a skipped or green job as a passed required
check, and a result recorded on the draft would still count after "Ready for
review" until the new run reports (for `e2e-foundation`, whose job is created
only after both browser projects finish, about 20 minutes). So on a draft these
jobs report under another name, ending in `(draft, not run)`, which is never
required: the required checks show as waiting, and a draft cannot merge anyway.

- **Ready for review** (`ready_for_review` is a trigger of `ci.yml`,
  `foundation-native.yml` and `e2e-foundation.yml`) starts a new run on the head
  commit, which reports the required names. In that run `e2e-foundation` always
  runs in full; `foundation-sql-lint` and `foundation-native` run in full, or
  end green under their required names when the pull request touches none of
  their inputs, exactly as for a pull request opened ready for review. So a pull
  request can merge only on results from a non-draft run on its head; re-running
  a draft-time run reports the draft names again and changes nothing.
- **Label `run-full-ci`** makes a draft behave like a ready pull request: the
  three jobs report their required names, `e2e-foundation` runs in full, and
  `foundation-sql-lint` and `foundation-native` still end green when no input
  changed. The label is read from the event that starts a run, so after adding
  it push a commit (or close and reopen the pull request).
- Pull requests opened ready for review, pushes to `main`, the nightly and
  manual runs are unchanged. Tooling tests (`scripts/branch-ruleset.test.mjs`)
  check the draft names, the shared draft condition and the triggers.

## Switching the required browser check

The pull request that retires the stub browser suite deletes the CI jobs
`e2e-full-matrix` and `build-e2e`. A required check whose job no longer exists
never reports, so it would block every pull request. Just before merging that
pull request, the owner edits the live ruleset in GitHub: Settings → Rules →
Rulesets → "Protect main" → Require status checks to pass:

- remove `e2e-full-matrix (chromium)`
- remove `e2e-full-matrix (firefox)`
- remove `e2e-full-matrix (mobile-chrome)`
- remove `Browser test build`
- keep `e2e-foundation` (source GitHub Actions), which the ruleset file already
  requires; add it if the live ruleset does not list it yet

Save, merge, then confirm with `pnpm check:branch-ruleset -- --live`, which
passes only when the live ruleset matches `.github/rulesets/protect-main.json`.
Applying the file with the GitHub CLI command below makes the same edit.

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

## Next's built-in type check

`next build` checks TypeScript unless `typescript.ignoreBuildErrors` is set.
Only one CI build skips it, by setting `VERIFYMZANSI_SKIP_NEXT_TYPECHECK=1`:
`bundle-analysis`, which measures the bundle. `lint-type-security` runs the full
typecheck on the same commit, and `build-route-verify`, the Cloudflare candidate
and the deploy always run Next's check: `build:cloudflare` refuses to start when
the variable is set (`scripts/lib/next-typecheck-skip.cjs`, tested by
`scripts/next-typecheck-skip.test.mjs`).

## Coverage thresholds

The source of truth is `vitest.config.ts`. Regular core-coverage thresholds are
74% statements, 63% branches, 81% functions and 75% lines. Strict main-push
thresholds are 75%, 64%, 82% and 76%, respectively, selected by
`STRICT_COVERAGE`. The coverage lane excludes the sensitive UI suites listed in
`src/test/coverage-excluded-suites.ts`; CI runs them in their own lane
(`unit-coverage-excluded`) and the local blocking lane still runs them.

## Test and check changes label

`.github/workflows/check-changes.yml` labels every pull request into `main`
`checks-changed` or `checks-clean` and keeps one comment that says in plain
words whether it deletes test files or test cases, adds skip, only, todo, fails
or fixme marks, changes the files that configure the checks (coverage
thresholds, audit baselines, rulesets, workflows, check scripts, lint, scanner
and Playwright configuration, the browser test skip policy, visual baselines,
database contract steps) or the test and check commands, or adds dependencies.
The comment is rewritten on every push. The label is for the reviewer and is not
a required check.

It runs on `pull_request_target`, so the workflow and its script
(`scripts/check-changed-checks.mjs`, `scripts/lib/check-changes.mjs`) always
come from `main`. It checks out nothing from the pull request and reads its diff
only through the GitHub API; the pull request's own text plays no part. The
detection is tested by `scripts/check-changes.test.mjs`. To see the verdict for
local work:

```bash
git diff origin/main... | node scripts/check-changed-checks.mjs --diff -
```

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
