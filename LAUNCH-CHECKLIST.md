# VerifyMzansi Launch Checklist

**Date:** 2026-03-13  
**Status:** Release gate checklist with split blocking and deep validation lanes

## 1. Required Local Verification

Run the blocking lane from the repo root:

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

Run the deeper confidence lane before higher-risk releases, larger refactors, or
shared infrastructure changes:

```bash
pnpm test:coverage:core
pnpm test:e2e
```

Run the production-only checks before final production deploy approval:

```bash
pnpm validate:launch-env
pnpm preflight:prod
pnpm cloudflare:secrets:check
pnpm cloudflare:posture
pnpm cloudflare:posture:strict
pnpm cloudflare:posture:strict:zone
# Or run both production checks and strict edge gate in one command:
pnpm preflight:prod:edge
```

Failure triage map:

- `pnpm validate:launch-env` failure: fix missing or placeholder secrets first
  (`KYC_WEBHOOK_SECRET`, `OZOW_*`, `AFRICASTALKING_SENDER_ID`, `RESEND_API_KEY`,
  Turnstile keys).
- `pnpm preflight:prod` failure: inspect whether failure is config
  (`Launch env`, `Production secrets`, `Ozow`) or connectivity
  (`Supabase schema`, `R2`) before retrying.
- `pnpm cloudflare:posture` warning/failure: inspect edge posture findings
  (HSTS, DNSSEC DS, `www` hostname routing, `/api/health` status, HTTP protocol)
  and close high-risk warnings before launch sign-off.
- `pnpm cloudflare:posture:strict` failure: treat as launch blocker for
  runtime-critical checks (health and HSTS).
- `pnpm cloudflare:posture:strict:zone` failure: resolve zone-governance checks
  (`www` routing/DNS behavior and DNSSEC DS) before final sign-off.
- `pnpm cloudflare:secrets:check` failure: add missing Worker secrets (for
  example `KYC_WEBHOOK_SECRET`) and remove forbidden production bypass secrets
  before any deploy promotion.
- `pnpm test:launch:flows` failure: prioritize billing roundtrip and DSAR flow
  regressions before non-critical e2e suites.

## 2. Production Env Contract

These values must be present and valid in both GitHub Actions secrets and the
deployed Cloudflare/Wrangler runtime secrets:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL=https://...`
- `AFRICASTALKING_API_KEY`
- `AFRICASTALKING_USERNAME` using the real production account, not `sandbox`
- `AFRICASTALKING_SENDER_ID`
- `RESEND_API_KEY`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `KYC_ENCRYPTION_KEY`
- `ID_ENCRYPTION_KEY`
- `HMAC_SECRET`
- `IP_HASH_SECRET`
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `OZOW_ENV=production`
- `OZOW_CLIENT_ID`
- `OZOW_CLIENT_SECRET`
- `OZOW_SITE_CODE`
- `OZOW_WEBHOOK_SECRET`
- Optional `OZOW_API_BASE_URL` only when explicitly required. In production, it
  must be `https://one.ozow.com`.
- `KYC_WEBHOOK_SECRET`

Failing any of the above should block deploy.

If `RATE_LIMITER_API_KEY` is set, `OTP_RATE_LIMITER_URL` must also be set.

`ENABLE_DEV_KYC_WEBHOOK_BYPASS` is local-development-only and must never be set
outside explicit localhost development. Production startup validation now treats
it the same as other dev bypass flags.

## 3. Data and Billing Checks

- Confirm Ozow is in production mode and can receive callbacks at
  `/api/webhooks/ozow`.
- Confirm authenticated members can cancel active subscriptions via
  `POST /api/billing/cancel`.
- Confirm authenticated members can start in-area plan changes via
  `POST /api/billing/change-plan`.
- Confirm the Ozow webhook path rejects unsigned requests, amount mismatches,
  and currency mismatches before fulfillment, and that fulfillment failures roll
  back `processing` status.
- Confirm successful subscription fulfillment writes one `invoices` row per
  payment and duplicate webhook deliveries do not create duplicate invoices.
- Confirm malformed JSON posted to `/api/webhooks/ozow` returns `400` and does
  not trigger fulfillment.
- Run `pnpm test:launch:flows` before release to exercise the bundled billing,
  OTP, and DSAR launch paths in one command.
- Confirm the KYC provider webhook secret is configured before enabling live
  provider callbacks at `/api/webhooks/kyc/provider`.
