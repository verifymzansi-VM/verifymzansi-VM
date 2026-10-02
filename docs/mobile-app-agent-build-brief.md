# VerifyMzansi: complete AI-agent build instructions

Prepared 2 October 2026. Copy this entire document into the implementation
agent's initial message. It is self-contained and supersedes the earlier mobile
proposals where they differ.

## 1. Your assignment and operating rules

You are the implementation agent for VerifyMzansi. Build a production-quality,
free buyer app for Android and iPhone, together with the backend integrations,
device tests, store submission materials and operating documentation described
below. Preserve the working website and its commercial model.

The owner's priorities are a South African launch, downloadable apps on both
stores, useful buyer features, and avoiding store commissions on seller payments
wherever the rules permit. Seller posting, KYC, plans, boosts, featured/urgent
purchases, sponsor programmes, enterprise slots and administration remain on the
website through Ozow. This assignment does not authorize an automatic switch to
in-app purchase.

Implement the work, not just another plan. Progress autonomously through local
code, migrations, isolated tests, build preparation and documentation. Keep an
implementation checklist and evidence log so another agent can resume. Do not
mark unperformed device tests or unapproved publication as complete.

Before executing external changes, determine what the owner has already
authorized. Prepare concrete reviewable changes first. Obtain missing owner
authorization for paid provisioning, production migrations/deployment, store
publication and commercial changes. Do not purchase accounts, create recurring
charges, send customer marketing or publish under your own account. Missing
credentials should block only dependent steps; continue independent
implementation and record the exact remaining owner action.

Read every applicable AGENTS.md and relevant installed Next.js guides before
editing web/backend code. Do not assume familiar Next.js APIs apply. Use pnpm
and the repository's supported Node version. Preserve existing unrelated
changes; never reset the working tree or apply destructive migrations to make
tests pass. Do not delegate unless the owner or applicable instructions
authorize it.

## 2. Verified starting facts and required discovery

The expected repository is C:/Users/SENZO/Documents/verifymzansi; use the actual
checkout supplied by the owner. Its current website is a Next.js 16.3.6 / React
/ TypeScript application deployed to Cloudflare Workers through OpenNext.
Supabase supplies Auth/Postgres/RLS; R2 stores media; Sentry observes errors;
Resend and Africa's Talking supply email/SMS; Turnstile protects several public
mutations.

There are exactly three current marketplace areas: Mzansi Market, Mzansi
Business, and Tourism & Events. Internal content target types remain listing,
business and promotion. Use existing canonical URLs and current enum
definitions; do not recreate removed mall/promotions marketplace products from
old documentation.

The configured public domain is verifymzansi.com. Confirm it against the current
deployment. Retail catalogue defaults in the inspected repository were R50/30
days, R140/90 days and R250/180 days, but the database catalogue is
authoritative. An earlier research-tool result returned legacy pricing;
reconcile live catalogue, rendered pricing, terms and checkout before making
commercial claims. Do not change prices as part of this assignment.

Website payments already use Ozow hosted checkout, signed webhooks and atomic
entitlement fulfilment. These are seller platform purchases, not an escrow or
buyer-product checkout. A payment-return URL alone cannot create entitlement.
Existing trial rules are identity-bound and must survive account
deletion/recreation controls.

Cookie sessions, same-origin checks and CSRF currently protect browser
mutations. Native bearer-token support is new work. Enquiry forms create leads
and notify sellers; they are not live chat. Existing account
deletion/DSAR/reporting routes require native integration and verification, not
a compliance assumption.

Existing translations are src/lib/i18n/messages/en.json, af.json and zu.json.
Their interpolation uses single-brace parameters such as {name}; preserve that
when adapting messages. Branding follows docs/DESIGN-SYSTEM.md: media-first
content, semantic colours, logo unchanged, account-check badge beside the poster
on detail screens rather than a guarantee of safety.

The website has a manifest, production service worker and offline page. Verify
actual installation/workflows; do not claim offline payment or KYC.

Content analytics has changed. Inspect src/app/api/engagement/view/route.ts,
src/lib/views/content-views.ts and the current SQL. The inspected implementation
batches up to 20 events through record_content_views: detail-page views, or
video played for two continuous seconds with at least half visible; one
qualifying view per viewer/content/30 minutes, with owner/staff exclusions and
network caps. Engaged video views are a separate measure. /api/analytics/visit
is site-visit analytics, not the content-view service.

The 1 October readiness report records recovery, isolated-staging and
migration-rollout prerequisites. Recheck them against current evidence; neither
assume they remain unresolved nor claim they are fixed. Read
docs/production-readiness-audit-2026-10-01.md and
docs/runbooks/production-audit-rollout-2026-10-01.md. At drafting time an
unrelated untracked migration, 20261002130200_retire_legacy_view_counting.sql,
was present and depended on the newer views implementation; preserve it and
reconcile migration order with its owner before applying anything remotely.

