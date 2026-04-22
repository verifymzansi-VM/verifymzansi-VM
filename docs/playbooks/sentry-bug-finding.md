# Playbook: Sentry Bug Finding

Use this playbook when you need a repeatable bug-finding loop for VerifyMzansi
using live Sentry data and local page-by-page debugging.

This playbook uses the repo's current Sentry integration as its base:

- [`next.config.js`](../../next.config.js)
- [`src/instrumentation.ts`](../../src/instrumentation.ts)
- [`src/instrumentation-client.ts`](../../src/instrumentation-client.ts)

Treat "Spotlight" as Sentry's current in-app debugging surface via the
[Sentry Toolbar](https://docs.sentry.io/product/sentry-toolbar/).

## Scope

- Lane 1: live triage against real issues and events in Sentry
- Lane 2: local debugging while browsing affected routes with the Sentry Toolbar
- Release and source-map validation through `sentry-cli`

This is an operator runbook, not a request to change runtime code.

## Required Inputs

| Variable                 | Required for                                | Notes                                                                                                                                |
| ------------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `NEXT_PUBLIC_SENTRY_DSN` | Local and deployed SDK event delivery       | The SDK self-disables when unset.                                                                                                    |
| `SENTRY_ORG`             | CLI and API reads                           | Sentry organization slug.                                                                                                            |
| `SENTRY_PROJECT`         | CLI and API reads                           | Sentry project slug.                                                                                                                 |
| `SENTRY_AUTH_TOKEN`      | CLI auth, issue/event reads, release checks | Read-only triage needs `org:read`, `project:read`, and `event:read`. Release and source-map operations also need `project:releases`. |

Examples below use PowerShell because this workspace commonly runs on Windows.

```powershell
$env:NEXT_PUBLIC_SENTRY_DSN = "https://examplePublicKey@o0.ingest.sentry.io/0"
$env:SENTRY_ORG = "your-org"
$env:SENTRY_PROJECT = "your-project"
$env:SENTRY_AUTH_TOKEN = "sntrys_your_token"
```

## Lane 0: Readiness Check

Verify the bundled CLI exists and authenticate before touching production data.

```powershell
Test-Path .\node_modules\.bin\sentry-cli.ps1
pnpm exec sentry-cli info --no-defaults
pnpm exec sentry-cli info
```

Expected outcome:

- `sentry-cli` resolves from `node_modules/.bin`
- auth succeeds
- org and project defaults are accepted when `SENTRY_ORG` and `SENTRY_PROJECT`
  are set

If auth is not ready yet, skip Lane 1 and use Lane 2 only.

## Lane 1: Live Triage

### 1. Run the default production scan

Start with a human-readable CLI scan, then use the API for the precise `prod` +
`24h` slice.

```powershell
pnpm exec sentry-cli issues list `
  -o $env:SENTRY_ORG `
  -p $env:SENTRY_PROJECT `
  --status unresolved `
  --query "environment:prod" `
  --max-rows 10

$headers = @{ Authorization = "Bearer $env:SENTRY_AUTH_TOKEN" }
$issues = Invoke-RestMethod -Headers $headers `
  -Uri "https://sentry.io/api/0/projects/$($env:SENTRY_ORG)/$($env:SENTRY_PROJECT)/issues/?environment=prod&statsPeriod=24h&query=is:unresolved"

$issues | Select-Object id, shortId, title, count, lastSeen
```

Prioritize issues in this order:

1. likely regressions after a recent release
2. highest-frequency or fastest-growing issue counts
3. auth, OTP, billing, DSAR, moderation, and posting flows
4. startup or launch-config failures surfaced by instrumentation bootstrap

### 2. Inspect the top issue and its recent events

```powershell
$issueId = "<issue-id-from-list>"

$issue = Invoke-RestMethod -Headers $headers `
  -Uri "https://sentry.io/api/0/issues/$issueId/"

$events = Invoke-RestMethod -Headers $headers `
  -Uri "https://sentry.io/api/0/issues/$issueId/events/"

$issue | Select-Object id, shortId, title, status, level, firstSeen, lastSeen, count, culprit
$events | Select-Object -First 5 eventID, dateCreated, message, platform
```

Optional project-wide event scan:

```powershell
pnpm exec sentry-cli events list `
  -o $env:SENTRY_ORG `
  -p $env:SENTRY_PROJECT `
  --max-rows 20 `
  -T
```

During issue review, capture:

- issue short ID and Sentry link
- title, culprit, release, and environment
- first seen, last seen, and count
- the exact route, user action, and browser/runtime where the error appears

### 3. Map the issue back to the repo

Use these areas first when the issue touches a known business-critical flow:

- auth and OTP: `src/app/(auth)/**`, `src/app/api/auth/**`, `src/app/api/otp/**`
- billing: `src/app/billing/**`, `src/app/api/billing/**`, `src/lib/payments/**`
- DSAR: `src/app/dsar/**`, `src/app/admin/dsar/**`, `src/app/api/dsar/**`,
  `src/app/api/admin/dsar/**`
- moderation and admin: `src/app/admin/**`, `src/app/api/admin/**`
- posting and listings: `src/app/post/**`, `src/app/dashboard/**`,
  `src/app/api/content/**`

Convert each high-signal issue into a repro candidate using this template:

| Rank | Issue     | Route or flow       | Suspected repo area                   | Repro notes                        | Next action                            |
| ---- | --------- | ------------------- | ------------------------------------- | ---------------------------------- | -------------------------------------- |
| 1    | `ABC-123` | `/billing/checkout` | `src/app/api/billing/create-checkout` | Fails after plan selection in prod | Reproduce locally with Toolbar enabled |

## Lane 2: Local Debug with Sentry Toolbar

### 1. Start the app with DSN enabled

```powershell
pnpm dev
```

### 2. Reproduce on high-value routes

Start with the routes most likely to match live issues:

- auth: `/login`, `/register`, `/forgot-password`, `/reset-password`
- verification and OTP: `/verification`, `/help/verification`
- billing: `/billing`, `/billing/checkout`, `/billing/success`
- DSAR: `/dsar`, `/admin/dsar`
- moderation and admin: `/admin/moderation`, `/admin/verification`,
  `/admin/verification/evidence`
- posting and dashboard: `/post/create`, `/post/create-business`,
  `/post/create-listing`, `/dashboard`, `/dashboard/listings`

### 3. Use the Toolbar

Follow the official
[Sentry Toolbar setup guide](https://docs.sentry.io/product/sentry-toolbar/) if
the floating `Login to Sentry` button does not appear.

Once the Toolbar is visible:

- log into Sentry from the page
- use the Issues panel to compare the current route with production issues
- use the Feature Flags panel to test route behavior when a flag is suspected
- compare the local trace, route, and interaction path with the live issue
  signature before changing code

Collect these fields during each repro pass:

- page URL and user action
- issue short ID or event ID
- error message and culprit
- release or build version
- any feature flag state that changes behavior
- likely file or route handler in the repo

## Release and Source-Map Validation

Validate the two expected build modes:

1. no `SENTRY_AUTH_TOKEN`: build stays quiet and skips upload
2. valid `SENTRY_AUTH_TOKEN`: build can publish release artifacts and source
   maps

### Quiet build without upload auth

```powershell
Remove-Item Env:SENTRY_AUTH_TOKEN -ErrorAction SilentlyContinue
pnpm build
```

Expected outcome:

- build succeeds
- no noisy source-map upload warnings are emitted

### Release-aware build with upload auth

```powershell
$env:SENTRY_AUTH_TOKEN = "sntrys_your_token"
pnpm build

$version = node -p "require('./package.json').version"
$release = "verifymzansi@$version"

pnpm exec sentry-cli releases list `
  -o $env:SENTRY_ORG `
  -p $env:SENTRY_PROJECT

pnpm exec sentry-cli releases info `
  $release `
  -o $env:SENTRY_ORG `
  -p $env:SENTRY_PROJECT `
  -P
```

If you need to validate a minified frame against uploaded artifacts, resolve the
frame against the matching release:

```powershell
pnpm exec sentry-cli sourcemaps resolve `
  -o $env:SENTRY_ORG `
  -p $env:SENTRY_PROJECT `
  -r $release `
  "<artifact-path>" `
  --line <minified-line> `
  --column <minified-column>
```

## Acceptance Checklist

- [ ] `sentry-cli` resolves from the workspace and auth validates
- [ ] unresolved production issues can be listed for the last 24 hours
- [ ] one issue and its recent events have been inspected in detail
- [ ] at least one concrete repo-level repro target has been identified
- [ ] the local app can be browsed with `NEXT_PUBLIC_SENTRY_DSN` enabled
- [ ] the Sentry Toolbar appears on a target page after setup and login
- [ ] the build stays quiet when `SENTRY_AUTH_TOKEN` is absent
- [ ] the release path can be inspected when `SENTRY_AUTH_TOKEN` is present
- [ ] a ranked bug shortlist has been produced with issue link, suspected repo
      area, repro notes, and next debugging action

## Official References

- [Sentry Toolbar](https://docs.sentry.io/product/sentry-toolbar/)
- [Permissions and Scopes](https://docs.sentry.io/api/permissions/)
- [Sentry sourcemap and CLI guidance](https://docs.sentry.io/platforms/javascript/guides/capacitor/sourcemaps/uploading/typescript)
