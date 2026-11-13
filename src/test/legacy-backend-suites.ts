/**
 * Unit test files that still exercise the retired "source" backend. They run
 * with NEXT_PUBLIC_DATA_BACKEND=source (vitest.config.ts, project
 * "legacy-backend"); every other test file runs on foundation, the backend
 * production uses. This list may only shrink: drop a file once its code runs on
 * foundation or is deleted (roadmap M6), and lower LEGACY_BACKEND_SUITE_LIMIT in
 * src/__tests__/legacy-backend-suites.test.ts to match.
 */
export const LEGACY_BACKEND_SUITES: readonly string[] = [
  "src/__tests__/auth-callback-route.test.ts",
  "src/__tests__/content-media-cleanup.test.ts",
  "src/__tests__/dashboard-listings.test.tsx",
  "src/__tests__/decision-ledger.test.ts",
  "src/__tests__/evidence-desk.test.tsx",
  "src/__tests__/feature-flags-canary.test.ts",
  "src/__tests__/feature-flags.test.ts",
  "src/__tests__/governance-pages.test.tsx",
  "src/__tests__/kyc-inline-preview.test.tsx",
  "src/__tests__/kyc-preview-lightbox.test.tsx",
  "src/__tests__/plan-gate.test.tsx",
  "src/__tests__/promotion-crud.test.ts",
  "src/__tests__/proxy-middleware.test.ts",
  "src/__tests__/public-trust-pages.test.tsx",
  "src/__tests__/test-runtime-isolation.test.ts",
  "src/__tests__/use-auth-races.test.ts",
  "src/__tests__/use-realtime.test.ts",
  "src/app/(marketplace)/mzansi-business/[id]/page.test.tsx",
  "src/app/(marketplace)/promotions/events/page.test.tsx",
  "src/app/admin/audit-log/page.test.tsx",
  "src/app/admin/dsar/page.test.tsx",
  "src/app/admin/moderation/page.test.tsx",
  "src/app/admin/reports/page.test.tsx",
  "src/app/admin/support/page.test.tsx",
  "src/app/dashboard/affiliations/page.test.tsx",
  "src/app/dashboard/listings/page.test.tsx",
  "src/app/dashboard/page.test.tsx",
  "src/app/listing/[id]/listing-generate-metadata.test.ts",
  "src/app/listing/[id]/page.test.tsx",
  "src/app/tourism-events/[id]/page.test.tsx",
  "src/components/admin/moderation/moderation-queue-client.test.tsx",
  "src/components/dashboard/leads-feed.test.tsx",
  "src/components/home/home-business-showcase.test.tsx",
  "src/components/home/home-mzansi-market-showcase.test.tsx",
  "src/components/home/home-promotions-showcase.test.tsx",
  "src/lib/account/compat.test.ts",
  "src/lib/auth/require-staff.test.ts",
  "src/lib/auth/staff-evidence-fetch.test.ts",
  "src/lib/payments/resolve-payment-status.test.ts",
  "src/lib/services/member-decisions.test.ts",
  "src/lib/showroom/feed.test.ts",
  "src/lib/supabase/client.test.ts",
  "src/lib/utils/admin-queries.test.ts",
  "src/lib/utils/kyc-artifact-blob-cache.test.ts",
];
