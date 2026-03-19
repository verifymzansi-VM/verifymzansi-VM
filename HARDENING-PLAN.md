# VerifyMzansi — Pre-Launch Codebase Hardening Plan

**Date:** 2026-02-24 **Author:** Principal Engineer / QA Lead **Scope:** Full
codebase audit — 32 API routes, 104 components/hooks/stores, 40+ lib modules, 3
workers, 6 scripts, 4 CI workflows, middleware **KYC Decision:** Stub provider
accepted (manual-only verification queue at launch) **Middleware Convention:**
`src/proxy.ts` is the active request gate (migrated from the deprecated
`middleware.ts` convention on Next.js 16.2). **Status:** ✅ **IMPLEMENTATION
COMPLETE** (2026-02-24)

---

## Executive Summary

The codebase is **well-engineered overall** with strong security fundamentals
(nonce-based CSP, HSTS, AES-256-GCM encryption, POPIA audit logging, Zod
validation). The full audit uncovered **~80 findings** across 5 severity tiers.
All findings have been addressed — **102/107 items implemented, 5 deferred**
(items 66-69, 73: major component extraction too risky pre-launch).

### Implementation Results

| Metric            | Result                 |
| ----------------- | ---------------------- |
| TypeScript errors | **0**                  |
| Test files        | **104**                |
| Tests passing     | **791 / 791**          |
| Dev server        | **Working (HTTP 200)** |

### Findings Summary

| Severity | Count | Status                                |
| -------- | ----- | ------------------------------------- |
| CRITICAL | 4     | ✅ All done                           |
| HIGH     | 14    | ✅ All done                           |
| MEDIUM   | 35    | ✅ All done                           |
| LOW      | 27    | ✅ 22 done, ⏭️ 5 deferred post-launch |
| TESTS    | 25+   | ✅ All done (101 files, 755 tests)    |

---

## Phase 1 — CRITICAL Security Fixes (4 items, do first) ✅ COMPLETE

### 1. ✅ Gate Ozow dev bypass behind explicit env var, not `NODE_ENV`

