# VerifyMzansi Launch Checklist

**Date:** 2026-03-13  
**Status:** Release gate checklist with split blocking and deep validation lanes

## 1. Required Local Verification

Run the blocking lane from the repo root:

```bash
pnpm lint
pnpm typecheck
pnpm test
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
- `PAYFAST_MERCHANT_ID`
- `PAYFAST_MERCHANT_KEY`
- `PAYFAST_PASSPHRASE`
- `PAYFAST_SANDBOX=false`
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

Failing any of the above should block deploy.

## 3. Data and Billing Checks

- Run `pnpm seed:prod` against the target Supabase project before release if
  `pnpm preflight:prod` reports plan drift.
- Confirm the `plans` table contains the same active rows as
  `src/lib/constants/pricing.ts`.
- Confirm PayFast is in production mode and can receive callbacks at
  `/api/webhooks/payfast`.
- Confirm Africa's Talking sender approval is complete for the live sender ID.
- Confirm Resend domain verification is complete for the production sender
  domain.

## 4. Deployment Path

Canonical path:

1. Merge or push to `master`
2. Let GitHub Actions run the blocking CI gate: `pnpm lint`, `pnpm typecheck`,
   `pnpm test`, `pnpm preflight`, `pnpm secret-scan`, `pnpm security:audit`,
   `pnpm licenses:check`, `pnpm build`, and Playwright smoke on `chromium` plus
   `mobile-chrome`
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
