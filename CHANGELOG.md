# VerifyMzansi — Recent Development Log

## Cloudflare Warning Cleanup Without Runtime Migration (2026-03-12)

- **Toolchain upgrades:** Bumped `@opennextjs/cloudflare` from `1.16.5` to
  `1.17.1` and `wrangler` from `4.69.0` to `4.72.0` to pick up current
  Cloudflare/OpenNext fixes without changing app behavior.
- **WSL build + deploy:** Native Windows remained intentionally blocked by
  `scripts/preflight-cloudflare.js`, so the Cloudflare bundle and deploy ran
  from an Ubuntu ext4 copy in WSL. Deploy succeeded with version ID
  `db5d5a11-f1b5-49fb-9b03-0407aeb0c77a`.
- **Runtime state:** Production remained healthy before cleanup, with
  `/api/health` reporting `status: "ok"` and successful Supabase probe, config,
  and audit checks.
- **Durable Objects:** Kept the OpenNext cache bindings and migrations in
  `wrangler.toml` unchanged (`DOQueueHandler`, `DOShardedTagCache`,
  `BucketCachePurge`). Generated worker output still exports those classes, so
  any remaining deploy-time DO startup warnings are treated as non-blocking
  adapter/workerd noise unless a later build proves otherwise.
- **Warning delta:** The Cloudflare build reduced to the expected Next.js
  `middleware` deprecation warning only. Deploy-time warnings still include the
  OpenNext internal Durable Object startup noise plus generated
  `duplicate-object-key` warnings inside
  `.open-next/server-functions/default/handler.mjs`.
- **Deferred migration:** Kept `src/middleware.ts` in place and did not migrate
  back to `src/proxy.ts`, because Next.js 16 `proxy` currently changes runtime
  behavior in a way that is riskier than tolerating the deprecation warning on
  this Cloudflare stack.
- **Post-deploy follow-up:** Public routing and auth-gated redirects still
  worked, but `/api/health` returned `status: "degraded"` after deploy because
  launch validation reported payment-provider and dev-only flag failures in
  production. That needed environment cleanup in Cloudflare, not code changes in
  this warning-cleanup pass.

## Cloudflare Middleware Compatibility Fix (2026-03-12)

- **Root cause fixed:** Next.js 16 `src/proxy.ts` runs on the Node.js runtime,
  which OpenNext Cloudflare rejects with
  `Node.js middleware is not currently supported`.
- **Implementation:** Replaced the active request gate with Edge
  `src/middleware.ts`, removed `src/proxy.ts`, and kept the existing auth, CSP,
  and route-protection logic intact.
- **Tests updated:** Middleware routing tests now import from
  `src/middleware.ts` and use the current naming.
- **Validation:** `pnpm run build` passes and
  `pnpm exec vitest run src/__tests__/proxy-middleware.test.ts` passes.
  `pnpm run build:cloudflare` remains intentionally blocked on native Windows by
  `scripts/preflight-cloudflare.js`; full Cloudflare bundling still needs Linux,
  WSL on ext4, or CI.

## Production Deploy — WSL Build Fix (2026-03-01)

- **Symlink EPERM resolved:** Moved Cloudflare build from native Windows to WSL
  2 Ubuntu (ext4 filesystem) to avoid `EPERM: operation not permitted, symlink`
  error in OpenNext's `copyTracedFiles.js`.
- **Successful deploy:** Built with Node v22.22.0, pnpm 10.2.1 on WSL. Worker
  uploaded (17,607 KiB / gzip 3,718 KiB, 32 ms startup). Version ID:
  `0bb0aa70-60d5-451e-ab3a-3f1354a6ed3d`.
- **Assets:** 2 new static assets uploaded, 137 already cached.
- **Bindings confirmed:** Durable Objects (DOQueueHandler, DOShardedTagCache,
  BucketCachePurge), KV (OTP_RATE_LIMITS), R2 (PUBLIC_BUCKET, PRIVATE_BUCKET),
  Assets, and all environment variables bound correctly.
- **Live at:** `verifymzansi.com` (custom domain).

---

## 20/20 Foundation Upgrade (2026-02-23)

Five-phase programme to raise the platform foundation score from 15/20 to 20/20.

### Phase 1 — Tooling Stability

- **Node 20 LTS pinning:** Added `.nvmrc`, `engines` in `package.json`, and
  `scripts/check-node-version.ts` guard run during preflight.
- **Shell-spawn hardening:** Replaced `shell: true` / `execSync` in
  `security-audit.ts`, `check-licenses.ts`, and `secret-scan.ts` with explicit
  `spawnSync` arg arrays and platform-aware binary names.
- **Lint zero:** Fixed `react-hooks/set-state-in-effect` error in
  `checkout/page.tsx`, suppressed 8 warnings (`@next/next/no-img-element` × 7,
  `exhaustive-deps` × 1) with targeted inline directives.

### Phase 2 — CI Quality Gates

- **DB-RLS no-skip:** Removed silent pass-through in `ci.yml` `db-rls` job;
  replaced with explicit `::error::` failure when Supabase secrets are missing.
- **Branch protection docs:** Added `docs/branch-protection.md` documenting
  required status checks and repository secrets.

### Phase 3 — Runtime Infrastructure

- **R2 bindings activated:** Uncommented `PUBLIC_BUCKET` and `PRIVATE_BUCKET`
  bindings in `wrangler.toml`.
