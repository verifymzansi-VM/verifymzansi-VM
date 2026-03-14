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
- If you set `RATE_LIMITER_API_KEY`, you must also set `OTP_RATE_LIMITER_URL`
- Sensitive values belong in GitHub Actions secrets and Cloudflare Wrangler
  secrets, not in committed files

## Key Commands

| Command                                                                                | Purpose                                              |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `pnpm dev`                                                                             | Start the local Next.js dev server                   |
| `pnpm build`                                                                           | Production Next.js build                             |
| `pnpm brand:assets`                                                                    | Regenerate logo lockups, favicon, and app icons      |
| `pnpm lint`                                                                            | ESLint                                               |
| `pnpm typecheck`                                                                       | TypeScript typecheck                                 |
| `pnpm test`                                                                            | Blocking Vitest lane used for launch gating          |
| `pnpm test:blocking`                                                                   | Explicit blocking Vitest lane                        |
| `pnpm test:coverage`                                                                   | Alias for the core coverage lane                     |
| `pnpm test:coverage:core`                                                              | Coverage lane focused on core server and domain code |
| `pnpm test:deep`                                                                       | Core coverage plus Playwright                        |
| `pnpm test:all`                                                                        | Full validation shortcut                             |
| `pnpm test:e2e`                                                                        | Full Playwright suite                                |
| `pnpm exec playwright test --grep "@smoke" --project chromium --project mobile-chrome` | Launch-path smoke coverage                           |
| `pnpm preflight`                                                                       | Local launch checks with development-mode validation |
| `pnpm preflight:prod`                                                                  | Production launch checks                             |
| `pnpm validate:launch-env`                                                             | Fail-fast production env validation                  |
| `pnpm security:audit`                                                                  | Dependency vulnerability gate                        |
| `pnpm secret-scan`                                                                     | Secret leak scan                                     |
| `pnpm licenses:check`                                                                  | License policy gate                                  |
| `pnpm build:cloudflare`                                                                | OpenNext Cloudflare build                            |

## Testing

Run the blocking launch gate with:

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

Run the deeper confidence lane when you want broader coverage before a release
candidate, after a risky refactor, or before changing shared infra code:

```bash
pnpm test:coverage:core
pnpm test:e2e
```

Before a production release, also run the production-only validation checks:

```bash
pnpm validate:launch-env
pnpm preflight:prod
```

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
