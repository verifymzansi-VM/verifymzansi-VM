# VerifyMzansi mobile apps: final AI-agent build instructions

Version 2.0 (final), prepared 2 October 2026.

Copy this **entire document** into the implementation agent's first message. It
is self-contained and **replaces** every earlier mobile proposal, including
`docs/mobile-app-agent-build-brief.md` (v1 brief) and v1.0 of this file,
wherever they differ. Statements marked **[verified]** were checked against this
repository on 2026-10-02. Re-check them before relying on them, because the code
changes.

---

## 1. Your assignment

You are the implementation agent for VerifyMzansi. Build:

- A production-quality, **free buyer app** for Android and iPhone.
- The backend integrations it needs.
- Device tests, store submission materials and operating documentation.

Preserve the working website and its commercial model.

**Owner priorities, in order:**

1. A South African launch.
2. Downloadable apps on both stores.
3. Useful buyer features.
4. **No store commission on seller payments**, by keeping every paid seller
   product on the website.

**Implement the work; don't write another plan.**

- Work through local code, migrations, isolated tests, build preparation and
  documentation on your own.
- Keep the progress log (section 2.5) up to date, so another agent can pick up
  where you stopped.
- Never mark a device test as done if you didn't run it, or a publication as
  done if it wasn't approved.

## 2. Operating rules (read before any change)

### 2.1 Authority and approvals

- **First establish what the owner has already authorised.** Prepare concrete
  changes for review before making any external change.
- **Owner approval is required for:**
  - Paid resources or recurring charges.
  - Production migrations.
  - Any push to `main`.
  - Secret changes.
  - Store submission or publication.
  - Customer messaging.
  - Any commercial or pricing change.
- **Never:**
  - Buy accounts or create recurring charges.
  - Publish under your own account.
  - Ask for secret values in chat. The owner enters secrets into provider stores
    or GitHub/EAS secret settings.
- **A missing credential blocks only the steps that need it.** Carry on with
  independent work and record the exact owner action still needed.
- **Don't delegate to sub-agents** unless the owner authorises it.

### 2.2 Production facts that change how you work [verified]

- **A push to `main` is a production deploy.** CI runs, then
  `.github/workflows/deploy.yml` deploys the website and companion workers.
  - Commit and push only when the owner asks.
  - The owner wants commits **directly on `main`**, with no feature branches and
    no PRs.
  - Before any push, run `pnpm lint`, `pnpm typecheck` and the affected tests.
- **One Supabase project, `tnygdgormnofpgjknlhr`, is production.**
  - The `verifymzansi-staging` worker was found pointing at **production**
    Supabase and R2.
  - Never run tests that write data, seed fixtures or destructive tests against
    production just because a local env file points there.
- **Migrations:**
  - Additions only.
  - State whether each one must be applied **before** or **after** the code
    deploy.
  - Check the current state with Supabase `list_migrations` first.
  - Safe way to check a migration against production: run it plus assertions in
    **one transaction ending with a deliberate `RAISE EXCEPTION`** carrying the
    results, so nothing commits.
- **Do not touch:**
  - The untracked
    `supabase/migrations/20261002130200_retire_legacy_view_counting.sql`. It may
    only be applied after views v2 is confirmed deployed, and the owner decides
    when.
  - Unrelated uncommitted changes.
  - Never reset the working tree to make tests pass.

### 2.3 Tooling rules [verified]

- **Read `AGENTS.md` / `CLAUDE.md` first.**
  - The website is **Next.js 16.3.6**, which has breaking changes from what you
    know.
  - Before editing web or backend code, read
    `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`
    and `node_modules/next/dist/docs/01-app/02-guides/authentication.md`.
  - Don't assume familiar Next.js APIs still apply.
  - Middleware lives in `src/middleware.ts` plus `src/proxy-handler.ts`. Follow
    that pattern; don't migrate file conventions on your own.
- **Package manager:** pnpm only (10.34.5), Node 22.
- **Root `.npmrc`:** `shamefully-hoist=true`, `node-linker=hoisted`,
  `minimum-release-age=10080`.
  - pnpm refuses package versions younger than 7 days, so choose versions that
    are older than that.
  - Override only for a vetted package, with owner approval.
- **The website runs React 19.3.0.** Expo pins its own React and React Native
  versions. **Never force the website's versions into the app, or the app's into
  the website** (see 6.1).
- **Repo checks that must stay green:**
  - `pnpm lint`, `pnpm typecheck`
  - `pnpm test:blocking` (includes the database test lanes)
  - `pnpm quality:openapi-drift`
  - `pnpm knip`, `pnpm licenses:check`, `pnpm secret-scan`
  - `pnpm build`
  - The final web release runs `pnpm safety:release`, using isolated fixtures
    and environment.

### 2.4 Stop and ask the owner when

- Something would spend money, create a paid resource, touch production data or
  secrets, push to `main`, or submit to a store.
- A provider (Supabase, Cloudflare Turnstile, Apple, Google, Expo) behaves
  differently from this document.
- A store reviewer asks for in-app purchase or questions the payment model.
- A refactor would change a website response or website behaviour.
- A fact in section 3 is no longer true.
- You find a security or privacy defect in the existing website. Report it;
  don't silently fix it inside unrelated work.
- A dependency younger than 7 days is required.

### 2.5 Progress log (required)

- Create `docs/mobile-build-progress.md` and keep it current. It must hold:
  - Decisions made.
  - Milestone status (completed, in progress or blocked).
  - Completed work with commit hashes.
  - Tests run, with dates and results.
  - Migrations and their deploy order.
  - Owner actions pending.
  - Next actions.
- **The repo's `.gitignore` ignores most Markdown files.** Add an exact
  allow-list entry, `!docs/mobile-build-progress.md`, next to the existing
  entries. Do the same for any new runbook.
- Never print credential values in the log.

---

## 3. Platform facts [verified 2026-10-02; re-verify at M0]

### 3.1 Stack and product

- **Website:** Next.js 16.3.6, React 19.3.0, TypeScript, pnpm, deployed on
  Cloudflare Workers through OpenNext.
- **Services:**
  - Supabase: Auth, Postgres with RLS on all public tables, and refresh-token
    rotation. Access-token lifetime is 3,600 s.
  - R2: media (public bucket served through `/api/media/serve/[...key]`, plus a
    private bucket).
  - Ozow: payments.
  - Resend: email.
  - Africa's Talking: phone OTP.
  - Turnstile: captcha.
  - Sentry: error monitoring.
- **Domain:** **verifymzansi.com.** Confirm it against the current deployment.
- **Three marketplace areas** (enum `marketplace_area`): `MZANSI_MARKET` (Mzansi
  Market), `MZANSI_BUSINESS` (Mzansi Business), `PROMOTIONS_EVENTS` (Tourism &
  Events).
  - Content target types: `listing`, `business`, `promotion`.
  - Web routes: `src/app/listing/[id]`, `src/app/(marketplace)/mzansi-market`,
    `mzansi-business/[id]` and `promotions/…`.
  - Don't recreate the removed mall-shops or business-ads products described in
    old documents.
- **Item prices:** listings have `price_cents`. These are the **seller's item
  prices, and the app must show them** wherever the website does.
- **Seller-plan prices are a separate thing.**
  - The database `plans` catalogue is authoritative. Retail defaults are R50 /
    30 days, R140 / 90 days and R250 / 180 days, plus enterprise and sponsor
    programmes and boost, featured and urgent add-ons.
  - **The app never shows seller-plan prices.**
  - Don't change prices. If live `/pricing`, the catalogue and checkout
    disagree, report it; don't fix it here.
- **Payments:**
  - Ozow hosted checkout, signed webhooks and atomic entitlement fulfilment.
  - Returning from checkout never creates an entitlement by itself.
  - Trial rules are tied to identity and must survive account deletion and
    re-creation.

### 3.2 Facts that shape the design

