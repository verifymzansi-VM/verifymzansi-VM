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
```

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
- `KYC_WEBHOOK_SECRET`

Failing any of the above should block deploy.

If `RATE_LIMITER_API_KEY` is set, `OTP_RATE_LIMITER_URL` must also be set.

`ENABLE_DEV_KYC_WEBHOOK_BYPASS` is local-development-only and must never be set
outside explicit localhost development. Production startup validation now treats
it the same as other dev bypass flags.

## 3. Data and Billing Checks

- Confirm Ozow is in production mode and can receive callbacks at
  `/api/webhooks/ozow`.
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

## 6. Release Decision

Call the release launch-ready only when:

- Every blocking-lane command passes on the release candidate branch
- Production-only validation passes
- Any required deep-lane checks for the change set pass
- The production deploy workflow completes without degraded health output

## 7. Why Startup Fails

The most common launch blockers are:

- Node.js is outside the supported `20.x` to `25.x` range
- `NEXT_PUBLIC_APP_URL` does not match the real environment origin
- A production secret is missing or malformed
- `RATE_LIMITER_API_KEY` is configured without `OTP_RATE_LIMITER_URL`

Run `pnpm validate:launch-env` first when startup or deploy validation fails.