Start by recording Git status, active branch, package versions, current
routes/schema, rate-limit actions, auth/provider configuration names, existing
communication preferences and CI scripts. Never print credential values. Inspect
auth callback under the actual route group; the inspected path was
src/app/(auth)/auth/callback/route.ts. Do not infer missing functionality just
because an old path fails.

Read node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
and the installed authentication guide for backend edits. Inspect root
TypeScript/ESLint/test/deploy globs before adding a workspace: root typecheck
currently includes all TS/TSX files, so mobile code needs separate configs and
explicit exclusions.

Create docs/mobile-build-progress.md containing decisions, completed work, tests
with dates, unresolved dependencies, migration order and next actions. Add exact
documentation allow-list entries to .gitignore where necessary; this repository
ignores most Markdown by default.

## 3. Commercial boundaries and release scope

Both store apps provide free buyer functionality. Access to buyer features never
requires a paid seller entitlement. No seller publishing, plan activation, paid
boost/featured/urgent controls, platform billing pages, renewal prompts or
platform seller-checkout links appear in native screens, app-owned hosted pages
or push notifications.

Advertised item/service prices MUST remain visible where the existing
marketplace displays them. Product prices are not VerifyMzansi seller-plan
prices. Preserve public placement ordering and legitimate sponsored listings as
public content; displaying an advertisement is different from selling its boost
to the advertiser inside the app.

Use explicit public-content DTOs and destination rules instead of banning words
such as price, buy or checkout across the repository. Do not expose seller-plan
prices, entitlement balances or Ozow URLs through the mobile API. Test behaviour
and destinations, including redirects and app-owned legal/support/auth
navigation. Preserve ordinary permitted contact for advertised real-world
goods/services.

No IAP SDK, RevenueCat, platform wallet, escrow, ticket booking or buyer
checkout in v1. Do not rename digital seller features as physical services to
claim an exemption. Zero store commission is the intended result of this product
design, subject to review and current contractual rules; it is not a guaranteed
approval.

If a reviewer objects, document the precise objection and prepare the smallest
compliant revision/appeal around the actual free-buyer design. Do not switch on
IAP or invent a separate advertising-management exemption without an owner
decision. Android seller posting is a later separately scoped phase, not an
automatic part of this implementation.

## 4. Product behaviour to implement

Use four bottom tabs: Explore, Saved, Alerts and Account. Explore contains the
three marketplace areas, search, filters and detail navigation. Use English by
default and support Afrikaans and isiZulu with a persistent language selector.
Translate new mobile copy; verify existing message coverage and interpolation
rather than claiming zero translation work.

Explore:

- Anonymous browsing/search/detail viewing, preserving current category,
  location, condition and area-specific filter semantics and default recommended
  ordering.
- Optional foreground location permission only after a user selects a location
  action; town/province selection always works without permission. No
  background-location permission or precise coordinates in analytics.
- Media-first cards/details, advertised price where relevant, account trust
  badge by the poster, moderation-safe descriptions, photos/video, native
  sharing and permitted contact actions.
- Thumbnail-first loading, video autoplay off by default, one active video at a
  time, user-controlled low-data mode and bounded pagination. Retain existing
  fair placement logic; do not invent a new recommendation engine.
- Deleted, hidden, expired or blocked content returns an unavailable state, not
  cached contact information or an ownership leak.

Saved:

- Sign-in is requested only when a user saves content/searches or performs
  another authenticated action; interrupted navigation returns to the intended
  safe destination after admission.
- Private saved items, separate from public likes, synced across devices. Show
  unavailable saved items without revealing withdrawn details; allow removal.
- Saved searches retain a validated canonical filter set and a user label. Limit
  v1 to ten active saved searches per account. The results use the same public
  eligibility/filter rules as Explore.

Alerts:

- In-app buyer alerts plus optional daily saved-search push digest. Do not
  forward every existing seller/admin notification to the buyer app.
- Explicit in-app preference and OS permission before push delivery. Preference
  is off initially; denial leaves in-app functionality usable. Provide
  per-search enable/disable and a global switch.
- One aggregate digest per opted-in account/day at 08:00 Africa/Johannesburg.
  Aggregate new matching publications since the last processed window, with at
  most 50 distinct matched IDs recorded per digest. Do not notify on old content
  merely edited, and do not count a renewal as new publication unless current
  product policy explicitly defines it that way.
- Generic lock-screen copy, localized to the account language, and a safe
  saved-search route. Never include lead bodies, private contact data, seller
  renewal/upgrade prompts or payment URLs.