| #   | Fact                                                                                                                                                                                                                                                                                                                                                                                                                                               | Location                                                                 | What it means for the build                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F1  | Web auth comes **only from cookies** (`@supabase/ssr` `createServerClient`).                                                                                                                                                                                                                                                                                                                                                                       | `src/lib/supabase/server.ts`                                             | Native apps need a new bearer-only `/api/mobile/v1`.                                                                                                                    |
| F2  | Requests that change data use `enforceMutationRequest`: same-origin check plus CSRF token.                                                                                                                                                                                                                                                                                                                                                         | `src/lib/utils/mutation-guard.ts`, `csrf.ts`                             | Mobile routes never read cookies, so they skip CSRF. Web routes are unchanged.                                                                                          |
| F3  | Turnstile is required on login, register, forgot-password, resend-confirmation, contact, general contact, DSAR submit and reports.                                                                                                                                                                                                                                                                                                                 | `src/app/api/**`, `src/app/api/auth/_lib/public-auth-turnstile.ts`       | The native challenge applies to **all** of those flows (section 7.3).                                                                                                   |
| F4  | The middleware matcher covers everything except static files, `api/health` and `api/webhooks`. `PROTECTED_PREFIXES` gates protected paths.                                                                                                                                                                                                                                                                                                         | `src/middleware.ts`, `src/proxy-handler.ts`                              | `/api/mobile/` must reach its handler without browser redirects or cookie refresh.                                                                                      |
| F5  | **Public reads use the service-role client.** The mandatory `status = 'live'` plus area filters in application code are the security boundary. Default page size 24, maximum 50.                                                                                                                                                                                                                                                                   | `src/app/api/listings/route.ts` (~L87–L116, L101)                        | Pull out shared read services. **The app never queries Supabase tables directly.**                                                                                      |
| F6  | Rate limits are keyed by IP: `cf-connecting-ip`, then `x-forwarded-for`, then `x-real-ip`, then a fingerprint.                                                                                                                                                                                                                                                                                                                                     | `src/lib/utils/rate-limit.ts`                                            | Authenticated mobile limits are keyed by **user ID**. Anonymous ceilings allow for many users sharing one mobile-network IP. The install ID is only a secondary signal. |
| F7  | **View counting (views v2):** `POST /api/engagement/view` accepts `{ events: [{ type, id, source: "video"\|"page", surface?, engaged? }] }`, with 1–20 events. It reads a viewer cookie, then calls RPC `record_content_views` with `p_viewer_key = 'device:<id>'`. Rules: a page view, or video played for 2 seconds continuously with at least half visible; one view per viewer per item per 30 minutes; owners and staff excluded; per-IP cap. | `src/app/api/engagement/view/route.ts`, `src/lib/views/content-views.ts` | Reuse exactly this logic. **`/api/analytics/visit` counts site visits; it is not content views.**                                                                       |
| F8  | **The bot filter rejects `okhttp`**, which is React Native's **default User-Agent on Android**. It also rejects `whatsapp`, `preview` and others.                                                                                                                                                                                                                                                                                                  | `src/lib/analytics/automated-agent.ts:8`                                 | **Without a custom User-Agent, every Android app view is thrown away.** See 8.1.                                                                                        |
| F9  | Supabase's **legacy anon and service_role keys retire at the end of 2026.** The swap to `sb_publishable_` / `sb_secret_` keys is a pending owner action. The code already supports both formats.                                                                                                                                                                                                                                                   | `workers/supabase-headers.ts`                                            | **The app ships only with the `sb_publishable_` key**, or installed apps stop working when the legacy keys are switched off.                                            |
| F10 | None of these exist: user blocking, private saved items, saved searches, push-token storage. These do: `content_likes` (public likes), `notifications`, `leads`, `contact_events`, `reports`, `operation_jobs`, `queue_claims`, `consent_records`, `feature_flags`.                                                                                                                                                                                | migrations                                                               | New tables in section 9. Reuse the existing job, consent and flag systems.                                                                                              |
| F11 | `notifications` holds in-app notices. `public/sw.js` has a push handler but nothing subscribes devices.                                                                                                                                                                                                                                                                                                                                            | `src/lib/notifications.ts`                                               | Native push is new work.                                                                                                                                                |
| F12 | Contact flow: Turnstile check, reply email required, insert into `contact_events` and `leads`, email the seller, add a notification linking to `/dashboard/leads`. **Enquiries are not live chat.**                                                                                                                                                                                                                                                | `src/app/api/contact/route.ts`                                           | Pull out the enquiry service and reuse it.                                                                                                                              |
| F13 | Account deletion: staff check, `redact_personal_audit_data`, then `auth.admin.deleteUser`. The entry point is in the dashboard profile page.                                                                                                                                                                                                                                                                                                       | `src/app/api/account/delete/route.ts`                                    | Reuse it, with re-authentication. Add a public page explaining deletion.                                                                                                |
| F14 | `docs/openapi.json` covers **24** of about 100 routes. `pnpm quality:openapi-drift` compares generated types with the spec only. It doesn't prove handlers match it.                                                                                                                                                                                                                                                                               | `scripts/check-openapi-drift.ts`, `src/lib/api/v1.d.ts`                  | Add contract tests for handlers and an inventory of mobile endpoints.                                                                                                   |
| F15 | Translations in `src/lib/i18n/messages/{en,af,zu}.json` use **single-brace** values like `{name}` (`src/lib/i18n/index.ts:75`).                                                                                                                                                                                                                                                                                                                    |                                                                          | i18next uses `{{ }}` by default. Configure `interpolation: { prefix: '{', suffix: '}' }`.                                                                               |
| F16 | Seller KYC runs MediaPipe and FFmpeg as WASM in the browser.                                                                                                                                                                                                                                                                                                                                                                                       | `src/components/ui/use-face-liveness.ts`                                 | KYC stays on the website.                                                                                                                                               |
| F17 | `public/.well-known/` holds only `security.txt`. Headers are set in `public/_headers`.                                                                                                                                                                                                                                                                                                                                                             |                                                                          | Add the app-link files (section 8.3).                                                                                                                                   |
| F18 | Root `tsconfig.json` **and** `tsconfig.typecheck.json` include `**/*.ts(x)`. `.dockerignore` excludes only build output. ESLint, knip, depcruise and vitest are scoped to `src`, `scripts` and `workers`.                                                                                                                                                                                                                                          |                                                                          | Exclude `mobile` and `packages` from both tsconfigs and from `.dockerignore`.                                                                                           |
| F19 | Branding: `docs/DESIGN-SYSTEM.md`, `src/components/brand/`, `tailwind.config.ts` tokens (`brand-green` Verified Emerald, `brand-gold` Marigold, `brand-blue` Ocean Indigo, `brand-red` Protea). Icons are in `public/icons/` (`icon-1024.png`, maskable 192 and 512).                                                                                                                                                                              |                                                                          | The approved look is a deep-green surface with the gold shield, media first, no hero photos, 44-point tap targets and an unchanged logo.                                |
| F20 | The website has a manifest, a service worker and an `/offline` page.                                                                                                                                                                                                                                                                                                                                                                               | `src/app/manifest.ts`, `public/sw.js`                                    | Check real install behaviour on phones. Never claim offline payment or offline KYC.                                                                                     |
| F21 | Auth callback: `src/app/(auth)/auth/callback/route.ts`. Recovery pages are in `src/app/(auth)/{forgot-password,reset-password}`.                                                                                                                                                                                                                                                                                                                   |                                                                          | Don't send these paths to the app. Browser password recovery must keep working.                                                                                         |

### 3.3 Open launch blockers [from `docs/production-readiness-audit-2026-10-01.md`]

Recheck each against current evidence. Don't assume they're still open, and
don't claim they're fixed.

1. **Recovery not proven.** No managed backups and no point-in-time recovery
   (free plan). Needs a rehearsed restore of the database, R2 objects and
   encryption keys.
2. **No isolated staging.** Staging currently shares production services.
3. **Branch protection.** The ruleset "Protect main" only blocks deletion and
   force-push. The owner decides.

**Public marketing launch is blocked until 1 and 2 are closed with evidence.**

The quota and job-fencing migrations listed there were applied on 2026-10-01.
Confirm with `list_migrations`.

---

## 4. Commercial boundaries (non-negotiable)

1. **Both apps are free.** Buyer features never depend on a seller entitlement.
2. **No seller commerce anywhere in the app**, including native screens,
   app-owned web pages, push notifications, notification links and redirects.
   That means no:
   - Seller publishing.
   - Plan activation.
   - Boost, featured or urgent controls.
   - Billing pages.
   - Renewal or upgrade prompts.
   - Seller-plan prices.
   - Entitlement balances.
   - Ozow URLs.
   - Links to `/pricing`, `/billing`, `/advertise`, `/sponsors`, `/post` or
     `/dashboard`.
3. **Item and service prices that sellers advertise stay visible** wherever the
   website shows them. Sponsored and featured placements stay visible as public
   content. Showing an ad is different from selling its boost inside the app.
4. **Enforce this through whitelisted response fields and allowed destinations,
   not word bans.** Don't scan for words such as "price", "buy" or "R" amounts;
   that would hide legitimate item prices. Test behaviour and where links go
   (section 13.3).
5. **v1 has none of these:** in-app purchase SDKs (`react-native-iap`,
   `expo-in-app-purchases`, `react-native-purchases`/RevenueCat), wallets,
   escrow, ticket booking or buyer checkout.
   - Don't relabel digital seller features as physical services to claim an
     exemption.
6. **Zero store commission is what this design aims for. Approval isn't
   guaranteed.**
   - If a reviewer objects, record the exact objection in
     `docs/mobile/store-review-log.md` and prepare the smallest compliant change
     or appeal based on the free-buyer design.
   - **Never switch on in-app purchase, and never claim the
     advertising-management exemption (Apple rule 3.1.3(g)), without the owner's
     written decision.**
7. **Remote config must never switch on paid or seller features after review**,
   and features must never be hidden from reviewers.

---

## 5. Product scope

### 5.1 v1 app (iPhone and Android): four bottom tabs

**Explore**

- Home shows rows from all three areas, using the existing fair showroom
  rotation and local-first ordering. Don't invent a new recommendation engine.
- Area browsing, search and filters keep the existing meanings: category,
  province and town, condition, area-specific filters and the default
  "Recommended" order.
- Location is optional.
  - Ask for foreground permission only after the user taps a location action.
  - Approximate location only.
  - Choosing province or town manually always works.
  - Never use background location, and never put precise coordinates in
    analytics.
- Cards and detail pages lead with media.
  - Show the advertised item price where relevant.
  - Show the **account-check badge next to the poster's name**. It means the
    account was checked; it doesn't guarantee the product is safe.
  - Show the moderated description, photos and video, native share, and
    permitted contact actions.
