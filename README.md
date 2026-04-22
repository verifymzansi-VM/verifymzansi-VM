# VerifyMzansi

Verification-first South African marketplace built on Next.js, Supabase, and
Cloudflare. The main business surface is `Mzansi Business`, with legacy
`business-ads` and `mall-shops` routes preserved for compatibility.

[![CI](https://github.com/verifymzansi/verifymzansi/actions/workflows/ci.yml/badge.svg)](https://github.com/verifymzansi/verifymzansi/actions/workflows/ci.yml)

## Overview

VerifyMzansi combines:

- `Mzansi Market` for classified listings
- `Mzansi Business` for verified businesses, shops, and services
- `Promotions & Events` for deals, campaigns, and business posts
- KYC, moderation, audit logging, and POPIA-sensitive data handling
- Ozow billing, Africa's Talking OTP, Resend email, Turnstile CAPTCHA, and
  Cloudflare R2 file storage

## Prerequisites

- Node.js `20.x` through `25.x` supported
- Node.js `22.x` recommended locally and in CI
- pnpm `>=10`
- Supabase project
- Cloudflare account for Pages/Workers/R2/Turnstile
- Ozow, Africa's Talking, and Resend credentials for launch validation

## Local Development

Use the development env template, not the production Cloudflare template.

```bash
git clone https://github.com/verifymzansi/verifymzansi.git
cd verifymzansi
pnpm install
cp .env.example .env.local
```

Generate the encryption secrets and paste them into `.env.local`:

```bash
node -e "const c=require('crypto'); console.log('KYC_ENCRYPTION_KEY='+c.randomBytes(32).toString('hex')); console.log('ID_ENCRYPTION_KEY='+c.randomBytes(32).toString('hex')); console.log('HMAC_SECRET='+c.randomBytes(32).toString('hex')); console.log('IP_HASH_SECRET='+c.randomBytes(32).toString('hex'));"
```

Then run:

```bash
pnpm preflight
pnpm dev
```

Open `http://localhost:3000`.

For Playwright, keep that local dev server separate. `pnpm test:e2e` starts its
own deterministic app instance on a dedicated port.

## Environment Modes

### Local dev

- Source template: `.env.example`
- Expected URL: `http://localhost:3000`
- `pnpm preflight` runs in development mode by default
- Production-only requirements such as HTTPS app URLs and a live Africa's
  Talking sender ID are warnings, not failures

### Supabase auth redirect URLs

`NEXT_PUBLIC_APP_URL` is the canonical public origin used to generate signup
confirmation and password reset email links. Set it per environment to the real
app URL users can reach.

If users open confirmation emails on a phone, `localhost` will always fail
because it points to the phone itself, not your dev machine. Use your public
domain for production email flows.

Add the auth callback route to Supabase Auth redirect allow-lists for every
origin you use:

- `http://localhost:3000/auth/callback`
- `https://verifymzansi.com/auth/callback`
- Any preview or staging origin, for example
  `https://your-preview-domain/auth/callback`

For the production environment, make sure both of these are aligned:

- `NEXT_PUBLIC_APP_URL=https://your-public-domain`
- Supabase Auth `site_url` and redirect allow-list include
  `https://your-public-domain/auth/callback`

Without that allow-list entry, signup confirmation emails may fall back to the
site root with `?code=...` instead of the app callback handler.

### Supabase Security Advisor Settings

Some Supabase security controls are dashboard-only and are not represented in
`supabase/config.toml` or app code.

- Enable leaked-password protection in Supabase Dashboard > Auth > Security. The
  VerifyMzansi auth routes rely on Supabase to enforce that control once it is
  enabled for the project. The repo also exposes the same control through the
  Supabase Management API field `password_hibp_enabled`. Supabase only allows
  that setting on Pro plans and above, so the related Security Advisor warning
  is expected while the project remains on the free plan.
- The `avatars` storage bucket is intentionally public because the profile
  avatar upload flow stores a persistent public URL in `avatar_url`. Keep the
  bucket public for direct object delivery, but do not add a broad public
  `SELECT` policy on `storage.objects`; that re-enables bucket listing.

### Supabase CLI From Workspace Env

The repo includes an env-aware Supabase CLI wrapper so linked remote commands do
not depend on manually exporting `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD` into your terminal first.

Use either the generic wrapper:

```bash
pnpm supabase:cli -- migration list
pnpm supabase:cli -- db push
```

Or the convenience aliases:

```bash
pnpm supabase:migration:list
pnpm supabase:db:push
```

To check live Supabase Security Advisor findings from workspace env:

```bash
pnpm supabase:advisor:security
pnpm supabase:advisor:security -- --json
pnpm supabase:advisor:security:strict
```

The advisor script classifies plan-gated findings separately. On free Supabase
plans, `auth_leaked_password_protection` is reported as plan-blocked instead of
being treated as an unresolved repo-owned issue.

To use a different env file, pass it through the generic wrapper:

```bash
pnpm supabase:cli -- --env-file=.env.local migration list
```

### Playwright / CI smoke

- Playwright does not depend on your local `.env.local`
- `playwright.config.ts` starts the app through
  `scripts/start-playwright-server.cjs`
- That script injects deterministic e2e-safe env values and sets
  `VERIFYMZANSI_RUNTIME_MODE=e2e`
- By default, Playwright boots its own server on `http://127.0.0.1:3100` so an
  unrelated local app on `3000` cannot contaminate browser results
- Set `PLAYWRIGHT_REUSE_SERVER=1` only when you intentionally want Playwright to
  attach to an already-running app on the configured Playwright port
- `chromium`, `firefox`, and `mobile-chrome` run the full interaction suite;
  `webkit` and `mobile-safari` are currently scoped to the stable page-load
  accessibility coverage because broader Safari automation intermittently
  renders blank public/auth pages in this app
- The app still boots through `next start`, but production-only launch rules are
  relaxed for that explicit e2e mode

### Production / Cloudflare

- Source template: `cloudflare-env-vars.txt`
- Required check: `pnpm validate:launch-env`
- Full release check: `pnpm preflight:prod`
- `NEXT_PUBLIC_APP_URL` must be public HTTPS
- `AFRICASTALKING_SENDER_ID`, `IP_HASH_SECRET`, Ozow credentials, Turnstile, R2,
  Resend, and encryption keys must all be populated
- `KYC_PROVIDER` defaults to `stub`; when you switch to a real provider,
  `KYC_WEBHOOK_SECRET` becomes a launch-blocking requirement for signed KYC
  callbacks
- If `OZOW_API_BASE_URL` is set, it must target an official Ozow HTTPS host.
  Production accepts only `https://one.ozow.com`.
- If you set `RATE_LIMITER_API_KEY`, you must also set `OTP_RATE_LIMITER_URL`
- Sensitive values belong in GitHub Actions secrets and Cloudflare Wrangler
  secrets, not in committed files

### Ozow webhook secret setup

Ozow webhook signature verification depends on a real `OZOW_WEBHOOK_SECRET`.

Use the helper script (OAuth + `GET /v1/webhooks/{id}/secret`) to retrieve it:

```bash
pnpm ozow:webhook:secret
```

If you already know the webhook subscription ID from Ozow, fetch only that one:

```bash
pnpm ozow:webhook:secret -- --webhook-id=<ozow-webhook-id>
```

You can also set `OZOW_WEBHOOK_ID` in your env file and run
`pnpm ozow:webhook:secret`.

Then set the returned secret in `.env.local` and also store it as a Cloudflare
secret for production:

```bash
pnpm wrangler secret put OZOW_WEBHOOK_SECRET
```

## Key Commands

| Command                                                                                | Purpose                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm dev`                                                                             | Start the local Next.js dev server                   |
| `pnpm build`                                                                           | Production Next.js build                             |
| `pnpm brand:assets`                                                                    | Regenerate logo lockups, favicon, and app icons      |
| `pnpm knip`                                                                            | Dead-code scan for unused files and exports          |
| `pnpm jscpd`                                                                           | Advisory code-duplication scan with HTML/JSON report |
| `pnpm depcruise`                                                                       | Import-graph check for cycles and test-only leaks    |
| `pnpm lint`                                                                            | ESLint                                               |
| `pnpm typecheck`                                                                       | TypeScript typecheck                                 |
| `pnpm test`                                                                            | Blocking Vitest lane used for launch gating          |
| `pnpm test:blocking`                                                                   | Explicit blocking Vitest lane                        |
| `pnpm run stability:check`                                                             | One-command full stabilization gate                  |
| `pnpm test:coverage`                                                                   | Alias for the core coverage lane                     |
| `pnpm test:coverage:core`                                                              | Coverage lane focused on core server and domain code |
| `pnpm test:dev-startup`                                                                | Local dev startup smoke (boot + / + /api/health)     |
| `pnpm test:launch:flows`                                                               | Billing + OTP + DSAR launch-confidence bundle        |
| `pnpm test:deep`                                                                       | Core coverage plus Playwright                        |
| `pnpm test:all`                                                                        | Full validation shortcut                             |
| `pnpm payments:audit`                                                                  | Paid-flow security and live posture audit            |
| `pnpm safety:review`                                                                   | One-command code review and security gate            |
| `pnpm safety:ci-review`                                                                | CI-safe review gate (preflight is non-blocking)      |
| `pnpm safety:release`                                                                  | One-command release-readiness gate                   |
| `pnpm test:e2e`                                                                        | Full Playwright suite                                |
| `pnpm exec playwright test --grep "@smoke" --project chromium --project mobile-chrome` | Launch-path smoke coverage                           |
| `pnpm bootstrap:operator`                                                              | Create or update the first live staff account        |
| `pnpm reset:launch-data`                                                               | Launch-reset inventory / wipe tool                   |
| `pnpm supabase:migration:list`                                                         | List linked Supabase local vs remote migrations      |
| `pnpm supabase:db:push`                                                                | Apply pending local migrations to linked Supabase    |
| `pnpm preflight`                                                                       | Local launch checks with development-mode validation |
| `pnpm preflight:prod`                                                                  | Production launch checks                             |
| `pnpm validate:launch-env`                                                             | Fail-fast production env validation                  |
| `pnpm ozow:webhook:secret`                                                             | Fetch Ozow webhook secret(s) via One API             |
| `pnpm security:audit`                                                                  | Dependency vulnerability gate                        |
| `pnpm secret-scan`                                                                     | Secret leak scan                                     |
| `pnpm licenses:check`                                                                  | License policy gate                                  |
| `pnpm build:cloudflare`                                                                | OpenNext Cloudflare build                            |

## Billing API Endpoints

- `POST /api/billing/create-checkout` starts a subscription checkout session
- `POST /api/billing/cancel` cancels an active subscription entitlement
- `POST /api/billing/change-plan` starts checkout for an in-area plan change
- `GET /api/billing/payment-status?payment=<payment-id>` returns normalized
  payment status

Billing fulfillment now records invoice rows in `invoices` for successful
subscription payments. Invoice records are created idempotently by `payment_id`
so duplicate webhooks cannot create duplicate invoices.

## Testing

Run the one-command stabilization gate with:

```bash
pnpm run stability:check
```

Or run the blocking launch gate step-by-step with:

```bash
pnpm lint
pnpm typecheck
pnpm test:blocking
pnpm preflight
pnpm secret-scan
pnpm security:audit
pnpm licenses:check
pnpm build
pnpm exec playwright test --grep "@smoke" --project chromium --project mobile-chrome
```

To specifically validate local `pnpm dev` startup behavior in one command, run:

```bash
pnpm test:dev-startup
```

Run the deeper confidence lane when you want broader coverage before a release
candidate, after a risky refactor, or before changing shared infra code:

```bash
pnpm test:coverage:core
pnpm test:e2e
```

Run the focused launch-path integration bundle when you want one command that
exercises the billing, OTP, and DSAR flows together before release:

```bash
pnpm test:launch:flows
```

That bundle runs the billing payment route/library/worker tests, OTP route and
verification page tests, DSAR submit/admin/page tests, then finishes with
Chromium Playwright smoke for the billing round-trip and DSAR browser flow.

For automated safety gates, use:

```bash
pnpm safety:review
pnpm safety:ci-review
pnpm safety:release
```

For dead-code analysis, run:

```bash
pnpm knip
```

For import-graph validation, run:

```bash
pnpm depcruise
```

Knip is now blocking in CI and included in the safety-review lane. Keep
`knip.jsonc` aligned with convention-based entrypoints and generated type
surfaces so regressions reflect real dead code instead of tooling noise.

Dependency-cruiser is also blocking in CI and in the safety-review lane. The
current baseline enforces a minimal rule set: no circular dependencies and no
runtime imports from test-only modules.

Use `-- --dry-run` to preview the command sequence without executing it.

Each run now writes machine-readable evidence artifacts to `tmp/safety-gate`:

- Timestamped JSON and Markdown files per run

## Health Endpoint Behavior

`GET /api/health` is the post-deploy readiness endpoint used by launch checks.

- Returns `200` with `status: "ok"` when launch config, schema, audit, and
  production probes are healthy
- Returns `503` with `status: "degraded"` when any enforced launch check is
  degraded
- Returns a controlled degraded `503` payload even when health snapshot
  generation itself throws before probes complete, so deploy automation never
  has to interpret an unstructured runtime exception
- `latest-review.json` / `latest-review.md`
- `latest-release.json` / `latest-release.md`
- `latest.json` / `latest.md`
- `latest-review-blockers.json` / `latest-review-blockers.txt`
- `latest-release-blockers.json` / `latest-release-blockers.txt`
- `latest-blockers.json` / `latest-blockers.txt`

Override output directory with `SAFETY_GATE_REPORT_DIR`.

For the paid-flow specific audit across subscriptions, add-ons, live smoke,
deployed Cloudflare posture, and local production env readiness, run:

```bash
pnpm payments:audit
```

That command writes JSON and Markdown artifacts to `tmp/payment-security-audit`
and is documented in
[docs/playbooks/payment-security-audit.md](docs/playbooks/payment-security-audit.md).

Before a production release, also run the production-only validation checks:

```bash
pnpm validate:launch-env
pnpm preflight:prod
```

## Live Operator Bootstrap

After a launch reset, the linked Supabase project can be left with zero auth
users. Use the minimal operator bootstrap script to create the first admin or
moderator without reintroducing any demo or seed data:

```bash
pnpm bootstrap:operator -- \
  --email=admin@verifymzansi.com \
  --password='replace-with-strong-password' \
  --display-name='VerifyMzansi Admin' \
  --role=admin \
  --confirm-project=your-project-ref
```

Notes:

- The script only supports `admin` and `moderator` roles.
- It creates or updates the auth user, sets both `user_metadata.role` and
  `app_metadata.role`, and upserts a minimal `account_profiles` row.
- It refuses to run unless `--confirm-project` matches the current
  `NEXT_PUBLIC_SUPABASE_URL` project ref.

## Launch Reset

Use the launch reset tool in inventory mode first, then only run a destructive
wipe after reviewing the generated snapshot:

```bash
pnpm reset:launch-data
```

For a destructive wipe that keeps exactly one admin account, pass the project
confirmation flag and an explicit preserve target when needed:

```bash
pnpm reset:launch-data -- \
  --execute \
  --confirm-project=your-project-ref \
  --preserve-admin-email=admin@verifymzansi.com
```

Or preserve by auth user id:

```bash
pnpm reset:launch-data -- \
  --execute \
  --confirm-project=your-project-ref \
  --preserve-admin-user-id=00000000-0000-0000-0000-000000000000
```

Notes:

- Inventory writes a JSON snapshot to `tmp/` showing auth users, admin users,
  legal holds, and table counts.
- Wipe mode now refuses to proceed when multiple admin users exist unless you
  explicitly choose which admin to preserve.
- When there is exactly one admin user, wipe mode preserves it automatically.
- The wipe clears tracked application tables first, then deletes all auth users
  except the preserved admin.
- Media and KYC object deletion completes through `r2_cleanup_queue` and the
  retention worker after the database wipe.

## Deployment

Canonical release path: push to `master` and let GitHub Actions deploy from
Ubuntu using Node `22.x`.

```bash
git push origin master
```

The deploy workflow now:

1. Validates the full production env contract with
   `scripts/validate-launch-env.ts`
2. Runs the blocking launch gate: `pnpm lint`, `pnpm typecheck`,
   `pnpm test:blocking`, `pnpm preflight`, `pnpm secret-scan`,
   `pnpm security:audit`, `pnpm licenses:check`, `pnpm build`, and Playwright
   smoke
3. Builds the Cloudflare bundle on Ubuntu
4. Deploys the Pages app plus supporting Workers
5. Fails if `/api/health` comes back degraded after deploy

## Startup Failures

Startup and launch validation usually fail for one of these reasons:

- `NEXT_PUBLIC_APP_URL` is not the real public origin for the current
  environment
- A production-only secret is missing or malformed
- `RATE_LIMITER_API_KEY` is set without `OTP_RATE_LIMITER_URL`
- Local or CI Node.js version is outside the supported `20.x` to `25.x` range

When that happens, run `pnpm validate:launch-env` first. It fails fast with the
specific variable or contract that needs fixing.

### Windows note

Local `pnpm build:cloudflare`, `pnpm preview:cloudflare`, and `pnpm deploy` are
not supported on native Windows because Wrangler/OpenNext emits filenames that
Windows cannot materialize. Use one of:

- GitHub Actions on `master`
- Ubuntu
- WSL on an ext4-backed workspace such as `~/verifymzansi`

Do not run Cloudflare builds from `/mnt/c/...`.

## Cloudflare MCP

This workspace already includes Cloudflare MCP configuration for VS Code and
GitHub Copilot.

- Primary workspace config: [docs/cloudflare-mcp.md](docs/cloudflare-mcp.md)
- VS Code MCP server: `.vscode/mcp.json`
- Remote endpoint reference: `.mcp.json`

Use the guide in [docs/cloudflare-mcp.md](docs/cloudflare-mcp.md) to validate
Cloudflare MCP against this repo's R2, KV, Durable Object, and Workers/Pages
resources. The workspace MCP command uses the validated local startup form
`npx -y @cloudflare/mcp-server-cloudflare run`.

## Project Structure

```text
src/
  app/                 Next.js routes, pages, and API handlers
  components/          UI and marketplace surfaces
  lib/                 domain logic, config, services, Supabase helpers
  stores/              Zustand stores
  test/                shared test setup
scripts/               preflight, validation, security, and release tooling
supabase/              migrations and schema assets
workers/               Cloudflare Workers
e2e/                   Playwright suites
```

## Launch Notes

- `Mzansi Business` is the primary business experience.
- Legacy public routes remain available for compatibility.
- `/api/health` now reports config, Supabase, and audit status without exposing
  secrets.

## License

Proprietary. All rights reserved.