Account and contact:

- Native email/password login and registration with existing validation,
  confirmation and registration policy; Google login on both platforms; native
  Apple login on iPhone and browser Apple login on Android for returning
  Apple-account users.
- Existing social-only users can sign in without resetting their account or
  losing entitlements. No new email-OTP login product: current
  phone-verification OTP is not automatically login OTP.
- Existing permitted call/WhatsApp actions and an authenticated native enquiry
  form. Honour contact-reveal/eligibility rules; do not publish hidden seller
  phone/email fields merely because the app needs a DTO. Clearly handle missing
  WhatsApp/dialler capability.
- Report content/users, block/unblock sellers, support, privacy/DSAR access,
  language/data/notification settings and deletion. Blocked sellers are excluded
  from this user's future Explore results, saved-search results and alerts, and
  cannot be contacted through the app. Stored reports remain accessible under
  their existing policy.
- Deletion uses existing reauthentication, legal-retention and DSAR semantics.
  Maintain an accessible external deletion-request URL. Do not promise immediate
  erasure of legally retained payment/abuse records.

No native seller KYC, posting, editing, lead-owner inbox or admin/staff tools.
Strengthen seller mobile web installation and interruption recovery with
targeted fixes, not a website redesign.

## 5. Repository, tooling and configuration

Keep the Next.js website at the repository root. Add apps/mobile and
packages/shared, with pnpm-workspace.yaml and one committed lockfile. Name the
mobile package @verifymzansi/mobile and the shared package @verifymzansi/shared.
Preserve existing root build/deploy commands and their working directory. Add
explicit mobile lint/typecheck/test scripts and CI jobs; keep native files out
of root Next.js/typecheck/Vitest/knip scans unless deliberately supported.

Use current stable Expo SDK with Expo Router and strict TypeScript, installed
through Expo-compatible dependency tooling. Pin compatible versions and record
them. Do not blindly force website React/React Native versions into Expo; scope
package resolution and peer dependencies correctly.

Use TanStack Query for fetch state; FlashList for large feeds; expo-image and
expo-video for media; react-hook-form and Zod for forms; i18next with existing
message interpolation preserved; Expo SecureStore; Expo WebBrowser/AuthSession;
react-native-webview for the bounded security challenge;
expo-apple-authentication; Expo Notifications; NetInfo; and Sentry React Native.
Use native StyleSheet/components with an exported semantic-token object derived
from the existing design system. No NativeWind dependency is required for v1.

Share pure enums, public DTOs, filter/validation logic, translation data and
formatting helpers only. Do not import server-only code, Node crypto, cookie
clients, Next.js components or browser stores into mobile. Prefer extracting
existing pure domain logic to copying implementations that drift.

Use EAS development, preview/staging and production profiles; isolated update
channels/runtime versions and environment-specific identifiers. Proposed
production bundle/package ID is com.verifymzansi.app; verify availability and
existing owner assets before registration. If it is already owned elsewhere,
obtain the owner's identifier choice rather than silently registering an
unrelated ID.

Keep all accounts/signing/provider credentials under the owner's control with
MFA. Public mobile config includes API origin, Supabase public URL/key,
environment and EAS project ID. Expo public variables are not secrets. Never
embed service-role, Turnstile secret, Ozow keys, Apple private keys, signing
credentials or push-service credentials.

Use the selected Expo SDK's supported minimum OS versions and target the current
store submission requirements. Record actual min/target versions; do not invent
support for unsupported old devices. Test an iPhone SE 2020-size display and at
least one low/mid-range Android device supported by those versions.

## 6. Authentication and native abuse protection

This section replaces the earlier custom hosted-login/session-handoff proposal.
Prefer provider-supported Supabase sessions and PKCE, plus controlled native
endpoints, rather than implementing a new token protocol.

Extract existing login/register/profile-admission business rules into server
services callable by browser and mobile route adapters. Website adapters keep
cookies, same-origin and CSRF exactly as before. Mobile adapters return sessions
in private no-store HTTPS responses and do not set browser auth cookies.
Preserve password policy/breached-password checks, registration uniqueness,
orphan cleanup, lockout, distributed limits, profile creation policy and
authoritative account-state checks.

Implement a small first-party HTTPS security page at /mobile/security-check for
Turnstile only. Load it in a bounded WebView when protected native forms require
a challenge. No credentials, OAuth login, payments or arbitrary website
navigation in that WebView. Keep the default user agent stable, permit
documented Turnstile frame/network requirements, and use a narrowly scoped CSP
rather than weakening the whole website. Accept bridge messages only from the
expected first-party page with a validated message schema and active challenge
context. Tokens remain in memory and are sent once to the relevant API, never
placed in URLs or logs.

