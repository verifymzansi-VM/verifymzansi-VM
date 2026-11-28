#!/usr/bin/env node
// Access matrix of the production (foundation) schema: candidate.sql plus every
// update in database/foundation/updates/, replayed exactly as production runs
// it. scripts/lib/foundation-access-matrix-native.mjs makes the same sweep on
// the older prototype fixture, which carries none of the updates; this one
// covers every API command the updates added (staff payments, invoices and
// refunds, account closure and erasure, phone bans, payment limits, ...).
//
// It replays database/foundation (prelude, candidate.sql, every update) into
// the throwaway, network-less Postgres 17 container of the SQL lint gate, then:
//
// - checks the role surface: every api.* command's execute grants equal the
//   reviewed manifests, nothing is SECURITY DEFINER, browsers have no table,
//   column, sequence or private-schema access, every application table has row
//   level security and only the Auth sign-up hook has a policy;
// - checks that every application table holding account data is in owner A's
//   row fingerprint (OWNER_TABLES, which includes A's Auth rows) or reviewed
//   as holding none (NOT_DIGESTED);
// - builds owner A's private world through the production commands (legal
//   name, an accepted identity review, a verified phone, a live event with an
//   enquiry and another member's report, a business draft with a seen check,
//   an organisation application, a paid and a pending payment, a saved form
//   draft, a privacy request, a support message);
// - calls every api.* command as a signed-out visitor, a member with no rights
//   (unverified), another verified member, an organisation administrator and
//   each staff role, with A's real identifiers and current revisions, and as
//   the intended principal (A, the staff role holding the capability, or the
//   service role). Each call runs in a subtransaction that is rolled back, so
//   every call sees the same world, and A's rows are fingerprinted before and
//   after it.
//
// It fails when a principal is let through a grant it does not have; when a
// service-only command is executable by anon or authenticated; when a staff
// role passes a capability check it lacks, or is refused one it holds; when
// any non-owner sees one of A's private values, or changes A's data, outside
// the short reviewed lists below; or when the intended principal is refused by
// a grant or a staff check. The synthetic arguments cannot satisfy every
// command's input and state rules, so the intended principal is required to
// succeed outright only for the commands in EXERCISED_FILE.
//
//   node --import tsx scripts/test-foundation-access-matrix.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members
// and staff are Auth rows written as the database owner (staff with a verified
// authenticator app and an AAL2 session), as the other replayed-schema checks
// do; everything else goes through the production API commands.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { replaySteps } from "./lib/foundation-replay.mjs";
import { createChecks, sqlHelpers } from "./lib/foundation-sql-checks.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import {
  buildAccessOwnerWorld,
  sweepBodies,
  sweepInteger,
  syntheticLetters,
} from "./lib/foundation-access-matrix-world.mjs";
import { createTrustedPostingFixture } from "./lib/foundation-trusted-posting-fixture.mjs";

const STAFF_ROLES = ["moderator", "governor", "admin"];

// Reviewed exceptions: who may see which of owner A's private values, and
// through which command (principal:command:value). Anything else observed by a
// non-owner fails.
const ALLOWED_VIEWS = new Map([
  // The organisation administrator reviews A's consented application, which
  // names A's business profile (as on the prototype fixture).
  ["orgAdmin:org_list_applications:applicationId", "reviews A's consented application"],
  ["orgAdmin:org_list_applications:businessDraftId", "the application names A's business"],
  // The administrator's own notices of that application link the business.
  ["orgAdmin:list_my_frontend_notices:businessDraftId", "own notice of A's application"],
  // Staff with organisation:manage act for any organisation and see the same
  // minimal application list.
  ["admin:org_list_applications:applicationId", "organisation:manage, same minimal list"],
  ["admin:org_list_applications:businessDraftId", "organisation:manage, same minimal list"],
  // Every staff role answers the support inbox (support:view), which shows
  // the sender's name, address and message.
  ...["moderator", "governor", "admin"].flatMap((role) =>
    ["supportName", "ownerEmail", "supportMessage"].map((value) => [
      `${role}:get_frontend_support_inbox:${value}`,
      "support:view answers A's message",
    ])
  ),
  // Staff with dsar:manage handle A's privacy request; the queue shows the
  // requester's address and request text.
  ...["governor", "admin"].flatMap((role) =>
    ["privacyName", "privacyDetails", "ownerEmail", "privacyRequestId"].map((value) => [
      `${role}:get_frontend_privacy_queue:${value}`,
      "dsar:manage handles A's request",
    ])
  ),
  // The staff audit page (audit:view) lists the request's events by id only.
  ["governor:get_frontend_staff_audit_page:privacyRequestId", "audit:view, the event's id only"],
  ["admin:get_frontend_staff_audit_page:privacyRequestId", "audit:view, the event's id only"],
  // The seen-check case summary (queue:view, no claim or recent MFA needed)
  // names the business. Since 20261118072601_staff_data_minimisation.sql
  // (pull request #264) it shows the owner's public short name, not the
  // surname; the visit address and legal name stay behind a claim with
  // evidence:view.
  ...["moderator", "governor", "admin"].map((role) => [
    `${role}:get_frontend_seen_case:businessDraftId`,
    "queue:view, the checked business",
  ]),
]);
// Reviewed exceptions: who may change which of owner A's rows, and through
// which command (principal:command:table). Staff may change A's rows only
// through a command whose own capability checks (its api body or the internal
// function of the same name) all name capabilities their role holds, not ones
// it merely reaches through a helper; anything else
// changed by a non-owner fails.
const ALLOWED_CHANGES = new Map([
  // The organisation administrator decides A's consented application, and A
  // is notified of the decision (as on the prototype fixture).
  ["orgAdmin:org_decide_application:organisation_applications", "decides A's application"],
  ["orgAdmin:org_decide_application:notifications", "A is told of the decision"],
  ["orgAdmin:org_decide_application:organisation_affiliations", "approval affiliates A's business"],
  [
    "orgAdmin:org_decide_application:organisation_events",
    "the decision is logged against A's application",
  ],
  // Staff holding organisation:manage (recent MFA) decide for any
  // organisation; the command reaches that check through
  // internal.organisation_actor, not directly.
  ...[
    "organisation_applications",
    "notifications",
    "organisation_affiliations",
    "organisation_events",
  ].map((table) => [
    `admin:org_decide_application:${table}`,
    "organisation:manage via internal.organisation_actor decides A's application",
  ]),
  // Revealing the business contact of A's pending application writes one
  // audit row (who, when, which application) to the organisation's event log
  // (20261118072601_staff_data_minimisation.sql); A's own rows are untouched.
  [
    "orgAdmin:reveal_organisation_applicant_contact:organisation_events",
    "the reveal of A's pending application contact is logged",
  ],
  [
    "admin:reveal_organisation_applicant_contact:organisation_events",
    "organisation:manage via internal.organisation_actor; the reveal is logged",
  ],
]);
// Staff roles that hold only some of a command's own capabilities yet may
// succeed, because the command checks the others on one branch only
// (role:command: reason).
const PARTIAL_CAPABILITY_BRANCHES = new Map([]);
// Commands that check a staff capability on one branch only and serve every
// member otherwise (command:reason).
const MEMBER_WITH_STAFF_BRANCH = new Map([
  ["get_my_account_context", "any member's own context; staff also see their queue counts"],
]);
// Refusals of the staff session layer (internal.staff_actor): the intended
// staff role must never meet one.
const STAFF_SESSION_REFUSALS = [
  "capability not granted",
  "staff session with second factor required",
  "live staff session required",
  "staff second-factor verification expired",
  "recent second-factor verification required",
  "verified authenticator app required",
  "account suspended",
];
// The commands whose intended principal reaches a successful answer with the
// synthetic arguments (so the sweep exercises them past their input and state
// rules). Each listed command must keep succeeding; the rest stop at input or
// state validation (an unknown id, a missing claim), never at a grant or a
// staff check. Rewrite the list with --write-exercised after reviewing a
// change in it.
const EXERCISED_FILE = "scripts/lib/foundation-access-matrix-exercised.json";

