# VerifyMzansi — Pre-Launch Codebase Hardening Plan

**Date:** 2026-03-01 **Branch:** test/addon-route-coverage → merging to master
**Status:** NOT LAUNCH-READY (fixable — see below)

---

## 1) Summary (Plain English)

### What This Codebase Is

VerifyMzansi is a **South African verification-first marketplace and advertising
platform** built on Next.js 16 + Supabase + Cloudflare. It serves three
interconnected spaces:

1. **Mzansi Market** — Buy/sell classified listings (vehicles, property,
   electronics, etc.)
2. **Mall Shops** — Digital storefronts for retail businesses (fashion,
   groceries, dining, etc.)
3. **Business Ads** — Professional service profiles and business directory
4. **Promotions & Advertising** — The central advertising hub where anyone can
   promote anything: products, services, events, hiring, deals, and campaigns

The platform differentiates from competitors through **identity verification
(KYC)**: every seller is verified via phone OTP → ID document → selfie/liveness
→ location/GPS, creating a trust layer that traditional classifieds lack.

### Main Flows / Entrypoints

| Flow                          | Entry Point                                      | Status                          |
| ----------------------------- | ------------------------------------------------ | ------------------------------- |
| User registration + KYC       | `/register` → `/verification`                    | Working                         |
| Browse marketplace            | `/mzansi-market`, `/mall-shops`, `/business-ads` | Working                         |
| Create listing/shop/business  | `/post/create` → create forms                    | Working                         |
| Boost/Featured/Urgent add-ons | Listing cards → Ozow checkout                    | Working                         |
| Storefront/Business posts     | API routes for promotions/events/offers          | Working                         |
| **Advertising hub**           | `/promotions`                                    | **Incomplete — see Finding #1** |
| Admin moderation              | `/admin/*`                                       | Working                         |
| Billing/subscriptions         | `/billing/*` + Ozow webhooks                     | Working                         |
| POPIA compliance (DSAR)       | `/dsar` + admin DSAR queue                       | Working                         |

### Current Readiness: **NOT LAUNCH-READY**

**Why:**

1. **CRITICAL:** The advertising/promotions feature — described as "the big part
   of this platform" — is underbuilt. The current `/promotions` page is a
   passive display of boosted items. There is no self-service advertising flow,
   no standalone ad campaigns, no "Advertise Here" CTA, and advertising is not
   prominently positioned in navigation or homepage.
2. **CRITICAL:** Cloudflare build fails on Windows (symlink EPERM error). Must
   build from Ubuntu/WSL.
3. **HIGH:** Type mismatches between `database.ts` post types and actual API
   usage will cause TypeScript errors in strict mode.
4. **MEDIUM:** Footer and homepage don't link to Promotions/Advertising section.
5. **LOW:** Several cleanup items (stale branches, unused files).

---

## 2) Full Audit Findings (Prioritized)

### CRITICAL — Must Fix Before Launch

#### Finding #1: Advertising/Promotions Feature Is Underdeveloped

**The Problem:** The user states that advertising is "the big part of this
platform" — when people want to advertise or promote anything, they should come
to VerifyMzansi. But the current implementation treats advertising as a
secondary feature (boost/featured/urgent add-ons on existing listings).

**What Exists:**

- `src/app/(marketplace)/promotions/page.tsx` — Shows boosted/featured/urgent
  listings + storefront/business posts (passive display only)
- `src/app/dashboard/promotions/page.tsx` — Shows user's active promotions
- Boost/Featured/Urgent buttons on listing cards
- Storefront posts (type: `promotion | event | special`)
- Business posts (type: `offer | hiring | case_study`)
- `src/components/layout/marketplace-switcher.tsx:44-50` — Has "Promotions" tab
  in nav

**What's Missing:**

1. **No "Advertise" CTA on homepage** — Homepage has no advertising entry point.
   The category grid at `src/app/page.tsx:96-169` has 8 categories but none for
   advertising/promotions.
2. **No prominent "Advertise" button in header** — The header at
   `src/components/layout/header.tsx` only has "+ Post" for authenticated users.
   There's no "Advertise" or "Promote" call-to-action.