- Data use:
  - Load thumbnails first.
  - Video autoplay is **off**, and only one video plays at a time.
  - Low-data mode is **on by default when the phone is on cellular data**, and
    the user can turn it off.
  - Pages load in bounded chunks.
- Deleted, hidden, expired or blocked content shows a neutral "no longer
  available" state. Never show cached contact details, and never reveal who the
  owner is.

**Saved** (sign-in is requested only when the user tries to save; afterwards
they return to where they were)

- **Saved items:** private (separate from public likes) and synced across
  devices. Items that are no longer available show as such, without their
  details, and can be removed.
- **Saved searches:** each has a checked, standard filter set and a label.
  **Limit 10 per account.** Results follow exactly the same eligibility rules as
  Explore.

**Alerts**

- In-app buyer alerts.
- An optional **daily saved-search digest** push.
- **Never forward seller or admin notifications** to the buyer app.
- Push stays **off** until the user turns it on in the app **and** grants OS
  permission. If they deny it, everything else keeps working.
  - There's a global switch and a switch per search.
- **Digest rules:**
  - One combined digest per opted-in account per day, at **08:00
    Africa/Johannesburg** (06:00 UTC).
  - It covers **new** posts since the last run, with at most 50 matched IDs
    recorded per digest.
  - An edit is not a new post. A renewal counts only if current product policy
    already says so.
- Lock-screen text is generic and in the account's language. The notification
  opens the saved-search screen.
- Notifications never contain enquiry text, private contact details, renewal or
  upgrade prompts, or payment links.

**Account**

- **Sign-in options:**
  - Native email and password, plus registration with the existing validation,
    confirmation and registration rules.
  - **Google** on both platforms.
  - **Sign in with Apple**: native on iPhone; in the browser on Android, for
    users who registered with Apple.
- Existing Google-only users sign in without resetting anything and keep their
  entitlements.
- Phone OTP is for verification only and is **not** a login method.
- **Settings and safety:**
  - Language: English (default), Afrikaans or isiZulu.
  - Theme: light, dark or system.
  - Low-data mode.
  - Notification preferences.
  - Blocked users.
  - Help and safety, Terms, Privacy and data requests (DSAR), Support.
- **Delete account:** requires signing in again (re-authentication), and follows
  the existing legal-retention and DSAR rules. Don't promise immediate erasure
  of payment or abuse records that the law requires you to keep.
- Sign out.
- App version.

**Contact and safety** (on the detail screen)

- **Call** and **WhatsApp** follow the **existing reveal and eligibility
  rules**. Never expose hidden seller phone numbers or emails through the app's
  API.
- Handle phones that have no WhatsApp or dialler.
- Taps are recorded as **contact intent**, never as an enquiry or a sale.
- **Send enquiry:** sign-in required, Turnstile challenge, idempotency key
  (section 7.5).
- **Report** content or a user (sign-in plus Turnstile).
- **Block or unblock a seller.** A blocked seller disappears from Explore,
  search, saved-search results and digests, and can't be contacted through the
  app. Reports already filed stay under the existing policy.

**General quality**

- Accessibility: screen-reader labels, text scaling up to 200% with nothing cut
  off, 44-point minimum tap targets, AA contrast, reduced-motion support.
- **Forced update:** if `/config` says this version is below the minimum
  supported, show a blocking screen with a link to the store listing.

### 5.2 Seller web work, shipped alongside v1

- Test on Android Chrome and iPhone Safari:
  - Installing to the home screen.
  - Login and recovery.
  - Posting and media upload.
  - KYC capture.
  - Leads.
  - Ozow handoff, and returning after switching apps.
- Fix only the problems you find, each with a regression test. No redesign.
- Add a short "Add VerifyMzansi to your home screen" help page and a public
  account-deletion page.

### 5.3 Not in scope without a new owner decision

- Native seller posting, editing, KYC, leads inbox or admin tools.
- Seller features on iPhone, in-app purchase, chat, booking or escrow, ad SDKs,
  launch outside South Africa, machine-learning recommendations.
- **Android seller mode** (posting, my posts, leads and plan status, with no
  purchase paths) is a possible separate phase after launch. It needs its own
  policy check and the owner's written approval.

---

## 6. Repository, tooling and configuration

### 6.1 Layout (decided; protects the live website)

```
/ (website, unchanged at root; root install/build/deploy commands unchanged)
mobile/              Expo app — STANDALONE pnpm project: own package.json, pnpm-lock.yaml, .npmrc
packages/shared/     source-only TypeScript (no package.json install step, no runtime deps):
                     enums, public DTO types, filter/search zod schemas, formatting helpers,
                     translation loader helpers. Pure code only.
```

- **No root `pnpm-workspace.yaml` in v1.** The root `.npmrc` hoists everything
  (`node-linker=hoisted`), and the website runs React 19.3.0. A shared workspace
  risks React and React Native version clashes, and it would add React Native
  downloads to the website's CI and Cloudflare deploy installs.
  - If you believe a workspace is better, **prove** with a branch build that
    `pnpm install`, `pnpm build`, `pnpm build:cloudflare`, CI and the deploy are
    unchanged. Then ask the owner.
- **`mobile/.npmrc`:**

  ```
  node-linker=hoisted
  minimum-release-age=10080
  ```

- **`mobile` uses `packages/shared`** through Metro `watchFolders` and a
  tsconfig `paths` alias (`@verifymzansi/shared/*`).
  - The website may import it later through a tsconfig alias. Do that only when
    you extract pure logic that the web already uses, and keep web behaviour
    identical.
- **Never import into `mobile` or `packages/shared`:** server-only code, Node
  `crypto`, cookie clients, Next.js components or browser stores.
- **Root repo changes:**
  - Add `"mobile"` and `"packages"` to `exclude` in **both** `tsconfig.json` and
    `tsconfig.typecheck.json`, unless `packages/shared` is deliberately added to
    the web's typecheck.
  - Add `mobile` to `.dockerignore`.
  - Run eslint, knip, depcruise, jscpd, vitest, prettier, `secret-scan` and
    `licenses:check`, and confirm each one either ignores `mobile/` or covers it
    on purpose.
- **CI:** add a `mobile` job to `.github/workflows/ci.yml`.
  - It runs only when `mobile/**`, `packages/shared/**`, `docs/openapi.json` or
    the workflow file changes.
  - Steps: install, lint, typecheck, Jest, `expo install --check` (or
    `npx expo-doctor`), OpenAPI type generation with no diff, and the compliance
    tests.
  - Pin actions to commit SHAs like the existing workflows.
  - **`deploy.yml` must not change behaviour and must not run because of mobile
    changes.**

### 6.2 Expo project

- Use the **current stable Expo SDK** (at least 7 days old), with Expo Router
  and strict TypeScript. Install packages with `npx expo install`, pin their
  versions and record them in `mobile/README.md`.
  - The New Architecture is on.
  - Record the actual minimum and target OS versions from the SDK. Don't claim
    support for devices the SDK doesn't support.
- **Identifiers:**
  - Bundle ID and package name: **`com.verifymzansi.app`**. Check it's available
    and whether the owner already has assets registered. If it's taken, ask the
    owner.
  - URL scheme: `verifymzansi`.
  - Display name: `VerifyMzansi`.
- **EAS build profiles:**
  - `development`: dev client.
  - `preview`: staging API, internal distribution.
  - `production`: store builds.
  - Each has its own update channel, and `runtimeVersion` uses the `appVersion`
    policy.
  - Staging and development builds use their **own identifiers** (e.g.
    `com.verifymzansi.app.staging`) and their own app-link hosts.
- **Public config** (set through EAS environment variables; these are **not
  secrets**):
  - `EXPO_PUBLIC_API_BASE_URL`
  - `EXPO_PUBLIC_SUPABASE_URL`
  - `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (**`sb_publishable_…` only**; F9)
  - `EXPO_PUBLIC_ENV`
  - `EXPO_PUBLIC_SENTRY_DSN`
  - The EAS project ID
- **Never put any of these in the app:** service-role or secret keys, the
  Turnstile secret, Ozow keys, Apple private keys, signing credentials, or push
  credentials.
  - `SENTRY_AUTH_TOKEN` is an EAS **build** secret only.

### 6.3 Libraries

Install with `npx expo install` and choose versions at least 7 days old.

| Need                | Library                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Navigation          | `expo-router`                                                                                                                    |
| Server state        | `@tanstack/react-query`. Persist public queries only, maximum age 24 h.                                                          |
| Lists               | `@shopify/flash-list`                                                                                                            |
| Media               | `expo-image` (the web already has blurhash placeholders), `expo-video`                                                           |
| Forms               | `react-hook-form` + `zod` (schemas in `packages/shared`)                                                                         |
| i18n                | `i18next`, `react-i18next`, `expo-localization`, single-brace interpolation (F15)                                                |
| Secure storage      | `expo-secure-store` plus an encrypted adapter, with AsyncStorage holding the encrypted blob                                      |
| Auth                | `@supabase/supabase-js`, `expo-web-browser`, `expo-auth-session`, `expo-apple-authentication`, `expo-crypto`                     |
| Captcha challenge   | `react-native-webview` (limited to the Turnstile page, section 7.3)                                                              |
| Links               | `expo-linking`                                                                                                                   |
| Push                | `expo-notifications`, `expo-device`                                                                                              |
| Device info         | `expo-application`, `expo-constants`, `@react-native-community/netinfo`                                                          |
| Location (optional) | `expo-location`, approximate and foreground only                                                                                 |
| Updates             | `expo-updates`                                                                                                                   |
| Monitoring          | `@sentry/react-native`, with source maps uploaded in EAS builds                                                                  |
| API types           | `openapi-typescript` + `openapi-fetch`, generated from `../docs/openapi.json`                                                    |
| Styling             | Native `StyleSheet` with a semantic token object built from `docs/DESIGN-SYSTEM.md` and `tailwind.config.ts`. **No NativeWind.** |
| Tests               | `jest-expo`, `@testing-library/react-native`; Vitest for `packages/shared`; **Maestro** for end-to-end flows on release builds   |

### 6.4 App structure

```
mobile/
  app/_layout.tsx                    providers: Query, i18n, theme, auth, Sentry, update gate
  app/(tabs)/{explore,saved,alerts,account}/...
  app/search.tsx · app/content/[type]/[id].tsx
  app/enquiry/[type]/[id].tsx · app/report/[type]/[id].tsx      (modals)
  app/auth/{sign-in,register,forgot-password}.tsx · app/mobile/auth/callback.tsx
  app/account/{blocked,language,notifications,delete}.tsx · app/update-required.tsx
  src/api/      client.ts (base URL, bearer, X-Install-Id, User-Agent, request id), schema.d.ts (generated)
  src/auth/     session.ts (supabase-js + encrypted SecureStore adapter), oauth.ts, apple.ts, admission.ts
  src/security/ TurnstileChallenge.tsx (bounded WebView)
  src/features/ explore/ search/ content/ saved/ alerts/ account/ safety/
  src/i18n/     mobile namespace en/af/zu + loader for shared bundles
  src/ui/       tokens.ts + brand components (Shield, VerificationChip, Card, Button, states)
  src/lib/      installId.ts, network.ts, dataSaver.ts, analytics.ts, views.ts
  maestro/      critical journeys