Extend the Turnstile verifier to validate expected hostname and action for
native auth/contact/report operations, preserving browser compatibility. Verify
server-side through Cloudflare; a bridge message or client platform flag is not
proof. Replay/expired/missing tokens fail. Provider outages fail closed for
protected operations with a usable retry/cancel path. This directly addresses
native login, registration, forgot-password requests, enquiries and reports; do
not solve only login and leave the other flows unprotected.

Native email/password login/register call controlled mobile endpoints, not
direct unguarded Supabase signup/password login from the app. Use non-persistent
request-scoped Supabase server clients for these operations; return a usable
session only after account admission succeeds. New registrations follow the
current profile/confirmation policy; do not weaken mandatory fields without an
owner product decision.

Google OAuth uses the official Supabase PKCE flow in the system authentication
browser. Persist the verifier securely, allow only one active OAuth attempt,
accept only configured callbacks, handle cancellation/expiry/process restart,
exchange the authorization code once using the SDK, then call mobile account
admission. No implicit token-in-URL flow. Native Apple sign-in uses a
cryptographically generated nonce and verified ID-token exchange; apply
identical account admission before enabling protected buyer functions. Android
Apple sign-in uses system-browser PKCE and the same callback/admission. Follow
provider guidance for relay emails, missing names, revocation and OAuth-secret
expiry; document six-month Apple web-secret rotation where applicable.

Admission must preserve current restrictions on banned/suspended/deleted/missing
profiles. Reuse current new-OAuth-user provisioning policy; never recreate a
deleted profile just because it is absent. Profile/status lookup failure denies
admission. Clear unusable sessions on failure. A client admission flag does not
authorize requests: every protected mobile operation independently verifies
token and account state.

Do not merge accounts solely because a client submits matching emails. Respect
existing trusted provider-linking semantics; different relay identities remain
separate unless the user proves both accounts through an explicit supported
linking process. Document the account collision/support flow; no admin-style
client account merge.

Store sessions/verifiers in a tested encrypted adapter backed by SecureStore.
Test payload-size limits, interrupted writes, background/foreground refresh,
logout, reinstall and account switching. Keep passwords out of persistence. A
refresh failure returns to free browsing and clears user-scoped state. Serialize
refresh to prevent races; do not retry non-idempotent writes blindly after
refresh.

Forgot-password initiation uses existing abuse controls. Complete recovery
through an account-only browser page reusing the existing signed recovery
proof/AMR checks and password validation; preserve ordinary website recovery
links. On completion return to normal app login, not automatic privileged
admission. Do not route all /auth/callback or password-reset paths to native and
break browser recovery.

Use existing distributed rate-limit actions/limits where appropriate, with
validated user IDs for authenticated actions and trusted network identity for
anonymous auth. Device/install IDs are secondary abuse signals, not
authentication; account for mobile carrier NAT. Device attestation is optional
later hardening, not a v1 prerequisite or a substitute for these controls.

## 7. Mobile API and service boundaries

Use /api/mobile/v1. Mobile handlers return JSON, not login-page HTML. Adjust
routing/security middleware deliberately so mobile requests are not rejected for
lacking browser cookies before their handler can validate bearer tokens.
Preserve security headers and website gating. Native protected endpoints accept
Authorization: Bearer only and do not fall back to cookie identity. A present
but invalid token is rejected, not silently treated as anonymous. Public
discovery may omit the token; authenticated discovery also applies user blocks.

Implement and document these capabilities under this prefix:

- GET /content and GET /content/{type}/{id}: discovery and details; query
  includes one current area, canonical filters, sort, page and limit. Default
  limit 24, maximum 50. Preserve existing stable sort/rotation semantics, add
  deterministic ID tie-breaking where missing, exclude blocks in the
  database/query service before pagination and deduplicate appended client
  pages.
- POST /auth/login, /auth/register, /auth/forgot-password, /auth/apple,
  /auth/admit and /auth/sign-out: controlled auth/admission. Google/Android
  Apple PKCE exchange uses the provider SDK and then admission. Auth response
  details are specified in OpenAPI according to actual provider session shape;
  never return an admin session.
- GET /me; DELETE /account: safe buyer profile and deletion using existing
  reauthentication policy. A dedicated current-credential reauth helper may be
  needed; do not use an old login token as sufficient proof for every deletion.
- GET/PUT/DELETE /saved-items and /saved-searches: idempotent ownership-scoped
  persistence. Use explicit target IDs/search IDs in path/body; no shared
  public-like side effect.
- GET /blocks, PUT/DELETE /blocks/{sellerId}; POST /reports; POST /enquiries.
  Reporting/enquiries use the native Turnstile verification and existing
  sanitization/contact/moderation services.
