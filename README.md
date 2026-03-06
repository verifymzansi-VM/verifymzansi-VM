# VerifyMzansi — SA's Trusted Marketplace

> Buy & sell with people you can trust. South Africa's verification-first
> marketplace for classifieds, shops, and business services.

[![CI](https://github.com/verifymzansi/verifymzansi/actions/workflows/ci.yml/badge.svg)](https://github.com/verifymzansi/verifymzansi/actions/workflows/ci.yml)

---

## Table of Contents

- [Overview](#overview)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Project Structure](#project-structure)
- [Environment Variables](#environment-variables)
- [Scripts](#scripts)
- [Testing](#testing)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

VerifyMzansi is a verification-first marketplace platform built for South
Africa. It features:

- **Three marketplace areas**: Mzansi Market (classifieds), Business Ads, and
  Mall Shops
- **Advertising & Promotions**: The core platform purpose — sellers advertise
  products, services, and events. Featured listings, urgent flags, boost
  visibility, storefront posts, and business offers
- **Promotions discovery**: Dedicated `/promotions` page aggregating all active
  deals, featured listings, and business offers
- **KYC verification**: ID validation, liveness checks, and location proof for
  trusted sellers
- **POPIA-compliant**: End-to-end encryption for sensitive documents, data
  subject access requests (DSAR)
- **Tiered subscriptions**: Starter, Growth, and Pro plans via PayFast (ZAR)
- **Admin panel**: Content moderation, KYC review, feature flags, audit logs
- **Mobile-first**: Responsive design optimized for South African mobile users

## Tech Stack

| Layer            | Technology                                                            |
| ---------------- | --------------------------------------------------------------------- |
| **Framework**    | Next.js 16 (App Router, Server Components, Server Actions)            |
| **Language**     | TypeScript (strict mode)                                              |
| **Styling**      | Tailwind CSS + shadcn/ui + Radix UI primitives                        |
| **State**        | Zustand (5 stores: auth, marketplace, listings wizard, notifications) |
| **Database**     | Supabase (PostgreSQL + Auth + Realtime + Storage)                     |
| **File Storage** | Cloudflare R2 (S3-compatible)                                         |
| **Hosting**      | Cloudflare Pages via OpenNext                                         |
| **Workers**      | Cloudflare Workers (KYC encryptor, rate limiter, retention cleanup)   |
| **Payments**     | PayFast (ZAR)                                                         |
| **SMS/OTP**      | Africa's Talking                                                      |
| **Email**        | Resend                                                                |
| **CAPTCHA**      | Cloudflare Turnstile                                                  |
| **Testing**      | Vitest + Testing Library + Playwright                                 |

## Prerequisites

- **Node.js** ≥ 20.0.0 (< 26)
- **pnpm** ≥ 10.0.0
- A **Supabase** project (free tier works for development)
- Cloudflare account (for R2 storage and Workers)
- Cloudflare **Turnstile** site key and secret key (required for CAPTCHA)

## Quick Start

```bash
# 1. Clone the repository
git clone https://github.com/verifymzansi/verifymzansi.git
cd verifymzansi

# 2. Install dependencies
pnpm install

# 3. Set up environment variables
cp cloudflare-env-vars.txt .env.local
# Edit .env.local with your actual keys (see Environment Variables below)

# 4. Generate encryption keys
node -e "const c=require('crypto'); console.log('KYC_ENCRYPTION_KEY='+c.randomBytes(32).toString('hex')); console.log('ID_ENCRYPTION_KEY='+c.randomBytes(32).toString('hex')); console.log('HMAC_SECRET='+c.randomBytes(32).toString('hex'));"

# 5. Run preflight checks (validates env, schema, connectivity)
pnpm preflight

# 6. Run the development server
pnpm dev

# 7. Open http://localhost:3000
```

> **Dev-only environment variables** — The following variables must NEVER be set
> in production:
>
> - `ENABLE_DEV_PAYMENT_BYPASS` — Bypasses PayFast payment validation
> - `ENABLE_MOCK_PAYFAST` — Enables the mock PayFast endpoint
> - `DEV_EXPOSE_OTP` — Logs OTP codes to the console

## Project Structure

```
verifymzansi/
├── src/
│   ├── app/                    # Next.js App Router pages & API routes
│   │   ├── (auth)/             # Login, register, password reset
│   │   ├── (marketplace)/      # Mzansi Market, Business Ads, Mall Shops, Promotions
│   │   ├── admin/              # Admin panel (moderation, KYC review, flags)
│   │   ├── dashboard/          # Seller dashboard (listings, promotions, leads, metrics)
│   │   ├── api/                # 31 API routes
│   │   └── ...                 # Billing, verification, safety, legal pages
│   ├── components/             # React components
│   │   ├── ui/                 # shadcn/ui primitives (Button, Dialog, etc.)
│   │   ├── layout/             # Header, Footer, navigation
│   │   ├── admin/              # Admin-specific components
│   │   ├── listings/           # Listing cards, forms, wizards
│   │   └── ...                 # billing, home, shared, trust, showrooms
│   ├── hooks/                  # Custom React hooks
│   ├── lib/                    # Core business logic
│   │   ├── auth/               # Role-based access control
│   │   ├── config/             # Environment validation (Zod)
│   │   ├── constants/          # Categories, pricing, provinces, trust scale
│   │   ├── services/           # Business logic (KYC, payments, email, SMS)
│   │   ├── supabase/           # Supabase client factories (server, client, admin)
│   │   ├── utils/              # Helpers (encryption, validation, formatting)
│   │   └── validations/        # Zod schemas for all data models
│   ├── stores/                 # Zustand state stores
│   ├── styles/                 # Global CSS
│   └── types/                  # TypeScript type definitions
├── e2e/                        # Playwright end-to-end tests
├── workers/                    # Cloudflare Workers
├── supabase/                   # Supabase config & migrations
├── scripts/                    # Build, seed, and utility scripts
├── docs/                       # Documentation & playbooks
└── public/                     # Static assets
```

## Environment Variables

Copy `cloudflare-env-vars.txt` to `.env.local` and populate with your values:

| Variable                         | Required | Description                                      |
| -------------------------------- | -------- | ------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`       | Yes      | Supabase project URL                             |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`  | Yes      | Supabase publishable (anon) key                  |
| `SUPABASE_SERVICE_ROLE_KEY`      | Yes      | Supabase service role key (server-only)          |
| `R2_ACCOUNT_ID`                  | Yes      | Cloudflare account ID                            |
| `R2_ACCESS_KEY_ID`               | Yes      | R2 API access key                                |
| `R2_SECRET_ACCESS_KEY`           | Yes      | R2 API secret key                                |
| `KYC_ENCRYPTION_KEY`             | Yes      | 64-char hex key for KYC document encryption      |
| `ID_ENCRYPTION_KEY`              | Yes      | 64-char hex key for ID number encryption         |
| `HMAC_SECRET`                    | Yes      | 64-char hex key for dedup hashing                |
| `AFRICASTALKING_API_KEY`         | Yes      | Africa's Talking API key for OTP                 |
| `AFRICASTALKING_USERNAME`        | Yes      | Africa's Talking username                        |
| `PAYFAST_MERCHANT_ID`            | Yes      | PayFast merchant ID                              |
| `PAYFAST_MERCHANT_KEY`           | Yes      | PayFast merchant key                             |
| `RESEND_API_KEY`                 | Yes      | Resend email API key                             |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Yes      | Cloudflare Turnstile site key (CAPTCHA)          |
| `TURNSTILE_SECRET_KEY`           | Yes      | Cloudflare Turnstile secret key                  |
| `NEXT_PUBLIC_APP_URL`            | No       | App URL (defaults to `https://verifymzansi.com`) |
| `ENABLE_DEV_PAYMENT_BYPASS`      | No       | ⚠️ Dev only — bypasses PayFast validation        |
| `ENABLE_MOCK_PAYFAST`            | No       | ⚠️ Dev only — enables mock PayFast endpoint      |
| `DEV_EXPOSE_OTP`                 | No       | ⚠️ Dev only — logs OTP codes to console          |

## Scripts

| Script                | Description                        |
| --------------------- | ---------------------------------- |
| `pnpm dev`            | Start development server           |
| `pnpm build`          | Production build                   |
| `pnpm lint`           | Run ESLint                         |
| `pnpm typecheck`      | TypeScript type checking           |
| `pnpm test`           | Run unit tests (Vitest)            |
| `pnpm test:e2e`       | Run E2E tests (Playwright)         |
| `pnpm test:coverage`  | Unit tests with coverage report    |
| `pnpm test:all`       | Unit + E2E tests                   |
| `pnpm preflight`      | Node version + schema + env checks |
| `pnpm seed:dev`       | Seed development database          |
| `pnpm security:audit` | Security audit                     |
| `pnpm secret-scan`    | Scan for leaked secrets            |
| `pnpm licenses:check` | Check dependency licenses          |
| `pnpm format`         | Format code with Prettier          |
| `pnpm format:check`   | Check formatting without writing   |

## Testing

```bash
# Unit tests
pnpm test

# Unit tests with coverage
pnpm test:coverage

# E2E tests (requires running dev server)
pnpm test:e2e

# All tests
pnpm test:all
```

**Test structure:**

- `src/__tests__/` — Unit and integration tests (Vitest + Testing Library)
- `e2e/` — End-to-end tests (Playwright)
- `scripts/test-*.ts` — Contract, smoke, performance, and mutation tests

## Deployment

VerifyMzansi deploys to Cloudflare Pages via OpenNext:

```bash
# Build for Cloudflare
pnpm build:cloudflare

# Preview locally with Wrangler
pnpm preview:cloudflare

# Deploy to production (Linux / macOS / WSL only — see note below)
pnpm deploy
```

> **Windows note:** Local deploys (`pnpm deploy`) fail on native Windows because
> wrangler writes WASM modules with `?module` query suffixes that are illegal in
> Windows filenames (e.g. `resvg.wasm?module`). Use one of these alternatives:
>
> - **Push to `master`** — GitHub Actions deploys automatically via CI
> - **WSL** — run `pnpm deploy` from a WSL terminal
> - **Cloudflare Dashboard** — trigger a deploy from the Cloudflare Pages UI

### Known Cloudflare Warning Classes

These warnings are currently expected on the supported Cloudflare/OpenNext path
and should be triaged separately from new build failures:

- **OpenNext Durable Object startup warnings** — The bindings in `wrangler.toml`
  for `DOQueueHandler`, `DOShardedTagCache`, and `BucketCachePurge` may trigger
  startup warnings during build/deploy, but OpenNext documents them as safe to
  ignore for cache initialization.
- **Next.js 16 `middleware` deprecation warning** — The app still uses
  `src/middleware.ts` because the `proxy` replacement is Node runtime only, and
  this Cloudflare/OpenNext deployment path is not ready to switch without a
  separate compatibility upgrade.
- **`duplicate-object-key` warnings in `.open-next/server-functions`** — These
  come from generated vendor bundle output (currently the Radix/Floating UI
  chain), not repo-authored application code. Track them through dependency
  upgrades to `@opennextjs/cloudflare`, `wrangler`, Radix UI, and
  `@floating-ui/*` rather than editing `.open-next`.

Workers are deployed separately:

```bash
pnpm exec wrangler deploy --config wrangler.kyc-encryptor.toml
pnpm exec wrangler deploy --config wrangler.rate-limiter.toml
pnpm exec wrangler deploy --config wrangler.retention-cleanup.toml
```

## Architecture

```
┌─────────────┐    ┌──────────────┐    ┌───────────────┐
│  Cloudflare  │───▶│  Next.js 16  │───▶│   Supabase    │
│   Pages      │    │  App Router  │    │  PostgreSQL   │
│  (CDN Edge)  │    │  + Workers   │    │  + Auth       │
└─────────────┘    └──────────────┘    │  + Realtime   │
       │                  │             └───────────────┘
       │                  │
       ▼                  ▼
┌─────────────┐    ┌──────────────┐
│ Cloudflare   │    │   External   │
│ R2 Storage   │    │   Services   │
│ (files)      │    │  PayFast     │
└─────────────┘    │  Africa's T. │
                   │  Resend      │
                   └──────────────┘
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on:

- Branch naming and commit conventions
- Pull request process
- Code review checklist
- Testing requirements

## License

Proprietary — All rights reserved.
