# Province and city confirmation

The existing location step now accepts only a South African province and a city
from that province's platform catalogue. Users can request a location
suggestion, correct it, or select manually immediately. Submission automatically
approves the location step; no address document or location admin decision is
required. Identity document and selfie review remain separate from location
approval.

## Choice and cost

Use the Cloudflare request metadata already available on the existing
deployment. `POST /api/verification/location/detect` normalizes the province and
city against the same catalogue used by the form and submission endpoint. It
does not save anything. No new geocoding account, API key, subscription, or
external lookup is needed. Existing hosting/database usage still applies.

Cloudflare documents `country`, `regionCode`, `region`, and `city` on the
request: https://developers.cloudflare.com/workers/runtime-apis/request/

Network location is approximate, particularly on mobile networks and VPNs. Only
a recognized South African pair is offered. Missing metadata, unknown cities,
foreign networks, local development, provider errors, and request timeouts all
leave manual selection available. Users confirm the final selection; approval is
acceptance of a self-declared location, not proof of residence or GPS evidence.
For places outside the catalogue, select the nearest listed city in the correct
province. The catalogue can be expanded without buying a geocoding service.

The former screen called Nominatim. Its public endpoint limits the entire
application to one request per second, requires attribution and identification,
prohibits autocomplete, and may withdraw access. It is unsuitable as a required
platform-wide approval dependency. The new screen never calls it or requests
precise GPS coordinates. The legacy GPS endpoint, geocoding implementation, and
their settings have been removed; clients use detection and manual submission.
https://operations.osmfoundation.org/policies/nominatim/

## Integrity and recovery

- Detection and submission require authentication, confirmed email, and CSRF
  protection. Detection responses are private and must not be cached.
- Submission validates province/city membership on the server and uses the
  existing fail-closed shared rate limiter: 10 attempts per minute per account,
  independent of shared carrier/Wi-Fi IP addresses. Province/city input is
  trimmed and capped at 50/80 characters respectively.
- Detection uses a separate per-instance cap of 10 attempts per account per
  configured local window (60 seconds by default). This is a lightweight
  throttle, not a distributed quota. Reaching it never consumes manual
  submission capacity.
- Both endpoints honor `kyc_v2_flow`. No paid tier or staff capability is
  required for either self-service endpoint.
- The upload endpoint rejects `proof_of_address` with HTTP 410 before storage or
  database writes. Old address artifacts and enum values remain readable for
  historical evidence and data-access requests.
- Submitted location is marked `self_declared`; old town/address and GPS fields
  on the location step are cleared when saving manually. Identity outcomes are
  not overridden.
- An identical approved submission can retry session/profile persistence after a
  partial failure. A different approved location cannot be overwritten here.
- Legacy pending location steps can be confirmed by the user even when their
  session has already been finalized. They do not need an admin decision.
- No database migration, new dependency, or infrastructure change is required.

Run the location route, geolocation, and verification page Vitest suites plus
the repository safety review before release. Production deployment is separate
from this code change.

## Validation on 27 September 2026

All 86 focused location/verification tests passed. The page's 29 tests also
passed after the final recovery-state change. Lint, type checking, OpenAPI
drift, import graph, duplication budget, preflight, secret scanning, dependency
audit, license policy, and database invariants passed in the full safety review.

The full safety verdict remains **FAIL** for findings outside these location
changes:

- Medium: `pnpm test:blocking` passed 4,211 tests but failed two. The admin
  reports test needs its roles mock updated to include `hasCapability`. The
  site-search pagination test expected four fetch calls and observed five;
  investigate its request/debounce timing before release. Later DB test commands
  chained after Vitest did not run because that stage failed.
- Low: `pnpm knip` initially failed allocating the parser's large raw-transfer
  buffer. Retrying with `KNIP_DISABLE_RAW_TRANSFER=1` completed analysis and
  found two existing unused exports: `getStaffSession` in
  `src/lib/auth/require-staff.ts` and `ID_NUMBER_IN_USE_ERROR` in
  `src/lib/services/verification-decision.ts`. Resolve their intended usage in
  the separate admin/decision changes before rerunning the gate.
- Browser validation is unconfirmed: the Chromium walkthrough timed out after
  120 seconds waiting for the test-server build, before executing the flow.

Full gate artifacts: `tmp/safety-gate/latest-review.json`,
`tmp/safety-gate/latest-review.md`, and
`tmp/safety-gate/latest-review-blockers.txt`. Focused results:
`tmp/location-tests-final.log` and `tmp/location-page-tests-final.log`. No
production deployment was performed.

## Dependency follow-up

Checked upload paths, shared validation, rate limits, feature flags, session
resumption, account-status summaries, staff permissions, evidence access, API
contracts, and the verification wizard. Closed the remaining address-upload
path, removed obsolete address/GPS submission schemas, corrected the OpenAPI
upload field from `type` to `docType`, and prevented selfie resubmission from
skipping a legacy pending location. The expanded dependency run passed 219
tests; type checking and lint for the affected files also passed. The earlier
full-repo failures above remain separate release blockers.