```

---

## 7. Authentication and abuse protection

### 7.1 Principles

- Use **Supabase sessions and the official PKCE flows** wherever possible.
  **Don't invent a custom token protocol.**
- Pull the existing login, register and profile-admission rules out into
  **server services**, called by both the browser routes (adapters) and the
  mobile routes.
- **Browser routes keep cookies, same-origin and CSRF exactly as they are.**
- **Mobile routes:**
  - Return sessions in `Cache-Control: private, no-store` JSON responses.
  - **Never set browser cookies.**
  - Use request-scoped, non-persistent Supabase server clients.
- **Keep every existing check:**
  - Password policy and the breached-password check
    (`src/lib/security/pwned-passwords.ts`).
  - Registration uniqueness and orphan clean-up.
  - Lockout.
  - Distributed rate limits.
  - Profile-creation policy.
  - Authoritative account-state checks.

### 7.2 Admission (account-state gate)

- After every login method, call **mobile admission**. It re-reads the profile
  and restriction status, and **refuses** banned, suspended, deleted or missing
  profiles. Failure to read the status also counts as a refusal.
- Reuse the existing provisioning policy for new OAuth users. **Never recreate a
  deleted profile** just because none exists.
- Clear any session that can't be used.
- **An "admitted" flag on the client authorises nothing.** Every protected
  mobile endpoint independently checks the token and the account state (7.6).
- **Don't merge accounts** just because the email addresses match. Follow the
  existing trusted provider-linking rules; Apple private-relay identities stay
  separate. Write down a support flow for account collisions.

### 7.3 Native Turnstile challenge

- Add the first-party page **`/mobile/security-check`**. It contains **Turnstile
  only**: no credentials, OAuth, payments or navigation, and a CSP scoped to
  that page alone.
- Load it in a **bounded WebView** whenever a protected native form needs a
  challenge: login, register, forgot-password, resend-confirmation, enquiry or
  report.
  - Block navigation to anything except the page and the Turnstile resources
    Cloudflare documents.
  - Keep the default user agent unchanged, as Cloudflare's mobile guidance
    requires.
- **The bridge:** accept `postMessage` only from the expected origin, with a
  schema-validated message tied to an active challenge (a nonce that you
  generate).
- **Token handling:** keep the token in memory only and send it **once** to the
  target API. Never put it in a URL or a log.
- **Server checks:** extend the Turnstile verifier to check the **expected
  hostname and action** for each native operation (`m_login`, `m_register`,
  `m_forgot`, `m_resend`, `m_enquiry`, `m_report`), while staying compatible
  with the browser.
  - Verification is always done server-side with Cloudflare.
  - **Missing, invalid, replayed, expired, wrong-host or wrong-action tokens all
    fail.**
  - If Cloudflare is down, **fail closed** and show a retry or cancel option.
- App attestation (App Attest or Play Integrity) is optional hardening for
  later. It's **not** part of v1 and doesn't replace these checks.

### 7.4 Login methods

- **Email and password.**
  - The native forms call `POST /api/mobile/v1/auth/login` and `/auth/register`
    with the Turnstile token.
  - **Never** call Supabase signup or password login directly from the app.
  - A usable session is returned only after admission succeeds.
- **Google.**
  - Use the official Supabase **PKCE** flow in the system authentication browser
    (`expo-web-browser` / `AuthSession`).
  - Store the verifier securely and allow **one active attempt** at a time.
  - Accept only the configured callback,
    `https://verifymzansi.com/mobile/auth/callback`, as a universal or app link.
    The `verifymzansi://` scheme is for development builds only.
  - Handle cancellation, expiry and the app being killed mid-flow.
  - Exchange the code once with the SDK, then run admission.
  - No implicit flow, and no tokens in URLs.
- **Apple on iPhone.**
  - Native `expo-apple-authentication` with a **cryptographically random
    nonce**. The SHA-256 hash goes to Apple; the raw nonce goes to Supabase with
    `signInWithIdToken`.
  - Then run admission.
  - Handle relay emails, a missing name after the first sign-in, and credential
    revocation.
- **Apple on Android:** the browser PKCE flow, with the same callback and
  admission.
- **Apple key rotation:** write a runbook for **rotating the Apple client secret
  every 6 months** (`docs/runbooks/apple-signin-secret-rotation.md`,
  allow-listed in `.gitignore`).
- **Forgot password.**
  - Starts natively, with Turnstile and the existing abuse controls.
  - Recovery is completed in the **browser**, using the existing signed recovery
    proof, AMR checks and password validation.
  - After completion, the user goes back to the normal app login. **Never sign
    them in automatically.**
  - **Don't route `/auth/callback` or the reset paths into the app.**

### 7.5 Sessions on the device

- Keep sessions and PKCE verifiers in an **encrypted adapter backed by
  SecureStore**: an AES key in SecureStore, with the encrypted data in
  AsyncStorage, following Supabase's React Native guidance.
- Test it for:
  - Size limits and interrupted writes.
  - Refreshing on return to the foreground.
  - Sign-out, reinstall and switching accounts.
- **Never store passwords.**
- **Refresh one at a time**, so parallel refreshes don't race.
- Never automatically retry a write that isn't safe to repeat after a refresh.
- If a refresh fails, go back to free browsing and **clear everything belonging
  to the user**.

### 7.6 Mobile request authentication (`src/lib/mobile/auth.ts`)

- `requireMobileUser(request)`:
  - Reads **only** `Authorization: Bearer`. **Never** reads cookies.
  - Validates the token with Supabase: `auth.getUser(jwt)`, or `getClaims`
    against the project's JWKS if it uses asymmetric signing keys. Check which
    applies.
  - Loads account state and **fails closed**: 401 for a missing, invalid or
    expired token; 403 for a restricted account.
- A token that is **present but invalid is rejected**, never treated as an
  anonymous request.
- **Public endpoints** may leave out the token. When a token is present, block
  filtering is applied.
- **Middleware:** `/api/mobile/` must reach its handler with no login redirect
  and no cookie refresh. Security headers stay.
- **Never** add CORS headers to mobile routes.

### 7.7 Rate limits (starting values; tune from data, record changes)

| Group                                    | Key                                       | Start                                                               |
| ---------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------- |
| Public reads (content, config, taxonomy) | Trusted IP                                | 600 per 5 min (allows for many users sharing one mobile-network IP) |
| Public reads                             | Install ID (secondary)                    | 240 per 5 min                                                       |
| Login, register, forgot, resend          | Trusted IP plus the existing auth actions | Reuse the existing limits                                           |
| Enquiries                                | User                                      | 10 per hour, 30 per day                                             |
| Reports                                  | User                                      | 20 per day                                                          |
| Saved items and saved searches writes    | User                                      | 300 per hour (and at most 10 searches, 500 items)                   |
| Blocks                                   | User                                      | 100 per day                                                         |
| Device registration                      | User                                      | 20 per hour                                                         |
| Views batch                              | Install ID (the RPC also caps per IP)     | 120 per hour                                                        |

Use the **existing distributed limiter**. Anonymous limits use trusted
Cloudflare headers. **Install IDs are an extra abuse signal only, never
identity.**

---

## 8. Analytics, links and translations

### 8.1 Views and analytics

- **User-Agent:** every request sends
  `User-Agent: VerifyMzansiApp/<version> (<ios|android> <osVersion>)`.
  - **Add a test** that this string is **not** matched by `isAutomatedUserAgent`
    (F8).
  - Make sure no request goes out with the default `okhttp` agent, including
    image and `fetch` requests where that's possible.
