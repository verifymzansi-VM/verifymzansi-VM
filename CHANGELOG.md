# VerifyMzansi — Recent Development Log

## Admin KYC Queue Grouping and Evidence Reliability (2026-03-27)

- **Queue UX redesign:** Reworked admin KYC queue rendering from per-step cards
  to per-user grouped cards so all pending documents for one user are displayed
  together while keeping approve/reject/resubmit actions step-scoped.
- **Root-cause name repair:** Hardened profile hydration by updating
  `ensureAccountProfile()` to repair missing/blank `display_name` values and
  returning normalized display names instead of only creating missing rows.
  Added OTP verification pre-check to ensure account profiles are repaired
  before verification state is promoted.
- **Admin query fallback repair path:** `getPendingVerifications()` and
  dashboard queue lookups now repair missing profile names through
  `auth.admin.getUserById` + `ensureAccountProfile` before rendering results.
- **Evidence error contract:** Added machine-readable evidence error codes
  across metadata and evidence proxy routes (`unauthorized`, `forbidden`,
  `no_active_case`, `not_linked`, `not_found`, `missing_file`, `rate_limited`,
  `server_error`) and mapped them in admin preview/lightbox components for
  actionable UI messages with retry.
- **Intentional security behavior:** Metadata requests with no session-linked
  artifacts now return explicit `403 not_linked` instead of an empty artifact
  list so admins can distinguish linkage failures from normal empty states.
- **Fallback cleanup:** Removed duplicated display-name fallback logic in admin
  verification queue/lightbox/dashboard surfaces.
- **Regression coverage added/updated:**
  - grouped queue rendering and evidence-link behavior,
  - missing-name repair fallback in grouped query path,
  - evidence metadata status/code assertions,
  - inline preview error badge mapping,
  - profile helper unit tests for create/repair/fallback behavior.
- **Validation executed:**
  - Focused Vitest: admin queries, queue table, inline preview, evidence
    metadata, evidence gating.
  - Security/auth Vitest: evidence access and KYC security checks.
  - Playwright: `e2e/kyc-verification.spec.ts` (chromium) passed.
  - Full `pnpm typecheck` and focused lint on touched files passed.

## Next.js 16.2.0 Rollback to 16.1.5 (2026-03-20)

- **Reason for rollback:** Production started returning Cloudflare 1101
  `Worker threw exception` responses after upgrading to Next.js `16.2.0`, so the
  app was rolled back to the closest supported pre-16.2 release to reduce
  regression risk before considering a deeper runtime-entrypoint migration.
- **Dependency rollback:** Pinned `next`, `@next/env`, and `eslint-config-next`
  from `16.2.0` to `16.1.5` in `package.json` and regenerated `pnpm-lock.yaml`.
  `@opennextjs/cloudflare@1.17.1` remained in place and resolved cleanly against
  `next@16.1.5`.
- **Code-path decision:** Kept the existing `src/middleware.ts` +
  `src/proxy-handler.ts` request path unchanged because the smaller downgrade
  validated successfully without restoring the older `src/proxy.ts` convention.
- **Validation:** `pnpm install`, `pnpm run build`, and
  `pnpm exec vitest run src/__tests__/proxy-middleware.test.ts` passed on
  Windows. A full `pnpm run build:cloudflare` also passed from the Ubuntu WSL
  ext4 workspace with Next.js `16.1.5` and OpenNext generating
  `.open-next/worker.js` successfully.
- **Deploy follow-up:** The first production deploy still returned HTTP 500
  because `.env.local` contained `ENABLE_TEST_POSTING_BYPASS` and
  `NEXT_PUBLIC_ENABLE_TEST_POSTING_BYPASS`, and
  `scripts/preflight-cloudflare.js` was not yet blanking those variables for
  production builds. Adding both vars to `blockedProductionVars`, rebuilding,
  and redeploying fixed startup and restored HTTP 200 responses for `/`,
  `/login`, and `/api/health` on worker version
  `d569f782-6774-41ba-ab29-9bd8d98a5049`.
- **Residual warning:** The Cloudflare build still reports the expected Next.js
  deprecation warning for the `src/middleware.ts` convention, but it does not
  block the OpenNext bundle on `16.1.5`.

## RLS Access-Boundary Hardening Follow-up (2026-03-19)

- **Owner and self-service cleanup:** Removed the remaining low-risk admin reads
  from `src/app/dashboard/businesses/page.tsx`,
  `src/app/billing/success/page.tsx`, and `src/app/billing/cancel/page.tsx` so
  those pages now use the authenticated Supabase client for caller-owned data.
- **OAuth callback cleanup:** `src/app/(auth)/auth/callback/route.ts` now uses
  the authenticated client created by `exchangeCodeForSession()` to check or
  create the current user's `account_profiles` row instead of using an admin
  client for that self bootstrap path.
- **Audit artifact:** Added `docs/rls-access-boundary-hardening-2026-03-19.md`
  to document the completed route hardening pass, residual intentional elevated
  access, and regression evidence.
- **Anonymous intake tightening:** `src/app/api/contact/route.ts` still uses
  service access for lead and contact-event writes, but now rejects non-live
  targets and supports legacy `seller_id` ownership when resolving listing or
  promotion owners.
- **Validation:** Focused callback regression passed with
  `pnpm vitest run src/__tests__/auth-callback-route.test.ts`. Focused
  contact-route regression passed with
  `pnpm vitest run src/__tests__/contact-route.test.ts`.

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

## Cloudflare Middleware Compatibility Fix (2026-03-20)

- **Root cause fixed:** Next.js 16 `src/proxy.ts` resolves to the Node.js
  runtime, which OpenNext Cloudflare rejects with
  `Node.js middleware is not currently supported`.
- **Implementation:** Restored Edge `src/middleware.ts` as the active request
  gate, removed `src/proxy.ts`, kept the existing auth/CSP/route-protection
  logic in `src/proxy-handler.ts`, and updated the Cloudflare preflight cleanup
  so build-cache restores cannot reintroduce the stale proxy entry.
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

- Removed legacy dummy development accounts and their generated marketplace
  content during environment cleanup.