3. **No link to Promotions in footer** —
   `src/components/layout/footer.tsx:27-48` lists Mzansi Market, Mall Shops,
   Business Ads but NOT Promotions.
4. **The `/promotions` page is read-only** — It shows promoted content but
   doesn't let users CREATE promotions or start advertising campaigns directly
   from that page.
5. **No self-service advertising landing page** — There should be an
   `/advertise` page explaining how to advertise on the platform (pricing,
   reach, options), targeted at both existing sellers AND external advertisers.
6. **Post creation page doesn't mention advertising** —
   `src/app/post/create/page.tsx:14-42` offers three options but none
   specifically for "Create a Promotion" or "Advertise."

**Fix Required:** See Section 4 for implementation details.

#### Finding #2: Cloudflare Build Fails on Windows

**File:** `build2.log:133-152` **Error:**
`EPERM: operation not permitted, symlink` — The OpenNext Cloudflare bundler uses
symlinks which require elevated privileges on Windows.

**Fix:** Build and deploy from Ubuntu/WSL. The `next build` step succeeds (63/63
pages); only the Cloudflare bundling step fails. This is a known OpenNext
limitation documented in `build2.log:6-8`.

**Action Items:**

1. Use WSL2 or a Linux CI runner for `pnpm build:cloudflare` and `pnpm deploy`
2. GitHub Actions CI already runs on `ubuntu-latest` — deployments from CI will
   work
3. Add a note to README.md about this requirement

#### Finding #3: Database Type Mismatches in Post Types

**Files:**

- `src/types/database.ts:253` —
  `StorefrontPost.type: "special" | "announcement"`
- `src/types/database.ts:289` — `BusinessPost.type: "special" | "announcement"`

**But the actual API usage:**

- `src/app/(marketplace)/promotions/page.tsx:104` — Queries for
  `["promotion", "event", "special"]`
- `src/app/(marketplace)/promotions/page.tsx:115` — Queries for
  `["offer", "hiring", "case_study"]`
- `src/app/api/storefronts/[id]/posts/route.ts:110` — Inserts `post_type` from
  validation schema (which allows `promotion | event | special`)
- `src/app/api/business-ads/[id]/posts/route.ts:110` — Inserts `post_type` from
  validation schema (which allows `offer | hiring | case_study`)

**Impact:** TypeScript won't catch invalid post type values. The database
accepts any string, but the TypeScript types are wrong.

**Fix:** Update `database.ts` to match actual post types.

### HIGH — Should Fix Before Launch

#### Finding #4: Footer Missing Promotions Link

**File:** `src/components/layout/footer.tsx:27-48` **Issue:** The Marketplace
section lists three areas but not Promotions/Advertising. **Fix:** Add
"Promotions & Deals" and "Advertise with Us" links.

#### Finding #5: Homepage Missing Advertising Entry Point

**File:** `src/app/page.tsx:96-169` **Issue:** The category grid has 8 items but
no "Advertise" or "Promotions" category. This is a major discovery issue — users
who come to the platform specifically to advertise won't find the feature.
**Fix:** Replace one of the existing categories or add a 9th "Advertise" card
linking to `/promotions`.

#### Finding #6: Homepage CTA Section Not Mentioning Advertising

**File:** `src/app/page.tsx:187-252` **Issue:** The CTA says "South Africa's
verification-first marketplace" and "Buy and sell with people you can trust." It
doesn't mention advertising, promotions, or reaching customers. **Fix:** Update
copy to reflect the platform's dual purpose: marketplace + advertising.

### MEDIUM — Improve Before Launch

#### Finding #7: `/promotions` Page Has No CTA to Create Promotions

**File:** `src/app/(marketplace)/promotions/page.tsx:133-319` **Issue:** The
page shows existing promotions but has no button/link for users to create their
own promotion. The empty state at line 143-151 says "When sellers promote their
listings..." but doesn't tell users HOW to promote. **Fix:** Add a prominent
"Promote Your Listing" or "Start Advertising" CTA button.

