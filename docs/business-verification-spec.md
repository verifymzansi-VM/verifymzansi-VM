# Business Verification spec — 3 stickers (approved 2026-10-06)

## Context

VerifyMzansi verifies **people** (ID + selfie KYC). Today the business CIPC
number is free text anyone can type, and it shows publicly as a "CIPC Reg."
fact. This spec adds:

- **three verification stickers**;
- document-based CIPC verification that **only admins decide**;
- the CIPC registered office linked to the business profile;
- the poster's verified position;
- a guide with example documents.

It also fixes real bugs found in the current code.

**Every claim below was checked against the code by five read-only agents**
(workflow, admin, code review, bug re-verification, assumption check).
Corrections from that pass are marked **(corrected)**.

**User decisions:**

- Sticker 3 = in-person visit **or** live video.
- Fees: decide later.
- Old typed CIPC numbers: delete immediately.
- No auto-rejection: admins decide.
- Post and advert addresses stay manual and separate from the CIPC address.
- Manual CIPC entry is removed.

**After approval:**

1. Save the SPEC section to `docs/business-verification-spec.md`.
2. Phase 0 (bug fixes).
3. Phases 1–5.

Every phase must pass `knip`, lint, typecheck and vitest before it is committed
and pushed straight to `main` (push = live for everyone).

---

# SPEC

## 1. The three stickers

| #   | Sticker                  | What it proves                                                                                                                        | Who                                                   | Prerequisite | Expires   |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ------------ | --------- |
| 1   | **ID Reviewed** (exists) | The poster's ID + selfie (+ phone, location) were reviewed                                                                            | Any member                                            | —            | as today  |
| 2   | **CIPC Registered**      | The company exists at CIPC, is In Business, and the business owner is a **director/member** or a **confirmed company representative** | CIPC-registered companies and CCs                     | Sticker 1    | 12 months |
| 3   | **Seen by VerifyMzansi** | We saw the business operating: premises, stock, products or service                                                                   | **Any** business, including informal and sole traders | Sticker 1    | 12 months |

- Stickers 2 and 3 are independent, so a trader without CIPC registration can
  hold 1 + 3.
- **Display.**
  - Up to three icons in a fixed order, each with a tooltip:
    - "ID reviewed";
    - "CIPC registered · checked Oct 2026";
    - "Visited in Empangeni · Oct 2026" or "Seen on live video · Oct 2026".
  - Missing stickers show nothing; there is no "unverified" label
    (no-duplicate-info rule, icons over words).
- **Where they render:**
  - business page intro (`unified-layout.tsx:491-510`);
  - **desktop immersive detail** (`presentBusinessSlide`, `presenters.ts:370`)
    **(corrected: this second render path also needs them)**;
  - business cards: a new prop on `business-card.tsx` /
    `business-card-grid-item.tsx`;
  - promotion linked-business card;
  - `ManagedByCard`.
- **Data source.** Stickers read **denormalised columns on `businesses`**, which
  are added to the explicit select lists:
  - `BUSINESS_DETAIL_SELECT` and its fallbacks
    (`business-detail-select.ts:5-55`);
  - `COLUMNS.businesses` (`showroom/feed.ts:37`);
  - the list selects (`api/businesses/route.ts:655-697`).
  - Cards then need no extra client fetches.
- **Mzansi Market listings** have no `business_id`, so they show sticker 1 only
  (as today).
- **Trust tiers.** The person-level `trust-scale.ts` tiers stay unchanged.

## 2. Security & privacy (priority)