- **`POST /api/mobile/v1/views`** reuses the event schema from F7 and
  `record_content_views`.
  - Viewer key: `user:<uid>` from the validated session, or a server-side
    **pseudonymous** key derived from the install ID with the existing server
    secret, for example an HMAC using `IP_HASH_SECRET`.
  - **Never accept user, owner or staff flags from the client.**
  - Network identity comes only from trusted Cloudflare headers.
  - Keep the owner and staff exclusions, the 30-minute window, de-duplication
    and per-IP caps.
- **What counts:**
  - Opening an available detail screen.
  - Video played for 2 continuous seconds with at least half visible.
  - Engaged video is recorded separately.
  - Background playback, prefetching and cards that weren't seen **don't
    count**.
- **Sending:**
  - At most 20 events per batch, with capped retries.
  - **No offline buffering of views in v1.**
  - A failure never blocks browsing.
  - Tag native views with a `surface` such as `app:detail`. Never touch website
    visit statistics.
- **Product events** (first-party only, through a mobile endpoint that reuses
  `/api/analytics/events`):
  - `search_performed` (filter types, never free text)
  - `detail_viewed`
  - `contact_intent` (call or WhatsApp)
  - `enquiry_confirmed` (server-confirmed only)
  - `item_saved`
  - `saved_search_created`
  - `notification_consent`
  - `push_opened`
  - `app_return`
- **Consent:** follow the web's rules in `consent_records`.
- **Never** collect an advertising identifier, use a tracking SDK or collect
  background location.
- Pseudonymised data isn't anonymous, so never describe it as untraceable.

### 8.2 Measurement

- Report:
  - Search to detail.
  - Detail to contact intent.
  - Server-confirmed enquiries.
  - 7-day and 30-day buyer return.
  - Seller renewals on the website.
- **Report call and WhatsApp taps separately from enquiries.** Never infer
  purchases.
- Establish website and beta baselines before setting any growth targets.

### 8.3 App links

- **`public/.well-known/apple-app-site-association`**, served as
  `application/json` through `public/_headers`, with no redirect and no auth.
  - App ID `<TEAMID>.com.verifymzansi.app`.
  - **Opens the app:** `/listing/*`, `/mzansi-market/*`, `/mzansi-business/*`,
    `/promotions/*`, `/mobile/auth/callback`.
- **`public/.well-known/assetlinks.json`** for `com.verifymzansi.app` with the
  **Play App Signing** SHA-256 fingerprint. The upload-key fingerprint alone
  doesn't work for store installs. The owner gets it from the Play Console after
  the first upload.
- **Never handled by the app:** `/post*`, `/billing*`, `/pricing*`,
  `/advertise*`, `/sponsors*`, `/dashboard*`, `/verification*`, `/admin*`,
  `/staff*`, `/auth/*`, `/forgot-password`, `/reset-password`,
  `/mobile/security-check`.
- Staging uses its own host and its own association files.
- Make sure the middleware, CSP and `_headers` don't redirect or block
  `/.well-known/*`. Check with `curl -I`.
- **Test:**
  - Cold and warm start.
  - The app killed during OAuth.
  - Invalid IDs, expired codes and wrong-host links.
  - Sharing from WhatsApp.
  - The website fallback when the app isn't installed.
- **The app accepts only:**
  - Its own known routes.
  - `https:` links to verifymzansi.com that are on the allowlist.
  - `tel:`.
  - `https://wa.me/`.
- A notification URL is never executed as-is.

### 8.4 Translations

- Reuse the three existing bundles through `packages/shared` loader helpers, and
  add a `mobile` namespace.
- Use **single-brace interpolation** (F15), with English as the fallback.
- Tests check that every key exists in all three languages, and that no screen
  ever shows a raw key.
- **Human review** of new Afrikaans and isiZulu text is a launch dependency
  (owner). Until reviewed, unreviewed strings fall back to English and are
  listed in the progress log.
- Make icon, splash and store images from the existing artwork
  (`public/icons/icon-1024.png` and the maskable icons). **Don't redesign the
  logo.**

---

## 9. Database, push and privacy

### 9.1 New tables (additive migrations; follow the existing naming; RLS on; least-privilege grants)

If you find an equivalent table already exists, extend it instead of creating a
duplicate.

```sql
saved_items(user_id uuid not null references auth.users on delete cascade,
  target_type text not null check (target_type in ('listing','business','promotion')),
  target_id uuid not null, created_at timestamptz not null default now(),
  primary key (user_id, target_type, target_id))
  -- RLS: owner select/insert/delete only. Index (user_id, created_at desc). Max 500 per user (server).

saved_searches(id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  label text not null check (char_length(label) between 1 and 80),
  area public.marketplace_area null,
  filters jsonb not null default '{}'::jsonb,      -- canonical; validated by shared zod schema
  digest_enabled boolean not null default false,
  last_processed_at timestamptz null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now())
  -- RLS: owner only. Max 10 per user, enforced server-side AND by a trigger (race-safe).

user_blocks(blocker_user_id uuid not null references auth.users on delete cascade,
  blocked_user_id uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  check (blocker_user_id <> blocked_user_id))
  -- RLS: blocker select/insert/delete own rows; blocked party can never learn they were blocked.

mobile_devices(installation_id uuid primary key,           -- random per install, not hardware ID
  user_id uuid null references auth.users on delete cascade,
  platform text not null check (platform in ('ios','android')),
  expo_push_token text null unique, push_consent boolean not null default false,
  app_version text not null, locale text not null default 'en',
  last_seen_at timestamptz not null default now(), disabled_at timestamptz null)
  -- service role only (via API). Re-registration moves ownership to the new admitted user.

mobile_enquiry_idempotency(user_id uuid not null, idempotency_key uuid not null,
  body_hash text not null, lead_id uuid null, response jsonb not null,
  created_at timestamptz not null default now(), primary key (user_id, idempotency_key))
  -- service role only; purge after 24 h.
```

- **Preferences:**
  - Put `locale`, `digest_enabled` (global) and `low_data_enabled` in the
    **existing communication preferences** (`/api/communications/preferences`
    and its table) if that storage fits cleanly. Otherwise create a
    `mobile_preferences(user_id pk, …)` table.
  - All push categories start **off**.
- **Outbox and digest state:**
  - Reuse `operation_jobs` and `queue_claims`, with their lease fencing (see
    `docs/runbooks/production-audit-rollout-2026-10-01.md`), wherever possible.
  - Only if they can't fit, add
    `push_outbox(id, user_id, category, payload jsonb, dedupe_key unique, status, attempts, next_attempt_at, expo_ticket_ids, receipt_checked_at, created_at)`.
- **Account deletion and DSAR:**
  - Add the new tables to the deletion and DSAR export code.
  - Cascades remove saved data, blocks, devices and digest state.
  - Legal evidence and **trial-abuse protections** must remain.
  - Test this explicitly.
- **Concurrency tests:**
  - Saving or blocking twice at the same moment.
  - The 10-search limit under parallel requests.
  - Moving a device token between accounts.

### 9.2 Push and digest worker

- **Delivery** goes through the Expo push service, backed by **APNs and FCM
  credentials** under owner control.
- **Scheduling:**
  - Add the cron to the existing ops-jobs worker (`wrangler.ops-jobs.toml`). If
    you have to add a new worker, **add it to `deploy.yml`**.
  - The digest runs at **06:00 UTC**.
  - Job key `digest:<account>:<date>`, with fenced leases, bounded batches and
    saved attempt state.
- **Selection:**
  - Use the **same public read service** as Explore: live content only, with the
    mandatory filters.
  - Exclude placeholder content (`is_placeholder_content`) and blocked sellers.
  - Recheck that the account is still eligible (not deleted or restricted)
    before sending.
- **Advance `last_processed_at` only after the in-app digest or outbox entry is
  safely committed.**
- **Sending:**
  - At most one combined push per account per day.
  - Up to 100 messages per Expo request.
  - Fetch receipts after about 15 minutes.
  - Disable a token on `DeviceNotRegistered`.
  - Exponential backoff, at most 5 attempts.
  - Push is **not exactly-once**, so never promise "no duplicates".
- **Fixed template list** in code: `saved_search_digest`, `report_outcome` and
  `account_security`.
  - No template may mention plans, renewals, upgrades, boosts or payments
    (tested).
  - Quiet hours are 21:00 to 07:00 SAST, except `account_security`.
- **Account switching:**
  - On sign-out or account switch, unregister the device from the old account
    while still signed in where possible.
  - Clear local user data.
  - Register the device to the new account only after fresh admission.
- If the user opts out or revokes permission, sending stops. In-app digest
  results stay available.

### 9.3 Local data and privacy