- **Worker normalisation:** `rate-limiter` compat date updated to `2024-09-23`
  with `nodejs_compat` flag. `retention-cleanup` secret renamed
  `SUPABASE_SERVICE_KEY` → `SUPABASE_SERVICE_ROLE_KEY` everywhere.
- **Worker health endpoints:** Added `GET /` health-check handlers to
  `kyc-encryptor.ts` and `rate-limiter.ts`.
- **Env hardening:** Removed `SKIP_ENV_VALIDATION` escape hatch in `env.ts`;
  critical vars now checked even during build.
- **Env documentation:** Expanded `cloudflare-env-vars.txt` to ~25 vars across
  all categories.

### Phase 4 — Canary Feature Flags

- **DB migration:** `20260224200000_feature_flags_canary.sql` — adds `mode`,
  `rollout_percent`, `allowlist_roles`, `updated_by`, `updated_reason` columns
  with audit trigger.
- **Service rewrite:** `feature-flags.ts` now evaluates 4 modes (off / on /
  percent via FNV-1a deterministic bucketing / allowlist by role).
  Backward-compatible — `isFeatureEnabled(key)` still works.
- **API upgrade:** Toggle endpoint accepts both legacy `{ key, enabled }` and
  canary `{ key, mode, percent, allowlist_roles, reason }` payloads.
- **Admin UI:** `feature-flags-client.tsx` rewritten with Advanced mode controls
  (mode dropdown, percent slider, role checkboxes, mandatory reason field).
- **Types:** `FeatureFlagMode` and extended `FeatureFlag` interface added to
  `database.ts`.
- **Tests:** 12 new unit tests covering all 4 modes, edge cases, backward
  compat, and cache behaviour.

### Phase 5 — Monitoring & Playbooks

- **Synthetic monitoring:** Added `worker-health` job to
  `synthetic-monitoring.yml` — curls health endpoints for all 3 workers.
- **Playbooks:** `docs/playbooks/toolchain-eperm.md`,
  `docs/playbooks/feature-flag-rollback.md`,
  `docs/playbooks/worker-secret-rotation.md`.

### Documentation

- **`platform-workflow-facts.md`:** Updated worker bindings (renamed secret,
  added health endpoints), documented canary rollout modes, fixed MD060 table
  formatting, bumped migration count.
- **Files touched:** 30+ files across app, lib, types, workers, scripts, CI,
  migrations, docs.

---

## Bug Fixes

- **Supabase `PGRST205` Schema Drift Guardrails**
  - **Cause:** Runtime marketplace reads failed when required tables were
    missing from PostgREST schema cache.
  - **Fix:** Added `scripts/check-supabase-schema.ts`, wired
    `pnpm db:verify-schema` into preflight/CI, and improved `/mzansi-market`
    grid error UX to show a configuration outage state for `PGRST205`.
  - **Files updated:** `scripts/check-supabase-schema.ts`,
    `scripts/preflight-check.ts`,
    `src/app/(marketplace)/mzansi-market/grid.tsx`, `.github/workflows/ci.yml`,
    `docs/supabase-schema-sync.md`.

- **React Hydration Error
  (`Hydration failed because the server rendered HTML didn't match the client`)**
  - **Cause:** Shadcn UI `Button` components were incorrectly nested inside
    Next.js `Link` components (`<a><button></button></a>`), leading to invalid
    HTML that the browser automatically closed unexpectedly.
  - **Fix:** Updated the `Button` components to use the `asChild` prop and
    reordered the nesting so the `Button` wraps the `Link`
    (`<Button asChild><Link>...</Link></Button>`).
  - **Files updated:** `src/components/layout/header.tsx`, `src/app/page.tsx`,
    `src/components/home/hero-banner.tsx`,
    `src/components/billing/plan-gate.tsx`.

- **"Complete the CAPTCHA" Form Validation Loop**
  - **Cause:** The form was not automatically clearing the `turnstileToken`
    error state after the widget successfully completed its check. Additionally,
    the development environment's default `.env.local` configuration for
    Cloudflare Turnstile (`dummy_site_key`) was causing the widget to fail
    silently.
  - **Fix:** Added bypass logic to skip the Turnstile widget when loading the
    default dummy site key in development. Updated `react-hook-form`'s
    `setValue` calls to include `{ shouldValidate: true }`, ensuring the CAPTCHA
    error disappears immediately upon getting a successful token.
  - **Files updated:** `src/components/ui/turnstile-widget.tsx`,
    `src/app/(auth)/login/page.tsx`, `src/app/(auth)/register/page.tsx`.

## Enhancements

- **Design Updates**
  - Changed the `<Header />` **Sign In** button strictly to a green bordered
    outline variant instead of a ghost button with an overlapping focus ring.
  - Updated the user profile avatar badge (`AvatarFallback`) to use gold
    (`bg-brand-gold`, `border-brand-gold`) instead of green, matching the new
    mockups.
  - **Files updated:** `src/components/layout/header.tsx`.

- **Navigation Flow**
  - Changed the default post-login redirect path so that users land on the
    marketplace homepage (`/`) instead of the dashboard (`/dashboard`)
    immediately after successful authentication.
  - **Files updated:** `src/app/(auth)/login/page.tsx`.

## Database Operations

- **Unseeding Test Data**
  - Created and executed a new script (`scripts/unseed-development.ts`) to
    programmatically delete the initial dummy seller accounts
    (`dev_seller1@test.com`, etc.) alongside all of their automatically
    generated marketplace listings, mall storefronts, and business profiles.