const APPLICATION_SCHEMAS = ["public", "api", "private", "internal"];
// Owner A's rows, fingerprinted before and after every call ($1 is A's
// account id). The coverage check below requires every private table that
// holds account data to be listed here or in NOT_DIGESTED.
const ownPosts = "post_id in (select id from private.posts where owner_id=$1)";
const ownCases = "case_id in (select id from private.evidence_cases where subject_id=$1)";
const ownPayments = "payment_id in (select id from private.payments where owner_id=$1)";
const ownChecks = "check_id in (select id from private.frontend_business_checks where owner_id=$1)";
const ownEmail = "lower(email)=(select lower(email) from auth.users where id=$1)";
const ownDecisions = `decision_id in (select id from private.decisions where ${ownCases})`;
const ownFacts = "fact_id in (select id from private.accepted_identity_facts where owner_id=$1)";
const ownReports =
  "report_id in (select id from private.reports where reporter_id=$1 or subject_account_id=$1)";
const OWNER_TABLES = [
  ["profiles", "account_id=$1"],
  ["identity_submission_names", "owner_id=$1"],
  ["posts", "owner_id=$1"],
  ["post_contacts", ownPosts],
  ["post_media", ownPosts],
  ["media_objects", "owner_id=$1"],
  ["enquiries", "owner_id=$1 or sender_account_id=$1"],
  ["notifications", "account_id=$1"],
  ["evidence_cases", "subject_id=$1"],
  ["evidence_artifacts", "owner_id=$1"],
  ["verification_identity_submissions", "owner_id=$1"],
  ["accepted_identity_facts", "owner_id=$1"],
  ["verification_phone_proofs", "owner_id=$1"],
  ["verification_localities", "owner_id=$1"],
  // Place changes (20261125161326_change_verified_place): A's recorded changes.
  ["verification_locality_changes", "owner_id=$1"],
  ["payments", "owner_id=$1"],
  ["entitlements", "owner_id=$1"],
  ["organisation_applications", "applicant_id=$1"],
  ["legal_holds", "subject_id=$1"],
  ["organisation_sponsorships", "owner_id=$1"],
  ["account_acquisitions", "account_id=$1"],
  ["partners", "account_id=$1"],
  ["partner_commissions", "referred_account_id=$1"],
  // Tables the updates added, and the rest of A's account, posts, cases,
  // payments and requests.
  ["account_closures", "user_id=$1"],
  ["account_erasures", "user_id=$1"],
  ["account_erasure_requests", "user_id=$1"],
  ["banned_identities", ownDecisions],
  [
    "banned_phone_numbers",
    // A's numbers, or a release A asked for or approved as staff
    // (20261125213005_release_one_phone_number).
    `identity_hmac in (select identity_hmac from private.identity_ban_bindings where ${ownFacts}) or release_proposed_by=$1 or released_by=$1`,
  ],
  ["business_details", ownPosts],
  ["communication_choice_events", "account_id=$1"],
  ["customer_invoices", "account_id=$1"],
  ["customer_invoice_payments", ownPayments],
  ["decisions", ownCases],
  ["entitlement_members", "member_id=$1"],
  ["event_details", ownPosts],
  ["event_submissions", "owner_id=$1"],
  ["evidence_access_log", ownCases],
  ["evidence_fraud_holds", ownCases],
  ["frontend_account_restrictions", "account_id=$1"],
  ["frontend_account_warnings", "account_id=$1"],
  ["frontend_appeals", "appellant_id=$1"],
  ["frontend_business_checks", "owner_id=$1"],
  ["frontend_business_check_messages", ownChecks],
  ["frontend_business_reply_files", ownChecks],
  ["frontend_business_seen_photos", ownChecks],
  ["frontend_cipc_documents", ownChecks],
  ["frontend_cipc_email_codes", ownChecks],
  ["frontend_cipc_exceptions", ownChecks],
  ["frontend_cipc_reviews", ownChecks],
  ["frontend_content_holds", "account_id=$1"],
  [
    "frontend_content_hold_media",
    "hold_id in (select id from private.frontend_content_holds where account_id=$1)",
  ],
  ["frontend_evidence_claim_events", ownCases],
  ["frontend_form_drafts", "owner_id=$1"],
  ["frontend_governance_events", ownDecisions],
  ["frontend_identity_step_approvals", ownCases],
  ["frontend_offline_post_reviews", ownPosts],
  ["frontend_partner_notes", "partner_id in (select id from private.partners where account_id=$1)"],
  ["frontend_payment_reversals", ownPayments],
  ["frontend_post_action_receipts", "owner_id=$1"],
  ["frontend_post_approval_snapshots", ownPosts],
  ["frontend_post_commands", "owner_id=$1"],
  ["frontend_post_hold_state", ownPosts],
  ["frontend_report_action_receipts", ownReports],
  [
    "frontend_report_proposals",
    `receipt_id in (select id from private.frontend_report_action_receipts where ${ownReports})`,
  ],
  ["frontend_staff_role_changes", "target_id=$1"],
  ["frontend_verification_uploads", "owner_id=$1"],
  // House slots (20261119082834): A's own slots, or a grant A approved.
  [
    "house_slot_events",
    "entitlement_id in (select id from private.entitlements where owner_id=$1) or approved_by=$1",
  ],
  ["identity_ban_bindings", ownFacts],
  ["identity_ban_proposal_requests", "owner_id=$1"],
  [
    "identity_review_proposals",
    "submission_id in (select id from private.verification_identity_submissions where owner_id=$1)",
  ],
  ["individual_slot_limits", "account_id=$1"],
  ["intro_trial_requests", "owner_id=$1"],
  // Post templates (20261122191646_post_templates): A's saved templates.
  ["post_templates", "owner_id=$1"],
  ["invoice_transfers", "account_id=$1"],
  ["invoices", ownPayments],
  ["listing_details", ownPosts],
  // Continue on your phone links (20261120131212_camera_capture_handoff).
  ["capture_handoffs", "owner_id=$1"],
  // Automatic ID checks (20261121094003_automatic_identity_checks): A's checks,
  // and setting changes A made as staff.
  ["identity_checks", "owner_id=$1"],
  ["identity_check_mode_events", "changed_by=$1"],
  // Authority requests (20261121043124_identity_record_disclosure): an opening
  // that names A, or one A opened as staff, and every later look at them.
  ["identity_disclosures", "$1=any(subject_ids) or opened_by=$1"],
  [
    "identity_disclosure_events",
    "subject_id=$1 or staff_id=$1 or disclosure_id in (select id from private.identity_disclosures where $1=any(subject_ids) or opened_by=$1)",
  ],
  // Copy a post (20261121150309_copy_a_post): which of A's posts a copy came from.
  ["post_copies", ownPosts],
  // Free credits (20261122130744_free_credits): a gift to A, or one A gave or
  // extended as staff.
  [
    "free_credit_events",
    "entitlement_id in (select id from private.entitlements where owner_id=$1) or actor_id=$1",
  ],
  // Lost days (20261125113433_add_lost_days): days added to A's grants, or
  // days A added as staff.
  [
    "lost_day_additions",
    "entitlement_id in (select id from private.entitlements where owner_id=$1) or actor_id=$1",
  ],
  ["listing_price_drafts", "owner_id=$1"],
  ["moderation_log", ownPosts],
  [
    "notification_dismissals",
    "notification_id in (select id from private.notifications where account_id=$1)",
  ],
  ["organisation_admins", "account_id=$1"],
  ["package_invoice_requests", "account_id=$1"],
  ["organisation_affiliations", ownPosts],
  // An event's subject is an account, application, affiliation, sponsorship,
  // invitation, programme or logo; match every one that belongs to A.
  [
    "organisation_events",
    "subject_id=$1 or subject_id in (select id from private.organisation_applications where applicant_id=$1" +
      ` union select id from private.organisation_affiliations where ${ownPosts}` +
      " union select id from private.organisation_sponsorships where owner_id=$1" +
      ` union select id from private.organisation_invites where ${ownEmail}` +
      " union select id from private.media_objects where owner_id=$1)",
  ],
  ["organisation_invites", ownEmail],
  ["outbox_events", "owner_id=$1"],
  ["owner_admin_invitations", ownEmail],
  // Member invitations and sign-up mode changes
  // (20261120040242_signup_mode_member_invitations): A's own invitation or
  // the one A used, or one A invited or revoked as staff, with its history;
  // a mode change A was named for.
  ["member_invitations", `${ownEmail} or invited_by=$1 or claimed_by=$1 or revoked_by=$1`],
  ["member_invitation_events", `${ownEmail} or actor_id=$1`],
  ["signup_mode_events", "changed_by=$1"],
  ["partner_events", "partner_id in (select id from private.partners where account_id=$1)"],
  ["payment_activations", ownPayments],
  ["payment_lines", ownPayments],
  ["payment_problems", ownPayments],
  // The daily payment-problem summary lists payment ids in its jsonb.
  [
    "payment_problem_digests",
    "exists(select 1 from private.payments p where p.owner_id=$1 and t.content::text like '%'||p.id::text||'%')",
  ],
  ["payment_refund_requests", "account_id=$1"],
  ["post_activations", "owner_id=$1"],
  ["post_addon_windows", `${ownPosts} or ${ownPayments}`],
  ["post_deletion_extensions", ownPosts],
  // Likes A made signed in, and every like and daily view total of A's posts.
  ["post_likes", `account_id=$1 or ${ownPosts}`],
  ["post_view_days", ownPosts],
  ["post_engagement_totals", ownPosts],
  // Daily activity counts of A's posts (20261121100028_post_performance_stats.sql).
  ["post_activity_days", ownPosts],
  ["post_presentations", ownPosts],
  ["post_presentation_media", ownPosts],
  ["post_search_documents", ownPosts],
  ["post_slugs", ownPosts],
  ["post_trial_claims", "owner_id=$1"],
  ["posting_terms_acceptances", "owner_id=$1"],
  ["privacy_requests", "subject_user_id=$1"],
  [
    "privacy_request_events",
    "request_id in (select id from private.privacy_requests where subject_user_id=$1)",
  ],
  [
    "privacy_notice_jobs",
    "request_id in (select id from private.privacy_requests where subject_user_id=$1)",
  ],
  ["provider_events", ownPayments],
  ["queue_claims", `${ownPosts} or ${ownReports}`],
  ["queue_claim_events", `${ownPosts} or ${ownReports}`],
  ["reports", "reporter_id=$1 or subject_account_id=$1"],
  ["signup_terms_acceptances", "account_id=$1"],
  ["slot_packages", "owner_id=$1"],
  ["staff_roles", "user_id=$1"],
  ["support_tickets", ownEmail],
  [
    "support_ticket_events",
    `ticket_id in (select id from private.support_tickets where ${ownEmail})`,
  ],
  [
    "support_ticket_mail",
    `ticket_id in (select id from private.support_tickets where ${ownEmail})`,
  ],
  ["trial_identities", "owner_id=$1"],
  ["verification_current_submissions", ownCases],
  ["verification_phone_challenges", "owner_id=$1"],
  ["verification_return_requests", ownCases],
  // A's Auth rows (sign-in identity, sessions, authenticator apps).
  ["auth.users", "id=$1"],
  ["auth.sessions", "user_id=$1"],
  ["auth.mfa_factors", "user_id=$1"],
];
// Private tables that reference an account, a post, a case, a notification or
// one of the tables above, or carry an account or contact column, yet hold no
// data of owner A (table: reason). Reviewed; add a table here only with a
// reason, never to make the coverage check pass.
const NOT_DIGESTED = new Map([
  ["cost_alarms", "platform cost alarms; the only account column is the acknowledging staff"],
  ["frontend_feature_flags", "runtime switches; the only account column is the staff editor"],
  ["frontend_feature_flag_events", "switch history; the only account column is the staff editor"],
  [
    "organisations",
    "an organisation's own record, edited only by staff with organisation:manage or its " +
      "administrators; its contacts are the organisation's (shown only once is_public is " +
      "set) and its account columns (created_by, logo_permission_by) name staff",
  ],
  [
    "organisation_notes",
    "staff notes on an organisation; the only account column is the staff author",
  ],
  [
    "programme_showcases",
    "staff-curated showcase settings of a programme; the only account column is the staff editor",
  ],
  [
    "category_fields",
    "posting-form field catalogue; its jsonb holds validation rules, no member data",
  ],
  ["posting_terms_versions", "published posting terms; the hash is the document's, no member data"],
  [
    "lost_email_alerts",
    "staff alerts about lost emails (20261125131322); the jsonb lists queue ids, kinds, " +
      "attempts, times and error codes, never an account, address or content",
  ],
  ["reference_catalog_versions", "taxonomy catalogue versions; the hash is the catalogue's"],
]);
// What makes a private table hold account data, for the coverage check.
const ACCOUNT_ANCHORS = [
  "auth.users",
  "private.posts",
  "private.evidence_cases",
  "private.notifications",
];
// Column names (matched case-insensitively) that hold or point at personal
// data: accounts, contacts, names, identity documents, addresses, network
// addresses, bank details, secrets and hashes, stored object keys.
const CONTACT_COLUMN =
  "(^|_)(email|email_address|phone|phone_number|phone_e164|msisdn|mobile|cell|whatsapp|" +
  "address|dob|birth|birth_date|date_of_birth|passport|passport_number|national_id|" +
  "id_number|account_number|iban|token|secret|last_four|object_key|full_name|" +
  "owner_id|account_id|user_id|subject_id|subject_user_id|applicant_id|appellant_id|" +
  "member_id|target_id|author_id|created_by|actor_id)(_|$)|_name$|^ip|_ip(_|$)|_hmac$|" +
  "_hash$|whatsapp|msisdn|mobile|birth|passport|address|secret|token";
