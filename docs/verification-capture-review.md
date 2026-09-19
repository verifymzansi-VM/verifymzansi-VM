# Selfie capture and identity review

## Full-screen selfie update — 19 September 2026

The selfie camera now opens in a viewport-sized modal, with safe-area spacing,
keyboard focus containment, a close control, two movement indicators and an oval
face guide. It uses dynamic viewport height rather than requiring the browser's
Fullscreen API, so it can fit mobile browsers that do not support that API. The
photo is captured automatically when the challenge has a fresh, centred,
eyes-open frame. The user can review or retake it before submitting.

The design follows the guided face positioning, feedback and reference-photo
pattern in
[Amazon Rekognition Face Liveness](https://docs.aws.amazon.com/rekognition/latest/dg/face-liveness.html)
and the preparation/lighting guidance in
[AWS usage recommendations](https://docs.aws.amazon.com/rekognition/latest/dg/recommendations-liveness.html).
The compatible implementation for this repository keeps its existing MediaPipe
and human-review workflow. No AWS service or proprietary vendor code was added.
This adopts the interaction pattern, not a claim of equivalent biometric
security.

Concrete fixes:

- The camera shows its entire image without CSS cropping. Selfie constraints
  avoid forcing a portrait sensor crop and prefer native camera output. The oval
  follows the actual image area, including after rotation, so framing checks and
  the visible guide agree. Prompts distinguish moving closer, further away and
  centering. See
  [MDN camera constraints](https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints).
- Movement tracking uses a wider envelope than final-photo framing. Turning
  outside the oval no longer discards a completed blink. A tracking interruption
  of up to 1.2 seconds pauses progress and blocks capture; sustained face loss
  or a second face resets the challenge. Blinks cannot complete across a
  tracking gap. Turns are measured relative to the initial neutral pose. Final
  capture still requires a fresh, centred, eyes-open frame.
- Automatic capture removes the need to press a shutter before the five-second
  completion window expires. Capture still rechecks freshness and visibility.
- Closing, unmounting or losing the camera invalidates pending work. Camera
  permission results arriving late are stopped; stale image-encoding callbacks
  cannot submit a photo from an abandoned session. Encoding failures are
  visible.
- The video attaches when the modal content actually mounts, avoiding a blank
  camera caused by an effect running before its portal exists.
- The admin queue displays uploaded selfie thumbnails with an enlarged preview.
  Thumbnail retries now trigger a new request, changing users reloads the photo,
  newest matching artifacts are selected, and requests have a bounded wait.

Admin photos become available after the user submits the capture through the
existing upload flow. They continue to use authenticated, audited evidence
endpoints and private encrypted storage. A local photo preview is not an upload.
Browser movement results remain untrusted review context; every selfie still
requires a human decision.

Regression coverage includes mobile and desktop modal bounds, cancel/reopen,
automatic capture, stale-frame rejection, late permission and encoding results,
portrait/landscape uncropped image and guide geometry, admin retries,
newest-selfie selection, upload and evidence routes. Real iOS/Android cameras
and varied faces/lighting still need physical-device acceptance testing before
rollout. Automated checks cannot establish biometric accuracy or guarantee that
no bugs remain.

### Follow-up for the reported blink/turn reset and zoom

The new regression tests exercise the reported blink-then-right-turn sequence
through both the state machine and the MediaPipe hook with synthetic landmarks.
They also cover short tracking interruptions, sustained loss, wrong turns,
neutral-pose calibration and centering before capture. The five focused suites
pass all 66 tests. Another 101 admin preview, queue, evidence, upload and query
tests pass, as do TypeScript and lint with zero warnings. The rebuilt desktop
and mobile Chromium walkthroughs both pass, including assertions that the guide
matches the uncropped image in portrait and landscape. Their screenshots were
visually inspected. These browser tests intentionally exercise explicit manual
review with a synthetic camera; the successful movement sequence is covered by
the hook and state-machine regressions. Physical-device movement and camera
checks remain necessary; this is a local fix, not a production deployment.

### Validation outcome for the initial full-screen update

- PASS: 241 tests across 15 focused suites, covering camera lifecycle, face
  challenge/framing, verification page, upload, risk engine, admin evidence and
  metadata routes, queue/preview/comparison, admin queries and media-fit policy.
- PASS: desktop Chromium and mobile Chromium verification walkthroughs, each
  including portrait/full-screen bounds, landscape rotation, cancel/reopen and
  explicit manual-review capture using a synthetic camera. Successful movement
  capture is covered by unit tests; the browser fixture cannot perform human
  face movements. Screenshots were inspected after correcting header stacking.
- PASS: final `pnpm lint --max-warnings=0`, `pnpm knip`, `pnpm typecheck`, and
  the production build made with the deterministic browser-test environment.
- PASS in the consolidated run: OpenAPI drift, dependency graph, duplication
  budget, development preflight, secret scan, dependency security audit, license
  policy and database migration invariants.
- FAIL: `pnpm safety:review`. Its initial report records lint, dead-code and
  blocking-test failures. Lint and dead-code findings were subsequently fixed
  and their commands passed on recheck. The crop-policy failure is also
  resolved; both the live selfie preview and saved evidence are now uncropped.

The broad test run reported 24 failures out of 3,915 tests. The resolved crop
policy accounts for one; the other 23 are in seven unrelated marketplace/card,
business-detail, video tracking and engagement-route suites. The first
actionable follow-up is to reconcile their existing card-content/fit and
playback-counting expectations with the intended product behavior, then rerun
`pnpm test:blocking` and `pnpm safety:review`. Database test commands chained
after the failed Vitest run did not execute. These failures have not been
concealed by weakening tests.

The original gate artifacts are preserved in `tmp/safety-gate/latest-review.md`,
`latest-review.json` and `latest-review-blockers.txt`; they record the initial
run, not the later focused rechecks described above. No deployment or database
migration was performed for this update.

## Earlier capture improvements

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
  turn, in random order, with a neutral pose before and after. Sustained face
  loss, extra faces and stale video invalidate progress. Invalid final framing
  blocks capture without discarding completed movements. Challenges expire;
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

## Earlier validation and release

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