- **File:**
  [src/app/api/webhooks/ozow/route.ts#L36](src/app/api/webhooks/ozow/route.ts#L36)
- **Problem:** `NODE_ENV === "development"` check allows `dev_bypass_signature`
  to bypass payment verification. Any staging/preview deployment with
  `NODE_ENV=development` is vulnerable to forged payment completions.
- **File:**
  [src/app/api/mock-ozow/route.ts#L16](src/app/api/mock-ozow/route.ts#L16)
- **Problem:** Entire mock payment endpoint active on all non-production
  deployments.
- **Fix:** Replace `NODE_ENV` checks with `ENABLE_DEV_PAYMENT_BYPASS === "true"`
  and `ENABLE_MOCK_OZOW === "true"` env vars. Add to `.env.example` with
  `# ⚠️ NEVER set in production` comments.

### 2. ✅ Harden Supabase auth config

- **File:** [supabase/config.toml](supabase/config.toml)
- **Problems:**
  - `minimum_password_length = 6` → increase to `8` (OWASP minimum)
  - `password_requirements = ""` → set to `"letters_digits"`
  - `enable_confirmations = false` → set to `true` (users can sign in without
    email verification)
  - `max_frequency = "1s"` → set to `"60s"` (allows 3600 emails/hour per user —
    email spam abuse)
  - `secure_password_change = false` → set to `true`

### 3. ✅ Fix Turnstile env-var template

- **File:** [cloudflare-env-vars.txt](cloudflare-env-vars.txt)
- **Problem:** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are
  commented out. New deployments following README will have **no CAPTCHA
  protection**.
- **Fix:** Uncomment both lines with placeholder values.

### 4. ✅ Remove hardcoded Supabase anon key from CI

- **File:** `.github/workflows/ci.yml` (lines ~91, ~120)
- **Problem:** Hardcoded `eyJ0eXAi...` JWT in CI config. Even as a test key,
  sets bad precedent and could be a real key.
- **Fix:** Move to GitHub repository secret `TEST_SUPABASE_ANON_KEY` and
  reference `${{ secrets.TEST_SUPABASE_ANON_KEY }}`.

---

## Phase 2 — HIGH Security & Reliability (14 items) ✅ COMPLETE

### 5. ✅ Add rate limiting to auth routes

- **Files:**
  - [src/app/api/auth/login/route.ts#L16](src/app/api/auth/login/route.ts#L16) —
    no brute-force rate limiting beyond Turnstile
  - [src/app/api/auth/register/route.ts#L15](src/app/api/auth/register/route.ts#L15)
    — no per-IP/email rate limit
  - [src/app/api/auth/forgot-password/route.ts#L16](src/app/api/auth/forgot-password/route.ts#L16)
    — can spam reset emails
- **Fix:** Add `rateLimit()` helper call using existing Cloudflare rate-limiter
  worker. Limits: 5/15min for login, 3/hour for register, 3/hour for
  forgot-password.

### 6. ✅ Add rate limiting + CAPTCHA to `/api/verify-buyer`

- **File:**
  [src/app/api/verify-buyer/route.ts#L13](src/app/api/verify-buyer/route.ts#L13)
- **Problem:** Unauthenticated, unrate-limited endpoint. UUID token space
  provides entropy but public endpoint should be protected from enumeration
  bots.
- **Fix:** Add Turnstile validation and per-IP rate limiting (10 req/min).

### 7. ✅ Fix silent audit logging failures (POPIA compliance)

- **File:**
  [src/lib/services/audit.ts#L67-L70](src/lib/services/audit.ts#L67-L70)
- **Problem:** Audit write failures silently swallowed with `console.error`. For
  POPIA compliance, undetectable breaches are unacceptable.
- **Fix:** Replace with structured `log.error()`, add `auditFailureCount`
  counter for monitoring. Consider dead-letter KV table for retry.

### 8. ✅ Fix XSS in email templates

- **File:** [src/lib/services/email.ts#L131](src/lib/services/email.ts#L131)
  (also ~L170, ~L298)
- **Problem:** `process.env.NEXT_PUBLIC_APP_URL` injected directly into `href`
  attributes without escaping. If tampered (e.g., `javascript:` protocol), XSS
  vector in email clients.
- **Fix:** Add `sanitizeAppUrl()` helper that validates URL starts with
  `https://` before interpolation.

### 9. ✅ Consolidate Turnstile components

- **Files:** [src/components/ui/turnstile.tsx](src/components/ui/turnstile.tsx)
  and
  [src/components/ui/turnstile-widget.tsx](src/components/ui/turnstile-widget.tsx)
- **Problem:** Two separate implementations with incompatible APIs (`onVerify`
  vs `onSuccess`). `turnstile-widget.tsx` has a dev-mode bypass that auto-calls
  `onSuccess("dev-bypass-token")` when `NODE_ENV === "development"`.
- **Fix:** Consolidate to one component. Remove client-side dev bypass — use
  server-side bypass logic only (in `src/lib/utils/turnstile.ts`).

### 10. ✅ Fix `useDebouncedCallback` memory leak

- **File:**
  [src/hooks/use-debounce.ts#L29-L53](src/hooks/use-debounce.ts#L29-L53)
- **Problem:** No cleanup `useEffect` — pending timer fires against unmounted
  component.
- **Fix:** Add `useEffect(() => () => clearTimeout(timerRef.current), [])`.

### 11. ✅ Fix unsafe env fallback

- **File:** [src/lib/config/env.ts#L168-L172](src/lib/config/env.ts#L168-L172)
- **Problem:** Build/CI fallback casts `process.env as unknown as Env`.
  Completely unvalidated env object — every call to `env()` returns potentially
  `undefined` while TypeScript says it's safe.
- **Fix:** Replace with explicit `createFallbackEnv()` that maps known keys with
  defaults or `""`. Log `log.warn("Running with partial env validation")`.

### 12. ✅ Add startup warning for stub KYC provider

- **File:**
  [src/lib/services/kyc-provider.ts#L88-L90](src/lib/services/kyc-provider.ts#L88-L90)
- **Problem:** `getConfiguredProvider()` always returns `StubKycProvider`
  (simulator with 1-2s random delay). Zero automated KYC at launch.
- **Fix:** Add
  `log.warn("KYC_PROVIDER=stub: All verifications route to manual review")` at
  startup. Add `KYC_PROVIDER` env var (default: `"stub"`) for explicit intent.

### 13. ✅ Harden Ozow sandbox guard

- **File:** [src/lib/services/ozow.ts#L91-L93](src/lib/services/ozow.ts#L91-L93)
- **Problem:** Mock signature accepted in dev+sandbox mode. If `OZOW_SANDBOX` is
  accidentally `"true"` in production, signature verification is bypassed.
- **Fix:** Add runtime check in `verifyOzowSignature()` that throws if
  `OZOW_SANDBOX === "true"` AND `NODE_ENV === "production"`. Document MD5 as
  accepted Ozow-mandated business risk.

### 14. ✅ Fix `DEV_EXPOSE_OTP` risk

- **File:**
  [src/app/api/otp/send/route.ts#L32-L37](src/app/api/otp/send/route.ts#L32-L37)
- **Problem:** Raw OTP returned to client when `DEV_EXPOSE_OTP=true` +
  non-production + localhost. If env var is set on any non-local deployment,
  OTPs leak.
- **Fix:** Add `validateEnv()` check that `DEV_EXPOSE_OTP` is not set when
  `NODE_ENV === "production"`. Log error and skip OTP exposure.

### 15. ✅ Secure storage key generation

- **File:**
  [src/lib/services/storage.ts#L87-L88](src/lib/services/storage.ts#L87-L88)
- **Problem:** `Math.random().toString(36)` for storage key random component.
  Not cryptographically secure — potential for predictable keys.
- **Fix:** Replace with `crypto.randomUUID()`.

### 16. ✅ Add video MIME validation strictness

- **File:**
  [src/app/api/media/upload/route.ts#L122-L127](src/app/api/media/upload/route.ts#L122-L127)
- **Problem:** If `detectedMime` is `null` for a video, it's allowed through.
  Attacker could upload malicious file with `.mp4` extension and spoofed
  Content-Type.
- **Fix:** Reject uploads where `detectedMime` is `null` for video files. Log
  rejected upload.

### 17. ✅ Add `actorRole` to admin audit calls

- **File:**
  [src/app/api/admin/verification/decide/route.ts#L154-L170](src/app/api/admin/verification/decide/route.ts#L154-L170)
- **Problem:** `actorRole` missing in final audit log call — role is available
  from `getRoleFromUser()` but not passed.
- **Fix:** Pass `actorRole: role` to `logAuditEvent()`. Audit all similar admin
  routes.

### 18. ✅ Host fallback images locally

- **Files:**
  [src/components/home/hero-banner.tsx](src/components/home/hero-banner.tsx),
  [src/components/showroom/showroom-hero.tsx](src/components/showroom/showroom-hero.tsx)
- **Problem:** Hardcoded fallback URLs point to `images.unsplash.com` and
  `storage.googleapis.com`. If external domains are compromised, users see
  attacker-controlled images.
- **Fix:** Download fallback images to `/public/images/fallbacks/` and reference
  locally.

---

## Phase 3 — MEDIUM Hardening (35 items) ✅ COMPLETE

### 19. ✅ Tighten CSP directives in middleware

- **File:** [src/proxy.ts](src/proxy.ts) (via `proxy-handler.ts`)
- **Fix:**
  - Replace `connect-src 'self' https:` with explicit origins (Supabase, Sentry,
    Cloudflare)
  - Replace `img-src 'self' data: blob: https:` with specific CDN domains
  - Add `report-uri` to Sentry CSP endpoint
  - Add `worker-src 'self'` for `sw.js`
  - Add `upgrade-insecure-requests`

### 20. ✅ Fix anonymous user bypass in middleware

- **File:** [src/proxy.ts](src/proxy.ts) (via `proxy-handler.ts`)
- **Problem:** `!user` check passes for anonymous Supabase users since `user` is
  non-null. Anonymous sessions can access `/dashboard`, `/billing`,
  `/verification`.
- **Fix:** Change to `if (!user || user.is_anonymous)`.

### 21. ✅ Expand vitest coverage scope

- **File:** [vitest.config.ts](vitest.config.ts)
- **Fix:** Add `src/components/**`, `src/hooks/**`, `src/stores/**` to coverage
  `include`. Set strict thresholds (90/85/90/90) as default.

### 22. ✅ Use production build for E2E tests

- **File:** [playwright.config.ts](playwright.config.ts)
- **Fix:** Change `webServer.command` from `"pnpm dev"` to
  `"pnpm build && pnpm start"`. Add `screenshot: 'only-on-failure'`.

### 23. ✅ Promote ESLint rules

- **File:** [eslint.config.mjs](eslint.config.mjs)
- **Fix:**
  - `@typescript-eslint/no-explicit-any` → `"error"`
  - Add `no-console: ["error", { allow: ["warn", "error"] }]`
  - Promote a11y rules (`click-events-have-key-events`,
    `no-noninteractive-element-interactions`, `label-has-associated-control`,
    `interactive-supports-focus`) from `"warn"` to `"error"`

### 24. ✅ Fix PII gaps in logger

- **File:** [src/lib/utils/logger.ts#L32-L41](src/lib/utils/logger.ts#L32-L41)
- **Fix:** Add `firstName`, `first_name`, `lastName`, `last_name`, `address`,
  `dob`, `date_of_birth`, `dateOfBirth` to PII field set. Add array handling in
  `scrubPii()`.

### 25. ✅ Add cache thundering herd protection

- **File:**
  [src/lib/services/cache.ts#L43-L52](src/lib/services/cache.ts#L43-L52)
- **Problem:** No deduplication of concurrent fetches. Thundering herd on
  expired keys.
- **Fix:** Implement singleflight pattern — concurrent callers for same key
  share one promise.

### 26. ✅ Add error handling to consent service

- **File:**
  [src/lib/services/consent.ts#L31-L37](src/lib/services/consent.ts#L31-L37)
- **Problem:** No error handling on `supabase.from("consent_records").upsert()`.
  DB error throws uncaught, no audit event logged.
- **Fix:** Wrap in try/catch, log errors, return result type.

### 27. ✅ Fix enforcement error handling

- **File:**
  [src/lib/services/enforcement.ts#L54](src/lib/services/enforcement.ts#L54)
- **Fix:** Replace raw `error.message` with `"Failed to update account status"`.
  Wrap moderation action insert (L67-73) in try/catch.

### 28. ✅ Add input validation for geocoding

- **File:**
  [src/lib/services/geocoding.ts#L57-L59](src/lib/services/geocoding.ts#L57-L59)
- **Fix:** Add SA bounding box validation (lat: -35 to -22, lon: 16 to 33).
  Validate `GEOCODING_API_URL` is a proper URL. Wrap `response.json()` in
  try/catch.

### 29. ✅ Validate OTP format before sending

- **File:**
  [src/lib/services/sms.ts#L110-L114](src/lib/services/sms.ts#L110-L114)
- **Fix:** Add `z.string().regex(/^\d{6}$/).parse(otp)` validation before
  embedding in SMS text.

### 30. ✅ Fix KYC engine HMAC fallback

- **File:**
  [src/lib/services/kyc-engine.ts#L116-L117](src/lib/services/kyc-engine.ts#L116-L117)
- **Problem:** If `HMAC_SECRET` is missing, processing continues without HMAC
  reuse check. Silently disables fraud-detection signal.
- **Fix:** Add risk signal `"hmac_unavailable"` to result instead of silently
  skipping.

### 31. ✅ Replace `alert()` in plan-gate

- **File:**
  [src/components/billing/plan-gate.tsx](src/components/billing/plan-gate.tsx)
- **Problem:** Browser `alert()` for checkout errors — blocks UI, bad mobile UX,
  blocked by popup blockers.
- **Fix:** Use existing `useToast()` hook.

### 32. ✅ Add IntersectionObserver to video cards

- **Files:**
  [src/components/listings/mall-card.tsx](src/components/listings/mall-card.tsx),
  [business-ad-card.tsx](src/components/listings/business-ad-card.tsx),
  [listing-card.tsx](src/components/listings/listing-card.tsx)
- **Problem:** All video cards use `autoPlay loop muted playsInline`. On listing
  grids, potentially dozens of videos autoplay simultaneously — massive
  bandwidth consumption, critical issue for SA mobile users on limited data.
- **Fix:** Use `IntersectionObserver` — only play when visible, pause when
  scrolled away.

### 33. ✅ Fix `listing-wizard-store` weak typing

- **File:**
  [src/stores/listing-wizard-store.ts](src/stores/listing-wizard-store.ts)
- **Problem:** `ListingDraft = Record<string, unknown>` — entire form data is
  untyped.
- **Fix:** Define proper `ListingDraft` interface matching backend schema.

### 34. ✅ Fix contact message stored XSS risk

- **File:**
  [src/app/api/contact/route.ts#L100-L107](src/app/api/contact/route.ts#L100-L107)
- **Problem:** `message` field stored without sanitization. If rendered in admin
  panel without escaping, stored XSS.
- **Fix:** Sanitize with HTML entity escape or document that admin rendering
  uses React (auto-escapes).

### 35. ✅ Add worker tempKey prefix validation

- **File:** [workers/kyc-encryptor.ts#L77](workers/kyc-encryptor.ts#L77)
- **Problem:** No validation of `payload.tempKey`. Attacker with API key could
  encrypt/probe arbitrary R2 files.
- **Fix:** Validate `tempKey` starts with `temp/kyc/`.

### 36. ✅ Add missing UUID validation on boost routes

- **Files:**
  [src/app/api/storefronts/[id]/boost/route.ts#L28](src/app/api/storefronts/%5Bid%5D/boost/route.ts#L28),
  [src/app/api/business-ads/[id]/boost/route.ts#L28](src/app/api/business-ads/%5Bid%5D/boost/route.ts#L28)
- **Fix:** Validate `[id]` param as UUID format with Zod before DB query.

### 37. ✅ Fix blob URL memory leak in evidence viewer

- **File:**
  [src/components/admin/evidence-viewer.tsx](src/components/admin/evidence-viewer.tsx)
- **Problem:** Old blob URL not revoked before setting new one in fetch
  callback.
- **Fix:** `URL.revokeObjectURL(prevBlobUrl)` before setting new blob URL.

### 38. ✅ Add `ErrorBoundary` wrappers to critical sections

- **Wrap:** Evidence viewer, billing plan-gate flow, admin dashboard panels,
  listing card grids
- **Using:**
  [src/components/shared/error-boundary.tsx](src/components/shared/error-boundary.tsx)

### 39. ✅ Add deploy rollback in CI

- **File:** `.github/workflows/deploy.yml`
- **Fix:** After health check, if it fails, run `wrangler pages rollback`.

### 40. ✅ Fix `check-supabase-schema.ts` to verify columns

- **File:**
  [scripts/check-supabase-schema.ts#L67](scripts/check-supabase-schema.ts#L67)
- **Fix:** Expand `select` to include critical columns per table (e.g.,
  `select("id, created_at, user_id")`).

### 41. ✅ Add preflight connectivity checks

- **File:** [scripts/preflight-check.ts#L142](scripts/preflight-check.ts#L142)
- **Fix:** R2: minimal `HeadBucket` call. Turnstile: verify with dummy challenge
  token. Add `AbortSignal.timeout(10_000)` to all HTTP calls.

### 42. ✅ Expand secret-scan rules

- **File:** [scripts/secret-scan.ts#L32-L49](scripts/secret-scan.ts#L32-L49)
- **Fix:** Add patterns for Ozow passphrase, Resend API keys (`re_`), Cloudflare
  API tokens (`cf_`), Turnstile secrets, 64-char hex strings outside `.env`
  files.

### 43. ✅ Add Tailwind safelist for dynamic classes

- **File:** [tailwind.config.ts](tailwind.config.ts)
- **Fix:** Add `safelist` array for trust-level badge colors and
  dynamically-computed class names.

### 44. ✅ Pin `next.config.js` image remote patterns

- **File:** [next.config.js#L10](next.config.js#L10)
- **Fix:** Replace `hostname: "*.supabase.co"` with specific
  `tnygdgormnofpgjknlhr.supabase.co`.

### 45. ✅ Document `.env.example` Ozow sandbox risk

- **File:** `.env.example`
- **Fix:** Add prominent `# ⚠️ SET TO false IN PRODUCTION` comment next to
  `OZOW_SANDBOX=true`.

### 46. ✅ Fix `use-auth.ts` null-safety

- **File:** [src/hooks/use-auth.ts#L35](src/hooks/use-auth.ts#L35)
- **Fix:** Change `user_metadata.display_name as string` to
  `(user_metadata?.display_name ?? "") as string`.

### 47. ✅ Fix cross-tab favourite sync

- **File:**
  [src/components/listings/listing-card.tsx](src/components/listings/listing-card.tsx)
- **Fix:** Dispatch custom `"favourites-changed"` event in toggle handler,
  subscribe in `useSyncExternalStore`.

### 48. ✅ Wire MallHero search or remove it

- **File:**
  [src/components/listings/mall-hero.tsx#L52-L60](src/components/listings/mall-hero.tsx#L52-L60)
- **Problem:** Search input has no `onChange` handler — decorative only.
- **Fix:** Wire to store's search filter or replace with static CTA.

### 49. ✅ Harden `.env.example` dev-only vars

- **Fix:** Add `# ⚠️ NEVER SET IN PRODUCTION` comments to: `DEV_EXPOSE_OTP`,
  `ENABLE_DEV_PAYMENT_BYPASS`, `ENABLE_MOCK_OZOW`.

### 50. ✅ Add DSAR page loading state

- **Fix:** Create [src/app/dsar/loading.tsx](src/app/dsar/loading.tsx) with
  skeleton UI.

### 51. ✅ Fix ID number duplication in DSAR schema

- **File:**
  [src/lib/validations/verification.ts#L110](src/lib/validations/verification.ts#L110)
- **Fix:** Reuse `saIdSchema` for DSAR `idNumber` validation (includes Luhn
  check) instead of inline regex.

### 52. ✅ Use `parseJsonRequest` consistently

- **Files:**
  [src/app/api/verification/location/gps/route.ts#L55](src/app/api/verification/location/gps/route.ts#L55),
  [src/app/api/admin/feature-flags/toggle/route.ts#L51](src/app/api/admin/feature-flags/toggle/route.ts#L51)
- **Fix:** Replace `request.json()` with project's `parseJsonRequest` helper.

### 53. ✅ Add `min={0}` to price filter inputs

- **Files:**
  [src/components/listings/listing-filters.tsx](src/components/listings/listing-filters.tsx),
  [listing-filter-sidebar.tsx](src/components/listings/listing-filter-sidebar.tsx)
- **Fix:** Add `min={0}` to all price `<Input type="number">` elements.

---

## Phase 4 — LOW Severity Polish (27 items) ✅ 22/27 DONE, ⏭️ 5 DEFERRED

| #   | Item                                                                        | File                                                                         | Status      |
| --- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------- |
| 54  | Bump `version` from `0.1.0` to `1.0.0`                                      | [package.json](package.json)                                                 | ✅          |
| 55  | Add `"packageManager": "pnpm@10.2.1"`                                       | [package.json](package.json)                                                 | ✅          |
| 56  | Add `"preinstall": "npx only-allow pnpm"`                                   | [package.json](package.json)                                                 | ✅          |
| 57  | Set `reactStrictMode: true` explicitly                                      | [next.config.js](next.config.js)                                             | ✅          |
| 58  | Add null guard to `slugify()`                                               | [src/lib/utils.ts#L17](src/lib/utils.ts#L17)                                 | ✅          |
| 59  | Add NaN guard to `formatZAR()`                                              | [src/lib/utils/format.ts#L5](src/lib/utils/format.ts#L5)                     | ✅          |
| 60  | Fix misleading CQRS comment: "Example" → "Registered"                       | [src/lib/cqrs/index.ts#L119](src/lib/cqrs/index.ts#L119)                     | ✅          |
| 61  | Fix KYC engine comment: ">3" → "≥4"                                         | [src/lib/services/kyc-engine.ts#L95](src/lib/services/kyc-engine.ts#L95)     | ✅          |
| 62  | Add debug logging to cookie set/remove catch blocks                         | [src/lib/supabase/server.ts#L35-L43](src/lib/supabase/server.ts#L35-L43)     | ✅          |
| 63  | Add max buffer size check (100MB) before decryption                         | [src/lib/utils/encryption.ts#L79](src/lib/utils/encryption.ts#L79)           | ✅          |
| 64  | Add `log.warn` in `plan-tier.ts` catch block                                | [src/lib/services/plan-tier.ts#L48](src/lib/services/plan-tier.ts#L48)       | ✅          |
| 65  | Use `useAuthStore()` in header instead of duplicate subscription            | [src/components/layout/header.tsx](src/components/layout/header.tsx)         | ✅          |
| 66  | Extract shared `VideoCard` component from 3 card components                 | mall-card, business-ad-card, listing-card                                    | ⏭️ Deferred |
| 67  | Extract shared `HeroCarousel` base from 2 hero components                   | hero-banner, showroom-hero                                                   | ⏭️ Deferred |
| 68  | Parametrize 3 duplicate category strips into one component                  | category-strip, mall-shop-category-strip, business-ad-category-strip         | ⏭️ Deferred |
| 69  | Parametrize 3 duplicate grid headers into one component                     | mall-shop-header, business-ad-header, listing-grid-header                    | ⏭️ Deferred |
| 70  | Fix keyboard handlers on video overlays (`role="button" tabIndex={0}`)      | mall-card, business-ad-card                                                  | ✅          |
| 71  | Add `aria-label` to MallHero button, filter selects, fullscreen toggle      | Multiple components                                                          | ✅          |
| 72  | Complete listings barrel export                                             | [src/components/listings/index.ts](src/components/listings/index.ts)         | ✅          |
| 73  | Merge `usePlanMaxPhotos`/`usePlanVideoAllowed` into `usePlanEntitlements()` | [src/components/billing/plan-gate.tsx](src/components/billing/plan-gate.tsx) | ⏭️ Deferred |
| 74  | Add `.dockerignore` exclusions for `e2e/`, `docs/`, `scripts/`              | [.dockerignore](.dockerignore)                                               | ✅          |
| 75  | Add `HEALTHCHECK` instruction                                               | [Dockerfile](Dockerfile)                                                     | ✅          |
| 76  | Pin `engines.node` upper bound to `">=20.0.0 <23"`                          | [package.json](package.json)                                                 | ✅          |
| 77  | Update Cloudflare `compatibility_date` to `2026-01-01`                      | All 4 wrangler configs                                                       | ✅          |
| 78  | Add Mobile Safari (`iPhone 14`) to Playwright projects                      | [playwright.config.ts](playwright.config.ts)                                 | ✅          |
| 79  | Fix `extractLicenseStrings` dead early return                               | [scripts/check-licenses.ts#L18](scripts/check-licenses.ts#L18)               | ✅          |
| 80  | Fix Zod version mention in Launch Report (`^3.25.67` → `^4.3.6`)            | [docs/LAUNCH-READINESS-REPORT.md](docs/LAUNCH-READINESS-REPORT.md)           | ✅          |

---

## Phase 5 — Comprehensive Test Suite (~25 new test files) ✅ COMPLETE

### API Route Tests (17 missing routes)

| #   | Test File                                              | Routes Covered                         | Key Test Cases                                                                           |
| --- | ------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------- |
| 81  | `src/app/api/auth/login/route.test.ts`                 | `POST /api/auth/login`                 | Valid login, invalid credentials, missing fields, Turnstile validation, anti-enumeration |
| 81  | `src/app/api/auth/register/route.test.ts`              | `POST /api/auth/register`              | Valid registration, duplicate email, weak password, Turnstile                            |
| 81  | `src/app/api/auth/sign-out/route.test.ts`              | `POST /api/auth/sign-out`              | Authenticated sign-out, unauthenticated call                                             |
| 81  | `src/app/api/auth/forgot-password/route.test.ts`       | `POST /api/auth/forgot-password`       | Always-success (anti-enumeration), invalid email format                                  |
| 82  | `src/app/api/listings/[id]/boost/route.test.ts`        | `POST /api/listings/[id]/boost`        | Auth, ownership, entitlement, duplicate boost, invalid UUID                              |
| 82  | `src/app/api/storefronts/[id]/boost/route.test.ts`     | `POST /api/storefronts/[id]/boost`     | Same as above                                                                            |
| 82  | `src/app/api/business-ads/[id]/boost/route.test.ts`    | `POST /api/business-ads/[id]/boost`    | Same as above                                                                            |
| 83  | `src/app/api/dsar/submit/route.test.ts`                | `POST /api/dsar/submit`                | Valid submission, invalid SA ID, 30-day deadline, Turnstile                              |
| 83  | `src/app/api/admin/dsar/decide/route.test.ts`          | `POST /api/admin/dsar/decide`          | Admin-only gate, already-processed rejection                                             |
| 84  | `src/app/api/contact/route.test.ts`                    | `POST /api/contact`                    | Valid submission, Turnstile, empty fields, XSS payload                                   |
| 85  | `src/app/api/reports/route.test.ts`                    | `POST /api/reports`                    | Valid report, missing IP_HASH_SECRET in production, Turnstile                            |
| 86  | `src/app/api/admin/flagging/action/route.test.ts`      | `POST /api/admin/flagging/action`      | RBAC (admin vs moderator vs user), all action types                                      |
| 86  | `src/app/api/admin/content/decide/route.test.ts`       | `POST /api/admin/content/decide`       | RBAC, valid actions, invalid payloads                                                    |
| 86  | `src/app/api/admin/feature-flags/toggle/route.test.ts` | `POST /api/admin/feature-flags/toggle` | Admin-only (not moderator), legacy + canary formats                                      |
| 87  | `src/app/api/health/route.test.ts`                     | `GET /api/health`                      | Returns 200, correct JSON shape                                                          |
| 88  | `src/app/api/verification/location/gps/route.test.ts`  | `POST /api/.../gps`                    | Auth, GPS bounds, province whitelist, feature flag                                       |
| 88  | `src/app/api/verification/status/route.test.ts`        | `GET /api/verification/status`         | Auth, user-scoped data only                                                              |

### Hook Tests (all new)

| #   | Test File                            | Key Test Cases                                              |
| --- | ------------------------------------ | ----------------------------------------------------------- |
| 89  | `src/hooks/use-debounce.test.ts`     | Debounce timing, cleanup on unmount, cancellation           |
| 90  | `src/hooks/use-auth.test.ts`         | Session detection, role extraction, sign-out, null metadata |
| 91  | `src/hooks/use-realtime.test.ts`     | Subscription setup/teardown, reconnection on error          |
| 92  | `src/hooks/use-media-upload.test.ts` | Progress tracking, file validation, error states            |
| 93  | `src/hooks/use-toast.test.ts`        | Add/dismiss/auto-dismiss timing, max toast limit            |

### Component Tests (all new)

| #   | Test File                                       | Key Test Cases                                          |
| --- | ----------------------------------------------- | ------------------------------------------------------- |
| 94  | `src/components/shared/error-boundary.test.tsx` | Fallback rendering, error reporting, retry              |
| 95  | `src/components/billing/plan-gate.test.tsx`     | Entitlement gating, upgrade prompt, checkout initiation |
| 96  | `src/components/listings/listing-card.test.tsx` | Favourite toggle, video autoplay, skeleton, empty data  |
| 97  | `src/components/admin/evidence-viewer.test.tsx` | Blob URL lifecycle, decryption error, access denial     |
| 98  | `src/components/admin/kyc-queue-table.test.tsx` | Admin decision flow, pagination, empty queue            |
| 99  | `src/components/ui/turnstile.test.tsx`          | Widget loading, token callback, error fallback          |

### Store Tests (all new)

| #   | Test File                                 | Key Test Cases                                         |
| --- | ----------------------------------------- | ------------------------------------------------------ |
| 100 | `src/stores/listing-wizard-store.test.ts` | Draft persistence, step progression, reset, validation |
| 101 | `src/stores/notification-store.test.ts`   | Add/dismiss/clear, max limit, auto-dismiss             |

### E2E Enhancements

| #   | Enhancement                          | Details                                                      |
| --- | ------------------------------------ | ------------------------------------------------------------ |
| 102 | Set `E2E_EMAIL`/`E2E_PASSWORD` in CI | Fail early if missing instead of silently skipping auth flow |
| 103 | Add DSAR E2E test                    | Submit request → verify confirmation → admin processes it    |
| 104 | Add contact form E2E test            | Submit form → verify success toast                           |

---

## Phase 6 — Documentation & Launch Checklist ✅ COMPLETE

### 105. ✅ Update README Quick Start

- Show Turnstile env vars as required (not commented out)
- Add note about `ENABLE_MOCK_OZOW` and `DEV_EXPOSE_OTP` being dev-only
- Add `pnpm preflight` as a required step before first deploy

### 106. ✅ Add RUNBOOK section

Document:

- How to rotate secrets (Ozow, Supabase, R2, encryption keys, HMAC)
- How to enable/disable feature flags
- How to process DSAR requests within 30-day POPIA deadline
- How to check audit logs for compliance
- How to rollback a deployment
- How to add a new KYC provider (replace stub)

### 107. ✅ Update Launch Readiness Report

- Add hardening pass findings and resolutions
- Update Zod version reference
- Update test count after new tests are added
- Update security posture summary

---

## Verification Checklist

### Automated (must all pass)

- [x] `pnpm typecheck` — zero errors ✅
- [x] `pnpm lint` — zero errors/warnings ✅
- [x] `pnpm test` — 101 files, 755 tests passing ✅
- [ ] `pnpm test -- --coverage` — all 4 thresholds at 90%+ (run with coverage to
      verify)
- [ ] `pnpm test:e2e` — all specs pass (requires staging deployment)
- [ ] `pnpm preflight` — all checks pass with production env vars
- [x] `pnpm secret-scan` — zero findings ✅

### Manual (deploy to staging)

- [ ] Turnstile challenges appear on register/login/contact/report pages
- [ ] `/api/mock-ozow` returns 404 on staging (no `ENABLE_MOCK_OZOW`)
- [ ] Ozow webhook rejects `dev_bypass_signature` on staging
- [ ] Banned user sees `/banned` page and cannot access `/dashboard`
- [ ] Password reset flow works end-to-end
- [ ] Supabase dashboard: email confirmations enabled, password length ≥8
- [ ] CSP report-uri is receiving reports (check Sentry)
- [ ] Audit log writes are succeeding (check monitoring)
- [ ] KYC manual review queue processes correctly
- [ ] All 3 Cloudflare workers respond to health checks

### Production Deploy

- [ ] `OZOW_SANDBOX=false` confirmed
- [ ] `ENABLE_DEV_PAYMENT_BYPASS` not set
- [ ] `ENABLE_MOCK_OZOW` not set
- [ ] `DEV_EXPOSE_OTP` not set
- [ ] All secrets rotated from test values
- [ ] Supabase network restrictions enabled (not `0.0.0.0/0`)
- [ ] Post-deploy health check passes
- [ ] Synthetic monitoring active (30-min interval)

---

## Accepted Decisions

| Decision                                      | Rationale                                                                                                                                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **KYC stub provider at launch**               | Intentional manual-only review. Documented with `KYC_PROVIDER=stub` env var and startup warning.                                                                                                    |
| **`src/proxy.ts` is the active request gate** | Migrated from deprecated `middleware.ts` to `proxy.ts` on Next.js 16.2. Shared logic remains in `proxy-handler.ts`.                                                                                 |
| **MD5 in Ozow signatures**                    | Ozow-mandated. Documented as accepted business risk.                                                                                                                                                |
| **`style-src 'unsafe-inline'`**               | Required by Tailwind CSS + shadcn component styles. Nonce-based styles deferred post-launch.                                                                                                        |
| **No MFA at launch**                          | Supabase MFA disabled. Acceptable for initial launch; plan to add for admin accounts in first sprint.                                                                                               |
| **Items 66-69, 73 deferred**                  | Major component extraction/DRY refactors (VideoCard, HeroCarousel, CategoryStrip, GridHeader, plan entitlements hook). Too high regression risk pre-launch. Scheduled for first post-launch sprint. |

---

## Priority Execution Order

1. **Phase 1** (CRITICAL) — do immediately, blocks launch
2. **Phase 5 items 81-88** (auth/payment/admin route tests) — validates Phase
   1+2 fixes
3. **Phase 2** (HIGH) — do before launch
4. **Phase 3 items 19-20** (CSP + anonymous user) — security-critical MEDIUM
   items
5. **Phase 5 remaining** (hooks, components, stores, E2E) — test coverage
6. **Phase 3 remaining** — hardening
7. **Phase 4** — polish
8. **Phase 6** — documentation update