// uuid columns that name an account even without a foreign key.
const ACCOUNT_UUID_COLUMN =
  "_by$|(^|_)(reviewer|requester|sender|recipient|staff|verifier|proposer|approver|" +
  "assignee|claimant|reporter|buyer|seller|customer|user|account|member|owner|actor|" +
  "author|subject|target|applicant|appellant|partner|referrer|referred_account|invited|" +
  "inviter|creator|editor|holder)_id$";
// Column types that hold free-form documents or network addresses: their
// table must be digested or reviewed whatever the column is called.
const FREE_FORM_TYPES = ["json", "jsonb", "json[]", "jsonb[]", "inet", "cidr"];

const { check, current, passed } = createChecks();
const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
let session;
try {
  const { steps, updates } = replaySteps();
  applySteps(database, steps);
  console.log(`Replayed candidate.sql and ${updates.length} updates.`);
  const { q, json, fails } = sqlHelpers(database, current);
  const sql = (statement) => q(statement);

  // ------------------------------------------------------------ catalogue
  const catalogue = json(
    "select json_agg(json_build_object('name',p.proname,'definer',p.prosecdef," +
      "'anon',has_function_privilege('anon',p.oid,'execute')," +
      "'authenticated',has_function_privilege('authenticated',p.oid,'execute')," +
      "'service',has_function_privilege('service_role',p.oid,'execute')," +
      "'args',coalesce((select json_agg(json_build_object('name',p.proargnames[i+1],'type',format_type(p.proargtypes[i],null)) order by i) from generate_series(0,p.pronargs-1) i),'[]'::json)) order by p.proname) " +
      "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api';"
  );
  const manifest = new Map(
    ["api-manifest.json", "runtime-api-manifest.json"].flatMap((file) =>
      JSON.parse(readFileSync(`database/foundation/${file}`, "utf8")).functions.map((fn) => [
        fn.name,
        fn.execute,
      ])
    )
  );
  const names = (pick) =>
    catalogue
      .filter(pick)
      .map((fn) => fn.name)
      .sort();
  const ANON = names((fn) => fn.anon);
  const SERVICE = names((fn) => fn.service);
  const MEMBER = names((fn) => fn.authenticated && !fn.anon);

  await check("role surface: every api command's grants equal the reviewed manifests", () => {
    assert.equal(new Set(catalogue.map((fn) => fn.name)).size, catalogue.length, "no overloads");
    assert.deepEqual(
      names(() => true),
      [...manifest.keys()].sort()
    );
    for (const fn of catalogue)
      assert.deepEqual(
        { anon: fn.anon, authenticated: fn.authenticated, service_role: fn.service },
        manifest.get(fn.name),
        fn.name
      );
    // Signed-out reads are also member reads; service commands are for the
    // server only; every command has exactly one audience class.
    assert.deepEqual(
      names((fn) => fn.anon && !fn.authenticated),
      []
    );
    assert.deepEqual(
      names((fn) => fn.service && (fn.anon || fn.authenticated)),
      []
    );
    assert.deepEqual(
      names((fn) => !fn.anon && !fn.authenticated && !fn.service),
      []
    );
    assert.deepEqual(
      names((fn) => fn.definer),
      []
    );
    // Internal commands open to signed-out callers are exactly the public reads.
    assert.deepEqual(
      sql(
        "select coalesce(string_agg(p.proname,',' order by p.proname),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='internal' and has_function_privilege('anon',p.oid,'execute');"
      ).split(","),
      ANON
    );
    // Nothing outside api and internal is executable by the API roles, apart
    // from the platform's own schemas.
    assert.equal(
      sql(
        "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join unnest(array['anon','authenticated','service_role']) r " +
          "where n.nspname in ('public','private') and has_function_privilege(r,p.oid,'execute');"
      ),
      "0"
    );
  });

  await check("role surface: no table access, row level security everywhere", () => {
    const schemas = APPLICATION_SCHEMAS.map((s) => `'${s}'`).join(",");
    assert.equal(
      sql(
        `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${schemas}) and c.relkind in ('r','p') and not c.relrowsecurity;`
      ),
      "0"
    );
    assert.equal(
      sql(
        "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r " +
          `where n.nspname in (${schemas}) and c.relkind in ('r','p','v','m','f','S') and (` +
          "has_table_privilege(r,c.oid,'select,insert,update,delete,truncate,references,trigger') or " +
          "(c.relkind<>'S' and has_any_column_privilege(r,c.oid,'select,insert,update,references')) or " +
          "(c.relkind='S' and has_sequence_privilege(r,c.oid,'usage,select,update')));"
      ),
      "0"
    );
    // The only policies are the Auth sign-up hook's reads: administrator and
    // member invitations, the sign-up mode and the blocked email domains.
    assert.equal(
      sql(
        `select coalesce(string_agg(schemaname||'.'||tablename||':'||policyname||':'||array_to_string(roles,','),' ' order by tablename),'') from pg_policies where schemaname in (${schemas});`
      ),
      [
        "private.member_invitations:member_invitations_signup_hook:supabase_auth_admin",
        "private.owner_admin_invitations:owner_admin_signup_hook:supabase_auth_admin",
        "private.signup_blocked_domains:signup_blocked_domains_signup_hook:supabase_auth_admin",
        "private.signup_settings:signup_settings_signup_hook:supabase_auth_admin",
      ].join(" ")
    );
    assert.equal(
      sql(
        "select string_agg(has_schema_privilege(r,s,'usage')::text,',' order by s,r) from unnest(array['anon','authenticated','service_role']) r cross join unnest(array['private']) s;"
      ),
      "false,false,false"
    );
    assert.equal(
      sql(
        `select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (${schemas}) and c.relkind in ('v','m') and not coalesce(c.reloptions @> array['security_invoker=true'],false);`
      ),
      "0"
    );
    assert.equal(
      sql(
        "select evtenabled::text||':'||evtevent||':'||evtfoid::regproc::text from pg_event_trigger where evtname='require_table_rls';"
      ),
      "O:ddl_command_end:internal.require_table_rls"
    );
    const probe = "zz_rls_guard_" + randomBytes(4).toString("hex");
    try {
      sql(`create table private.${probe}(id integer primary key);`);
      assert.equal(
        sql(`select relrowsecurity from pg_class where oid='private.${probe}'::regclass;`),
        "t"
      );
      fails(`alter table private.${probe} disable row level security;`, "42501");
    } finally {
      sql(`drop table if exists private.${probe};`);
    }
  });

  // A new table holding account data must join the owner digest (so a
  // non-owner changing A's rows in it is caught) or be reviewed as holding
  // none of A's data. A table, in any schema the application stores data in,
  // holds account data when it references an account, a post, a case, a
  // notification or a digested table, or has an account, contact, identity or
  // secret column, an account-like uuid column or a free-form column. Tables
  // outside private are named schema.table.
  const relation = (table) => (table.includes(".") ? table : `private.${table}`);
  await check("coverage: every table holding account data is in the owner digest", () => {
    const digested = OWNER_TABLES.map(([table]) => table);
    assert.equal(new Set(digested).size, digested.length, "a table is digested twice");
    assert.deepEqual(
      digested.filter((table) => NOT_DIGESTED.has(table)),
      [],
      "digested and reviewed as not digested"
    );
    const anchors = [...ACCOUNT_ANCHORS, ...digested.map(relation)].map(
      (name) => `'${name}'::regclass`
    );
    const schemas = APPLICATION_SCHEMAS.map((schema) => `'${schema}'`).join(",");
    const types = FREE_FORM_TYPES.map((type) => `'${type}'::regtype`).join(",");
    const linkedTables = () =>
      json(`select coalesce(json_agg(case when n.nspname='private' then c.relname::text
          else n.nspname||'.'||c.relname end order by n.nspname,c.relname),'[]') from pg_class c
      join pg_namespace n on n.oid=c.relnamespace
      where n.nspname in (${schemas}) and c.relkind in ('r','p') and (
        exists(select 1 from pg_constraint k where k.conrelid=c.oid and k.contype='f'
          and k.confrelid in (${anchors.join(",")}))
        or exists(select 1 from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped
          and (a.attname ~* '${CONTACT_COLUMN}' or a.atttypid in (${types})
            or (a.atttypid='uuid'::regtype and a.attname ~* '${ACCOUNT_UUID_COLUMN}'))));`);
    // The rule finds a table that references a post, one for each kind of
    // flagged column (whatever its letter case), and one outside private; a
    // table with none of them is not flagged.
    const probe = "zz_coverage_guard_" + randomBytes(4).toString("hex");
    const probes = {
      ref: "post_id uuid references private.posts(id)",
      contact: "buyer_phone text",
      emailaddress: "email_address text",
      msisdn: "msisdn text",
      mobile: "mobile_number text",
      cell: "cell text",
      whatsapp: "whatsapp_number text",
      e164: "phone_e164 text",
      address: "home_address text",
      dob: "dob date",
      birth: "birth_date date",
      passport: "passport_number text",
      national: "national_id text",
      idnumber: "id_number text",
      bank: "account_number text",
      iban: "iban text",
      token: "reset_token text",
      secret: "client_secret text",
      hash: "document_hash text",
      lastfour: "card_last_four text",
      objectkey: "avatar_object_key text",
      name: "holder_name text",
      full: "full_name text",
      upper: '"Buyer_Email" text',
      ip: "ip_address text",
      sourceip: "source_ip text",
      hmac: "device_hmac text",
      author: "author_id uuid",
      creator: "created_by uuid",
      actor: "actor_id uuid",
      reviewer: "reviewer_id uuid",
      requested: "requested_by uuid",
      sender: "sender_id uuid",
      document: "payload jsonb",
      json: "payload json",
      documents: "payloads jsonb[]",
      network: "origin inet",
    };
    const plain = `${probe}_plain`;
    const outside = `public.${probe}_outside`;
    const probeTables = [
      ...Object.keys(probes).map((kind) => `private.${probe}_${kind}`),
      `private.${plain}`,
      outside,
    ];
    try {
      sql(
        Object.entries(probes)
          .map(
            ([kind, column]) =>
              `create table private.${probe}_${kind}(id integer primary key, ${column});`
          )
          .join("") +
          `create table private.${plain}(id integer primary key, label text, amount integer, ` +
          `post_ref uuid, created_at timestamptz);` +
          `create table ${outside}(id integer primary key, owner_id uuid);`
      );
      const found = linkedTables();
      for (const kind of Object.keys(probes))
        assert.ok(found.includes(`${probe}_${kind}`), `coverage rule misses ${probe}_${kind}`);
      assert.ok(found.includes(outside), "coverage rule misses a table outside private");
      assert.ok(!found.includes(plain), "coverage rule flags a table with no account data");
    } finally {
      sql(`drop table if exists ${probeTables.join(", ")};`);
    }
    const linked = linkedTables();
    // Every listed table exists; every reviewed one still matches the rule.
    assert.deepEqual(
      digested.filter(
        (table) => sql(`select to_regclass('${relation(table)}') is not null;`) !== "t"
      ),
      [],
      "digested table no longer exists"
    );
    assert.deepEqual(
      [...NOT_DIGESTED.keys()].filter((table) => !linked.includes(table)),
      [],
      "reviewed table no longer holds account data; remove it from NOT_DIGESTED"
    );
    assert.deepEqual(
      linked.filter((table) => !digested.includes(table) && !NOT_DIGESTED.has(table)),
      [],
      "table holding account data is neither digested nor reviewed"
    );
  });

  // ------------------------------------------------------ calling commands
  // One psql session for every call. vmtest.try runs one command as the given
  // role and JWT claims inside a subtransaction, catches its error, and (for
  // the sweep) fingerprints owner A's rows before and after it and rolls it
  // back, so every call sees the same world.
  // One jsonb_build_object per table (a function takes at most 100 arguments).
  const ownerDigest = OWNER_TABLES.map(
    ([table, where]) =>
      `jsonb_build_object('${table}',(select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from ${relation(table)} t where ${where.replaceAll("$1", "p_owner")}))`
  ).join("||");
  sql(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); mail text:=p_label||'-'||uid||'@example.invalid'; begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,mail,now(),jsonb_build_object('display_name','Fixture '||initcap(p_label)));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      return jsonb_build_object('id',uid,'session',sid,'email',mail);
    end$$;
    create function vmtest.staff(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;
    -- plpgsql keeps the plan of the digest query for the session.
    create function vmtest.digest(p_owner uuid) returns jsonb language plpgsql as $$
      begin return ${ownerDigest}; end $$;
    create function vmtest.try(p_role text,p_claims jsonb,p_call text,p_owner uuid) returns jsonb
    language plpgsql as $$
    declare v_data jsonb; v_ok boolean:=false; v_state text; v_message text; v_detail text; v_hint text;
      v_before jsonb; v_after jsonb; v_changed text[]:='{}';
    begin
      if p_owner is not null then v_before:=vmtest.digest(p_owner); end if;
      begin
        perform set_config('request.jwt.claims',coalesce(p_claims::text,''),true);
        perform set_config('request.jwt.claim.sub',coalesce(p_claims->>'sub',''),true);
        perform set_config('role',p_role,true);
        execute p_call into v_data;
        perform set_config('role','none',true);
        v_ok:=true;
        if p_owner is not null then
          v_after:=vmtest.digest(p_owner);
          select coalesce(array_agg(k order by k),'{}') into v_changed from jsonb_object_keys(v_before) k
            where v_before->k is distinct from v_after->k;
          raise exception using errcode='VMRB0';
        end if;
      exception
        when sqlstate 'VMRB0' then null;
        when others then
          get stacked diagnostics v_state=returned_sqlstate,v_message=message_text,
            v_detail=pg_exception_detail,v_hint=pg_exception_hint;
      end;
      return jsonb_build_object('ok',v_ok,'data',v_data,'code',v_state,'message',v_message,
        'details',v_detail,'hint',v_hint,'changed',to_jsonb(v_changed));
    end$$;`);

  session = openPsqlSession(database.name);
  const types = new Map(
    catalogue.map((fn) => [fn.name, new Map(fn.args.map((a) => [a.name, a.type]))])
  );
  const literal = (value, type) => {
    if (value === null || value === undefined) return `null::${type}`;
    if (type.endsWith("[]"))
      return `array[${value.map((v) => literal(v, type.slice(0, -2))).join(",")}]::${type}`;
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return `'${text.replaceAll("'", "''")}'::${type}`;
  };
  const callSql = (name, body) => {
    const argTypes = types.get(name);
    assert.ok(argTypes, `unknown command ${name}`);
    const args = Object.entries(body).map(([arg, value]) => {
      assert.ok(argTypes.has(arg), `${name} has no argument ${arg}`);
      return `${arg}=>${literal(value, argTypes.get(arg))}`;
    });
    return `select to_jsonb(api.${name}(${args.join(",")}))`;
  };
  const nowSeconds = () => Math.floor(Date.now() / 1000);
  // A principal's role and JWT claims, as PostgREST would set them.
  const claimsOf = (principal) => {
    if (principal === "service") return ["service_role", { role: "service_role" }];
    if (!principal) return ["anon", { role: "anon" }];
    const base = {
      sub: principal.id,
      role: "authenticated",
      email: principal.email,
      session_id: principal.session,
      aal: "aal1",
      is_anonymous: false,
    };
    // A recent sign-in is an amr entry, as GoTrue issues it.
    if (!principal.staff)
      return ["authenticated", { ...base, amr: [{ method: "password", timestamp: nowSeconds() }] }];
    return [
      "authenticated",
      {
        ...base,
        aal: "aal2",
        amr: [
          { method: "totp", timestamp: nowSeconds() },
          { method: "password", timestamp: nowSeconds() },
        ],
      },
    ];
  };
  const tag = "$vmcall" + randomBytes(4).toString("hex") + "$";
  const invoke = async (name, body, principal, ownerId = null) => {
    const [role, claims] = claimsOf(principal);
    const statement = callSql(name, body);
    assert.ok(!statement.includes(tag));
    const out = await session.exec(
      `select vmtest.try('${role}',${literal(claims, "jsonb")},${tag}${statement}${tag},${ownerId ? `'${ownerId}'` : "null"});`
    );
    return JSON.parse(out);
  };
  // PostgREST-shaped result for the shared fixtures: {status, data}.
  const statusOf = (result, role) => {
    if (result.ok) return 200;
    if (result.code === "42501") return role === "anon" ? 401 : 403;
    if (/^PT\d{3}$/.test(result.code)) return Number(result.code.slice(2));
    if (["23505", "23503", "40001"].includes(result.code)) return 409;
    if (result.code === "P0002") return 404;
    return 400;
  };
  const rpc = async (name, body, token, service = false) => {
    const principal = service ? "service" : (token ?? null);
    const result = await invoke(name, body, principal);
    const status = statusOf(result, claimsOf(principal)[0]);
    return {
      status,
      data: result.ok
        ? result.data
        : { code: result.code, message: result.message, details: result.details },
    };
  };
  const call = async (name, body, principal = owner, service = false) => {
    const response = await rpc(name, body, principal, service);
    assert.equal(response.status, 200, `${name}: ${JSON.stringify(response.data)}`);
    return response.data;
  };

  // ------------------------------------------------------------ the world
  const person = (label) => {
    const user = json(`select vmtest.member('${label}');`);
    user.token = user;
    return user;
  };
  const staffPerson = (label, role) => {
    const user = json(`select vmtest.staff('${label}','${role}');`);
    user.staff = true;
    user.token = user;
    user.refresh = async () => user;
    return user;
  };
  const reviewer = staffPerson("access-reviewer", "governor");
  const staff = Object.fromEntries(
    STAFF_ROLES.map((role) => [role, staffPerson(`access-${role}`, role)])
  );
  const owner = person("access-owner");
  const other = person("access-other");
  const unverified = person("access-unverified");
  const orgAdmin = person("access-org-admin");
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const surname = "Zq" + syntheticLetters();
  let world;
  const plans = (await call("billing_catalogue", {}, null)).plans;

  await check("world: owner A's private data through the production commands", async () => {
    const profile = await call("get_my_profile", {});
    await call("save_my_legal_name", {
      p_expected_revision: profile.revision,
      p_first_name: "Access",
      p_last_name: surname,
    });
    const verified = await fixture.ready(owner);
    await fixture.ready(other);
    await fixture.ready(orgAdmin);
    // Staff act on payments only with a current accepted ID review of their own.
    for (const role of STAFF_ROLES) await fixture.ready(staff[role]);
    await acceptPostingTerms(owner);
    const { live, buyer, business, org, orgSlug, programme, tokenHash, application } =
      await buildAccessOwnerWorld({
        call,
        sql,
        owner,
        // Staff review posts only with an accepted ID review of their own
        // (20261121143000_one_person_admin_mode.sql): the verified governor
        // approves the post; the identity reviewer stays unverified.
        reviewer: staff.governor,
        admin: staff.admin,
        orgAdmin,
        orgAdminEmail: orgAdmin.email,
        startsAt: new Date(Date.now() + 86400000),
        endsAt: new Date(Date.now() + 93600000),
      });
    const payment = await startPayment(owner);
    const one = (statement) => sql(statement).split("\n").filter(Boolean);
    const ids = {
      caseId: verified.caseId,
      submissionId: verified.submissionId,
      factId: verified.factId,
      proofId: verified.proofId,
      enquiryId: one(`select id from private.enquiries where owner_id='${owner.id}';`)[0],
      notificationId: one(
        `select id from private.notifications where account_id='${owner.id}' and kind='enquiry_received' order by created_at limit 1;`
      )[0],
      paymentId: payment,
      applicationId: application.id,
      businessDraftId: business.id,
    };
    one(
      `select id from private.evidence_artifacts where owner_id='${owner.id}' order by id;`
    ).forEach((id, index) => (ids["artifactId" + index] = id));
    for (const [name, value] of Object.entries(ids))
      assert.match(value ?? "", /^[a-f0-9-]{36}$/, name);
    world = { ids, live, business, org, orgSlug, programme, tokenHash, buyer, verified };
  });

  // Personal data A gives the updates' flows: a saved form draft, a privacy
  // request and a message to support (through the server's own commands).
  const extra = {
    draftNote: "Synthetic draft note " + syntheticLetters(),
    visitAddress: "Synthetic visit address " + syntheticLetters(),
    privacyName: "Requester " + syntheticLetters(),
    privacyDetails: "Synthetic privacy detail " + syntheticLetters(),
    supportName: "Supporter " + syntheticLetters(),
    supportMessage: "Synthetic support message " + syntheticLetters(),
    templateNote: "Synthetic template description " + syntheticLetters(),
  };
  await check("world: owner A's form draft, privacy request and support message", async () => {
    await call("frontend_form_draft", {
      p_flow: "listing",
      p_action: "save",
      p_step: 1,
      p_data: { note: extra.draftNote },
    });
    const request = await call(
      "record_frontend_privacy_request",
      {
        p_account: owner.id,
        p_session: owner.session,
        p_type: "access",
        p_name: extra.privacyName,
        p_last_four: null,
        p_details: extra.privacyDetails,
      },
      null,
      true
    );
    const ticket = await call(
      "submit_frontend_support",
      {
        p_name: extra.supportName,
        p_email: owner.email,
        p_category: "general_support",
        p_message: extra.supportMessage,
      },
      null,
      true
    );
    world.ids.privacyRequestId = request.id;
    world.ids.supportTicketId = ticket.id;
    // A post template (20261122191646_post_templates). Saving needs a running
    // Multi-listing package, which A does not hold, so it is written as the
    // database owner.
    world.ids.templateId = sql(
      `insert into private.post_templates(owner_id,name,data) values('${owner.id}','Synthetic template',
        jsonb_build_object('category','vehicles','description',${literal(extra.templateNote, "text")})) returning id;`
    ).trim();
    for (const name of ["privacyRequestId", "supportTicketId", "templateId"])
      assert.match(world.ids[name] ?? "", /^[a-f0-9-]{36}$/, name);
  });

  // Rows staff act on: a settled payment (so A holds an entitlement), a
  // business check with A's visit address, and another member's report about
  // A's live event.
  await check("world: owner A's paid slot, seen check and a report on A's post", async () => {
    const paid = await startPayment(owner);
    const lease = await call(
      "claim_checkout_request",
      { p_payment_id: paid, p_owner_id: owner.id },
      null,
      true
    );
    if (!lease.checkout_url)
      await call(
        "complete_checkout_request",
        {
          p_payment_id: paid,
          p_owner_id: owner.id,
          p_claim_token: lease.claim_token,
          p_request_id: `req-${paid}`,
          p_checkout_url: `https://one.ozow.com/checkout/req-${paid}`,
        },
        null,
        true
      );
    const row = json(
      `select jsonb_build_object('ref',merchant_reference,'amount',amount_cents) from private.payments where id='${paid}';`
    );
    const settled = await call(
      "apply_provider_event",
      {
        p_event: {
          payload_sha256: createHash("sha256").update(`event-${paid}-complete`).digest("hex"),
          merchant_reference: row.ref,
          provider_request_id: `req-${paid}`,
          provider_transaction_id: `tx-${paid}`,
          status: "complete",
          amount_cents: Number(row.amount),
          currency: "ZAR",
        },
      },
      null,
      true
    );
    assert.equal(settled.outcome, "completed");
    world.ids.paidPaymentId = paid;
    // Starting that checkout closed the earlier one; open a new pending
    // payment so the checkout commands still have one to act on.
    world.ids.paymentId = await startPayment(owner);
    const seen = await call("request_frontend_business_seen", {
      p_business: world.business.id,
      p_method: "visit",
      p_slots: ["Monday morning"],
      p_consent: true,
      p_address: extra.visitAddress,
    });
    world.seenCaseId = seen.caseId;
    const report = await call(
      "submit_frontend_report",
      {
        p_post_id: world.live.id,
        p_kind: "promotion",
        p_reason: "misleading",
        p_description: "Synthetic report about the event's details.",
        p_reporter_ip_hmac: randomBytes(32).toString("base64url"),
        p_reporter_id: other.id,
      },
      null,
      true
    );
    world.reportId = report.id;
    assert.ok(
      Number(sql(`select count(*) from private.entitlements where owner_id='${owner.id}';`)) > 0,
      "the settled payment grants an entitlement"
    );
    for (const value of [world.ids.paidPaymentId, world.seenCaseId, world.reportId])
      assert.match(value ?? "", /^[a-f0-9-]{36}$/);
  });

  // Another member's invoice whose bank transfer expired
  // (20261118044440_bank_transfer_expiry.sql). It belongs to `other`, not to
  // owner A, so the sweep's invoice commands show that only its own member
  // reads it, without adding A's details to staff payment lists.
  await check("world: another member's invoice with an expired bank transfer", async () => {
    const invoice = await call(
      "issue_staff_invoice",
      {
        p_account_email: other.email,
        p_term_days: 30,
        p_slots: 1,
        p_due_days: 7,
        p_reason: "Invoice requested by email",
        p_request_id: randomUUID(),
      },
      staff.admin
    );
    const transfer = await call(
      "record_staff_invoice_transfer",
      {
        p_invoice_number: invoice.invoice_number,
        p_bank_reference: "FNB MATRIX 0001",
        p_cleared_on: sql(
          "select to_char((now() at time zone 'Africa/Johannesburg')::date,'YYYY-MM-DD');"
        ),
        p_cooling_off_waiver: true,
        p_reason: "EFT cleared; written waiver on file",
      },
      staff.admin
    );
    sql(`set session_replication_role=replica;
      update private.invoice_transfers set recorded_at=now()-interval '15 days' where id='${transfer.transfer_id}';
      set session_replication_role=origin;`);
    const swept = await call("expire_waiting_bank_transfers", { p_limit: 50 }, null, true);
    assert.equal(swept.expired, 1);
    world.otherInvoice = invoice.invoice_number;
    world.otherTransfer = transfer.transfer_id;
  });

  // Owner A's private values. Phone numbers are matched on their last nine
  // digits so a reformatted number is still caught.
  const canaries = {
    ...extra,
    ...world.ids,
    surname,
    ownerEmail: owner.email,
    ownerPhone: world.verified.phone.slice(-9),
    buyerEmail: world.buyer.email,
    buyerPhone: world.buyer.phone.slice(-9),
    buyerName: world.buyer.name,
    buyerMessage: world.buyer.message,
  };
  const leaks = (text, sent) =>
    Object.entries(canaries)
      .filter(([, value]) => text.includes(value) && !sent.includes(value))
      .map(([name]) => name);

  await check("world: owner A reads their own data, so the probes are detectable", async () => {
    const ownView = [
      await call("get_my_profile", {}),
      await call("list_my_enquiries", {}),
      await call("list_my_notifications", {}),
      await call("get_owner_post_contacts", { p_post_id: world.live.id }),
      await call("get_owner_verification_readiness", {}),
      await call("frontend_form_draft", { p_flow: "listing", p_action: "read" }),
      await call("list_my_post_templates", {}),
    ]
      .map((value) => JSON.stringify(value))
      .join("");
    for (const name of [
      "draftNote",
      "templateNote",
      "surname",
      "buyerEmail",
      "buyerPhone",
      "buyerMessage",
      "enquiryId",
      "notificationId",
    ])
      assert.ok(leaks(ownView, "").includes(name), "owner view lacks " + name);
  });

  // The fingerprint tables that hold rows of owner A once the world is built.
  // Each recorded one must keep at least one row, so a filter that stops
  // matching A cannot leave its table fingerprinted as empty.
  const recorded = JSON.parse(readFileSync(EXERCISED_FILE, "utf8"));
  const writeRecord = process.argv.includes("--write-exercised");
  let nonEmptyOwnerTables = [];
  await check("world: the recorded fingerprint tables hold rows of owner A", () => {
    const counts = json(
      `select ${OWNER_TABLES.map(
        ([table, where]) =>
          `jsonb_build_object('${table}',(select count(*) from ${relation(table)} t where ${where.replaceAll("$1", `'${owner.id}'`)}))`
      ).join("||")};`
    );
    nonEmptyOwnerTables = OWNER_TABLES.map(([table]) => table).filter((table) => counts[table] > 0);
    if (writeRecord) return;
    assert.deepEqual(
      recorded.nonEmptyOwnerTables.filter((table) => !nonEmptyOwnerTables.includes(table)),
      [],
      "fingerprint tables with no rows of owner A"
    );
    const added = nonEmptyOwnerTables.filter(
      (table) => !recorded.nonEmptyOwnerTables.includes(table)
    );
    if (added.length) console.log(`Also non-empty now (add with --write-exercised): ${added}`);
  });

  // ------------------------------------------------------------ arguments
  const { ids, live, business, org, orgSlug, programme, tokenHash } = world;
  const revisionOf = (id) =>
    Number(
      sql(
        `select coalesce((select revision from private.posts where id='${id}'),(select revision from private.organisations where id='${id}'),` +
          `(select revision from private.privacy_requests where id='${id}'),(select revision from private.support_tickets where id='${id}'),1);`
      )
    );
  const caseVersion = () =>
    Number(sql(`select version from private.evidence_cases where id='${ids.caseId}';`));
  const mediaIds = sql(
    `select id from private.media_objects where owner_id='${owner.id}' order by id;`
  )
    .split("\n")
    .filter(Boolean);
  const entitlementIds = sql(
    `select id from private.entitlements where owner_id='${owner.id}' order by id;`
  )
    .split("\n")
    .filter(Boolean);
  const uuidCandidates = (name) =>
    ({
      p_post_id: [live.id, business.id],
      p_post: [live.id],
      p_id: [live.id, business.id, org.id],
      p_post_a: [live.id],
      p_post_b: [business.id],
      p_target_post: [live.id],
      p_business: [business.id],
      p_case: [ids.caseId, ids.privacyRequestId, world.seenCaseId],
      p_report: [world.reportId],
      p_report_id: [world.reportId],
      p_ticket: [ids.supportTicketId],
      p_case_id: [ids.caseId],
      p_submission: [ids.submissionId],
      p_artifact: [ids.artifactId0],
      p_artifact_id: [ids.artifactId0],
      p_id_artifact: [ids.artifactId0],
      p_selfie_artifact: [ids.artifactId1],
      p_owner: [owner.id],
      p_owner_id: [owner.id],
      p_account: [owner.id],
      p_account_id: [owner.id],
      p_user_id: [owner.id],
      p_subject_id: [owner.id],
      p_sender: [owner.id],
      p_reporter_id: [owner.id],
      p_expected_account: [owner.id],
      p_session: [owner.session],
      p_application: [ids.applicationId],
      p_org: [org.id],
      p_programme: [programme.id],
      p_payment_id: [ids.paymentId, ids.paidPaymentId],
      p_object_id: mediaIds.slice(0, 2),
      p_fact: [ids.factId],
      p_challenge: [randomUUID()],
      p_product_id: [plans[0]?.id ?? randomUUID()],
      p_plan_id: [plans[0]?.id ?? randomUUID()],
      p_entitlement_id: entitlementIds.slice(0, 1),
      p_before_id: [ids.enquiryId],
      p_template: [ids.templateId],
    })[name] ?? [randomUUID()];
  const textValue = (name) =>
    ({
      p_subject: "post",
      p_purpose: "routine_review",
      p_claim_generation: "1",
      p_status: "read",
      p_action: "withdraw",
      p_decision: "approve",
      p_slug: orgSlug,
      p_organisation_slug: orgSlug,
      p_token_hash: tokenHash,
      p_kind: "listing",
      p_queue: "posts",
      p_outcome: "dismissed",
      p_view: "open",
      p_tab: "review",
      p_category: "other",
      p_email: owner.email,
      p_account_email: owner.email,
      p_phone: world.verified.phone,
      p_invoice_number: world.otherInvoice,
      // The current ID check consent words
      // (20261124235920_identity_check_consent.sql), so every principal's
      // start reaches the checks after the consent.
      p_consent_version: "identity-check-consent-v1",
    })[name] ?? "Synthetic access sweep value";
  const bodies = (fn) =>
    sweepBodies(fn, {
      uuids: uuidCandidates,
      uuidArray: (name) =>
        ({
          p_ids: [ids.notificationId],
          p_payment_ids: [ids.paymentId],
          p_entitlement_ids: entitlementIds,
        })[name] ?? [live.id, business.id],
      text: textValue,
      integer: (name, body) =>
        sweepInteger(name, body, {
          caseVersion,
          revisionOf,
          // Privacy requests (p_case) and support tickets carry their own
          // revision; an evidence case has none, so it falls back to 1.
          revisionTarget: (target) =>
            target.p_post_id ??
            target.p_id ??
            target.p_post ??
            target.p_ticket ??
            target.p_case ??
            live.id,
          fixed: { p_offset: 0 },
        }),
      typed: (arg) =>
        ({
          bigint: [100],
          numeric: [null],
          "text[]": [["Synthetic access sweep value"]],
        })[arg.type],
    });

  // ---------------------------------------------------------------- sweep
  const principals = {
    anon: null,
    unverified,
    other,
    orgAdmin,
    ...staff,
    owner,
    service: "service",
  };
  const outcomes = new Map();
  const views = [];
  const changes = [];
  const bodyCache = new Map(catalogue.map((fn) => [fn.name, bodies(fn)]));
  let calls = 0;
  let sweepSeconds = 0;
  await check("sweep: every api command as every principal", async () => {
    const sweepStarted = Date.now();
    for (const [label, principal] of Object.entries(principals)) {
      for (const fn of catalogue) {
        const results = [];
        for (const body of bodyCache.get(fn.name)) {
          const result = await invoke(fn.name, body, principal, owner.id);
          calls++;
          results.push(result);
          if (label === "owner" || label === "service") continue;
          const seen = JSON.stringify([result.data, result.message, result.details, result.hint]);
          for (const name of leaks(seen, JSON.stringify(body)))
            views.push(`${label}:${fn.name}:${name}`);
          for (const table of result.changed) changes.push(`${label}:${fn.name}:${table}`);
        }
        outcomes.set(`${label}:${fn.name}`, results);
      }
    }
    sweepSeconds = Math.round((Date.now() - sweepStarted) / 1000);
  });

  const grantRefusal = (r) =>
    !r.ok && r.code === "42501" && /permission denied for function/.test(r.message);

  // 20261118044440_bank_transfer_expiry.sql: the sweep is the service role's
  // only; the member read answers only the invoice's own member; the staff
  // list needs payments:view (checked with every capability below).
  await check("bank transfer expiry: the sweep and the member read are scoped", () => {
    for (const label of Object.keys(principals)) {
      const sweep = outcomes.get(`${label}:expire_waiting_bank_transfers`);
      if (label === "service")
        assert.ok(
          sweep.every((r) => r.ok),
          "service sweep refused"
        );
      else assert.ok(sweep.every(grantRefusal), `${label} ran the sweep`);
      const read = outcomes.get(`${label}:get_my_invoice_transfer_expiry`);
      if (label === "anon" || label === "service")
        assert.ok(read.every(grantRefusal), `${label} read an invoice`);
      else if (label === "other") {
        assert.ok(
          read.every((r) => r.ok),
          "the invoice's member was refused"
        );
        for (const r of read) {
          assert.equal(r.data.invoice_number, world.otherInvoice);
          assert.match(r.data.transfer_expired_at ?? "", /^\d{4}-\d{2}-\d{2}T/);
        }
      } else
        assert.ok(
          read.every((r) => !r.ok && r.code === "PT404"),
          `${label} read another member's invoice`
        );
    }
    const listed = outcomes.get("admin:get_staff_expired_invoice_transfers");
    assert.ok(
      listed.some((r) => r.ok && r.data.items.some((t) => t.transfer_id === world.otherTransfer)),
      "staff list lacks the expired transfer"
    );
  });
  await check("grants: each principal is refused exactly the commands it cannot execute", () => {
    for (const fn of catalogue)
      for (const label of Object.keys(principals)) {
        const results = outcomes.get(`${label}:${fn.name}`);
        const allowed =
          label === "anon" ? fn.anon : label === "service" ? fn.service : fn.authenticated;
        if (allowed) assert.ok(!results.some(grantRefusal), `${label} refused ${fn.name}`);
        else assert.ok(results.every(grantRefusal), `${label} executed ${fn.name}`);
      }
  });

  // Each staff role is refused exactly the commands whose capability it lacks,
  // as read from private.staff_capabilities; a role holding the capability
  // always gets past the capability check. Capabilities are read from the
  // command's own body and every internal function it reaches.
  const granted = json(
    "select json_object_agg(role,caps) from (select role,json_agg(capability) caps from private.staff_capabilities group by role) r;"
  );
  const capabilities = json(`with recursive fns as (
      select p.oid,n.nspname,p.proname,p.prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('api','internal')),
    edges as (select distinct f.oid src,g.oid dst from fns f
      cross join lateral regexp_matches(f.prosrc,'internal[.]([a-z0-9_]+)','g') m
      join fns g on g.nspname='internal' and g.proname=m[1]),
    reach(root,oid) as (select oid,oid from fns where nspname='api'
      union select r.root,e.dst from reach r join edges e on e.src=r.oid)
    select coalesce(json_object_agg(a.proname,c.caps),'{}') from (
      select r.root,array_agg(distinct m[1] order by m[1]) caps from reach r join fns f on f.oid=r.oid
      cross join lateral regexp_matches(f.prosrc,'staff_actor[(]''([a-z_:]+)''[)]','g') m group by r.root) c
    join fns a on a.oid=c.root;`);
  // Capabilities checked directly by the command (its api body or the
  // internal function of the same name), as the prototype matrix reads them.
  const directCapabilities =
    json(`select coalesce(json_object_agg(a.proname,c.caps),'{}') from pg_proc a
    join pg_namespace an on an.oid=a.pronamespace and an.nspname='api'
    cross join lateral (select array_agg(distinct m[1] order by m[1]) caps from pg_proc p
      join pg_namespace n on n.oid=p.pronamespace and (p.oid=a.oid or (n.nspname='internal' and p.proname=a.proname))
      cross join lateral regexp_matches(p.prosrc,'staff_actor[(]''([a-z_:]+)''[)]','g') m) c
    where c.caps is not null;`);
  const capabilityRefusal = (r) =>
    !r.ok && r.code === "42501" && r.message === "capability not granted";
  let capabilityChecks = 0;
  await check("staff: capability checks hold for every staff command", () => {
    for (const fn of catalogue) {
      const caps = capabilities[fn.name];
      const direct = directCapabilities[fn.name];
      if (!fn.authenticated || !caps) continue;
      for (const role of STAFF_ROLES) {
        const results = outcomes.get(`${role}:${fn.name}`);
        const held = (direct ?? []).filter((cap) => granted[role].includes(cap));
        if (caps.every((cap) => granted[role].includes(cap)))
          assert.ok(!results.some(capabilityRefusal), `${role} refused ${fn.name}`);
        // A role holding none of the command's own capabilities is refused
        // every call by the capability check.
        else if (direct?.length && !held.length)
          assert.ok(results.every(capabilityRefusal), `${role} lacks ${direct} for ${fn.name}`);
        // A role holding only some of them never succeeds, unless the command
        // checks the others on a reviewed branch only.
        else if (direct?.length && !PARTIAL_CAPABILITY_BRANCHES.has(`${role}:${fn.name}`))
          assert.ok(
            results.every((r) => !r.ok),
            `${role} succeeded at ${fn.name} holding only ${held} of ${direct}`
          );
        else continue;
        capabilityChecks++;
      }
      // Members are never let through a staff check.
      for (const label of ["unverified", "other", "orgAdmin", "owner"])
        if (direct?.length && !MEMBER_WITH_STAFF_BRANCH.has(fn.name))
          assert.ok(
            outcomes.get(`${label}:${fn.name}`).every((r) => !r.ok),
            `${label} passed the staff check of ${fn.name}`
          );
    }
    assert.ok(capabilityChecks >= 100, String(capabilityChecks));
  });

  await check("views: no non-owner sees owner A's private values", () => {
    const unexpected = [...new Set(views)].filter((entry) => !ALLOWED_VIEWS.has(entry)).sort();
    assert.deepEqual(unexpected, []);
    for (const entry of ALLOWED_VIEWS.keys())
      assert.ok(views.includes(entry), `reviewed view no longer observed: ${entry}`);
  });

  await check("changes: no non-owner changes owner A's data", () => {
    const unexpected = [...new Set(changes)]
      .filter((entry) => !ALLOWED_CHANGES.has(entry))
      .filter((entry) => {
        const [label, name] = entry.split(":");
        if (!STAFF_ROLES.includes(label)) return true;
        const direct = directCapabilities[name] ?? [];
        return !direct.length || !direct.every((cap) => granted[label].includes(cap));
      })
      .sort();
    assert.deepEqual(unexpected, []);
    for (const entry of ALLOWED_CHANGES.keys())
      assert.ok(changes.includes(entry), `reviewed change no longer observed: ${entry}`);
  });

  let intendedOk = 0;
  const exercised = [];
  await check("intended principal: never refused by a grant or a staff check", () => {
    for (const fn of catalogue) {
      const caps = capabilities[fn.name];
      const label = fn.service
        ? "service"
        : fn.anon
          ? "anon"
          : caps
            ? (STAFF_ROLES.find((role) => caps.every((cap) => granted[role].includes(cap))) ??
              "admin")
            : "owner";
      const results = outcomes.get(`${label}:${fn.name}`);
      if (results.some((r) => r.ok)) exercised.push(fn.name);
      assert.ok(
        !results.some(
          (r) => grantRefusal(r) || (!r.ok && STAFF_SESSION_REFUSALS.includes(r.message))
        ),
        `${label} refused ${fn.name}`
      );
    }
    intendedOk = exercised.length;
    if (writeRecord)
      writeFileSync(
        EXERCISED_FILE,
        `${JSON.stringify({ commands: exercised, nonEmptyOwnerTables }, null, 2)}\n`
      );
    const listed = writeRecord ? exercised : recorded.commands;
    assert.deepEqual(
      listed.filter((name) => !exercised.includes(name)),
      [],
      "commands the sweep no longer exercises"
    );
    const added = exercised.filter((name) => !listed.includes(name));
    if (added.length) console.log(`Also exercised now (add with --write-exercised): ${added}`);
  });

  console.log(
    JSON.stringify(
      {
        updates: updates.length,
        commands: catalogue.length,
        anon: ANON.length,
        member: MEMBER.length,
        service: SERVICE.length,
        principals: Object.keys(principals),
        calls,
        sweepSeconds,
        capabilityChecks,
        intendedOk,
        reviewedViews: [...ALLOWED_VIEWS.keys()],
        reviewedChanges: [...ALLOWED_CHANGES.keys()],
        checks: passed.length,
        seconds: Math.round((Date.now() - started) / 1000),
      },
      null,
      2
    )
  );

  // ------------------------------------------------------------- helpers
  async function acceptPostingTerms(member) {
    const terms = await call("get_current_posting_terms", {}, member);
    await call(
      "accept_posting_terms",
      { p_version: terms.version, p_document_hash: terms.document_hash },
      member
    );
  }
  async function startPayment(member) {
    const plan = plans.find((p) => p.code === "individual_30d");
    const quoted = await call(
      "start_slot_checkout",
      {
        p_plan_id: plan.id,
        p_slots: 1,
        p_expected_total_cents: Number(plan.price_cents),
        p_cooling_off_consent: true,
      },
      member
    );
    return quoted.payment_id;
  }
} finally {
  session?.close();
  database.stop();
}