- GET /notifications and PATCH /notifications/{id}: allowlisted buyer
  notifications only; never expose staff/seller inbox content. Ownership-check
  IDs and restrict link targets. Match current notification read semantics.
- PUT/DELETE /devices/{installationId}; PATCH /preferences: authenticated device
  registration, unregister and buyer digest/language preferences.
- POST /views: small best-effort event batches through the current shared
  content-view service/RPC. See analytics requirements below.
- GET /config: non-sensitive API compatibility/maintenance metadata only; no
  remote flag may activate paid seller functions or bypass review.

For new collection endpoints return {items,page,limit,hasMore}. Use existing
payloads for extracted domain services where compatible; standardize mobile
errors as {error:{code,message,requestId}} with meaningful
400/401/403/404/409/429/503 statuses. Private/session responses use
Cache-Control: private, no-store. Public responses without bearer auth may use
bounded caching only if current expiry/moderation invalidation remains correct;
authenticated/block-personalized responses are private.

Enquiries include an installation-generated UUID Idempotency-Key. Persist
ownership-scoped key/body-hash/result for 24 hours: identical retries reuse the
result, a reused key with different content is 409. Insert lead and idempotency
record atomically; notification/email effects use the existing durable
operation/outbox model. An upstream email failure must not invite duplicate lead
creation.

Use a request-scoped RLS client for normal user data. When existing services
need service-role access, enforce ownership/account state/target eligibility
explicitly and test the boundary. No mobile admin surface and no bulk exposure
of profiles or phone numbers.

Extend docs/openapi.json for every mobile endpoint and regenerate shared client
types through the existing tooling. The current drift script compares generated
types against the specification; it does not prove handlers implement that
contract or discover undocumented routes. Add handler/contract tests and an
endpoint inventory that verifies mobile routes are covered. Keep old web
contracts compatible with installed clients and the website.

## 8. Database, push and privacy design

Add additive migrations using actual schema naming conventions. Do not duplicate
current tables if discovery finds equivalent capabilities. Required logical
entities:

- saved_items: user_id, target_type, target_id, created_at; unique
  (user_id,target_type,target_id).
- saved_searches: id, user_id, label, area, canonical filter JSON,
  digest_enabled, created_at, updated_at; owner-only access and server-enforced
  ten-active-search limit. The server validates allowed keys/values using shared
  search schemas.
- user_blocks: blocker_user_id, blocked_user_id, created_at; unique pair, reject
  self-blocking; avoid leaking whether the other party blocked someone.
- mobile_devices: installation_id, user_id, platform, Expo push token,
  notification consent state, app version, last_seen_at; unique push token and
  correct token ownership reassignment. An installation ID is random per
  installation, not a hardware identifier.
- mobile_preferences: user_id, locale, digest_enabled and low_data_enabled where
  needed; extend existing communication preferences if their policy/storage
  cleanly supports this.
- Minimal idempotency/outbox/digest state only where the existing
  durable-operation model lacks it. No persistent custom OAuth token-exchange
  table is needed for the SDK PKCE approach.

Enable RLS, least-privilege grants, ownership indexes and unique constraints.
Test concurrent save/block/search-limit operations and token reassignment.
Validate current account-deletion cascades explicitly: remove saved
data/blocks/device tokens/digests appropriately while preserving documented
legal evidence and existing trial-abuse protections.

Use Expo push backed by APNs/FCM credentials. Implement scheduled digest
delivery through existing Cloudflare worker/job infrastructure; schedule at
06:00 UTC for 08:00 South African time. Use a unique account/day/window job key,
fenced leases, bounded batches and persisted attempt state. Read the existing
job hardening runbook first.

Advance the processed search window only when the in-app digest/outbox is
durably committed. Exclude hidden/expired/blocked posts at selection and
revalidate when opening results. Send at most one aggregate push/account/day,
with best-effort retries and receipt processing. Push delivery is not
exactly-once: provider timeouts can leave ambiguous outcomes, so use bounded
retries and avoid promising no duplicate delivery. Remove invalid tokens and
handle quotas/backoff. Opt-out/revocation stops future delivery; in-app digests
remain usable without OS push permission.

On sign-out or account change, unregister the device from the old identity while
authenticated when possible, clear local token association/user cache, and
register it to the new account only after fresh admission. Generic payloads
minimize lock-screen exposure; reassignment and receipt cleanup are still
required. On deleted/restricted accounts, jobs must recheck eligibility before
delivery.

Persist only bounded public summaries for offline browsing, plus user-owned
saved references where required. Mark cached content stale with a timestamp;
contact, reports, auth and saves require connectivity in v1 and show a retry
state rather than claiming success. Do not persist private lead text, evidence,
passwords or raw tokens in ordinary AsyncStorage/query cache. Clear user-scoped
cache on logout/switch/delete and revalidate content before contact.