- Confirm Africa's Talking sender approval is complete for the live sender ID.
- Confirm Resend domain verification is complete for the production sender
  domain.
- Confirm the shared rate-limiter worker is healthy. Verification upload,
  session start, GPS location, manual location, OTP, and billing checkout now
  fail closed with `503` when shared abuse protection is unavailable.

## 4. Deployment Path

Canonical path:

1. Merge or push to `master`
2. Let GitHub Actions run the blocking CI gate on Node `22.x`: `pnpm lint`,
   `pnpm typecheck`, `pnpm test:blocking`, `pnpm preflight`, `pnpm secret-scan`,
   `pnpm security:audit`, `pnpm licenses:check`, `pnpm build`, and Playwright
   smoke on `chromium` plus `mobile-chrome`
3. Let the deploy workflow run `pnpm secret-scan`, `pnpm security:audit`,
   `pnpm licenses:check`, `pnpm validate:launch-env`, and `pnpm preflight:prod`
4. Verify the workflow passes the post-deploy `/api/health` gate

Manual local Cloudflare builds are only supported on Ubuntu or WSL with an
ext4-backed workspace. Native Windows remains unsupported.

## 5. Post-Deploy Checks

- `/api/health` returns HTTP `200` with `status: "ok"`
- Homepage, login, pricing, `Mzansi Business`, and promotions pages render
- Anonymous access to protected routes redirects correctly
- OTP, email, billing webhooks, and file uploads work without 5xx errors
- Admin moderation and KYC review pages load for staff accounts
- No new warning classes appear beyond the documented OpenNext/Cloudflare
  warning classes

## 6. Sensitive Calls Hardening Verification

- [ ] Register → login redirect does NOT include `?email=` in the URL
- [ ] Password reset uses `/api/auth/reset-password` (not direct Supabase client
      call)
- [ ] POST `/api/listings/[id]/boost`, `/featured`, `/urgent` reject
      cross-origin requests (403)
- [ ] POST `/api/businesses/[id]/boost` rejects cross-origin requests (403)
- [ ] PUT+DELETE `/api/promotions/[id]` reject cross-origin requests (403)
- [x] POST `/api/dsar/submit` rejects cross-origin requests (403)
- [x] POST `/api/verify-buyer` rejects cross-origin requests (403)
- [x] Admin evidence desk fetches artifacts via POST body (not GET query params)
- [x] Admin Evidence Desk navigation uses clean URL (no stepId/userId query
      params)
- [ ] `GET /api/media/serve/kyc/...` returns 400 (key prefix blocked)
- [ ] `GET /api/promotions?business_id=not-a-uuid` returns 400
- [ ] No PII (email, ID number, artifact IDs) appears in browser URL bar during
      normal flows
- [ ] Full inventory: `docs/sensitive-calls-inventory.md`

## 7. Release Decision

Call the release launch-ready only when:

- Every blocking-lane command passes on the release candidate branch
- Production-only validation passes
- Any required deep-lane checks for the change set pass
- The production deploy workflow completes without degraded health output

## 8. Why Startup Fails

The most common launch blockers are:

- Node.js is outside the supported `20.x` to `25.x` range
- `NEXT_PUBLIC_APP_URL` does not match the real environment origin
- A production secret is missing or malformed
- `RATE_LIMITER_API_KEY` is configured without `OTP_RATE_LIMITER_URL`
- `OZOW_API_BASE_URL` is set to a non-Ozow or non-HTTPS host
- Owner-column metadata probing fails for marketplace tables (`listings` or
  `businesses`), causing controlled `503` responses until schema metadata
  recovers
- `KYC_ENCRYPTION_KEY`, `ID_ENCRYPTION_KEY`, or `HMAC_SECRET` still contain the
  build-phase placeholder value (`cafebabe` repeated). Production startup now
  hard-blocks when these are detected — generate real keys with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

## 9. Startup Strictness

By default, production env validation failures are non-fatal (availability-first
approach). To enable fail-closed startup behavior — blocking the entire worker
on any env validation error — set:

```bash
STRICT_ENV_STARTUP_BLOCK=1
```

This is recommended for regulated production deployments where a misconfigured
service should never silently serve real users. When set, any error from
`validateEnv()` will crash the worker at startup before handling any requests.

Run `pnpm validate:launch-env` first when startup or deploy validation fails.
