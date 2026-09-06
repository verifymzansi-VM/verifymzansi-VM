# Selfie capture and identity review

## Changes

- Fixed the MediaPipe loader's CSP mismatch. Its pinned WASM directory also
  contains a JavaScript bootstrap; allowing only model/WASM fetches in
  `connect-src` prevented that bootstrap from running. `script-src` now permits
  the versioned runtime directory, without adding general JavaScript evaluation
  permissions. See Google's
  [Face Landmarker web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js).
- Reused the installed MediaPipe dependency. No paid service, subscription or
  new dependency is introduced. Existing model downloads, hosting and human
  review still use resources. One database migration repairs the
  upload-frequency check.
- Selfies require an eyes-closed/open movement and a randomly directed head
  turn, in random order, with a neutral pose before and after. Face loss, extra
  faces, invalid framing and stale video invalidate progress. Challenges expire;
  eligibility is checked again at capture time.
- Model initialization retries on CPU after GPU failure and has a bounded
  overall wait. Superseded and late models are closed. Unsupported devices offer
  retry and an explicit manual-review alternative. Uploaded files and incomplete
  challenges remain flagged by the existing server flow.
- Front-camera previews are mirrored, while saved photos retain the original
  orientation for comparison. Starting a new capture clears the previous
  upload's readiness.
- ID capture offers guides for the South African Smart ID front and green ID
  book photo/details page. Guides retain their aspect ratios across camera
  sizes; the original image is retained, including document edges.
- The comparison dialog has a bounded mobile viewport, one close control,
  separate image zoom, side-by-side/full-width modes, and grouped risk signals.
  Queue identity approvals open comparison first. Per-document decisions require
  a review checklist before the existing reason/override confirmation. Retake
  presets provide clear user-facing instructions.

## Security boundaries

Browser-reported liveness is untrusted context, not a server attestation. A
modified client or sophisticated replay/virtual camera can bypass local motion
checks. Every selfie still requires human review; no browser boolean is allowed
to auto-approve identity. This implementation adds no automatic face recognition
or government database lookup.

A still photo cannot prove liveness. Where evidence is insufficient, request a
new live capture or escalate for further review. The checklist supports
moderator consistency; authorization and decision enforcement remain in the
existing server endpoints.

The screenshot's `velocity_check_error` was reproduced with a read-only call to
the configured database using a nonexistent user UUID: PostgreSQL returned
`42883: operator does not exist: verification_step_type = text`. Migration
`20260906134500_fix_kyc_velocity_step_type.sql` casts the RPC parameter to the
column's enum type. A PGlite regression test reproduces the old error, applies
the migration, and verifies limits, expiry, step isolation and service-role-only
execution. The migration has not been applied to production; the existing server
failure policy remains intact until deployment. Historical risk signals are
retained for audit rather than silently cleared.

## Validation and release

Final local review: `pnpm safety:review` passed all 12 gates on 6
September 2026. This includes 3,716 tests across 423 files and 21 trial database
checks. Desktop and mobile Chromium verification walkthroughs both passed. The
real MediaPipe loader was also verified in Chromium under the pinned script
policy, and the comparison dialog showed no horizontal overflow at 390px width.
The trial test runner's references were corrected to the current migration
filenames.

Synthetic fixtures are used for visual checks, never real identity documents.
Unit tests cover challenge ordering, static faces, incorrect turns, face loss,
expiration, model fallback/timeout/stale loads, explicit manual capture, CSP and
moderator checklist behavior. The authenticated browser walkthrough exercises ID
capture and explicitly requested fallback selfie capture on desktop and mobile
Chromium. A separate browser check loads the real MediaPipe runtime under the
pinned script policy.

Before rollout, perform a physical-device acceptance check on iOS Safari and
Android Chrome: allow camera access, finish each movement, leave/re-enter the
frame, retry after a failed model load, retake a photo and review the resulting
artifacts. Synthetic camera tests cannot validate movement thresholds across
real faces and devices.

Changes are local until deployed. The consolidated review writes its latest
verdict and exact blockers to `tmp/safety-gate/latest-review.md`,
`latest-review.json` and `latest-review-blockers.txt`.