Privacy notices and store labels must match actual collection/SDK behaviour. No
advertising identifier, tracking SDK or background location in v1.
Hash/pseudonymize analytics identifiers using existing server-side secrets;
pseudonymized data is not necessarily anonymous. Do not claim hashing makes all
information untraceable. Retention, DSAR and deletion follow current reviewed
platform policy.

## 9. Analytics, links and translations

For views, reuse the current event schema and record_content_views logic, not a
new counter or the site-visit endpoint. Use a random installation-scoped
identifier in secure local storage, processed into a server-side pseudonymous
viewer key; never accept client user/owner/staff flags. Derive user ID from the
validated session and network identity from trusted Cloudflare headers. Preserve
server owner/staff exclusions, 30-minute windows, deduplication and network
caps.

Count an actually opened available detail screen, or an eligible visible video
playback; background playback, list prefetch and rendering an unseen card do not
count. Batch at most 20, cap retries, and do not let analytics failure block
browsing. Keep analytics offline buffering disabled in v1 so expired events
cannot manufacture current views. Record engaged video separately using the
existing threshold logic. Use labelled native surfaces without falsifying
website acquisition/site-visit statistics.

Track search/detail/contact intent, server-confirmed enquiry, saved-item/search
actions, notification consent and app return. Call/WhatsApp launches are contact
intent, not completed leads or sales. Establish beta/website baselines before
setting growth claims; do not invent transaction conversion from taps.

Configure Android App Links and iOS Universal Links for canonical public content
and /mobile/auth/callback only. Serve /.well-known/assetlinks.json and
/.well-known/apple-app-site-association as public HTTPS JSON without
authentication or redirect. Use actual owner Team ID, bundle ID and Play App
Signing certificate fingerprints; upload-key fingerprints alone are insufficient
for store installations. Development/staging identities use their own
hosts/association files.

Exclude seller /post, /billing, /pricing, KYC/admin and existing password
recovery/callback routes from native interception. Fallback website links remain
useful when the app is absent. Verify cold start, warm start, terminated OAuth,
invalid IDs, expired code and wrong-host links. Permit only recognized in-app
routes and safe external protocols/hosts; no arbitrary notification URL
execution.

Reuse all three translation bundles through the shared package, add a mobile
namespace and configure single-brace interpolation compatibility. English is
fallback; tests enforce missing-key parity and prevent raw key display. Human
review of new isiZulu/Afrikaans copy is a release dependency if fluent reviewers
are unavailable. Preserve brand assets and create required icon/splash/store
image sizes from the existing artwork; do not silently redesign the logo.

## 10. Build order and evidence gates

Maintain these milestones with completed/in-progress/blocked status. A
historical check is not a fresh pass.

M0 — Foundation: inspect source/config, establish isolated staging/local
services, reconcile prerequisite evidence and catalogue/domain; write
endpoint/schema/credential inventory. Implement a private test vertical slice:
native challenge, login, admission, one public detail and enquiry on both
platforms. Do not build every screen before proving this boundary.

M1 — Workspace/services: establish root-safe workspace/configs; extract shared
auth/contact/discovery services with regression tests; add mobile
API/DTOs/OpenAPI and additive saved/block/device schema. Keep website builds and
cookie protections working.

M2 — Authentication: complete challenge bridge, email/register/recovery, Google
PKCE, Apple paths, secure persistence/admission/logout, deep links and
restrictions. Record real-device/provider checks separately from mocked tests.

M3 — Core app: finish Explore/search/details/media/contact, four tabs, saved
items/searches, report/block/deletion, three languages, themes/accessibility and
data/offline behaviour. Confirm existing contact visibility and placement order.

M4 — Retention/analytics: buyer-safe in-app alerts and daily push
worker/receipts/preferences; current view semantics; measured enquiry/retention
events. Do not accidentally send seller/admin notifications or leak blocked
content.

M5 — Seller web: device-test home-screen installation, posting/KYC/media,
contact/leads and Ozow handoff/return; fix demonstrated issues and
regression-test them. No native seller purchase or publishing additions.

M6 — Verification: run appropriate backend/database/contract tests and native
unit/component tests, staging provider smoke checks and device E2E. Complete
privacy/link/payment-path review. Fix failures and record remaining external
dependencies explicitly.

M7 — Release package: build Android AAB and signed iOS release archive through
owner-controlled EAS credentials, prepare TestFlight/Play testing and all store
materials/runbooks. Submit or publish only within the owner's existing
authorization. If blocked, deliver the complete prepared artifacts and a precise
owner-action list rather than claiming public launch.