- **The app may store only:**
  - Bounded public summaries and media, labelled with their age ("Updated 2 h
    ago").
  - The user's saved references.
- **Never store** enquiry text, KYC evidence, passwords, raw tokens outside
  secure storage, or private seller data.
- Contact, reports, auth, saves and blocks need a connection in v1. When
  offline, show a retry state, never a false success.
- Clear user data on sign-out, account switch or deletion.
- Re-check content is still available before showing contact options.
- **Store privacy labels and the privacy notice must match what the app actually
  collects and what its SDKs actually do:**
  - Account email and ID.
  - Saved items and searches.
  - Reports.
  - Enquiries.
  - Device push token.
  - Approximate location, if granted.
  - Crash data.
  - First-party analytics.
  - No tracking.
- Sentry `beforeSend` scrubs personal data, mirroring the web logger's redaction
  list (`src/lib/utils/logger.ts`).

---

## 10. Mobile API (`/api/mobile/v1`)

### 10.1 Conventions

- Responses are JSON only, never HTML.
- **Errors:**
  `{ "error": { "code": "snake_case", "message": "…", "requestId": "…", "retryAfter"?: n } }`,
  with status 400, 401, 403, 404, 409, 422, 429 or 503. Every response sends an
  `X-Request-Id` header.
- **New list endpoints:** `{ items, page, limit, hasMore }`.
  - Default 24, maximum 50 per page.
  - Stable sort order with the **ID as a final tie-breaker**.
  - Blocked sellers are excluded **in the query, before pagination**. The app
    also removes duplicates when it appends pages.
- **Response fields come from explicit whitelists (DTOs)**, never raw database
  rows.
  - **Public DTOs never contain:** seller-plan prices, entitlement or slot
    balances, invoice or payment data, Ozow or checkout URLs, hidden phone or
    email fields, or KYC details beyond the public badge.
  - Advertised item prices **are** included.
- **Caching:**
  - Private or session responses: `Cache-Control: private, no-store`.
  - Anonymous public responses may use short caching **only** if moderation and
    expiry still take effect correctly.
  - Responses personalised by blocks are private.
- **Database access:**
  - Normal user data goes through a **request-scoped RLS client**.
  - Where the service-role client is needed, check ownership, account state and
    target eligibility explicitly, and test those checks.
  - No admin features. No bulk exposure of profiles or phone numbers.
- **Versioning:**
  - Within `v1`, only additive changes.
  - Breaking changes go to `v2`.
  - Older installed apps are protected through `minSupportedVersion` in
    `/config`.

### 10.2 Endpoints

| Method and path                                                                               | Auth                                   | Purpose                                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /config`                                                                                 | none                                   | `minSupportedVersion` and `latestVersion` per platform, maintenance flag, support, privacy, terms and help URLs, and kill switches (`mobile_enquiries`, `mobile_push`) from `feature_flags`. **No flag can switch on paid or seller features.** |
| `GET /taxonomy?locale=`                                                                       | none                                   | Areas, categories, conditions, provinces and towns, and sort options, with localised labels                                                                                                                                                     |
| `GET /home?province=&town=`                                                                   | optional                               | Showroom rows using the existing fair rotation and local-first logic                                                                                                                                                                            |
| `GET /content?area=&q=&category=&province=&town=&condition=&sort=&page=&limit=`               | optional                               | Discovery, using the extracted public read service                                                                                                                                                                                              |
| `GET /content/{type}/{id}`                                                                    | optional                               | Detail. **404 if the content isn't live**, without revealing anything.                                                                                                                                                                          |
| `POST /views`                                                                                 | optional                               | Section 8.1                                                                                                                                                                                                                                     |
| `POST /contact-intents`                                                                       | optional                               | Records call and WhatsApp taps, reusing the `contact_events` logic                                                                                                                                                                              |
| `POST /events`                                                                                | optional                               | First-party product events (8.1)                                                                                                                                                                                                                |
| `POST /auth/login` · `/auth/register` · `/auth/forgot-password` · `/auth/resend-confirmation` | none + Turnstile                       | Section 7.4. Never returns an admin session.                                                                                                                                                                                                    |
| `POST /auth/apple`                                                                            | none                                   | Native Apple ID token plus nonce, then admission                                                                                                                                                                                                |
| `POST /auth/admit`                                                                            | bearer                                 | Runs admission after Google or Android Apple PKCE                                                                                                                                                                                               |
| `POST /auth/sign-out`                                                                         | bearer                                 | Revokes the session and unregisters this device                                                                                                                                                                                                 |
| `GET /me` · `PATCH /preferences`                                                              | bearer                                 | Safe profile fields. Locale, digest and low-data preferences.                                                                                                                                                                                   |
| `POST /auth/reauthenticate` · `DELETE /account`                                               | bearer                                 | Re-authentication helper (a **current** credential, not just an old token), then deletion through the existing service                                                                                                                          |
| `GET /saved-items` · `PUT/DELETE /saved-items/{type}/{id}`                                    | bearer                                 | Repeating a save or removal is harmless. Unavailable items appear as stubs.                                                                                                                                                                     |
| `GET/POST /saved-searches` · `PATCH/DELETE /saved-searches/{id}`                              | bearer                                 | Validated with shared zod schemas. At most 10.                                                                                                                                                                                                  |
| `GET /blocks` · `PUT/DELETE /blocks/{sellerId}`                                               | bearer                                 | Blocking yourself returns 422                                                                                                                                                                                                                   |
| `POST /reports`                                                                               | bearer + Turnstile                     | Existing reports service and reason codes                                                                                                                                                                                                       |
| `POST /enquiries`                                                                             | bearer + Turnstile + `Idempotency-Key` | Section 10.3                                                                                                                                                                                                                                    |
| `GET /notifications` · `PATCH /notifications/{id}`                                            | bearer                                 | **Allowlisted buyer categories only.** Ownership is checked. Link targets are restricted (8.3). Uses the existing read/unread meaning.                                                                                                          |
| `PUT /devices/{installationId}` · `DELETE /devices/{installationId}`                          | bearer                                 | Register or unregister a push token and record consent                                                                                                                                                                                          |

### 10.3 Enquiries

- The app generates a UUID for each **send attempt** and reuses it on retries.
- The server stores `(user, key) → body hash + result` for 24 hours:
  - The same key with the same body returns the stored result.
  - The same key with a **different** body returns **409**.
- **The lead and the idempotency record are saved in one transaction.** Seller
  notification and email go through the existing durable operation or outbox
  model, so a failed email can never cause a duplicate lead.
- If either side has blocked the other, return 403 `blocked`.
- When the `mobile_enquiries` flag is off, return 503 `disabled`.
- Replies go to the account email.

### 10.4 Contract

- **Document every mobile endpoint** in `docs/openapi.json` before implementing
  it.
- Regenerate the types:
  - The website's `src/lib/api/v1.d.ts` through the existing tooling.
  - The app's `mobile/src/api/schema.d.ts`.
- Add **handler contract tests**: responses must validate against the spec.
- Add an **endpoint inventory test** that fails if any route under
  `src/app/api/mobile/v1` is missing from the spec.
- Existing website API contracts stay compatible.

### 10.5 Shared services (no behaviour change for the website)

- Before refactoring, add **snapshot or contract tests** for the affected
  website routes.
- Move query-building and business rules into
  `src/lib/marketplace/public-read/*`, `src/lib/auth/services/*`,
  `src/lib/contact/enquiry-service.ts` and `src/lib/reports/report-service.ts`.
  Website routes then call these.
- Website responses must stay identical, and the tests must pass before and
  after.
- Keep the security-boundary comments next to the code.

---

## 11. Build order and evidence gates

At the end of each milestone, update the progress log and **stop for owner
review**, presenting the evidence listed. A historical pass is not a fresh pass.

**M0 Foundation**

- Record in the progress log:
  - Git status and branch.
  - Package versions.
  - Routes and schema.
  - Rate-limit actions.
  - Names of auth and provider settings (never their values).
  - Communication preferences.
  - CI scripts.
- Re-verify section 3.
- Check `list_migrations`.
- With owner approval, set up **isolated staging**:
  - A separate Supabase project and Worker, with their own R2 buckets and
    secrets.
  - Fix `verifymzansi-staging` so it never touches production.
- Record the owner's backup choice and **run a restore rehearsal** into staging.
  Document it in `docs/runbooks/`.
- Reconcile the plan catalogue and the domain.
- **Vertical slice on real devices against staging:** Turnstile challenge, then
  email login, then admission, then one public detail, then one enquiry, on one
  iPhone and one Android phone.
  - **Don't build every screen before this works.**
- **Evidence:**
  - Proof that staging is isolated: different project ref and buckets, plus a
    test write that appears in staging but not in production.
  - The restore log.
  - A recording of the vertical slice.
  - The inventory.

**M1 Workspace and services**

- The layout from 6.1, root exclusions and the CI mobile job.
- Extract the shared services, with snapshot tests.
- Mobile auth helper, middleware passthrough and DTOs.
- OpenAPI updates.
- Additive migrations, applied to staging.
- **Evidence:**
  - Website `pnpm lint`, `typecheck`, `test:blocking`, `build` and
    `build:cloudflare` all green and **unchanged**.
  - The migration list with deploy order.

**M2 Authentication**

- Challenge bridge.
- Email login, register and recovery.
- Google PKCE.
- Apple, native and through the browser.
- Secure storage, admission, sign-out and account switching.
- Deep links and restrictions.
- **Evidence:** mocked tests reported separately from **real-device and
  real-provider checks**.

**M3 Core app**

- All four tabs: Explore, search, detail, media and contact.
- Saved items and saved searches.
- Report, block and delete.
- Three languages, themes, accessibility, low-data mode and offline behaviour.
- Forced update.
- Confirm that filters, contact visibility, item prices and fair placement
  **match the website**.

**M4 Retention and analytics**

- Buyer-safe alerts.
- Push registration and the digest worker, including receipts and preferences.
- View semantics, including the **User-Agent test**.
- Product events.
- **Evidence:**
  - No seller or admin notifications leak into the app.
  - Blocked content never appears in digests.

**M5 Seller web**

- The device checks and fixes from 5.2, each with a regression test.

**M6 Verification**

- Every test in section 13 on staging.
- Device matrix and Maestro.
- Security, privacy, link and payment-path review.
- `pnpm safety:release`.
- **Evidence:**
  - The device results table.
  - The Maestro report.
  - The checklists in 13.3 and 13.4, every item ticked or explained.
  - Performance measurements.

**M7 Release package**

- Signed Android AAB and iOS release builds through **owner-controlled** EAS
  credentials.
- TestFlight and Play testing.
- Store materials (section 14).
- Runbooks.
- Production backend rollout plan (14.4).
- Submit or publish **only within the owner's authorisation**. Otherwise deliver
  the prepared artefacts and an exact list of owner actions.

**Timing:** roughly **12–16 weeks** after M0 is done, re-estimated at the end of
M0 from real progress. This is not a deadline. Never shorten testing to save
time.

---

## 12. Testing (all automated where possible; record date and result)

### 12.1 Backend and security

- **Website regression:**
  - Cookie, CSRF and origin protection.
  - Browser login, register and recovery.
  - The full `pnpm test:blocking`.
  - Snapshots of the routes that were refactored.
- **Mobile auth:**
  - Bearer-only requests get JSON responses.
  - Requests with only a cookie are rejected.
  - Requests carrying both a cookie and a bearer token use only the bearer
    token.
  - Forged, expired and wrong-project tokens fail.
  - Present-but-invalid tokens are refused, never treated as anonymous.
  - Missing, banned, suspended and deleted profiles fail.
- **Isolation:**
  - Reads and writes across accounts.
  - Service-role ownership checks.
  - Getting around a block through detail, contact or digests.
  - Hidden or expired content.
  - ID enumeration.
- **Turnstile:** missing, invalid, replayed, expired, wrong host, wrong action,
  and Cloudflare down. Also message injection into the bridge and navigation to
  foreign pages.
- **OAuth:** replay, wrong verifier, cancel, and app restart mid-flow.
- **Apple:** nonce, relay email, missing name, and existing social accounts.
- **Sessions:** secure-storage size and interruptions, refresh races, account
  switching, sign-out while offline, moving push tokens between accounts,
  recovery proof, and re-authentication before deletion.
- **Database:**
  - Saves, blocks and the 10-search limit under concurrent requests.
  - Enquiry idempotency: replay and body mismatch.
  - Digest windows, retries, lease fencing and opt-out.
- **DTOs and templates:**
  - No banned fields in public DTOs.
  - Item prices **are** present.
  - No disallowed links in notifications.
  - Push templates contain no commercial wording.
- **Views:**
  - The app User-Agent isn't treated as a bot.
  - De-duplication by device and by user.
  - Owner and staff views excluded.
- **Contract:** handlers match OpenAPI, and the endpoint inventory is complete.
- **Ozow regression on staging:**
  - Pending, success and failure.
  - Duplicate and signed webhooks.
  - Refunds and entitlement expiry.
  - Amount and currency checks.
  - **Test fixtures don't prove real money is settled.**

### 12.2 Native and product

- **Release builds** on real devices:
  - An iPhone SE (2020) size display.
  - A recent iPhone.
  - A low-end and a mid-range Android phone supported by the SDK.
  - Test conditions: text scaling, screen reader, light and dark, reduced
    motion, all 3 languages, a slow-3G profile and switching offline and back.
- **Maestro critical journeys:**
  - Anonymous search to detail.
  - Every login method.
  - Save, saved search and digest (triggered manually on staging).
  - Enquiry, including a retry that must not create a duplicate.
  - Call and WhatsApp, including when the apps are missing.
  - Report, block and unblock.
  - Delete account.
  - Share links on cold and warm start.
  - An expired auth callback.
  - Forced update.
  - Account switch with no leftover data from the previous user.
- **Parity with the website:** filters, item prices, contact restrictions and
  fair placement.
- **Offline:** content is labelled as stale, failures can be retried, there's no
  false success and no flood of retries, and signing out clears previous data.

### 12.3 Performance (measure and record device, OS, build, network and method; these are targets, not guarantees)

- Cold start to a usable home screen: target ≤ 2.5 s on the low-end Android.
- Feed scrolling without visible jank.
- Download size: Android ≤ 25 MB per device, iOS ≤ 40 MB. Report the actual
  numbers.
- One page of feed images with low-data mode on: ≤ 600 KB.
- `/content` p95 from South Africa: ≤ 800 ms.

### 12.4 Release thresholds

- Pilot: **≥ 99.5% crash-free sessions** over 7 days, and **≥ 99% success for
  valid enquiry submissions**. Inspect every failure in a small sample.
- **Zero** open critical or high defects in authorisation or privacy.
- No unhandled crashes in critical flows.
- No unverified migration or recovery dependency at public launch.

---

## 13. Compliance and security checklists (must be fully ticked at M6)

### 13.1 Security

- [ ] Mobile routes accept bearer tokens only, and cookies are ignored (tested).
- [ ] Every protected endpoint fails closed for missing, invalid, expired,
      forged, restricted or deleted accounts (tested).
- [ ] Turnstile protects login, register, forgot, resend, enquiry and report
      from the app, with hostname and action checked (tested).
- [ ] No tokens in URLs, logs, Sentry events or analytics.
- [ ] Sessions are stored only in the encrypted SecureStore adapter, and user
      data is cleared on sign-out or switch (tested).
- [ ] RLS and least-privilege grants on every new table, with isolation tested
      at database level.
- [ ] Rate limits on every write and auth endpoint, keyed by user or trusted IP.
- [ ] No secrets in the app bundle: inspect the built JS bundle, and confirm
      only the `sb_publishable_` key is present.
- [ ] App links exclude dashboard, billing, post, verification, admin, staff and
      auth recovery paths.
- [ ] Release builds don't log network bodies.
- [ ] Every account (stores, Expo, Sentry, signing, APNs, FCM) is owned by the
      company, with MFA. The agent has least-privilege access only.

### 13.2 Privacy

- [ ] Location is approximate, foreground only and optional. No advertising
      identifier and no tracking SDKs.
- [ ] Store privacy labels and data-safety answers match actual collection and
      SDK behaviour.
- [ ] The new tables are covered by deletion and DSAR, and the trial-abuse
      protections are kept (tested).
- [ ] There's an in-app deletion flow **and** a public deletion URL.

### 13.3 Payment path (behaviour and destinations, not word bans)

- [ ] No IAP or billing libraries in `mobile/package.json` (CI check).
- [ ] Public DTOs exclude seller-plan prices, entitlements, invoices, payments
      and Ozow or checkout URLs. Item prices are present (tested).
- [ ] An **allowlist of destinations** covers every link the app can open, in
      screens, notification links and `/config` URLs. Allowed: the app's own
      routes; `https://verifymzansi.com` `/privacy`, `/terms`, `/help*`,
      `/safety*`, `/trust-safety`, `/contact`, the public deletion page and
      `/mobile/*`; `tel:`; `https://wa.me/`. CI runs a test that resolves every
      link in the app.
- [ ] App-owned web pages (`/mobile/security-check`, `/mobile/auth/callback`
      fallback, deletion page): a Playwright test collects every `a[href]` and
      follows redirects, and finds no seller checkout, pricing or dashboard
      destination.
- [ ] Push templates come from a fixed list with no commercial wording (tested).
- [ ] A manual walk through every screen on both platforms finds no seller
      commerce.

### 13.4 Store rules (recheck the current text before submitting)

- [ ] **Apple 4.8:** Sign in with Apple is offered alongside Google on iPhone.
- [ ] **Apple 1.2 (user content):** report, block, moderation queue
      (`/api/admin/queue` receives app reports; confirm) and a named moderator.
- [ ] **Apple 5.1.1(v) and Google:** account deletion in the app and on the web.
- [ ] **Apple 3.1.x and Google Payments:** section 13.3 is fully ticked.
- [ ] **Google:** data safety form, target API level, `POST_NOTIFICATIONS`,
      approximate location only, no broad media permissions, and ads declared as
      "No".

---

## 14. Owner setup, publication and operations

### 14.1 Owner checklist (the agent prepares it and the owner does it; never collect secrets in chat)

| #   | Action                                                                                                                                                                                        | Needed by                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| O1  | Confirm the legal entity (CIPC) that will hold the accounts, and the D-U-N-S status (free)                                                                                                    | M0                             |
| O2  | Apple Developer Program **as an organisation** (US$99/yr, regional pricing may apply)                                                                                                         | M0                             |
| O3  | Google Play Console **organisation** account (US$25 once), plus verification                                                                                                                  | M0                             |
| O4  | Expo organisation owned by the company. Scoped token for the agent. MFA everywhere.                                                                                                           | M1                             |
| O5  | Approve the cost of isolated staging and the backup method. Approve the restore rehearsal.                                                                                                    | M0                             |
| O6  | Create Supabase `sb_publishable_` and `sb_secret_` keys (F9)                                                                                                                                  | Before the first preview build |
| O7  | Supabase OAuth settings: Google and Apple providers, the redirect allowlist (`https://verifymzansi.com/mobile/auth/callback` plus the staging equivalent), Apple Services ID, key and Team ID | M2                             |
| O8  | APNs key (Apple) and FCM credentials (Google) uploaded to EAS                                                                                                                                 | M4                             |
| O9  | Test devices: one low-end Android, plus access to an iPhone                                                                                                                                   | M0                             |
| O10 | Native-speaker review of Afrikaans and isiZulu                                                                                                                                                | M6                             |
| O11 | A named moderation and support person. Targets: urgent safety reports the same working day, others within 2 working days.                                                                     | M7                             |
| O12 | Approve each production migration, each push to `main`, the spending scope, submission and release                                                                                            | M1–M7                          |
| O13 | Reviewer demo buyer account, created in production and entered directly in App Store Connect and the Play Console                                                                             | M7                             |
| O14 | Play App Signing SHA-256 fingerprint and Apple Team ID, for the app-link files                                                                                                                | M7                             |

### 14.2 Budget

- **Store accounts:** Google US$25 once; Apple US$99 per year. Check both before
  paying.
- **Expo:** start on the free tier. Move to Starter (about US$19/month plus
  usage) only if build queues slow the work, and justify any upgrade.
- **Other services:** Supabase, Cloudflare, Sentry, email, SMS and Ozow charges
  are separate. Never call free tiers unlimited, and never work out Ozow fees
  from the code.
- **Budget alerts:** set at 50%, 80% and 100% of an owner-approved monthly
  infrastructure budget. Push and digest workloads are capped in code.
- **Contractor scenario** (an assumption, not a quote): 450–650 hours at R600
  per hour, plus 20% contingency, comes to **R324,000–R468,000**. That excludes
  the foundation remediation, equipment, taxes and recurring charges. Building
  with an AI agent lowers the cash cost but not the duty to verify.
- **Store commission on seller payments: 0%, by design.**

### 14.3 Store materials and pilot

- Store descriptions, screenshots from release builds, feature graphic, icons
  from existing artwork, honest age ratings (user-generated-content
  marketplace), privacy labels and data safety form, support, privacy and
  deletion URLs, and the reviewer account.
- **Reviewer notes:**

> VerifyMzansi is a free South African marketplace directory. In this app,
> anyone can browse and search listings for goods, businesses, and tourism and
> events, and contact sellers by WhatsApp, phone or enquiry. Buyer accounts are
> free. Sign-in is available with email, Google or Apple. There are no
> purchases, subscriptions or paid features in this app, and nothing in the app
> is unlocked by a purchase. Content is posted by verified sellers through our
> website and is moderated before it is published. Users can report any listing
> (⋯ → Report) and block any seller (⋯ → Block seller). Blocked sellers' content
> is hidden immediately. Accounts can be deleted in Account → Delete account.
> Demo buyer account details are in the sign-in fields.

- **Pilot:** TestFlight and Google Play testing with **20–50 South African
  testers**. Mix buyers, sellers, low-end Android users, and Afrikaans and
  isiZulu speakers. Follow any testing requirements that apply to the account
  type.
- **First publication:** use **manual release**. Apple's 7-day phased release
  applies to **updates only**. Google Play staged rollout: 10%, then 50%, then
  100%, at least 3 days per step. Keep initial marketing to an invited audience.
  Public listings can still be downloaded by anyone, so don't describe this as
  an access restriction.

### 14.4 Rollout and rollback

- Follow `docs/runbooks/production-audit-rollout-2026-10-01.md`.
- **Order:**
  1. Additive migrations.
  2. Backend deploy (owner approves the push to `main`).
  3. Check production `/api/health`, `/api/mobile/v1/config` and the app-link
     files with `curl -I`.
  4. Confirm the website smoke and synthetic monitoring stay green.
  5. Release the apps.
- **The APIs go live before any released app depends on them.** `v1` stays
  compatible with older installed apps.
- **Never drop a table when rolling back an app release.**
- **Rollback options:**
  - Turn off a kill switch through `/config`.
  - Redeploy the previous backend.
  - Ship an EAS Update for **compatible JavaScript or asset fixes only**. Native
    dependency, permission or SDK changes need a new build.
- Keep a release record in `docs/runbooks/mobile-release.md`, allow-listed in
  `.gitignore`.
- **Halt the rollout** after a confirmed privacy or authorisation defect, a
  regression in a critical journey, or crash-free sessions below 99%. Turn off
  the affected feature and fix it; **never lower the gates**.

### 14.5 Operations after launch

- **Monitor:**
  - Sentry release health, with an alert below 99.5%.
  - Auth and admission failures.
  - Enquiry failures.
  - Push receipts.
  - Job backlogs.
  - API latency and errors on `/api/mobile/v1/*`.
  - The moderation and report backlog.
  - Infrastructure spend.
- **Report weekly:** buyer return at 7 and 30 days, server-confirmed enquiries,
  contact intent and seller renewals, each kept separate from downloads.
- **After 30 days:** fix proven friction for buyers and on the seller website.
- **Re-check store payment rules:**
  - Before each submission.
  - Before any commercial change.
  - Every quarter.
  - Ahead of Google's billing-choice rollout to the "rest of world" scheduled
    for **30 Sept 2027**. That still carries a service fee.
- **Never base a launch on pending court cases.**
- Don't create monitoring automations unless the owner asks.

---

## 15. Risk register

| Risk                                                           | Mitigation                                                                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Apple rejects over payments                                    | Free-buyer design, destination allowlist, reviewer notes, smallest compliant change. **No in-app purchase without the owner.** |
| Apple rejects over login (rule 4.8) or user content (rule 1.2) | Apple sign-in included, plus report, block, moderation and a named moderator                                                   |
| Turnstile in the WebView fails, or causes too much friction    | Prove it in the M0 vertical slice. Fail closed with retry. If it's unworkable, stop and propose attestation to the owner.      |
| Breaking the live website                                      | Standalone `mobile/`, root exclusions, snapshot tests before refactors, staging first, CI must be unchanged                    |
| Testing pollutes production                                    | Isolated staging in M0 is mandatory                                                                                            |
| Legacy Supabase keys retire and break installed apps           | Ship only the `sb_publishable_` key (F9)                                                                                       |
| Android views discarded as bots                                | Custom User-Agent plus test (F8)                                                                                               |
| Many users behind one mobile-network IP hit rate limits        | Per-user keys and tuned IP ceilings                                                                                            |
| Data costs put users off                                       | Low-data mode on by default for cellular, thumbnails first, no autoplay                                                        |
| Push duplicates or spam                                        | Off until opt-in, de-duplication keys, one digest per day, quiet hours, receipts                                               |
| Apple Sign in secret expires                                   | 6-monthly rotation runbook with a calendar reminder for the owner                                                              |
| Store rules change                                             | Re-check before each submission and every quarter                                                                              |

---

## 16. Final delivery and honest completion

**Deliver:**

- Source code, with pinned dependencies and lockfiles.
- `packages/shared`.
- The OpenAPI contract and generated types.
- Additive migrations, with their order.
- Environment templates (no secrets).
- Staging and production configuration instructions.
- Reproducible build commands and profiles.
- Test suites with their evidence.
- Device and provider QA results.
- Store assets and the reviewer pack.
- Privacy, deletion and support material.
- Seller web verification.
- Runbooks: release, rollback, Apple secret rotation, support.
- `mobile/README.md` and an up-to-date `docs/mobile-build-progress.md`.

**The final report must:**

- Say what works, how it was verified, and which builds exist.
- List the external setup and publication still outstanding, and any
  limitations.
- **Separate implemented, tested, submitted, approved and publicly available.**
  Finishing the code doesn't prove store approval.
- Never invent credentials, device checks or payment settlements in order to
  claim A-to-Z completion.

---

## 17. Official references (recheck during implementation; prefer installed SDK docs)

- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
  (3.1.1, 3.1.3(b)/(e)/(g), 4.8, 1.2, 5.1.1)
- [Google Play Payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)
  ·
  [new fee rollout](https://support.google.com/googleplay/android-developer/answer/16954621)
  ·
  [user choice billing](https://support.google.com/googleplay/android-developer/answer/13821247)
- [Cloudflare Turnstile mobile implementation](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/)
  ·
  [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)
- [Expo Router](https://docs.expo.dev/router/introduction/) ·
  [EAS Build](https://docs.expo.dev/build/introduction/) ·
  [Expo authentication](https://docs.expo.dev/guides/authentication/) ·
  [Expo + Supabase](https://docs.expo.dev/guides/using-supabase/)
- [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) ·
  [Supabase Apple provider](https://supabase.com/docs/guides/auth/social-login/auth-apple)
  ·
  [Supabase React Native auth](https://supabase.com/docs/guides/auth/quickstarts/react-native)
- [Expo AppleAuthentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/)
  · [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) ·
  [Push sending, receipts and retries](https://docs.expo.dev/push-notifications/sending-notifications/)
- [Android App Links](https://docs.expo.dev/linking/android-app-links/) ·
  [iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/)
- [Google account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
  · [Apple enrolment](https://developer.apple.com/programs/enroll/) ·
  [Google enrolment](https://support.google.com/googleplay/android-developer/answer/6112435)
  · [Expo pricing](https://expo.dev/pricing)
- [Apple phased release (updates)](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/)
  · [EAS Update](https://docs.expo.dev/eas-update/introduction/)

_Confidence note:_ the repository facts above were checked on 2026-10-02.
Production readiness still depends on fresh evidence, credentials, real devices
and an approved rollout. Don't treat this document as a substitute for those
checks.
