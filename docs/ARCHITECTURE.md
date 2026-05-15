# VerifyMzansi Architecture Map

VerifyMzansi is a Next.js marketplace application for South African listings,
businesses, tourism, and events. The runtime is a Next.js App Router app
deployed to Cloudflare Workers through OpenNext, with Supabase handling auth,
Postgres data, RLS, and migrations.

## Public Surfaces

- `src/app/page.tsx`: homepage, SEO JSON-LD, hero/search, and marketplace
  preview sections.
- `src/app/mzansi-market`, `src/app/mzansi-business`, `src/app/tourism-events`:
  public marketplace browse surfaces.
- `src/app/listing/[id]/page.tsx`, `src/app/business-ad/[id]/page.tsx`,
  `src/app/mall-shop/[id]/page.tsx`: public detail pages and legacy
  compatibility routes.
- `src/components/home/*`, `src/components/listings/*`,
  `src/components/showrooms/*`: public cards, grids, filters, and home/showroom
  presentation.

## Request And Auth Flow

- `src/middleware.ts` delegates every matched request to `src/proxy-handler.ts`.
- `src/proxy-handler.ts` checks Supabase auth cookies, redirects logged-in users
  away from auth pages, gates protected pages/APIs, enforces admin access,
  checks bans, checks posting eligibility, and applies security headers.
- `src/lib/supabase/server.ts` creates request-scoped Supabase clients that
  read/write auth cookies.
- `src/lib/supabase/admin.ts` creates service-role clients for server-only
  operations that intentionally bypass RLS.
- Auth endpoints live under `src/app/api/auth/*`;
  `src/app/api/auth/register/route.ts` is the main registration path with
  Turnstile, rate limiting, pwned-password checks, Supabase signup, and profile
  creation.

## Posting And Marketplace Flow

- `src/app/api/listings/route.ts`: public listing discovery (`GET`) and
  authenticated Mzansi Market listing creation (`POST`).
- `src/app/api/businesses/route.ts` and `src/app/api/promotions/route.ts`:
  business and tourism/events content flows.
- `src/app/post/*`: user-facing create/edit pages.
- `src/app/api/listings/_lib/listing-route-helpers.ts`: shared listing route
  helpers for query filtering, compatibility fallbacks, placeholder filtering,
  and insert fallback handling.
- `src/lib/validations/*`: Zod schemas for all major mutation inputs.
- `src/lib/services/entitlements.ts`, `src/lib/billing/free-posts.ts`: plan
  limits and free-post accounting.

## KYC And Trust Flow

- `src/app/api/verification/upload/route.ts`: KYC document/selfie/proof upload
  endpoint. It validates form data, checks file integrity, strips metadata,
  encrypts evidence, stores it in private R2, and updates verification state.
- `src/app/api/verification/upload/_lib/kyc-upload-cleanup.ts`: cleanup and
  retry handling for failed KYC artifact/R2 writes.
- `src/lib/services/kyc-engine.ts`: risk engine for SHA-256 duplicates,
  perceptual-hash similarity, velocity, ID HMAC reuse, provider results,
  EXIF/liveness/blur signals, and aggregate risk score.
- `src/app/api/admin/verification/decide/route.ts`: admin review path that
  approves/rejects/resubmits verification steps and propagates verified account
  status.

## Payment Flow

- `src/app/api/billing/create-checkout/route.ts`: authenticated checkout
  creation after profile, email, duplicate entitlement, and duplicate
  pending-payment checks.
- `src/lib/payments/checkout.ts`: creates pending payment rows and Ozow hosted
  checkout sessions.
- `src/app/api/webhooks/ozow/route.ts`: signed Ozow webhook handler; validates
  amount/currency/provider IDs, claims processing, fulfills entitlements,
  finalizes payment state, and sends receipt/failure emails.
- `src/lib/payments/store.ts` and `src/lib/payments/fulfillment.ts`: payment
  state transitions and entitlement creation.

## Media Flow

- `src/app/api/media/upload-url/route.ts`: presigned Cloudflare R2 upload URLs
  for direct video uploads.
- `src/app/api/media/upload/route.ts`: server-mediated media upload path.
- `src/app/api/media/upload-complete/route.ts`: upload completion/tracking path.
- `src/app/api/media/serve/[...key]/route.ts`: media proxy/serving path.
- `src/lib/services/storage.ts`: native R2 binding support, S3-compatible R2
  fallback, encrypted KYC upload/download, and safe storage key checks.

## Admin And Operations

- `src/app/admin/*`: internal moderation, verification, reports, audit log,
  feature flags, governance, and intelligence pages.
- `src/app/api/admin/*`: admin mutation APIs guarded by DB-backed capability
  checks.
- `src/lib/auth/admin-access.ts`: staff capability/role checks.
- `src/lib/services/audit.ts`: audit event persistence.
- `workers/*.ts`: companion Cloudflare Workers for rate limiting, payment
  cleanup, retention cleanup, and KYC encryption support.
- `supabase/migrations/*.sql`: schema, RLS, indexes, RPCs, retention jobs, and
  hardening changes.

## Deployment And Runtime

- `next.config.js`: Next/Sentry config, Cloudflare image loader, headers, route
  redirects, and package optimization.
- `wrangler.toml`: Cloudflare Worker, routes, R2 buckets, KV, Durable Objects,
  production/staging vars, and required secrets.
- `open-next.config.ts` and `workers/open-next-entry.mjs`: OpenNext Cloudflare
  entry/config.
- `supabase/config.toml`: local Supabase ports, auth, templates, storage, and
  database settings.

## Rate Limiting Map

- Local in-process limiter: `checkLocalRateLimit` in
  `src/lib/utils/rate-limit.ts`. Used for low-cost page/API throttles such as
  public marketplace browsing and admin button spam. This is per runtime isolate
  and should not be treated as the only abuse boundary for high-risk flows.
- Shared/degradable limiter: `checkRateLimit` in `src/lib/utils/rate-limit.ts`.
  Used for auth, OTP, billing, verification upload, webhooks, and content
  creation. Some calls set `degradedMode: "block"` for fail-closed behavior;
  others allow local fallback.
- Cloudflare Worker/DO limiter: configured through `OTP_RATE_LIMITER_URL`,
  `RATE_LIMITER_API_KEY`, and `RATE_LIMITER_DO` in `wrangler.toml`. This is the
  preferred shared boundary for OTP and high-abuse actions.
- Supabase constraints/RPCs: posting limits, KYC velocity, payment uniqueness,
  and plan limits are also enforced with database constraints/RPCs to close race
  windows.

When adding a new mutation, prefer `checkRateLimit` plus CSRF/origin checks. Use
`degradedMode: "block"` for auth, payment, KYC, and other flows where failing
open creates fraud or account risk.