/** A long-lived psql session in the lint container; exec(sql) resolves with
 * the statement's output (one line per call, as vmtest.try returns). */
function openPsqlSession(name) {
  const child = spawn(
    "docker",
    ["exec", "-i", name, "psql", "-X", "-q", "-A", "-t", "-U", "postgres", "-d", "postgres"],
    { windowsHide: true }
  );
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let out = "";
  let err = "";
  let waiting = null;
  let sequence = 0;
  const settle = () => {
    if (!waiting) return;
    const at = out.indexOf(waiting.marker + "\n");
    if (at < 0) return;
    const body = out.slice(0, at).replace(/\r/g, "").trim();
    out = out.slice(at + waiting.marker.length + 1);
    const { resolve, reject } = waiting;
    waiting = null;
    if (!body) reject(new Error(`psql returned nothing: ${err.trim()}`));
    else resolve(body);
    err = "";
  };
  child.stdout.on("data", (chunk) => {
    out += chunk;
    settle();
  });
  child.stderr.on("data", (chunk) => {
    err += chunk;
  });
  return {
    exec: (statement) =>
      new Promise((resolve, reject) => {
        const marker = `@@vm-access-${++sequence}`;
        waiting = { marker, resolve, reject };
        child.stdin.write(`${statement}\n\\echo ${marker}\n`);
      }),
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}