| Threat                                   | Control                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Forged or edited CIPC PDF**            | CIPC PDFs have no QR code, signature or verification code (confirmed on the user's samples). Approval therefore needs a copy **the admin fetches from CIPC**. The owner's upload is evidence and pre-fill only.                                                                                                                                                                                                                                               |
| **Claiming someone else's company**      | Director match: the HMAC of each 13-digit director ID on the **admin copy**, computed exactly like `id_number_hmac` (`kyc-engine.ts:227-230`, `HMAC_SECRET`, raw 13 digits, spaces stripped), must equal the owner's approved `id_doc` HMAC. Otherwise the representative route applies (§3.3). Raw director IDs are never stored.                                                                                                                            |
| **Owner writes verification fields**     | New `businesses` columns are protected by a **guard trigger** (pattern `guard_content_monetization_columns`, `20260724020000:175-222`), because owners keep direct UPDATE through RLS and the existing guard only covers live rows **(corrected)**. They are also added to `SYSTEM_CONTROLLED_COLUMNS` (`admin/content-edits/decide/route.ts:24`) so an approved content edit can't set them **(corrected)**. All writes go through service-role routes only. |
| **Promotion hijacking another business** | Phase 0 #10: a DB trigger requires `promotions.business_id` to be owned by `promotions.owner_id`. Today the RLS UPDATE lets an owner point a non-live promotion at any business **(new finding)**.                                                                                                                                                                                                                                                            |
| **Self-typed CIPC data**                 | The field is removed and its data deleted (§7).                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Malicious PDFs**                       | Nothing is auto-rejected. The scanner inflates Flate streams and rescans (Phase 0 #4). A CIPC file with active content is **quarantined**: the admin sees the extracted text only, and the file is never sent to the browser. **(Corrected:** no iframe `sandbox`, because it stops Chrome's PDF viewer rendering; Chrome's viewer has no access to the admin origin, and the evidence route already sniffs the content type.)                                |
| **Personal data**                        | AES-GCM private R2 (`uploadKycDocument`). Director IDs as HMAC only. Masked in admin, reveal-on-click, every view logged in a new fail-closed `business_verification_evidence_access_logs`. No presigned URLs (Phase 0 #8). Files purged 30 days after a decision; visit photos after 90 days unless the owner publishes them. Hashes and metadata kept.                                                                                                      |
| **Insider misuse**                       | Queue claims (no self-review: `check_queue_claim`), staff MFA, `enforceAdminMutationGuard`, audit events. Exceptions and revocations go through the two-person ledger (only `governance_controller`/`admin` can approve; `decision_involves` blocks the proposer). For visits, the verifier ≠ the approver.                                                                                                                                                   |
| **Stale decisions**                      | `expectedUpdatedAt` is required on every approve (Phase 0 #7; the new route has it from day 1).                                                                                                                                                                                                                                                                                                                                                               |
| **Abuse**                                | Owner only. Sticker 1 required. 5 submissions per business per day. Body ≤ 6 MB, file ≤ 5 MB. These limits are **upload errors**, not verification decisions.                                                                                                                                                                                                                                                                                                 |
| **Drift**                                | 12-month expiry via pg_cron (pattern: `kyc_retention_daily`). Admin revoke. Ownership change → stickers 2 and 3 cleared.                                                                                                                                                                                                                                                                                                                                      |

## 3. Sticker 2 — CIPC Registered

### 3.1 Owner journey (owner is a director)

1. **Entry points.**
   - A per-business **Verification card** on
     `/dashboard/listings?area=MZANSI_BUSINESS` (beside
     `PlanAdministratorsCard`, `dashboard/listings/page.tsx:639`). It shows the
     3 stickers as steps, in the style of `verification-status-card.tsx`.
   - A nudge in `dashboard-onboarding.tsx`.
   - The old CIPC field on create/edit becomes a "Get the CIPC sticker" link.
   - Without sticker 1, the card says "Verify your ID first" and links to
     `/verification`.
2. **Guided form (one screen).**
   1. **Upload first.** "Upload any CIPC document for your company". Accepted:
      free disclosure, Disclosure Certificate, CoR14.3. A PDF downloaded from
      CIPC/BizPortal is best; photos are accepted but slower to review. A link
      explains where to download each.
   2. **We read it for you.** The registration number, name, status, directors
      (names only) and registered office appear for the owner to confirm. They
      only type the number if the file can't be read (photo).
   3. **Friendly heads-up, never a block.** "✓ You appear as Director", or "We
      couldn't find you on the director list — you can still submit, or use the
      company representative route if you're not a director."
   4. **Submit** → "In review — usually within 1 business day".
3. **Card states:** In review → **Needs info** (admin message; reply and
   re-upload inline) → Verified / Not approved (reason + "Try again") → Renew
   soon (30 days) → Expired.
4. **Renewal is one tap: "Renew".** No new upload is needed unless the details
   changed; the admin re-fetches from CIPC.

### 3.2 Several profiles, same company

- **Same owner.** An owner whose company is already verified can tap **"Link
  this profile to <verified company>"** on another business profile (branches, a
  second brand). This creates a light case: no documents, and an admin one-click
  approve.
- **Different owner.** A claim on a number already verified for a different,
  unrelated owner becomes a **conflict case** for admins.
  - The current holder is **notified** that someone else claimed their company,
    the way Google Business handles ownership claims.
  - Nothing changes until an admin decides.

### 3.3 Big companies — company representative route (no letters)

This is for when the account owner is not a director (e.g. a marketing manager).
It uses checks we can carry out ourselves:

1. **Sticker 1** on the representative (the business owner).
2. **Work-email code** to an address on the company's own domain. The admin
   confirms the domain matches the company's real website.
   - **(Corrected)** No email OTP exists today. Build it from the phone OTP
     pattern:
     - `otp_challenges` (`20260224000005`), extended with an `email` and
       `channel` column;
     - the PBKDF2 hash in `api/otp/send/route.ts:84-105`;
     - the atomic `increment_otp_attempt`;
     - sending via `sendEmail` (`email.ts:76`, to be exported).
3. **Call-back.** The admin phones the company on a number **they find
   independently** (website, public directory), **never one supplied by the
   applicant**. They confirm the person works there and may represent the
   company online. The case records the number's source, who confirmed, the date
   and the confirmed position.
4. **CIPC record** fetched by the admin as usual.

### 3.4 Automatic checks → findings for the admin (no auto-decisions)

- **Module.** `src/lib/cipc/` (`parse.ts`, `screen.ts`, `address.ts`), built on
  `unpdf` (Workers-compatible; no PDF library exists today) plus a raw-byte
  scan.
- **Each finding has:**
  - a severity: 🔴 attention / 🟠 check / 🟢 OK;
  - a plain-English meaning and what to do;
  - a suggested reason code.

| Check                                                              | Finding                                                                                                                                                                                                         |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Photo/scan, no text layer                                          | 🔴 "Can't inspect the file — rely on your CIPC copy"                                                                                                                                                            |
| Active content                                                     | 🔴 "Contains scripts — shown as text only"                                                                                                                                                                      |
| Document type (fingerprints from the user's real samples)          | 🟢 Official disclosure (`Disclosure Certificate: Companies and Close Corporations` + `CHANGE SUMMARY`) · 🟢 CoR14.3 (`COR14.3: Registration Certificate`) · 🟢 free disclosure (marker TBD) · 🔴 not recognised |
| Producer `Powered By Crystal` / Creator `Crystal Reports`          | 🟠 if different: "Made or re-saved with X"                                                                                                                                                                      |
| More than one `startxref`/`%%EOF`; ModDate later than CreationDate | 🟠 "Edited after CIPC issued it"                                                                                                                                                                                |
| Issue date "Certificate issued … on <date>" more than 90 days old  | 🟠                                                                                                                                                                                                              |
| Status ≠ In Business                                               | 🔴                                                                                                                                                                                                              |
| Owner's ID HMAC not among the directors                            | 🔴, with suggestion "Representative route or request info"                                                                                                                                                      |
| Director without SA ID (date of birth only)                        | 🟠 "Can't ID-match — KYC accepts SA ID only" **(corrected:** KYC accepts no passports, `validations/verification.ts:82`; such companies use the representative route)                                           |
| Same file hash on another business                                 | 🟠                                                                                                                                                                                                              |
| Number verified for an unrelated owner                             | 🔴 conflict                                                                                                                                                                                                     |
| Registered name ≠ profile name                                     | 🟠 informational; trading names are normal                                                                                                                                                                      |
| City not in our list                                               | 🟠 address kept as read                                                                                                                                                                                         |

**Parsed fields:** number, registered name, type, status, registration date;
directors/members (close corporations list _members_) with name, type, ID HMAC
and appointment date; registered office.

### 3.5 Admin review — easy, and the admin decides

- **Nav.** `/admin/business-verification` in `ADMIN_NAV`
  (`src/lib/admin/nav.ts`, `queues`).
  - Badge `business_kyc` from new branches in `staff_nav_counts()` /
    `staff_dashboard()`.
  - A `nav.test.ts` entry.
- **Tabs:** CIPC · Representatives · Visits · Conflicts · Renewals.
- **Queue.**
  - Reuses `QueueClaimsProvider` / `ClaimGate`. A migration widens the
    `queue_claims` CHECKs (`20260928120000:23-27`: add queue `business_kyc`,
    item_type `business_verification`) and `claim_queue_items` /
    `queue_item_conflict`, plus the TS union (`queue-claims.ts:17`).
  - Sorted by 🔴 count. A 24 h SLA badge (generalise `sla.ts` to take hours).
- **Who decides.** Moderators make routine decisions, as with normal-risk KYC.
  "Approve with exception" and "Revoke" use the two-person ledger: a new
  `sensitive_action_category`, a `propose_business_verification_override` RPC,
  an `approve_decision` branch, and an executor in the governance decide route.
- **Case screen** (one page):
  1. **Suggested next step**, clearly labelled a suggestion. Example: "All
     checks match — suggested: Approve".
  2. **Findings**, red first.
  3. **Side-by-side comparison:** owner's document | admin CIPC copy | profile.
     ✓/✗ per row: name, number, status, office, directors.
  4. **CIPC source check:**
     - "Open CIPC eServices" and copy-number buttons;
     - "Upload the copy you fetched", which is auto-parsed and auto-compared;
     - the result is one green "All match", or a list of differences.
  5. **Owner panel:** name, sticker 1, masked ID (reveal-and-log); for
     representatives, the email-code status plus a call-back form.
  6. **Message thread** (§3.6).
  7. **Decision dialog** with presets (copying `kyc-queue-table.tsx:571-606`):
     - **Approve:** enabled only when the admin copy is attached. The admin
       ticks "In Business" and "director matched / representative confirmed",
       and both ticks are recorded.
     - **Approve with exception.**
     - **Request info.**
     - **Reject:** reason code + a note the owner sees. Codes:
       `not_in_business`, `owner_not_director`, `document_not_cipc`,
       `document_altered`, `details_mismatch`, `conflict_other_owner`,
       `unreadable`.
     - **Revoke.**
- **Audit.** `logAuditEvent` actions `business_verification_*` (extend the union
  at `audit.ts:14-105`).

### 3.6 Correspondence (new — nothing threaded exists today)

- **Table.** `business_verification_messages`: case_id, author_id, author_role
  (`owner`|`staff`), body (plain text, ≤2000), optional encrypted attachment,
  `created_at`, `read_at`.
- **Access.** RLS limits it to the owner and staff; writes go through API
  routes.
- **Notifications.**
  - A staff message → `createNotification` + an email via the
    `email-template.ts` helpers.
  - An owner reply → `notifyStaffForAdminEvent`, and the case returns to the
    queue.
- **Visibility.** The thread shows on the case screen and on the owner's
  Verification card.

## 4. Sticker 3 — Seen by VerifyMzansi

1. **Request.** On the card, the owner taps "Get seen" and chooses:
   - **Live video** (default; nationwide): 3 preferred slots;
   - **In-person visit** ("where available"): the address to visit (any trading
     location) and 3 slots.
2. **Assign.** In the Visits tab, staff with a new capability `visit:conduct`
   (moderator and up) are assigned. The owner is notified of the date and the
   verifier's first name; reschedule and cancel are available.
3. **Verifier checklist** (phone-friendly `/admin/visits/[id]`):
   - person present = owner (their KYC selfie shown beside the live view);
   - business name or signage;
   - products or services seen;
   - premises type (shop / home-based / stall / mobile service / online-only
     with stock or work samples);
   - ≥3 photos or screenshots, with server time and, for visits, device GPS;
   - notes.
   - Then **Submit report**.
4. **Approve.** A **different** staff member approves or rejects. This requires
   at least 2 staff; it is standard separation of duties, the same as the KYC
   override rule.
5. **Privacy.**
   - Video calls are not recorded; the owner ticks consent for screenshots.
   - Visited addresses are never public; the tooltip shows the city only.
   - Photos are private unless the owner publishes chosen ones to their gallery.

## 5. Addresses — profile vs posts

- **The CIPC registered office belongs to the profile.**
  - On approval it is stored in `businesses.cipc_registered_office` (jsonb).
  - It is shown in the profile's **About** facts **(corrected:** the facts grid
    is in the "About" card, `unified-layout.tsx:540-552,673-681`; there is no
    "Business information" section), next to "Registered as VERIFYMZANSI (PTY)
    LTD" and the number.
  - It is also shown in the immersive slide.
  - **Default display:** suburb, city and province. A toggle, "Show full
    registered address", reveals the street lines. Default off, because a
    registered office is often a home; the owner chooses.
- **Posts and adverts keep their own addresses.**
  - The business listing's `location_*` and each promotion's own `location_*`
    columns (confirmed independent, `20260303000000:35-36`,
    `20260330100000:14-16`) are **never overwritten**.
  - The create/edit forms get an optional **"Use registered office"** one-tap
    pre-fill.
  - When the trading location equals the registered office, it is shown once.
- **Parsing (bottom-up):**
  - 4-digit line → postal code;
  - province: add alias `"kwa zulu natal"` (today
    `normalizeProvinceName('KWA-ZULU NATAL')` returns null, confirmed);
  - city via `resolveCityName`: add Empangeni and KwaDlangezwa to `SA_PROVINCES`
    / `sa-towns.ts` (confirmed missing);
  - then town/suburb, then street lines; everything title-cased.
  - An unknown city is kept as read (🟠). The admin can correct the address
    before approving.

## 6. Positions (who is posting)

- **Only the business owner can post for a business** today: ownership is
  enforced in the promotion routes (`promotions/route.ts:351`,
  `[id]/route.ts:219`), plus Phase 0 #10 in the DB.
  - So the position shown is the **owner's verified position**, stored on
    approval in `businesses.owner_verified_role`
    (`director`|`member`|`representative`) and `owner_position_title`.
  - Display: `ManagedByCard` (`business-sidebar-cards.tsx:60-86`) and the
    promotion advertiser blocks (`promotion-detail-content.tsx:684,1104`).
    - "S. Mhlongo · Director ✓CIPC"
    - "T. Khumalo · Marketing Manager ✓confirmed by company"
  - A position is shown **only when verified**; there are no self-declared
    titles, consistent with removing manual CIPC entry.
- **Ownership transfer** clears the position and stickers 2 and 3.
- **Deferred (next spec): team accounts** where staff post for a business. It
  needs new posting permissions, so it is out of scope here.

## 7. Removing manual CIPC entry

- **Remove the field from:**
  - forms: `business-profile-extras-fields.tsx:14,23,44,55,108-121`,
    `create-business/page.tsx:345,1032,1229,1805-1816`, and the edit page;
  - schema: `business-unified.ts:219`;
  - payload: `build-business-mutation-payload.ts:31,54`;
  - facts: `business-facts.ts:115-117` (and the immersive facts via
    `presenters.ts:413`);
  - guidance: `post-guidance.ts:9-10`;
  - docs: `docs/POSTING-GUIDE.md:127`;
  - tests: `business-crud.test.ts:1228,1246`, `business-unified.test.ts:209`,
    `business-facts.test.ts`.
- **Migration:**
  - deletes `category_details->business_profile->cipc_registration` from every
    business;
  - **notifies each affected owner** in-app ("We now verify CIPC registration
    from documents — get the CIPC sticker"), inserting into `notifications` as
    other SQL functions do.
- **Old clients.** The server ignores the key if an old client sends it (Phase 0
  #1).

## 8. Guide & example documents

- **New page `/help/business-verification`**, modelled on
  `src/app/help/verification/page.tsx` (`InfoHero`, numbered steps, reasons and
  fixes):
  1. The three stickers: what each means and what it doesn't (not tax, B-BBEE or
     solvency).
  2. **Annotated synthetic examples** of the accepted CIPC documents, using the
     real layouts with a fake company "EXAMPLE TRADING (PTY) LTD",
     `2020/123456/07`, ID `0000000000000`. Callouts mark title, number, status,
     directors and registered office. The user's real files are never used.
  3. Downloading from CIPC eServices/BizPortal.
  4. "Not a director?" — the representative route.
  5. Getting seen: video vs visit, and what to prepare.
  6. Review, "Needs info", renewals.
  7. Privacy: what we keep, who sees it, and when it is deleted.
- **Inline help** on the card links to the matching guide section.
- **Docs.** `docs/POSTING-GUIDE.md` updated. `docs/mobile-app-build-spec.md`
  gets a note that the APIs are reusable.

## 9. Data model

- **`business_verifications`:**
  - id, business_id, kind (`cipc`|`cipc_link`|`seen`), owner_id, route
    (`director`|`representative`);
  - status
    (`pending`|`info_requested`|`approved`|`rejected`|`revoked`|`expired`);
  - registration_number (`CHECK ~ '^\d{4}/\d{6}/\d{2}$'`), doc_type, parsed
    jsonb (no raw IDs), director_id_hmacs text[], findings jsonb,
    registered_office jsonb;
  - representative jsonb (email-code status, call-back log);
  - seen jsonb (method, slots, assigned_to, report, gps);
  - reviewed_by, reason_code, decided_at, expires_at, updated_at (CAS).
- **`business_verification_files`:** case_id, kind
  (`owner_upload`|`admin_copy`|`visit_photo`|`message_attachment`), r2_key,
  sha256, producer, xref_count.
- **`business_verification_messages`** and
  **`business_verification_evidence_access_logs`**.
- **`businesses` (guard-triggered and in `SYSTEM_CONTROLLED_COLUMNS`):**
  - `cipc_verified_at`, `cipc_registration_number`, `cipc_registered_name`,
    `cipc_registered_office`, `show_full_registered_office` (owner-editable);
  - `seen_verified_at`, `seen_method`, `seen_city`;
  - `owner_verified_role`, `owner_position_title`.
- **Email codes:** extend `otp_challenges` with `channel` and `email`.
- **RLS.** Owners read their own cases and messages; staff read via
  `has_role`/`has_any_role`; all writes go through service-role routes.
- **Jobs:**
  - pg_cron daily: expire stickers, send 30-day renewal notices;
  - retention purge of files and photos (`kyc_retention_daily` pattern).
- **Fees:** no fee code now (decide later); add one when pricing is set.

## 10. Phases

- **Phase 0:** bug fixes (below).
- **Phase 1:**
  - remove manual CIPC entry, plus the deletion and notification migration;
  - `src/lib/cipc/*` parser, findings and address parsing, with tests;
  - province and city data fixes;
  - core tables, guard trigger and `SYSTEM_CONTROLLED_COLUMNS`.
- **Phase 2:** owner flow:
  - Verification card, guided form, link-profile flow;
  - API `src/app/api/businesses/[id]/verification/route.ts`;
  - help page and examples.
- **Phase 3:** admin:
  - queue and claims migration, case screen, compare, decisions and ledger;
  - messages, notifications and emails, nav and counts, audit, evidence route.
- **Phase 4:**
  - sticker display in all render paths, select lists;
  - registered office in About and "Use registered office";
  - owner position;
  - representative route (email code + call-back);
  - renewals and expiry cron.
- **Phase 5:** sticker 3: request, assign, checklist, second-person approval,
  photo purge.

## 11. Logic review — what changed from earlier drafts and why

1. **Auto-reject removed.** It contradicted "admins decide". All checks are now
   findings with suggestions; only size/type limits remain, as upload errors.
2. **CIPC address no longer overwrites `location_*`.** That would break branches
   and adverts; it is now a separate profile field.
3. **The one-profile-per-number rule was replaced** by same-owner linking plus
   conflict cases with holder notification. The old rule blocked branches and
   gave no warning on hijack attempts.
4. **The representative route replaces letters for big companies.** The email
   OTP must be built, because none exists.
5. **"Team members post with positions" was cut.** Only owners can post today,
   so the position is the owner's verified position. Team accounts are deferred
   to their own spec.
6. **Foreign directors.** KYC accepts SA ID only (the UI copy wrongly says
   passports, Phase 0 #11). Such companies use the representative route.
7. **The fee hook was dropped.** Unused config is dead code (knip); it will be
   added when pricing is decided.
8. **Renewal is one tap**, with no re-upload.
9. **Video first, visit where available.** Nationwide in-person visits aren't
   realistic at launch.
10. **The badge data is denormalised** on `businesses`, so card grids need no
    per-card fetches. Both render paths (classic and immersive) are covered.
11. **Self-declared positions are not shown.** This is consistent with removing
    unverified CIPC data.
12. **Affected owners are notified** when their typed CIPC numbers are deleted,
    rather than the data disappearing silently.

## Phase 0 — fixes to existing code (each re-verified against the code)

| #   | Status                                 | Issue                                                                                                                                                                                                                                            | Fix                                                                                                                                                             | Tests                                                           |
| --- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| 1   | Confirmed (API-only; moderation-gated) | `build-business-mutation-payload.ts:38-55` keeps a client `category_details.business_profile` (unbounded strings, arbitrary keys) when no extras are sent                                                                                        | Strip `business_profile` from incoming `category_details` and rebuild only from validated extras (mirrors the client, `edit-business/[id]/page.tsx:618`)        | New builder unit test; `businesses/[id]/route.test.ts`          |
| 2   | Confirmed                              | Unverified CIPC number shown publicly (`business-facts.ts:115`)                                                                                                                                                                                  | Resolved by §7 (Phase 1)                                                                                                                                        | `business-facts.test.ts`                                        |
| 3   | Confirmed (latent)                     | `is_organisation_admin()` (`20260925090200:165`) never rechecks KYC or bans; the trigger is INSERT-only                                                                                                                                          | Migration: join `account_profiles` requiring `account_verification_status='verified'` and not banned/suspended                                                  | SQL behaviour test, `organisations/[id]/manage/route.test.ts`   |
| 4   | Partial                                | `malware-scan.ts:139-149` scans raw bytes only, so JavaScript inside Flate/ObjStm streams is missed                                                                                                                                              | Inflate Flate streams (bounded size and count) and rescan. **No iframe sandbox** (it breaks the PDF viewer)                                                     | `malware-scan.test.ts` + a compressed-JS fixture                |
| 5   | Confirmed (low) + **new**              | (a) Prior artifacts superseded before later steps that can fail (`upload/route.ts:536-542`). (b) **The `config_missing` return (678-684) leaves the new pending artifact behind, blocking all future uploads with `duplicate_pending_artifact`** | (a) Move the supersede after the step update succeeds. (b) Clean up on `config_missing`                                                                         | `verification-upload-cleanup.test.ts`, `upload/route.test.ts`   |
| 6   | Partial                                | Risk lowered, then restored in a second unconditional update; the restore is skipped on read/update errors (`upload/route.ts:767-947`)                                                                                                           | Single write using the worse of existing vs new risk; delete the restore block                                                                                  | `upload/route.test.ts`                                          |
| 7   | Hardening                              | `expectedUpdatedAt` optional (`validations/admin.ts:73`)                                                                                                                                                                                         | Required for approve                                                                                                                                            | `decide/route.test.ts`, `verification-decision-binding.test.ts` |
| 8   | Confirmed dead code                    | `getKycDocumentViewUrl` (`storage.ts:731`), only used in tests                                                                                                                                                                                   | Delete it and its test block                                                                                                                                    | `storage.test.ts`                                               |
| 9   | Confirmed                              | WebP KYC images keep EXIF/GPS (`kyc-file-analysis.ts:134-138`)                                                                                                                                                                                   | Call the existing `stripMetadataFromWebp` (`exif-strip.ts:219`)                                                                                                 | `kyc-file-analysis.test.ts`                                     |
| 10  | **New, confirmed**                     | Promotions RLS UPDATE lets an owner set `business_id` to someone else's business on non-live rows (`20260318140000:50-52`)                                                                                                                       | Migration: trigger on promotions INSERT/UPDATE OF business_id requiring `businesses.owner_id = NEW.owner_id`. The service role is exempt only for admin tooling | Promotion route tests + SQL test                                |
| 11  | **New, confirmed**                     | The verification page says passports are accepted (`verification/page.tsx:214-215`) but the server only allows SA ID (`validations/verification.ts:82`)                                                                                          | Correct the copy to SA ID only (passport support is a separate decision)                                                                                        | page test                                                       |

## Verification

- **Phase 0:** a test per fix. Migrations #3 and #10 go to a Supabase branch
  first. Then `knip`, lint, typecheck, vitest, and push to main.
- **Parser:** **synthetic** fixtures mirroring the real Crystal Reports layouts
  (the user's real PDFs contain an ID and a tax number and are never committed).
  Cases: genuine, re-saved, Print-to-PDF, photo, active content, wrong number,
  non-director, CC members, date-of-birth director. Each case asserts findings,
  never an auto-decision.
- **API:**
  - non-owner 403; no sticker 1 → 403;
  - approve without an admin copy refused; missing `expectedUpdatedAt` → 400;
    stale → 409;
  - owner direct UPDATE of verification columns blocked by the trigger;
  - old-client `cipc_registration` ignored.
- **RLS and triggers** on a Supabase branch.
- **End-to-end on the dev server:**
  - **CIPC:** submit → findings → claim → message round-trip → approve →
    stickers on page, card and immersive; registered office in About; "Director"
    on `ManagedByCard`; advert address unchanged; "Use registered office"
    pre-fills.
  - **Link a second profile.**
  - **Conflict claim** → holder notified.
  - **Representative:** email code + call-back.
  - **Seen:** video request → checklist → second-staff approval.
  - **Expiry:** back-date → cron clears the stickers → renew.
- **Open item:** one free CIPC disclosure sample, to fingerprint it and to learn
  whether the admin's CIPC copy can be free.

---

## Implementation notes (2026-10-06)

Built as specified, with these deliberate differences:

- **Two-person exceptions live on the case, not in the shared decision ledger.**
  A reviewer proposes an exception with a reason; a different governance
  controller or admin confirms it (step-up MFA). Wiring a new category into
  `approve_decision` would have meant rewriting a function that live KYC
  overrides depend on. Removing a sticker is a senior, single-person action with
  a written reason and step-up MFA.
- **Seen identity check uses the owner's verified legal name, not the KYC
  selfie.** Approved KYC images are deleted after 30 days, so the verifier
  checks that the person shows an ID matching the name on the owner's reviewed
  ID.
- **Visit photos are never published.** They are private evidence and are
  deleted 30 days after the decision, like every other case file.
- **Owners read their cases only through the API.** RLS gives owners no direct
  access, so staff-only fields (forensic findings, the admin's CIPC copy,
  work-email code hashes) cannot leak through PostgREST.
- **Work-email codes are stored on the case** (HMAC-hashed, 15 minutes, 5 tries)
  rather than in `otp_challenges`, which is keyed on phone numbers.
- **Cards show the CIPC and Seen stickers; the ID sticker appears on the
  profile**, where the owner's verification status is already loaded.
- **Cases waiting on the owner for 30 days close as withdrawn** (daily job), and
  the owner is told.