#### Finding #8: Missing `/promotions` and `/dashboard/promotions` in Build Output

**File:** `build2.log:40-114` **Issue:** Neither `/promotions` nor
`/dashboard/promotions` appear in the build output routes list. This suggests
these pages may have been added after the last successful build, or the build
was from a different branch. **Verification needed:** Run a fresh `next build`
to confirm these routes compile.

### LOW — Nice to Have

#### Finding #9: Footer Description Doesn't Mention Advertising

**File:** `src/components/layout/footer.tsx:21-23` **Current:** "South Africa's
verification-first marketplace. Buy and sell with people you can trust."
**Should be:** Should mention advertising/promotion capability.

#### Finding #10: Git Branch Cleanup

**Current state:** 3 branches (`fix/prettier-formatting`, `master`,
`test/addon-route-coverage`) **Action:** Merge `test/addon-route-coverage` to
`master`, delete feature branches, push clean.

---

## 3) Improved Design Notes

### Advertising as a First-Class Feature

The platform should treat advertising/promotions as equal to the three
marketplace areas. The mental model:

```
VerifyMzansi
├── Mzansi Market (Buy & Sell)
├── Mall Shops (Digital Storefronts)
├── Business Ads (Service Directory)
└── Advertise & Promote (Get Visibility)  ← NEW first-class section
```

**Current architecture already supports this:**

- Boost/Featured/Urgent add-ons exist with full Ozow payment integration
- Storefront posts (promotions, events, specials) exist
- Business posts (offers, hiring, case studies) exist
- `/promotions` page exists as a public feed
- `/dashboard/promotions` exists as a management dashboard

**What's needed is primarily navigation/discovery work:**

1. Add "Advertise" to homepage category grid
2. Add "Promotions & Deals" link to footer
3. Add CTA buttons to the `/promotions` page
4. Update homepage copy to mention advertising
5. Fix TypeScript types to match actual DB values

### Build & Deploy Strategy

```
Development:  Windows 11 + pnpm dev (works fine)
Testing:      Windows 11 + pnpm test (works fine)
Building:     Ubuntu/WSL + pnpm build:cloudflare (required for Cloudflare)
CI/CD:        GitHub Actions (ubuntu-latest) → auto-deploy on push to master
```

---

## 4) Updated Code (Specific Changes)

### Change 1: Fix StorefrontPost and BusinessPost types in database.ts

**File:** `src/types/database.ts`

```typescript
// Line 253: Change from
type: "special" | "announcement";
// To
type: "promotion" | "event" | "special" | "announcement";

// Line 289: Change from
type: "special" | "announcement";
// To
type: "offer" | "hiring" | "case_study" | "special" | "announcement";
```

### Change 2: Add Advertising to Homepage Category Grid

**File:** `src/app/page.tsx`

Add a "Promotions" card to the category grid (replace the 8-column grid with a
9th item or reorganize):

```typescript
{
  label: "Promotions",
  icon: Megaphone,
  href: "/promotions",
  iconBg: "bg-red-100 dark:bg-red-950",
  iconColor: "text-red-500",
},
```

### Change 3: Add Promotions Link to Footer

**File:** `src/components/layout/footer.tsx`

Add to the Marketplace nav section:

```tsx
<Link href="/promotions" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
  Promotions & Deals
</Link>
<Link href="/promotions" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
  Advertise with Us
</Link>
```

### Change 4: Add CTA to Promotions Page

**File:** `src/app/(marketplace)/promotions/page.tsx`

Add a prominent CTA section at the top of the page, after the PageHeader:

```tsx
<Card className="bg-gradient-to-r from-brand-green/10 to-brand-gold/10 border-brand-green/20">
  <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
    <div>
      <h3 className="font-display font-semibold text-lg">
        Want to promote your listing or business?
      </h3>
      <p className="text-sm text-muted-foreground">
        Boost your visibility with Featured, Urgent, or Boosted promotions.
      </p>
    </div>
    <Button asChild>
      <Link href="/post/create">Start Advertising</Link>
    </Button>
  </CardContent>
</Card>
```