Allow approximately 12-16 engineering weeks with a senior mobile engineer plus
part-time backend/design/QA, after foundation issues are resolved. Re-estimate
after M0 from actual work and staffing. This is not a deadline or contractor
quote. Initial illustrative budget: 450-650 hours at assumed R600/hour plus 20%
contingency = R324,000-R468,000, excluding foundation
remediation/equipment/taxes/recurring charges. Replace assumed rates/hours with
the owner's actual delivery model; agent-assisted work can reduce cash cost but
cannot remove verification duties.

## 11. Required testing and acceptance criteria

Backend/security:

- Browser regression: existing cookie/CSRF/origin protection and
  login/register/recovery remain intact. Native bearer requests receive JSON;
  forged/expired/wrong-project tokens and missing/restricted profiles fail.
- Cross-account reads/writes, service-role ownership, block bypass through
  details/contact/digests, hidden/expired content and ID enumeration are tested.
- Turnstile
  absent/invalid/replayed/expired/wrong-host/wrong-action/provider-outage;
  bridge injection and foreign navigation; OAuth replay/wrong
  verifier/cancellation/restart; Apple nonce/relay email/missing name and
  existing social accounts.
- Secure persistence/refresh races, account switching, logout/offline logout,
  push reassignment/deletion, password recovery proof and deletion
  reauthentication.
- Database concurrent save/block/search limits, idempotent enquiry replay/body
  mismatch, durable digest windows, retries/lease fencing and notification
  opt-out.
- New contract types match schemas AND tested handlers. Mobile routes are all
  documented; existing web APIs remain compatible.
- Website Ozow pending/success/failure, duplicate/signed webhook checks,
  refunds, entitlement expiry and payment amount/currency validation remain
  correct. Fixtures alone are not live settlement evidence.

Native/product:

- Real supported iPhone and lower-cost Android release builds; small screen,
  text scaling, screen reader, light/dark/reduced motion, three languages and
  weak/offline connections.
- End-to-end anonymous search/detail; each login method; save/search/alert;
  enquiry/call/WhatsApp; report/block/unblock; deletion; cold/warm share links
  and expired auth callback.
- Existing canonical area filters, displayed advertised prices, contact
  restrictions and fair placement match website behaviour.
- Current view qualification/deduplication and owner/staff/network exclusions
  match the server model; prefetch/background video do not count.
- No seller purchases, platform upgrade calls to action or checkout destinations
  through screens, responses, hosted pages, content redirects, notifications or
  links. Product prices remain visible.
- Offline content is labelled stale; mutation failures are actionable; no false
  success or replay storm; logout clears previous account data.

Use meaningful native component tests with React Native Testing
Library/Jest-compatible Expo tooling; use Vitest for shared pure logic and
existing backend suites; Maestro for release-build critical journeys. Run
existing pnpm lint, typecheck, quality:openapi-drift, affected tests, relevant
DB gates and production build. Run pnpm safety:release for the final backend/web
release, with safe isolated fixtures/environment and repository-required checks.
Add mobile equivalents and Expo compatibility checks. Never point
destructive/seeded tests at production merely because a local environment file
does.

Record actual device/OS/build/network and measurement method for startup, search
latency, download size and data usage. Targets are 99.5% crash-free sessions and
99% success for valid enquiry submissions during the pilot, with every
small-sample failure inspected. Do not make 30 MB downloads, 2.5-second startup
or 4.5-star ratings unverified launch guarantees. No open critical/high
authorization or privacy defects, no unhandled critical-flow crashes, and no
unverified migration/recovery dependency at public launch.

## 12. Owner setup, publication and operations

Prepare one concise owner checklist: legal entity/account holder and D-U-N-S
status; owner-controlled Apple/Google/Expo accounts; bundle IDs/Team ID/signing
fingerprints; Supabase OAuth callback configuration; Google/Apple provider
settings; APNs/FCM credentials; isolated staging resources; representative test
devices; fluent translation review; store privacy/support/deletion URLs;
approved spending/deployment/publication scope. Never request secret values in
chat; use secure provider stores and repository secret mechanisms.

At drafting, official developer registration was US$25 once for Google and
US$99/year for Apple, with regional Apple pricing; verify before payment. Expo
offers free/paid usage tiers; start with an appropriate prototype tier and
justify upgrades. Supabase/Cloudflare/Sentry/email/SMS/Ozow charges are
separate. Do not quote free infrastructure as unlimited service or infer Ozow
fees from code.

Prepare store descriptions/screenshots/age ratings, accurate privacy/data-safety
answers, reviewer accounts, support/deletion URLs and review notes describing
the actual free buyer model. Include user-content
reporting/blocking/moderation/contact support. Verify current Apple social-login
requirements before submission. Never hide features during review and enable
paid seller paths later through remote config.

