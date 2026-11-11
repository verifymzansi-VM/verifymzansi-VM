# Porting the stub suite to the foundation suite

The stub suite (`playwright.config.ts`, `e2e/*.spec.ts`) ran the website on the
retired backend with an in-memory stand-in. Before it was retired, every check
it held had to either live here or have a recorded reason why not; this file is
that record. The owner retired it on 2026-11-11 and made the foundation suite
(`playwright.foundation.config.ts`, this folder; CI check `e2e-foundation`) the
required browser check in place of `e2e-full-matrix`. The stub files named below
are deleted; the git history keeps them.

Classes:

- **a**: backend-independent (public pages, accessibility, layout, media,
  video and showroom behaviour on fixture or public pages, auth page
  rendering). Moved here.
- **b**: needs foundation data or flows that a spec here already covers.
- **c**: depends on stub-only behaviour, or waits for product work.

`visual-regression.spec.ts` is not listed: its foundation copy is
`visual-regression.spec.ts` here, run only inside the pinned Playwright image by
`scripts/foundation-visual.mjs` (config `playwright.visual.config.ts`; this
folder's config ignores it). It backs the required check `Visual regression
(chosen frontend)`. Its new pictures and how they differ from the stub suite's
are recorded in `VISUAL-BASELINES.md`.

| Stub spec                         | Class   | Where its coverage lives / why not ported                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a11y.spec.ts`                    | a       | `a11y.spec.ts` (all 17 checks).                                                                                                                                                                                                                                                                                         |
| `smoke.spec.ts`                   | a       | `public-pages.spec.ts` (all 8 checks, merged with golden).                                                                                                                                                                                                                                                              |
| `golden.spec.ts`                  | a       | `public-pages.spec.ts`: legacy redirects, 404, auth guards. Its homepage, login, register, health, pricing and market checks were weaker duplicates of smoke and were dropped.                                                                                                                                          |
| `addon-checkout.spec.ts`          | a       | `public-api-guards.spec.ts`.                                                                                                                                                                                                                                                                                            |
| `auth-recovery-readiness.spec.ts` | a       | `public-forms.spec.ts` (auth routes answered in the browser).                                                                                                                                                                                                                                                           |
| `contact-form.spec.ts`            | a       | `public-forms.spec.ts`. The "strips HTML" check only asserted that the input keeps typed text, and was dropped.                                                                                                                                                                                                         |
| `dsar.spec.ts`                    | a       | `public-pages.spec.ts` (sign-in guard). The signed-in request is `staff-review.spec.ts` (privacy request).                                                                                                                                                                                                              |
| `header-session-shell.spec.ts`    | a       | `public-forms.spec.ts`; the signed-in header uses a real local sign-in of the seeded verified member.                                                                                                                                                                                                                   |
| `home-discovery.spec.ts`          | a       | `public-forms.spec.ts`.                                                                                                                                                                                                                                                                                                 |
| `kyc-verification.spec.ts`        | a       | `public-api-guards.spec.ts` and `public-pages.spec.ts` (guards). Not ported: "webhook accepts unknown provider_ref" (the copy runs `KYC_PROVIDER=manual`; identity review is `staff-review.spec.ts`).                                                                                                                   |
| `media-cache-policy.spec.ts`      | a       | `public-api-guards.spec.ts`.                                                                                                                                                                                                                                                                                            |
| `posting-terms.spec.ts`           | a       | `public-forms.spec.ts`.                                                                                                                                                                                                                                                                                                 |
| `media-fit-cards.spec.ts`         | a       | `media-fit-cards.spec.ts` (unchanged; grid requests answered in the browser).                                                                                                                                                                                                                                           |
| `video-card-autoplay.spec.ts`     | a       | `video-card-autoplay.spec.ts` (unchanged).                                                                                                                                                                                                                                                                              |
| `video-singleton-playback.spec.ts`| a       | `video-singleton-playback.spec.ts` (unchanged).                                                                                                                                                                                                                                                                         |
| `immersive-viewer.spec.ts`        | a       | `immersive-viewer.spec.ts` (unchanged; `/dev/immersive` exists in the copy's build, test mode).                                                                                                                                                                                                                        |
| `video-mode.spec.ts`              | a       | `video-mode.spec.ts` (`/dev/video-mode`; the filter-tab click now waits for hydration).                                                                                                                                                                                                                                 |
| `marketplace-showroom-smoke.spec.ts` | a    | `showroom-behaviour.spec.ts`, on the copy's seeded posts (the stub's hide-fixtures cookie has no effect here and was dropped).                                                                                                                                                                                          |
| `promotions-showroom.spec.ts`     | a       | `showroom-behaviour.spec.ts`.                                                                                                                                                                                                                                                                                           |
| `showroom-cta-touch-target.spec.ts` | a     | `showroom-behaviour.spec.ts`.                                                                                                                                                                                                                                                                                           |
| `showroom-desktop-drag.spec.ts`   | a       | `showroom-behaviour.spec.ts` (`/dev/showroom-drag`).                                                                                                                                                                                                                                                                    |
| `showroom-loading-stability.spec.ts` | a    | `showroom-behaviour.spec.ts` (`/dev/showroom-drag`).                                                                                                                                                                                                                                                                    |
| `mobile-loading-scroll.spec.ts`   | a       | `showroom-behaviour.spec.ts` (`/dev/showroom-drag`).                                                                                                                                                                                                                                                                    |
| `rail-desktop-drag.spec.ts`       | a       | `showroom-behaviour.spec.ts` (`/dev/rail-drag`).                                                                                                                                                                                                                                                                        |
| `showroom-viewport-fit.spec.ts`   | a       | Not yet ported: 10 viewports across 5 pages, about a minute per project; held back to keep each project near 10 minutes. Port it with a smaller viewport set in a later change.                                                                                                                                                        |
| `commercial-model.spec.ts`        | a + b   | Visitor checks: `public-pages.spec.ts` (pricing ladder, tourism trial, phone overflow, unknown organisation). Not checked: "Save R10/R50" (the foundation catalogue sets no compare-at price, see below). Signed-in checkout: `checkout-smoke.spec.ts`, `checkout-fulfilment.spec.ts`. Affiliations page: not covered. |
| `mobile-ux-smoke.spec.ts`         | a + b + c | Visitor phone checks: `public-pages.spec.ts` (tab bar, footer, browse intro, sign-in input, filter pills). Its `beforeAll` publishes posts through the posting forms (c: roadmap M1.1). Billing picker: `checkout-fulfilment.spec.ts`. Detail-page share/report and DSAR touch targets: not yet ported.               |
| `auth-qa-audit.spec.ts`           | a + b + c | Validation, landing and guards: `public-forms.spec.ts`, `public-pages.spec.ts`, `public-api-guards.spec.ts`. Sign-up: `member-post-publish.spec.ts` (invitation-gated sign-up). Sign-in: `account-recovery.spec.ts`. Turnstile bypass (TC09, TC14) and rate limiting (TC10) depend on stub-mode switches (c). |
| `critical-flows.spec.ts`          | a + b   | Guardrails: `public-api-guards.spec.ts`. Sign-in to the dashboard: `account-recovery.spec.ts`, `showroom-contact.spec.ts`.                                                                                                                                                                                              |
| `billing-payment-roundtrip.spec.ts` | b     | `checkout-smoke.spec.ts`, `checkout-fulfilment.spec.ts` (mock Ozow round trip, declined payment, lost notification).                                                                                                                                                                                                   |
| `dashboard-status.spec.ts`        | b       | `member-post-publish.spec.ts` ("the member is shown as verified").                                                                                                                                                                                                                                                      |
| `profile-completion.spec.ts`      | b       | `member-post-publish.spec.ts` (phone code from the SMS sink).                                                                                                                                                                                                                                                           |
| `verification-flow.spec.ts`       | b       | `member-post-publish.spec.ts`, `staff-review.spec.ts` (ID and selfie photos through the website).                                                                                                                                                                                                                        |
| `kyc-authenticated.spec.ts`       | b + c   | Submission and review: `staff-review.spec.ts`. The high-risk governance escalation uses stub personas and has no foundation counterpart yet.                                                                                                                                                                             |
| `posting.chromium.spec.ts`        | c       | Fills in the posting forms; the form path waits for roadmap M1.1 (see `member-post-publish.spec.ts`).                                                                                                                                                                                                                   |
| `posting.mobile.spec.ts`          | c       | As above.                                                                                                                                                                                                                                                                                                               |
| `posting-journeys.spec.ts`        | c       | As above.                                                                                                                                                                                                                                                                                                               |
| `posting-guidance.spec.ts`        | c       | As above.                                                                                                                                                                                                                                                                                                               |

## Differences seen on foundation

- Pricing: the stub shows "Save R10" (90 days) and "Save R50" (180 days). In
  foundation mode `src/lib/commercial/plans.ts` sets `compare_at_cents: null`
  for every plan, so the restored pricing page shows no saving. The ported
  pricing check leaves those two lines out; the owner decides whether this is
  intended.

## Time budget

Measured locally (4 cores) on 11 November 2026: the moved specs add about
3.1 minutes of test time to chromium and 3.6 to mobile-chrome; the whole
suite then took about 10 minutes per project. CI stops Playwright at 12
minutes per project (`PLAYWRIGHT_GLOBAL_TIMEOUT_MS` in
`.github/workflows/e2e-foundation.yml`), so the headroom is about 1.2 times
a clean run instead of the 1.8 the workflow was sized for. The largest
additions are `a11y.spec.ts` (about 50 s per project), `public-pages.spec.ts`
(25 to 50 s), `immersive-viewer.spec.ts` (45 s, chromium) and
`video-mode.spec.ts` (40 s, mobile-chrome).

## Rules for specs moved here

- Read nothing from the copy at import time (`readTestCopy()` in a hook or test).
- Write nothing to the copy unless the spec owns the data it creates.
- Skip only with a reason listed in `e2e/support/skip-policy.ts`.
- Wait for hydration before a click that a pre-hydration page would ignore.
- Each moved spec passed three runs in a row on chromium and mobile-chrome.