### Change 5: Update Footer Description

**File:** `src/components/layout/footer.tsx`

Change line 21-23 from:

```
South Africa's verification-first marketplace. Buy and sell with people you can trust.
```

To:

```
South Africa's verification-first marketplace and advertising platform. Buy, sell, and promote with people you can trust.
```

---

## 5) Test Suite

### Existing Test Coverage: 799 tests across 104 files

The existing test suite is comprehensive and covers:

- Authentication flows
- Add-on/boost payment flows
- Ozow webhook processing
- KYC verification pipeline
- Entitlements and plan gating
- File validation and security
- Rate limiting
- DSAR/POPIA compliance

### Additional Tests Needed

1. **Promotions page rendering test** — Verify `/promotions` page renders with
   and without data
2. **Dashboard promotions page test** — Verify authenticated user sees their
   promotions
3. **Post type validation test** — Verify storefront/business post types match
   schema
4. **Navigation link test** — Verify footer and header contain expected links

### Run Tests

```bash
pnpm test          # Unit tests (vitest)
pnpm test:e2e      # End-to-end tests (Playwright)
pnpm test:smoke    # Smoke tests
pnpm test:contract # Contract tests
```

---

## 6) Launch Checklist

### Pre-Launch (Must Do)

- [ ] Fix `database.ts` post type enums (Finding #3)
- [ ] Add "Promotions" to homepage category grid (Finding #5)
- [ ] Add Promotions/Advertise links to footer (Finding #4)
- [ ] Add CTA to `/promotions` page (Finding #7)
- [ ] Update footer description to mention advertising (Finding #9)
- [ ] Run full test suite: `pnpm test` — all 799 tests pass
- [ ] Run `pnpm lint` — zero warnings
- [ ] Run `pnpm typecheck` — zero errors
- [ ] Merge `test/addon-route-coverage` branch to `master`
- [ ] Delete stale feature branches
- [ ] Build from Ubuntu/WSL: `pnpm build:cloudflare`
- [ ] Verify all environment variables are set in Cloudflare dashboard
- [ ] Push clean master to GitHub

### Pre-Launch (Should Do)

- [ ] Update homepage CTA copy to mention advertising (Finding #6)
- [ ] Add "Advertise" button to header for non-authenticated users
- [ ] Verify Ozow webhook endpoint is publicly accessible
- [ ] Test full payment flow in Ozow sandbox
- [ ] Verify R2 bucket CORS configuration
- [ ] Check Cloudflare Turnstile (CAPTCHA) is configured
- [ ] Test KYC flow end-to-end with Africa's Talking SMS
- [ ] Review Supabase RLS policies for all tables

### Post-Launch (Track)

- [ ] Monitor Ozow webhook delivery rate
- [ ] Monitor KYC completion rate
- [ ] Track advertising/promotion usage metrics
- [ ] Set up alerts for audit log failure threshold
- [ ] Plan dedicated `/advertise` landing page for external advertisers

---

## Git Cleanup & Deployment Instructions

### Step 1: Merge to Master (from Ubuntu/WSL)

```bash
git checkout master
git merge test/addon-route-coverage
git branch -d test/addon-route-coverage
git branch -d fix/prettier-formatting
```

### Step 2: Push Clean to GitHub

```bash
git push origin master
git push origin --delete test/addon-route-coverage
git push origin --delete fix/prettier-formatting
```

### Step 3: Build & Deploy (Ubuntu/WSL required)

```bash
pnpm install
pnpm test
pnpm lint
pnpm typecheck
pnpm build:cloudflare
pnpm deploy
```

### Files to Keep Out of Git (already in .gitignore)

- `.env*` (secrets)
- `node_modules/`
- `.next/`
- `.open-next/`
- `coverage/`
- `*.log`
- `.claude/`

### Security-Sensitive Files (never commit)

- `.env.local` — Contains Supabase service role key, Ozow passphrase
- `.env.production` — Production secrets
- Any `*.pem` files
- `cloudflare-env-vars.txt`