Use TestFlight and Play testing for a pilot of 20-50 representative South
African users. Respect applicable account-specific store testing requirements.
Initial publication uses manual release controls and a limited invited marketing
audience; Apple's seven-day phased release is for updates, not the first launch.
Public listings can still be downloaded by other eligible users, so do not
describe marketing limits as technical access restrictions.

Prepare a coordinated backend/schema rollout and forward-compatible rollback
following the existing runbook. Additive APIs go live before released apps
depend on them; keep /v1 compatible with older installed clients. Do not drop
schemas immediately when an app release is rolled back. EAS Update is only for
compatible JS/assets within store rules; native dependencies/permissions/SDK
changes require new binaries. Keep an owner-accessible rollback procedure and
release record.

Monitor crashes, authentication/admission failures, enquiry failures, push
receipts, job backlogs, API latency, moderation/report backlog and
infrastructure spend. Launch with a named support/moderation owner. Track
seven-day/30-day buyer return and seller enquiry/renewal outcomes separately
from downloads. Halt expansion after a confirmed privacy/authorization defect or
critical journey regression; disable affected capabilities safely and fix rather
than lowering gates.

After 30 days, improve demonstrated buyer/seller-web friction. Native Android
seller publishing, native iPhone seller tools, IAP, chat and booking/escrow
require new scope/policy/cost decisions. Review payment policy before
submission, before commercial changes and ahead of the scheduled September 2027
Google rest-of-world changes. Do not create monitoring automations unless the
owner separately requests them.

## 13. Final delivery and honest completion

Deliver source code, pinned workspace/lockfile, shared/OpenAPI contracts and
generated types, additive migrations with application order, environment
templates without secrets, staging/production config instructions, reproducible
Android/iOS build commands/profiles, test suites and evidence, device/provider
QA results, store assets/reviewer pack, privacy/deletion/support materials,
seller-PWA verification, and rollout/rollback/support runbooks.

The final report must state what works, how it was verified, which builds exist,
what external setup/publication remains, and any material limitations.
Distinguish implemented, tested, submitted, approved and publicly available.
Completion of source code is not proof of store approval. Continue independent
work when an external dependency blocks only one milestone; never fabricate
credentials, device checks or settlements to claim A-to-Z completion.

## 14. Official references to recheck during implementation

These references informed the brief; operational rules can change. Use the
installed SDK/provider docs and current official sources, not third-party
summaries, when implementing.

- [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/):
  paid digital features, physical services, multiplatform/advertising
  exceptions, social login, user content and privacy. Applicable digital seller
  purchases can require IAP; listing physical products is a separate activity.
- [Google payments policy](https://support.google.com/googleplay/android-developer/answer/10281818)
  and
  [new fee rollout](https://support.google.com/googleplay/android-developer/answer/16954621):
  alternatives do not automatically eliminate fees; current rest-of-world
  schedule is 30 September 2027.
- [Cloudflare mobile Turnstile implementation](https://developers.cloudflare.com/turnstile/get-started/mobile-implementation/)
  and
  [server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/):
  scoped WebView support and required server verification.
- [Expo Router](https://docs.expo.dev/router/introduction/),
  [EAS Build](https://docs.expo.dev/build/introduction/),
  [Expo authentication](https://docs.expo.dev/guides/authentication/) and
  [Expo/Supabase](https://docs.expo.dev/guides/using-supabase/): native routing,
  Windows-to-cloud builds and provider integration.
- [Supabase PKCE](https://supabase.com/docs/guides/auth/sessions/pkce-flow) and
  [Apple provider](https://supabase.com/docs/guides/auth/social-login/auth-apple):
  provider code exchange, nonce/identity handling and Apple web-secret rotation.
- [Expo AppleAuthentication](https://docs.expo.dev/versions/latest/sdk/apple-authentication/),
  [SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) and
  [push receipts/retries](https://docs.expo.dev/push-notifications/sending-notifications/).
- [Android App Links](https://docs.expo.dev/linking/android-app-links/) and
  [iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/):
  domain associations and actual signing identities.
- [Google deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111),
  [Apple enrollment](https://developer.apple.com/programs/enroll/),
  [Google enrollment](https://support.google.com/googleplay/android-developer/answer/6112435)
  and [Expo pricing](https://expo.dev/pricing).
- [Apple phased updates](https://developer.apple.com/help/app-store-connect/update-your-app/release-a-version-update-in-phases/)
  and [EAS Update limitations](https://docs.expo.dev/eas-update/introduction/):
  release mechanics and compatible update boundaries.

Research confidence: the repository shape and named current services were
checked while preparing this brief; production readiness remains subject to
fresh evidence, credentials, real devices and approved rollout. Do not
substitute this document for those checks.
