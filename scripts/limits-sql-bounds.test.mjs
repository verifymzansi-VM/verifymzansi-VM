// Database limits from docs/testing/limits-register.json that guard a
// command's input, exercised at their bound on the replayed production schema
// (scripts/lib/limits-sql-harness.mjs: embedded Postgres, no Docker, no hosted
// database).
//
// One table, one row per limit (or per register entry sharing a guard line):
// the command is called through the production API as the role that uses it
// (a member, a staff member with a fresh second factor, the service role or a
// visitor; internal helpers no API role may call run as the database owner).
//   - every `at` value passes the guard: the call succeeds, or, with `then`,
//     fails later with that different error (the guard let it through);
//   - every `over` value is refused by the guard, with its error code (22023
//     unless `code` says otherwise) and message.
// Each value gets fresh synthetic users, so earlier calls cannot interfere.
//
//   node --import tsx --test scripts/limits-sql-bounds.test.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { emailOfLength, lit, openLimitsDb, refused } from "./lib/limits-sql-harness.mjs";

let h;
before(async () => {
  h = await openLimitsDb();
});
after(async () => {
  await h?.db.close();
});

const text = (n, ch = "a") => lit(ch.repeat(n));
const uuid = () => lit(randomUUID());
const uuids = (n) =>
  n === 0 ? "'{}'::uuid[]" : `array[${Array.from({ length: n }, uuid).join(",")}]::uuid[]`;
const texts = (values) =>
  values.length === 0 ? "'{}'::text[]" : `array[${values.map(lit).join(",")}]::text[]`;
const json = (value) => `${lit(JSON.stringify(value))}::jsonb`;
/** A JSON object `{ [key]: "aaa…" }` whose jsonb text is exactly `bytes` long. */
const sizedObject = (bytes, key = "pad", extra = {}) => {
  const empty = Buffer.byteLength(jsonbText({ ...extra, [key]: "" }));
  return { ...extra, [key]: "a".repeat(bytes - empty) };
};
// jsonb's text form: ", " between members and ": " after keys, keys ordered by
// length then bytes. Only simple string values are used here.
const jsonbText = (object) =>
  `{${Object.keys(object)
    .sort((a, b) => a.length - b.length || (a < b ? -1 : 1))
    .map((k) => `${JSON.stringify(k)}: ${JSON.stringify(object[k])}`)
    .join(", ")}}`;
let category;
/** The first listing category (and an activity when it needs one). */
const listingCategory = async () =>
  (category ??= (
    await h.db.query(`select c.category_key as key,
        (select a.key from private.category_activities a join private.categories k on k.key=a.category_key
          where a.category_key=c.category_key and k.activity_required order by a.key limit 1) as activity
      from private.post_category_contracts c where c.kind='listing' and c.area='market' order by c.category_key limit 1`)
  ).rows[0]);
const fingerprint = (n) => `${String(n).padStart(42, "f").slice(-42)}A`;

const MAIL_KINDS = [
  "payment_completed",
  "payment_reversed",
  "payment_reconciliation_required",
  "trial_started",
  "post_expired",
  "post_expiry_reminder",
  "draft_deletion_warning",
  "post_deleted",
  "verification_phone_confirmed",
  "identity_accepted",
  "enquiry_received",
  "account_warning",
  "content_hidden",
  "account_suspended",
  "account_banned",
  "appeal_decided",
  "business_check_update",
  "post_sold",
  "post_kept",
  "verification_returned",
  "slot_renewal_reminder",
  "term_ending_notice",
  "free_credit_reminder",
];
const batch = (id, command, max, error) => ({
  id,
  as: "service",
  sql: (v) => `select api.${command}(${v})`,
  at: [1, max],
  over: [0, max + 1],
  error,
});
const ownerBatch = (id, fn, max, error) => ({
  ...batch(id, fn, max, error),
  as: "owner",
  sql: (v) => `select internal.${fn}(${v})`,
});

// ---------------------------------------------------------------- the table

const ROWS = [
  // Service-role sweeps and claims: the batch size.
  batch("LIM-F-approve_due_commissions", "approve_due_commissions", 1000, /limit 1 to 1000/),
  batch("LIM-F-claim_evidence_cleanup", "claim_evidence_cleanup", 100, /limit 1 to 100/),
  batch("LIM-F-claim_media_cleanup", "claim_media_cleanup", 500, /limit 1 to 500/),
  batch("LIM-F-claim_notification_outbox", "claim_notification_outbox", 50, /invalid limit/),
  batch(
    "LIM-F-claim_ozow_refund_checks",
    "claim_ozow_refund_checks",
    20,
    /invalid refund check limit/
  ),
  batch("LIM-F-claim_payment_alerts", "claim_payment_alerts", 50, /invalid payment alert limit/),
  batch(
    "LIM-F-expire_stale_checkouts",
    "expire_stale_checkouts",
    500,
    /invalid checkout sweep limit/
  ),
  batch(
    "LIM-F-expire_waiting_bank_transfers",
    "expire_waiting_bank_transfers",
    50,
    /limit 1 to 50/
  ),
  batch(
    "LIM-F-list_ozow_refund_sends_due",
    "list_ozow_refund_sends_due",
    20,
    /invalid refund send limit/
  ),
  batch(
    "LIM-F-list_reconcilable_payments",
    "list_reconcilable_payments",
    50,
    /invalid reconciliation limit/
  ),
  batch(
    "LIM-F-purge_expired_identity_bans",
    "purge_expired_identity_bans",
    5000,
    /limit 1 to 5000/
  ),
  batch("LIM-F-purge_expired_inbox", "purge_expired_inbox", 5000, /limit 1 to 5000/),
  batch(
    "LIM-F-purge_expired_trial_identities",
    "purge_expired_trial_identities",
    5000,
    /limit 1 to 5000/
  ),
  batch(
    "LIM-F-purge_frontend_form_drafts",
    "purge_frontend_form_drafts",
    1000,
    /bounded draft cleanup required/
  ),
  batch("LIM-F-reconcile_intro_trials", "reconcile_intro_trials", 100, /invalid limit/),
  batch("LIM-F-run_post_lifecycle", "run_post_lifecycle", 5000, /limit 1 to 5000/),
  batch("LIM-F-run_retention", "run_retention", 5000, /limit 1 to 5000/),
  batch("LIM-F-run_slot_renewals", "run_slot_renewals", 5000, /limit 1 to 5000/),
  batch("LIM-F-sweep_sponsorships", "sweep_sponsorships", 1000, /limit 1 to 1000/),
  batch(
    "LIM-F-void_ended_package_add_invoices",
    "void_ended_package_add_invoices",
    500,
    /limit must be 1 to 500/
  ),
  ownerBatch("LIM-F-purge_capture_handoffs", "purge_capture_handoffs", 5000, /limit 1 to 5000/),
  ownerBatch("LIM-F-purge_member_invitations", "purge_member_invitations", 5000, /limit 1 to 5000/),
  ownerBatch("LIM-F-run_account_erasures", "run_account_erasures", 100, /limit 1 to 100/),
  {
    id: "LIM-F-claim_payment_digest",
    as: "service",
    sql: ([hour, limit]) => `select api.claim_payment_digest(${hour},${limit})`,
    at: [
      [0, 1],
      [23, 50],
    ],
    over: [
      [-1, 1],
      [24, 1],
      [0, 0],
      [0, 51],
    ],
    error: /invalid payment summary request/,
  },
  {
    // 23 kinds are supported; a 24th (unknown) kind is refused by the count
    // before the unknown-kind rule ("unsupported mail kind") sees it.
    id: "LIM-F-claim_supported_notification_outbox",
    as: "service",
    sql: (kinds) => `select api.claim_supported_notification_outbox(${texts(kinds)},20)`,
    at: [MAIL_KINDS.slice(0, 1), MAIL_KINDS],
    over: [[], [...MAIL_KINDS, "unknown_kind"]],
    error: /supported mail kinds required/,
  },
  {
    id: "LIM-F-claim_supported_notification_outbox-2",
    as: "service",
    sql: (v) => `select api.claim_supported_notification_outbox(${texts(MAIL_KINDS)},${v})`,
    at: [1, 50],
    over: [0, 51],
    error: /invalid limit/,
  },

  // Service-role commands: lengths, sizes and counts of what the worker sends.
  {
    id: "LIM-F-complete_checkout_request",
    as: "service",
    sql: ([request, url]) =>
      `select api.complete_checkout_request(${uuid()},${uuid()},${uuid()},${text(request)},${lit(`https://${"a".repeat(url - 8)}`)})`,
    at: [
      [1, 10],
      [100, 4096],
    ],
    then: /pending checkout unavailable/,
    over: [
      [0, 10],
      [101, 10],
      [1, 9],
      [1, 4097],
    ],
    error: /invalid checkout response/,
  },
  {
    id: "LIM-F-create_verification_phone_challenge",
    as: "service",
    sql: (n, { user }) =>
      `select api.create_verification_phone_challenge(${lit(user.id)},'+27721009998',${text(n, "h")})`,
    at: [16, 512],
    over: [15, 513],
    error: /valid phone challenge required/,
  },
  {
    id: "LIM-F-get_frontend_cipc_preview_context",
    as: "service",
    sql: (n, { user }) =>
      `select api.get_frontend_cipc_preview_context(${lit(user.id)},${lit(user.session)},${uuid()},${texts(Array.from({ length: n }, (_, i) => fingerprint(i)))})`,
    at: [100],
    then: /reviewed business owner identity required/,
    over: [101],
    error: /bounded document fingerprints required/,
  },
  {
    id: "LIM-F-record_frontend_cipc_parse",
    as: "service",
    sql: (n, { user }) =>
      `select api.record_frontend_cipc_parse(${lit(user.id)},${lit(user.session)},${uuid()},${json(sizedObject(n, "findings"))},'[]'::jsonb)`,
    at: [50000],
    then: /CIPC upload unavailable/,
    over: [50001],
    error: /validated CIPC parse receipt required/,
  },
  {
    id: "LIM-F-record_frontend_cipc_parse-2",
    as: "service",
    sql: (n, { user }) =>
      `select api.record_frontend_cipc_parse(${lit(user.id)},${lit(user.session)},${uuid()},'{}'::jsonb,${json(Array.from({ length: n }, () => ({})))})`,
    at: [100],
    then: /CIPC upload unavailable/,
    over: [101],
    error: /validated CIPC parse receipt required/,
  },
  {
    // One string director entry: the array's text is its length plus 4
    // (["…"]).
    id: "LIM-F-record_frontend_cipc_parse-3",
    as: "service",
    sql: (n, { user }) =>
      `select api.record_frontend_cipc_parse(${lit(user.id)},${lit(user.session)},${uuid()},'{}'::jsonb,${json(["a".repeat(n - 4)])})`,
    at: [35000],
    then: /CIPC upload unavailable/,
    over: [35001],
    error: /validated CIPC parse receipt required/,
  },
  {
    id: "LIM-F-record_payment_problem",
    as: "service",
    sql: (n) =>
      `select api.record_payment_problem(null,'unknown_payment','notice',true,${text(n)})`,
    at: [1, 100],
    over: [0, 101],
    error: /invalid payment problem/,
  },
  {
    id: "LIM-F-reverse_payment",
    as: "service",
    sql: (n) => `select api.reverse_payment(${uuid()},'refunded',${text(n)})`,
    at: [5, 500],
    then: /only completed payments can be reversed/,
    over: [4, 501],
    error: /reversal kind and audit reason required/,
  },
  {
    id: "LIM-F-reconcile_ozow_refunds",
    as: "service",
    sql: (n) => `select api.reconcile_ozow_refunds(${json(Array.from({ length: n }, () => ({})))})`,
    at: [2000],
    then: /valid Ozow refund required/,
    over: [2001],
    error: /up to 2000 Ozow refunds required/,
  },
  {
    id: "LIM-F-stage_frontend_post_command",
    as: "service",
    sql: (n, { user }) => {
      const request = randomUUID();
      return `select api.stage_frontend_post_command(${lit(user.id)},${lit(request)},${text(64, "d")},${json(sizedObject(n, "pad", { request_id: request }))})`;
    },
    at: [131072],
    over: [131073],
    error: /validated form command required/,
  },
  {
    id: "LIM-F-submit_frontend_support",
    as: "service",
    sql: (n) =>
      `select api.submit_frontend_support('Fixture Person',${lit(emailOfLength(n))},'general_support','A synthetic support message.')`,
    at: [254],
    over: [255],
    error: /check support recipient and category/,
  },
  {
    id: "LIM-F-start_frontend_cipc_email-2",
    as: "service",
    sql: (n, { user }) =>
      `select api.start_frontend_cipc_email(${lit(user.id)},${lit(user.session)},${uuid()},${uuid()},${lit(emailOfLength(n))},'Director',${text(64, "d")})`,
    at: [254],
    then: /CIPC case unavailable/,
    over: [255],
    error: /valid work email required/,
  },

  // Members: page sizes, id lists and text lengths.
  {
    id: "LIM-F-dismiss_my_notifications",
    as: "member",
    sql: (n) => `select api.dismiss_my_notifications(${uuids(n)})`,
    at: [1, 100],
    over: [0, 101],
    error: /invalid notification ids/,
  },
  {
    id: "LIM-F-mark_my_notifications_read",
    as: "member",
    sql: (n) => `select api.mark_my_notifications_read(${uuids(n)})`,
    at: [1, 100],
    over: [0, 101],
    error: /invalid notification ids/,
  },
  {
    id: "LIM-F-get_frontend_affiliation_workspace",
    as: "member",
    sql: (n) => `select api.get_frontend_affiliation_workspace(${text(n)})`,
    at: [3, 60],
    over: [2, 61],
    error: /valid organisation slug required/,
  },
  {
    id: "LIM-F-get_frontend_organisation_dashboard",
    as: "member",
    sql: (n) => `select api.get_frontend_organisation_dashboard(${text(n)})`,
    at: [3, 60],
    over: [2, 61],
    error: /valid organisation slug required/,
  },
  {
    id: "LIM-F-list_my_email_history",
    as: "member",
    sql: (n) => `select api.list_my_email_history(${n})`,
    at: [1, 50],
    over: [0, 51],
    error: /invalid limit/,
  },
  {
    id: "LIM-F-list_my_frontend_notices",
    as: "member",
    sql: (n) => `select api.list_my_frontend_notices(${n},false,null)`,
    at: [1, 50],
    over: [0, 51],
    error: /invalid notification query/,
  },
  {
    id: "LIM-F-list_my_frontend_notifications",
    as: "member",
    sql: (n) => `select api.list_my_frontend_notifications(${n},false,null)`,
    at: [1, 50],
    over: [0, 51],
    error: /invalid notification query/,
  },
  ...[
    ["LIM-F-list_my_frontend_posts", "list_my_frontend_posts"],
    ["LIM-F-list_my_frontend_posts_v2", "list_my_frontend_posts_v2"],
  ].map(([id, fn]) => ({
    id,
    as: "member",
    sql: (n) => `select api.${fn}('listing',null,${n},0)`,
    at: [1, 100],
    over: [0, 101],
    error: /bounded owner post query required/,
  })),
  ...[
    ["LIM-F-list_my_frontend_posts-2", "list_my_frontend_posts"],
    ["LIM-F-list_my_frontend_posts_v2-2", "list_my_frontend_posts_v2"],
  ].map(([id, fn]) => ({
    id,
    as: "member",
    sql: (n) => `select api.${fn}('listing',null,100,${n})`,
    at: [0, 100000],
    over: [-1, 100001],
    error: /bounded owner post query required/,
  })),
  {
    id: "LIM-F-list_my_posts",
    as: "member",
    sql: ([limit, offset]) => `select api.list_my_posts(${limit},${offset})`,
    at: [
      [1, 0],
      [100, 100000],
    ],
    over: [
      [0, 0],
      [101, 0],
      [1, -1],
      [1, 100001],
    ],
    error: /invalid page/,
  },
  {
    id: "LIM-F-manage_plan_member",
    as: "member",
    sql: (n) => `select api.manage_plan_member(${uuid()},'add',${text(n)})`,
    at: [3, 254],
    then: /shared plan unavailable/,
    over: [2, 255],
    error: /invalid member command/,
  },
  {
    id: "LIM-F-record_my_acquisition",
    as: "member",
    sql: (n) =>
      `select api.record_my_acquisition('{}'::jsonb,p_landing_path=>${lit(`/${"a".repeat(n - 1)}`)})`,
    at: [300],
    over: [301],
    error: /invalid attribution/,
  },
  {
    id: "LIM-F-record_my_acquisition-2",
    as: "member",
    sql: (n) =>
      `select api.record_my_acquisition('{}'::jsonb,p_referrer_host=>${lit(`${"a".repeat(n - 4)}.com`)})`,
    at: [200],
    over: [201],
    error: /invalid attribution/,
  },
  {
    id: "LIM-F-request_frontend_business_seen",
    as: "member",
    sql: (n) =>
      `select api.request_frontend_business_seen(${uuid()},'video',${texts(Array.from({ length: n }, (_, i) => `slot ${i}`))},true)`,
    at: [1, 3],
    then: /business unavailable for this member/,
    over: [0, 4],
    error: /method, availability and screenshot consent required/,
  },
  {
    id: "LIM-F-resolve_my_frontend_media",
    as: "member",
    sql: ([keys, ids]) =>
      `select api.resolve_my_frontend_media(${texts(Array.from({ length: keys }, () => `media/${randomUUID()}`))},${uuids(ids)})`,
    at: [
      [40, 40],
      [80, 0],
    ],
    then: /upload unavailable/,
    over: [
      [41, 40],
      [0, 81],
    ],
    error: /bounded owned media references required/,
  },
  {
    id: "LIM-F-set_post_media",
    as: "member",
    sql: (n) =>
      `select api.set_post_media(${uuid()},1,${json(Array.from({ length: n }, () => ({})))})`,
    at: [62],
    then: /post not found/,
    over: [63],
    error: /invalid media list/,
  },
  {
    id: "LIM-F-start_slot_checkout",
    as: "member",
    sql: (n) => `select api.start_slot_checkout(${uuid()},${n},100,true)`,
    at: [1, 25],
    then: /this slot is not on sale/,
    over: [0, 26],
    error: /slot plan, number of slots and total required/,
  },
  {
    id: "LIM-F-start_slot_renewal_checkout",
    as: "member",
    sql: (n) => `select api.start_slot_renewal_checkout(${uuids(n)},${uuid()},100,true)`,
    at: [1, 25],
    then: /this slot is not on sale/,
    over: [0, 26],
    error: /slots to renew, term and total required/,
  },

  {
    // A listing's detail may only carry contact channels, so the size rule
    // passes a padded object that the next rule then refuses.
    id: "LIM-F-create_core_draft",
    as: "member",
    sql: async (n) => {
      const c = await listingCategory();
      return `select api.create_core_draft('listing','market',${lit(c.key)},${json(sizedObject(n))},${c.activity ? lit(c.activity) : "null"})`;
    },
    at: [512],
    then: /detail fields not implemented/,
    over: [513],
    error: /invalid detail payload/,
  },
  {
    id: "LIM-F-save_post_content",
    as: "member",
    sql: (n) => `select api.save_post_content(${uuid()},1,${json(sizedObject(n, "description"))})`,
    at: [12000],
    then: /post not found/,
    over: [12001],
    error: /invalid content/,
  },
  {
    id: "LIM-F-save_business_event_context",
    as: "member",
    sql: (n) =>
      `select api.save_business_event_context(${uuid()},1,${json(sizedObject(n, "business_type"))})`,
    at: [1024],
    then: /business or event not found/,
    over: [1025],
    error: /invalid context patch/,
  },
  {
    id: "LIM-F-register_identity_submission",
    as: "service",
    sql: (n) =>
      `select api.register_identity_submission(${uuid()},1,${uuid()},${uuid()},${lit(fingerprint(1))},'identity-match-v1',${json(
        {
          ciphertext: "a".repeat(26),
          iv: "b".repeat(24),
          tag: "c".repeat(32),
          key_id: "identity-number-v1",
        }
      )},${uuid()},${n})`,
    at: [0, 100],
    then: /case unavailable/,
    over: [-1, 101],
    error: /bound processing receipt required/,
  },
  {
    id: "LIM-F-advance_evidence_artifact",
    as: "service",
    sql: async (n, { user }) => {
      const id = randomUUID();
      await h.seed(`insert into private.evidence_cases(id,subject_id,kind) values(gen_random_uuid(),${lit(user.id)},'business');
        insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state)
          values(${lit(id)},(select c.id from private.evidence_cases c where c.subject_id=${lit(user.id)} limit 1),
            ${lit(user.id)},'registration',${lit(`evidence/${id}`)},'intent');`);
      return `select api.advance_evidence_artifact(${lit(id)},'uploaded',${text(64, "e")},${n})`;
    },
    at: [1, 20000000],
    over: [0, 20000001],
    error: /valid digest and bounded size required/,
  },
  {
    // The window's time zone is checked against the list later, so padding it
    // reaches the size rule.
    id: "LIM-F-save_business_event_context-2",
    as: "member",
    sql: async (n, { user }) => {
      const post = await seedPost(user, { kind: "event", status: "draft" });
      const window = { starts_at: "2030-01-01T10:00:00Z", ends_at: "2030-01-01T12:00:00Z" };
      return `select api.save_business_event_context(${lit(post)},1,${json({ event_window: sizedObject(n, "timezone", window) })})`;
    },
    at: [512],
    then: /invalid event window/,
    over: [513],
    error: /complete event window required/,
  },
  {
    // An earlier rule (the locality field's 80-character maximum) refuses 81
    // characters first, with the same bound; the registered line repeats it.
    id: "LIM-F-save_post_content-2",
    as: "member",
    sql: async (n, { user }) => {
      const post = await seedPost(user, { kind: "listing", status: "draft" });
      return `select api.save_post_content(${lit(post)},1,${json({ locality_label: "a".repeat(n) })})`;
    },
    at: [1, 80],
    over: [81],
    error: /attribute text outside bounds/,
  },
  // Internal helpers that no API role calls directly.
  {
    id: "LIM-F-validate_listing_attributes",
    as: "owner",
    sql: async (n) =>
      `select internal.validate_listing_attributes(${lit((await listingCategory()).key)},${json(sizedObject(n))},false)`,
    at: [16384],
    then: /unknown attribute key/,
    over: [16385],
    error: /attribute object required/,
  },
  {
    id: "LIM-F-canonical_post_channels",
    as: "owner",
    sql: (channels) => `select internal.canonical_post_channels(${json(channels)})`,
    at: [["call", "whatsapp", "form", "in_app"]],
    over: [["call", "call", "call", "call", "call"]],
    error: /choose supported contact channels/,
  },

  // Staff: page numbers, page sizes, id lists and text lengths.
  {
    id: "LIM-F-claim_frontend_staff_items",
    as: "staff",
    sql: (n) => `select api.claim_frontend_staff_items('content',${n})`,
    at: [1, 25],
    over: [0, 26],
    error: /bounded staff queue required/,
  },
  ...["LIM-F-claim_queue_items", "LIM-F-claim_queue_items-2"].map((id) => ({
    id,
    as: "staff",
    sql: (n) => `select api.claim_queue_items('content',${n})`,
    at: [1, 25],
    over: [0, 26],
    error: /claim between 1 and 25 items/,
  })),
  {
    id: "LIM-F-get_frontend_area_activity",
    as: "staff",
    sql: (n) => `select api.get_frontend_area_activity(null,${n})`,
    at: [1, 100],
    over: [0, 101],
    error: /bounded program activity required/,
  },
  {
    id: "LIM-F-get_frontend_privacy_queue",
    as: "staff",
    sql: (n) => `select api.get_frontend_privacy_queue('open',${n})`,
    at: [1, 100000],
    over: [0, 100001],
    error: /valid privacy queue filters required/,
  },
  {
    id: "LIM-F-get_frontend_staff_audit_page-2",
    as: "staff",
    sql: (n) => `select api.get_frontend_staff_audit_page(${json(sizedObject(n, "q"))})`,
    at: [4096],
    then: /bounded audit search required/,
    over: [4097],
    error: /valid audit filters required/,
  },
  {
    id: "LIM-F-get_frontend_staff_audit_page-3",
    as: "staff",
    sql: (n) => `select api.get_frontend_staff_audit_page(${json({ page: n })})`,
    at: [100000],
    over: [100001],
    error: /audit page limit exceeded/,
  },
  {
    id: "LIM-F-get_frontend_staff_audit_page-4",
    as: "staff",
    sql: (n) => `select api.get_frontend_staff_audit_page(${json({ q: "a".repeat(n) })})`,
    at: [1, 100],
    over: [101],
    error: /bounded audit search required/,
  },
  {
    id: "LIM-F-get_frontend_staff_claims",
    as: "staff",
    sql: (n) =>
      `select api.get_frontend_staff_claims(${json(Array.from({ length: n }, () => ({ type: "listing", id: randomUUID() })))})`,
    at: [300],
    over: [301],
    error: /bounded claim subjects required/,
  },
  {
    id: "LIM-F-get_frontend_staff_moderation_queue",
    as: "staff",
    sql: (n) => `select api.get_frontend_staff_moderation_queue(null,${n})`,
    at: [1, 50],
    over: [0, 51],
    error: /bounded moderation queue required/,
  },
  {
    id: "LIM-F-get_frontend_staff_role_review",
    as: "staff",
    sql: (n) => `select api.get_frontend_staff_role_review(${n},null)`,
    at: [1, 10000],
    over: [0, 10001],
    error: /valid roster page required/,
  },
  {
    id: "LIM-F-get_frontend_staff_verification_queue",
    as: "staff",
    sql: ([limit, include]) =>
      `select api.get_frontend_staff_verification_queue(${limit},${uuids(include)})`,
    at: [
      [1, 0],
      [100, 300],
    ],
    over: [
      [0, 0],
      [101, 0],
      [1, 301],
    ],
    error: /bounded identity queue required/,
  },
  {
    id: "LIM-F-get_frontend_support_inbox",
    as: "staff",
    sql: (n) => `select api.get_frontend_support_inbox(${n},null)`,
    at: [1, 100000],
    over: [0, 100001],
    error: /valid support page required/,
  },
  {
    id: "LIM-F-get_staff_invoice_payments",
    as: "staff",
    sql: (n) => `select api.get_staff_invoice_payments(${uuids(n)})`,
    at: [50],
    over: [51],
    error: /up to 50 payment ids required/,
  },
  {
    id: "LIM-F-get_staff_ozow_refunds",
    as: "staff",
    sql: (n) => `select api.get_staff_ozow_refunds(${uuids(n)})`,
    at: [50],
    over: [51],
    error: /up to 50 payments required/,
  },
  {
    id: "LIM-F-get_staff_payment_list",
    as: "staff",
    sql: (n) => `select api.get_staff_payment_list(${n},null)`,
    at: [1, 100000],
    over: [0, 100001],
    error: /valid payment filter required/,
  },
  {
    id: "LIM-F-get_frontend_staff_payments",
    as: "staff-owner",
    sql: (n) => `select internal.get_frontend_staff_payments(${n},null)`,
    at: [1, 100000],
    over: [0, 100001],
    error: /valid payment filter required/,
  },
  ...[
    ["LIM-F-issue_staff_invoice", ([email]) => [email, 1, 7], [3, 254], [2, 255]],
    ["LIM-F-issue_staff_invoice-2", ([slots]) => [20, slots, 7], [1, 25], [0, 26]],
    ["LIM-F-issue_staff_invoice-3", ([days]) => [20, 1, days], [1, 30], [0, 31]],
  ].map(([id, args, at, over]) => ({
    id,
    as: "staff",
    sql: (n) => {
      const [email, slots, days] = args([n]);
      return `select api.issue_staff_invoice(${text(email)},30,${slots},${days},'Synthetic invoice reason',${uuid()})`;
    },
    at,
    then: /no confirmed account has that email/,
    over,
    error: /customer email, slot term, number of slots and days to pay required/,
  })),
  {
    id: "LIM-F-issue_staff_package_invoice",
    as: "staff",
    sql: (n) => `select api.issue_staff_package_invoice(${uuid()},${n},'Synthetic invoice reason')`,
    at: [1, 30],
    then: /invoice request not found/,
    over: [0, 31],
    error: /days to pay required \(1 to 30\)/,
  },
  ...[
    ["LIM-F-record_staff_invoice_payment", (n) => [n, 1], [3, 254], [2, 255]],
    ["LIM-F-record_staff_invoice_payment-2", (n) => [20, n], [1, 25], [0, 26]],
  ].map(([id, args, at, over]) => ({
    id,
    as: "staff",
    sql: (n) => {
      const [email, slots] = args(n);
      return `select api.record_staff_invoice_payment(${text(email)},30,${slots},10000,'BANKREF1','2026-11-20',false,'Synthetic payment reason')`;
    },
    at,
    then: /confirm the customer agreed in writing to the cooling-off waiver/,
    over,
    error: /customer email, slot term, number of slots and amount received required/,
  })),
  {
    id: "LIM-F-invoice_customer_by_email",
    as: "owner",
    sql: (n) => `select internal.invoice_customer_by_email(${text(n)})`,
    at: [3, 254],
    then: /no confirmed account has that email/,
    over: [2, 255],
    error: /customer email required/,
  },
  {
    id: "LIM-F-moderate_post",
    as: "staff",
    sql: (n) => `select api.moderate_post(${uuid()},1,'reject','1',${uuid()},${text(n)})`,
    at: [5, 500],
    then: /post is not awaiting moderation/,
    over: [4, 501],
    error: /decision and, for rejections, a reason are required/,
  },
  {
    id: "LIM-F-propose_frontend_staff_role",
    as: "staff",
    sql: (n) =>
      `select api.propose_frontend_staff_role(${lit(emailOfLength(n))},'moderator','Synthetic role reason')`,
    at: [254],
    then: /confirmed account not found/,
    over: [255],
    error: /valid account and role required/,
  },
  {
    id: "LIM-F-save_frontend_organisation_profile",
    as: "staff",
    sql: (n) =>
      `select api.save_frontend_organisation_profile(${text(n)},'{}'::jsonb,'Synthetic profile reason')`,
    at: [3, 60],
    then: /organisation details are invalid/,
    over: [2, 61],
    error: /invalid organisation profile/,
  },
  {
    id: "LIM-F-set_frontend_feature_flag",
    as: "staff",
    sql: ([percent, roles]) =>
      `select api.set_frontend_feature_flag('fixture_flag',1,'percent',${percent},${texts(roles)},'Synthetic flag reason')`,
    at: [
      [0, []],
      [100, ["admin", "moderator", "governance_controller", "member", "buyer"]],
    ],
    then: /supported display flag required/,
    over: [
      [-1, []],
      [101, []],
      [50, ["admin", "moderator", "governance_controller", "member", "buyer", "admin"]],
    ],
    error: /valid represented feature configuration required/,
  },
  {
    id: "LIM-F-staff_audit_page-2",
    as: "staff",
    sql: (n) => `select api.staff_audit_page(${json(sizedObject(n, "q"))})`,
    at: [4096],
    then: /invalid audit search/,
    over: [4097],
    error: /invalid staff audit request/,
  },
  {
    id: "LIM-F-staff_audit_page-3",
    as: "staff",
    sql: (n) => `select api.staff_audit_page(${json({ limit: n })})`,
    at: [1, 100],
    over: [0, 101],
    error: /invalid audit limit/,
  },
  {
    id: "LIM-F-staff_audit_page-4",
    as: "staff",
    sql: (n) => `select api.staff_audit_page(${json({ action: "a".repeat(n) })})`,
    at: [100],
    over: [101],
    error: /invalid audit action/,
  },
  {
    id: "LIM-F-staff_audit_page-5",
    as: "staff",
    sql: (n) => `select api.staff_audit_page(${json({ q: "a".repeat(n) })})`,
    at: [1, 100],
    over: [0, 101],
    error: /invalid audit search/,
  },
  {
    id: "LIM-F-staff_decision_page-2",
    as: "staff",
    sql: (n) => `select api.staff_decision_page(${json(sizedObject(n, "status"))})`,
    at: [4096],
    then: /invalid decision status/,
    over: [4097],
    error: /invalid staff decision request/,
  },
  {
    id: "LIM-F-staff_decision_page-3",
    as: "staff",
    sql: (n) => `select api.staff_decision_page(${json({ limit: n })})`,
    at: [1, 100],
    over: [0, 101],
    error: /invalid decision limit/,
  },
  {
    id: "LIM-F-staff_save_partner",
    as: "staff",
    sql: (n, { other }) =>
      `select api.staff_save_partner(${lit(other.id)},'create','Synthetic partner reason',${lit(randomUUID().slice(0, 8).toUpperCase())},${n})`,
    at: [0, 2000],
    over: [-1, 2001],
    error: /invalid rate/,
  },
  {
    // Up to 4 slots needs no end date; above 4, one between a day and a year
    // away. The person has no ID review, so a passing call stops there.
    id: "LIM-F-staff_set_individual_slot_limit",
    as: "staff",
    sql: (n, { other }) =>
      `select api.staff_set_individual_slot_limit(${lit(other.id)},${n},${n > 4 ? "now()+interval '30 days'" : "null"},'Synthetic slot reason')`,
    at: [4, 25],
    then: /ID review/,
    over: [3, 26],
    error: /valid slot limit \(4 to 25\), end date and reason required/,
  },
  {
    id: "LIM-F-staff_set_individual_slot_limit-2",
    as: "staff",
    sql: (n, { other }) =>
      `select api.staff_set_individual_slot_limit(${lit(other.id)},${n},null,'Synthetic slot reason')`,
    at: [4],
    then: /this account has no ID review/,
    over: [5],
    error: /valid slot limit \(4 to 25\), end date and reason required/,
  },
  {
    id: "LIM-F-staff_set_individual_slot_limit-3",
    as: "staff",
    sql: (n, { other }) =>
      `select api.staff_set_individual_slot_limit(${lit(other.id)},${n},${n > 4 ? "now()+interval '30 days'" : "null"},'Synthetic slot reason')`,
    at: [4],
    then: /this account has no ID review/,
    over: [5],
    code: "PT409",
    error: /the person's ID review must be accepted first/,
  },
  ...[
    ["LIM-F-save_programme_showcase", (n) => [n, 0], [3, 48], [2, 49]],
    ["LIM-F-save_programme_showcase-2", (n) => [12, n], [0, 100000], [-1, 100001]],
  ].map(([id, args, at, over]) => ({
    id,
    as: "staff",
    sql: async (n) => {
      const [cards, order] = args(n);
      return `select api.save_programme_showcase(${lit(await seedOrganisation())},'Fixture showcase','home',true,now(),now()+interval '30 days',${cards},${order},false,'Synthetic showcase reason')`;
    },
    at,
    over,
    error: /invalid showcase/,
  })),
  // A bank reference needs at least 4 letters or digits ("AB-C" has 3).
  {
    id: "LIM-F-record_staff_invoice_payment-4",
    as: "staff",
    sql: (ref) =>
      `select api.record_staff_invoice_payment('buyer@example.com',30,1,10000,${lit(ref)},null,true,'Synthetic payment reason')`,
    at: ["AB-CD"],
    then: /date the money cleared required/,
    over: ["AB-C"],
    error: /bank reference must be 4 to 60 letters/,
  },
  {
    id: "LIM-F-record_staff_invoice_transfer",
    as: "staff",
    sql: (ref) =>
      `select api.record_staff_invoice_transfer('VM-2026-000001',${lit(ref)},null,true,'Synthetic transfer reason')`,
    at: ["AB-CD"],
    then: /date the money cleared required/,
    over: ["AB-C"],
    error: /bank reference must be 4 to 60 letters/,
  },
  {
    id: "LIM-F-staff_refund_reference",
    as: "owner",
    sql: async (ref, { user }) => {
      const payment = randomUUID();
      await h.seed(`insert into private.payments(id,owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,provider)
        values(${lit(payment)},${lit(user.id)},'plan',gen_random_uuid(),100,'ZAR','{}'::jsonb,'invoice');`);
      return `select internal.staff_refund_reference(${lit(payment)},${lit(ref)})`;
    },
    at: ["AB-CD"],
    over: ["AB-C"],
    error: /bank refund reference must be 4 to 100 letters/,
  },
  {
    id: "LIM-F-staff_verification_queue",
    as: "staff",
    sql: (n) => `select api.staff_verification_queue(${n})`,
    at: [1, 100],
    over: [0, 101],
    error: /limit 1 to 100/,
  },
  {
    id: "LIM-F-execute_frontend_report_action",
    as: "staff",
    sql: (n) =>
      `select api.execute_frontend_report_action(${uuid()},1,'1',${uuid()},'warn',${text(n)})`,
    at: [10],
    then: /report unavailable/,
    over: [9],
    error: /warning reason needs at least 10 characters/,
  },
  {
    id: "LIM-F-propose_frontend_report_restriction",
    as: "staff-owner",
    sql: (n) =>
      `select internal.propose_frontend_report_restriction(${uuid()},1,'1',${uuid()},'suspend','A synthetic restriction reason',${n},false)`,
    at: [1, 30],
    then: /report unavailable/,
    over: [0, 31],
    error: /valid represented restriction required/,
  },
  {
    id: "LIM-F-open_authority_request",
    as: "staff",
    sql: (n) =>
      `select api.open_authority_request('subpoena','REF-001','A synthetic court','035 789 1234','A synthetic clerk','A synthetic disclosure reason','email',${lit(emailOfLength(n))},true)`,
    at: [254],
    over: [255],
    error: /valid search value required/,
  },
  {
    id: "LIM-F-record_frontend_privacy_intake",
    as: "staff",
    sql: (n) =>
      `select api.record_frontend_privacy_intake('access',${lit(emailOfLength(n))},null,'A synthetic privacy request.','A synthetic intake note.')`,
    at: [254],
    over: [255],
    error: /check recipient and received date/,
  },
  {
    // The address pattern needs at least five characters, so only the upper
    // bound is reachable.
    id: "LIM-F-invite_member",
    as: "staff",
    sql: (n) => `select api.invite_member(${lit(emailOfLength(n))})`,
    at: [254],
    over: [255],
    error: /member_invitation_email_invalid/,
  },
  {
    id: "LIM-F-revoke_member_invitation",
    as: "staff",
    sql: (n) => `select api.revoke_member_invitation(${text(n)})`,
    at: [3, 254],
    over: [2, 255],
    error: /member_invitation_email_invalid/,
  },
  {
    id: "LIM-F-set_signup_mode",
    as: "owner",
    sql: (n) => `select internal.set_signup_mode('open',${text(n)},null)`,
    at: [5, 500],
    then: /signup_mode_changer_invalid/,
    over: [4, 501],
    error: /signup_mode_reason_required/,
  },

  // Visitors: how many posts one public read may ask about.
  {
    id: "LIM-F-get_public_frontend_business_affiliations",
    as: "visitor",
    sql: (n) => `select api.get_public_frontend_business_affiliations(${uuids(n)})`,
    at: [100],
    over: [101],
    error: /at most 100 business ids required/,
  },
  ...[
    ["LIM-F-get_public_frontend_business_cipc", "get_public_frontend_business_cipc"],
    ["LIM-F-get_public_frontend_business_seen", "get_public_frontend_business_seen"],
  ].map(([id, fn]) => ({
    id,
    as: "visitor",
    sql: (n) => `select api.${fn}(${uuids(n)})`,
    at: [100],
    over: [101],
    error: /bounded represented businesses required/,
  })),
  ...[
    ["LIM-F-public_post_affiliations", "public_post_affiliations"],
    ["LIM-F-public_post_affiliations-2", "public_post_affiliations"],
    ["LIM-F-public_post_sponsorships", "public_post_sponsorships"],
    ["LIM-F-public_post_sponsorships-2", "public_post_sponsorships"],
  ].map(([id, fn]) => ({
    id,
    as: "visitor",
    sql: (n) => `select api.${fn}(${uuids(n)})`,
    at: [1, 100],
    over: [0, 101],
    error: /between 1 and 100 post ids required/,
  })),
];

// ---------------------------------------------------------------- runner

async function call(row, value) {
  const user = await h.member(`bound-${row.id}`);
  const other = await h.member(`bound-other-${row.id}`);
  const staffUser = await h.staff(`bound-staff-${row.id}`);
  const sql = await row.sql(value, { user, other, staff: staffUser });
  switch (row.as) {
    case "service":
      return h.asService(sql);
    case "member":
      return h.asMember(user, sql);
    case "staff":
      return h.asStaff(staffUser, sql);
    case "staff-owner":
      return h.asOwner(sql, staffUser);
    case "visitor":
      return h.asVisitor(sql);
    case "owner":
      return h.asOwner(sql);
    default:
      throw new Error(`${row.id}: unknown caller ${row.as}`);
  }
}

describe("database input limits at their bound", () => {
  test("every row names a distinct register entry", () => {
    const ids = ROWS.map((row) => row.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  for (const row of ROWS) {
    test(row.id, async () => {
      for (const value of row.at) {
        const label = `${row.id} at ${JSON.stringify(value)}`;
        if (row.then)
          await assert.rejects(call(row, value), (error) => {
            assert.doesNotMatch(error.message, row.error, `${label}: refused by the guard`);
            assert.match(error.message, row.then, label);
            return true;
          });
        else
          await call(row, value).catch((error) => {
            throw new Error(`${label}: ${error.code} ${error.message}`);
          });
      }
      for (const value of row.over)
        await refused(call(row, value), row.code ?? "22023", row.error).catch((error) => {
          throw new Error(`${row.id} over ${JSON.stringify(value)}: ${error.message}`);
        });
    });
  }
});

// ---------------------------------------------------------------- counted and stored limits
//
// Limits on what is already stored (counts in a window, attempts, sizes of a
// stored row): earlier rows are written as fixtures, then the command is
// called once at the limit and once past it.

/** A post of `owner` written directly (fixture), by default a pending listing. */
async function seedPost(owner, { kind = "listing", status = "pending_moderation" } = {}) {
  const id = randomUUID();
  const c = (
    await h.db.query(
      `select c.category_key as key, c.area,
        (select a.key from private.category_activities a join private.categories k on k.key=a.category_key
          where a.category_key=c.category_key and k.activity_required order by a.key limit 1) as activity
       from private.post_category_contracts c where c.kind=$1 order by c.category_key limit 1`,
      [kind]
    )
  ).rows[0];
  await h.seed(`insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id,status)
    values(${lit(id)},${lit(owner.id)},${lit(kind)},${lit(c.area)},${lit(c.key)},${c.activity ? lit(c.activity) : "null"},
      'Fixture post','A synthetic description long enough for every rule.','gp','gp_johannesburg',${lit(status)});
    ${
      kind === "event"
        ? `insert into private.event_details(post_id,starts_at,ends_at,timezone)
            values(${lit(id)},now()+interval '1 day',now()+interval '2 days','Africa/Johannesburg');`
        : `insert into private.${kind}_details(post_id) values(${lit(id)});`
    }`);
  return id;
}

/** A listed organisation that accepts applications (fixture). */
async function seedOrganisation() {
  const id = randomUUID();
  await h.seed(`insert into private.organisations(id,slug,name,is_public,programme_status,accepting_applications)
    values(${lit(id)},${lit(`fixture-${id.slice(0, 8)}`)},'Fixture Organisation',true,'affiliation_only',true);`);
  return id;
}

/** `count` live review claims held by `staffUser` on other items (fixtures). */
const seedClaims = (staffUser, count) =>
  count &&
  h.seed(
    `insert into private.queue_claims(post_id,claimed_by,claim_nonce,claimed_at,claim_expires_at,claim_generation)
     select gen_random_uuid(),${lit(staffUser.id)},gen_random_uuid(),now(),now()+interval '15 minutes',1 from generate_series(1,${count});`
  );

describe("counted and stored database limits", () => {
  test("LIM-SQL-staff-open-claims: at most 20 open review claims per staff member", async () => {
    const author = await h.member("claims-author");
    // A single claim: allowed while 19 others are held, refused at 20.
    for (const [held, ok] of [
      [19, true],
      [20, false],
    ]) {
      const reviewer = await h.staff(`claims-single-${held}`);
      await seedClaims(reviewer, held);
      const post = await seedPost(author);
      const claim = h.asStaff(reviewer, `select api.claim_queue_item('post',${lit(post)})`);
      if (ok) await claim;
      else await refused(claim, "PT429", /claim limit of 20 items reached/);
    }
    // A batch claim stops at 20 open claims.
    const batcher = await h.staff("claims-batch");
    await seedClaims(batcher, 18);
    for (let n = 0; n < 3; n += 1) await seedPost(author);
    const items = (await h.asStaff(batcher, `select api.claim_queue_items('content',5) as r`))[0].r;
    assert.equal(items.length, 2, JSON.stringify(items));
    // Reassigning to a reviewer who already holds 20 is refused; at 19 it works.
    const lead = await h.staff("claims-lead");
    for (const [held, ok] of [
      [19, true],
      [20, false],
    ]) {
      const holder = await h.staff(`claims-holder-${held}`);
      const target = await h.staff(`claims-target-${held}`);
      await seedClaims(target, held);
      const post = await seedPost(author);
      await h.asStaff(holder, `select api.claim_queue_item('post',${lit(post)})`);
      const move = h.asStaff(
        lead,
        `select api.reassign_queue_claim('post',${lit(post)},${lit(target.id)},'Synthetic reassignment reason')`
      );
      if (ok) await move;
      else await refused(move, "PT429", /that reviewer already holds 20 items/);
    }
  });

  test("LIM-F-renew_queue_claim: a claim is renewed at most 4 times", async () => {
    const author = await h.member("renew-author");
    const reviewer = await h.staff("renew-reviewer");
    const post = await seedPost(author);
    const claim = (
      await h.asStaff(reviewer, `select api.claim_queue_item('post',${lit(post)}) as c`)
    )[0].c;
    const renew = () =>
      h.asStaff(
        reviewer,
        `select api.renew_queue_claim('post',${lit(post)},${lit(claim.claim_generation)},${lit(claim.claim_nonce)})`
      );
    for (let n = 1; n <= 4; n += 1) await renew();
    await refused(renew(), "PT409", /renewal limit reached/);
  });
});

describe("delivery retries and back-off", () => {
  const OLD = "'2000-01-01T00:00:00Z'";
  /** An outbox message (fixture) that has had `attempts` delivery attempts. */
  async function outbox(attempts, claimed) {
    const owner = await h.member("outbox-owner");
    const id = randomUUID();
    const claim = randomUUID();
    await h.seed(`insert into private.outbox_events(id,kind,subject_id,owner_id,dedupe_key,delivery_attempts,delivery_after,created_at
        ${claimed ? ",delivery_claim,delivery_until" : ""})
      values(${lit(id)},'payment_completed',gen_random_uuid(),${lit(owner.id)},${lit(`fixture:${id}`)},${attempts},${OLD},${OLD}
        ${claimed ? `,${lit(claim)},now()+interval '90 seconds'` : ""});`);
    return { id, claim };
  }
  const claimedIds = (rows) => rows[0].r.map((item) => item.id);

  test("LIM-F-claim_notification_outbox-2 and LIM-F-claim_supported_notification_outbox-3: a message is tried at most 8 times", async () => {
    for (const claimSql of [
      `select api.claim_notification_outbox(50) as r`,
      `select api.claim_supported_notification_outbox(${texts(MAIL_KINDS)},50) as r`,
    ]) {
      const seventh = await outbox(7);
      const eighth = await outbox(8);
      const ids = claimedIds(await h.asService(claimSql));
      assert.ok(ids.includes(seventh.id), `${claimSql}: the 8th attempt is claimed`);
      assert.ok(!ids.includes(eighth.id), `${claimSql}: no 9th attempt`);
    }
  });

  test("LIM-F-complete_notification_outbox: a failed message waits 30 s x 2^attempts, doubling at most 9 times", async () => {
    // 30 x 2^9 = 15,360 s is below the 21,600 s ceiling, so the ceiling never
    // applies; the doubling stops at 9 attempts.
    for (const [attempts, seconds] of [
      [8, 7680],
      [9, 15360],
      [12, 15360],
    ]) {
      const message = await outbox(attempts, true);
      const rows = await h.asService(
        `select api.complete_notification_outbox(${lit(message.id)},${lit(message.claim)},false) as r`
      );
      assert.equal(rows[0].r, true);
      const wait = Number(
        await h.one(
          `select round(extract(epoch from delivery_after-statement_timestamp())) from private.outbox_events where id=$1`,
          [message.id]
        )
      );
      assert.ok(
        Math.abs(wait - seconds) <= 5,
        `${attempts} attempts: waited ${wait} s, expected ${seconds}`
      );
    }
  });

  /** A privacy notice job (fixture) on a manual request, after `attempts`. */
  async function notice(attempts, claimed) {
    const request = randomUUID();
    const id = randomUUID();
    const claim = randomUUID();
    await h.seed(`insert into private.privacy_requests(id,type,requester_email,description,identity_check,received_at,due_by,legal_basis)
        values(${lit(request)},'access','fixture@example.com','A synthetic request','manual',now(),now()+interval '30 days','POPIA section 23');
      insert into private.privacy_notice_jobs(id,request_id,kind,attempts,next_attempt_at${claimed ? ",claim_token,locked_until" : ""})
        values(${lit(id)},${lit(request)},'submitted',${attempts},${OLD}${claimed ? `,${lit(claim)},now()+interval '90 seconds'` : ""});`);
    return { id, claim };
  }

  test("LIM-F-claim_frontend_privacy_notice: a privacy notice is tried at most 8 times", async () => {
    const seventh = await notice(7);
    const eighth = await notice(8);
    const claimed = [];
    for (let n = 0; n < 50; n += 1) {
      const job = (await h.asService(`select api.claim_frontend_privacy_notice() as r`))[0].r;
      if (!job) break;
      claimed.push(job.id);
    }
    assert.ok(claimed.includes(seventh.id), "the 8th attempt is claimed");
    assert.ok(!claimed.includes(eighth.id), "no 9th attempt");
  });

  test("LIM-F-complete_frontend_privacy_notice: a failed notice waits 2^attempts minutes, at most 6 hours", async () => {
    for (const [attempts, minutes] of [
      [8, 256],
      [9, 360],
    ]) {
      const job = await notice(attempts, true);
      await h.asService(
        `select api.complete_frontend_privacy_notice(${lit(job.id)},${lit(job.claim)},false)`
      );
      const wait = Number(
        await h.one(
          `select round(extract(epoch from next_attempt_at-clock_timestamp())/60) from private.privacy_notice_jobs where id=$1`,
          [job.id]
        )
      );
      assert.ok(
        Math.abs(wait - minutes) <= 1,
        `${attempts} attempts: waited ${wait} min, expected ${minutes}`
      );
    }
  });
});

describe("stored rows, attempts and counts", () => {
  const sha = (label) => (label.repeat(64) + "0".repeat(64)).slice(0, 64);

  test("LIM-F-finalize_media: an image is at most 20,000 pixels wide and high", async () => {
    const owner = await h.member("media-size");
    const finalize = async (width, height) => {
      const id = randomUUID();
      await h.seed(`insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,state)
        values(${lit(id)},${lit(owner.id)},'image',${lit(`media/${id}`)},1024,'intent');`);
      return (
        await h.asService(
          `select api.finalize_media(${lit(id)},1024,${lit(sha("a"))},'image/jpeg',${width},${height}) as r`
        )
      )[0].r.state;
    };
    assert.equal(await finalize(20000, 20000), "ready");
    assert.equal(await finalize(1, 1), "ready");
    assert.equal(await finalize(20001, 100), "rejected");
    assert.equal(await finalize(100, 20001), "rejected");
    assert.equal(await finalize(0, 100), "rejected");
  });

  test("LIM-F-finalize_verification_phone: a code is confirmed only after 1 to 5 attempts", async () => {
    const confirm = async (attempts) => {
      const user = await h.member(`phone-finalize-${attempts}`);
      const hash = "h".repeat(64);
      const challenge = (
        await h.asService(
          `select api.create_verification_phone_challenge(${lit(user.id)},'+2772100980${attempts}',${lit(hash)}) as c`
        )
      )[0].c.challenge_id;
      await h.db.query(`update private.verification_phone_challenges set attempts=$2 where id=$1`, [
        challenge,
        attempts,
      ]);
      return h.asService(
        `select api.finalize_verification_phone(${lit(user.id)},${lit(challenge)},${lit(hash)})`
      );
    };
    await confirm(1);
    await confirm(5);
    await refused(confirm(0), "22023", /challenge unavailable/);
    // A sixth attempt cannot even be stored: the table allows at most 5.
    await refused(confirm(6), "23514");
  });

  test("LIM-F-close_my_account: the address of the account closed is 3 to 254 characters", async () => {
    const close = async (length) => {
      const id = randomUUID();
      const session = randomUUID();
      await h.db.query(`insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())`, [
        id,
        emailOfLength(length),
      ]);
      await h.db.query(`insert into auth.sessions(id,user_id,aal) values($1,$2,'aal1')`, [
        session,
        id,
      ]);
      const signedIn = [{ method: "password", timestamp: Math.floor(Date.now() / 1000) }];
      return h.asMember({ id, session, amr: signedIn }, `select api.close_my_account()`);
    };
    await close(254);
    await refused(close(255), "42501", /live confirmed member session required/);
  });

  test("LIM-F-assess_identity_upload and LIM-F-assess_identity_upload-2: risk 75 for a reused ID, at least 80 from the third upload in a day", async () => {
    const owner = await h.member("assess-owner");
    const assess = async (who, documentSha) =>
      (
        await h.asService(
          `select api.assess_identity_upload(${lit(who.id)},${lit(fingerprint(7))},${lit(documentSha)},${lit(sha("b"))}) as r`
        )
      )[0].r.risk_score;
    assert.equal(await assess(owner, sha("c")), 0);
    // Another account's clean upload with the same ID photo: 75.
    const other = await h.member("assess-other");
    await h.seed(`insert into private.evidence_artifacts(case_id,owner_id,purpose,object_key,state,sha256,content_sha256)
      values(gen_random_uuid(),${lit(other.id)},'id_front','evidence/fixture-assess','clean',${lit(sha("d"))},${lit(sha("d"))});`);
    assert.equal(await assess(owner, sha("d")), 75);
    // Two earlier submissions today: unchanged; three: at least 80.
    const submissions = (count) =>
      h.seed(
        `insert into private.verification_identity_submissions(case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,identity_hmac,
           identity_key_id,encryption_key_id,receipt_id,recipe,risk_score,number_ciphertext,number_iv,number_tag,protocol)
         select gen_random_uuid(),${lit(owner.id)},1,gen_random_uuid(),gen_random_uuid(),${lit(fingerprint(8))},'identity-match-v1',
           'identity-number-v1',gen_random_uuid(),'manual-id-selfie-v1',0,${lit("a".repeat(26))},${lit("b".repeat(24))},${lit("c".repeat(32))},
           'sa-id-hmac-sha256-v1' from generate_series(1,${count});`
      );
    await submissions(2);
    assert.equal(await assess(owner, sha("c")), 0);
    await submissions(1);
    assert.equal(await assess(owner, sha("c")), 80);
    assert.equal(await assess(owner, sha("d")), 80);
  });

  test("LIM-F-apply_to_organisation: at most 10 organisation requests a day", async () => {
    const owner = await h.member("apply-owner");
    const post = await seedPost(owner, { kind: "business", status: "draft" });
    await h.seed(
      `insert into private.organisation_applications(organisation_id,post_id,applicant_id,share_representative_name,consented_at,post_kind)
       select gen_random_uuid(),${lit(post)},${lit(owner.id)},false,now(),'business' from generate_series(1,9);`
    );
    const apply = async () =>
      h.asMember(
        owner,
        `select api.apply_to_organisation(${lit(await seedOrganisation())},${lit(post)},false,true)`
      );
    await apply();
    await refused(apply(), "PT429", /too many requests today/);
  });

  test("LIM-F-save_programme_showcase-3: at most 20 showcases per organisation", async () => {
    const lead = await h.staff("showcase-lead");
    const org = await seedOrganisation();
    await h.seed(`insert into private.programme_showcases(organisation_id,title,placement,starts_at,ends_at,created_by)
      select ${lit(org)},'Fixture showcase','home',now(),now()+interval '30 days',${lit(lead.id)} from generate_series(1,19);`);
    const save = () =>
      h.asStaff(
        lead,
        `select api.save_programme_showcase(${lit(org)},'Fixture showcase','home',true,now(),now()+interval '30 days',12,0,false,'Synthetic showcase reason')`
      );
    await save();
    await refused(save(), "PT409", /showcase limit reached/);
  });

  test("LIM-F-start_capture_handoff: at most 5 phone links an hour", async () => {
    const owner = await h.member("handoff-owner");
    const earlier = (count) =>
      h.seed(
        `insert into private.capture_handoffs(token_sha256,owner_id,case_id,session_id,created_at,expires_at)
         select encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'),${lit(owner.id)},gen_random_uuid(),${lit(owner.session)},
           now()-interval '1 minute',now()-interval '1 minute'+interval '15 minutes' from generate_series(1,${count});`
      );
    const start = () =>
      h.asMember(
        owner,
        `select api.start_capture_handoff(encode(sha256(convert_to(gen_random_uuid()::text,'UTF8')),'hex'))`
      );
    // Below the limit the call goes on to the next rule (this member has no
    // ID details yet).
    await earlier(4);
    await refused(start(), "PT409", /ID details required/);
    await earlier(1);
    await refused(start(), "PT429", /too many phone links/);
  });

  test("LIM-F-slot_package_move_stuck: a busy package move is reported after 2 tries in its last day", async () => {
    const stuck = (tries) =>
      h.one(
        `select internal.slot_package_move_stuck(now()-interval '1 minute',now()+interval '2 hours',$1,'busy')`,
        [tries]
      );
    assert.equal(await stuck(1), false);
    assert.equal(await stuck(2), true);
  });
});

describe("allowances computed from packages", () => {
  /** An active staff-granted entitlement of `owner` (fixture). */
  async function grant(owner, { photos = 10, videos = 1, days = 30 } = {}) {
    const id = randomUUID();
    await h.seed(`insert into private.entitlements(id,owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at,status)
      values(${lit(id)},${lit(owner.id)},'staff_grant',gen_random_uuid(),1,${photos},${videos},now()-interval '1 minute',
        now()-interval '1 minute'+make_interval(days=>${days}),'active');`);
    return id;
  }

  test("LIM-SQL-media-storage-allowance: 5 MB a photo and 50 MB a video of the packages, at least 100 MB", async () => {
    const storage = async (owner) =>
      Number(await h.one(`select (internal.package_capacity($1)).post_media_bytes`, [owner.id]));
    const MB = 1024 * 1024;
    const none = await h.member("storage-none");
    assert.equal(await storage(none), 100 * MB);
    const small = await h.member("storage-small");
    await grant(small, { photos: 10, videos: 0 });
    assert.equal(await storage(small), 100 * MB);
    const large = await h.member("storage-large");
    await grant(large, { photos: 30, videos: 2 });
    assert.equal(await storage(large), 30 * 5 * MB + 2 * 50 * MB);
  });

  test("LIM-F-edit_allowance: at least 2 edits, 2 more for every 30 days a slot runs", async () => {
    const edits = async (days) => {
      const owner = await h.member(`edits-${days}`);
      const post = await seedPost(owner, { kind: "listing", status: "draft" });
      if (days) {
        const entitlement = await grant(owner, { days });
        await h.seed(`insert into private.post_activations(post_id,owner_id,entitlement_id)
          values(${lit(post)},${lit(owner.id)},${lit(entitlement)});`);
      }
      return Number(await h.one(`select internal.edit_allowance($1)`, [post]));
    };
    assert.equal(await edits(0), 2);
    assert.equal(await edits(1), 2);
    assert.equal(await edits(30), 2);
    assert.equal(await edits(31), 4);
    assert.equal(await edits(90), 6);
  });
});

describe("payment problem alerts", () => {
  test("LIM-F-record_payment_problem-2: an emailed problem is raised again by a new transaction at most 5 times", async () => {
    const owner = await h.member("problem-owner");
    const payment = randomUUID();
    await h.seed(`insert into private.payments(id,owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot)
      values(${lit(payment)},${lit(owner.id)},'plan',gen_random_uuid(),100,'ZAR','{}'::jsonb);`);
    const record = async (transaction) =>
      (
        await h.asService(
          `select api.record_payment_problem(${lit(payment)},'amount_mismatch','notice',true,${lit(transaction)}) as r`
        )
      )[0].r.raised;
    const emailed = () =>
      h.db.query(
        `update private.payment_problems set alerted_at=clock_timestamp() where payment_id=$1 and reason='amount_mismatch'`,
        [payment]
      );
    assert.equal(await record("tx-0"), true);
    for (let n = 1; n <= 5; n += 1) {
      await emailed();
      assert.equal(await record(`tx-${n}`), true, `repeat ${n} raises it again`);
    }
    await emailed();
    assert.equal(await record("tx-6"), false, "a sixth repeat does not");
  });
});

// ---------------------------------------------------------------- read caps
//
// A read returns at most `cap` rows: `cap + 1` rows are written as fixtures
// (on top of whatever earlier tests left), and the read returns exactly `cap`.

const customerInvoices = (count, year, account) =>
  `insert into private.customer_invoices(account_id,invoice_number,invoice_year,sequence_number,plan_version_id,slots,
     unit_price_cents,total_cents,description,due_on,issued_by,issue_reason,request_id,seller,issued_at)
   select ${account ? lit(account) : "gen_random_uuid()"},'VM-${year}-'||lpad(n::text,6,'0'),${year},n,gen_random_uuid(),1,100,100,
     'Fixture invoice',current_date+7,gen_random_uuid(),'Synthetic invoice reason',gen_random_uuid(),'{}'::jsonb,now()-make_interval(secs=>n)
   from generate_series(1,${count}) n;`;
const organisations = (count, listed) =>
  `insert into private.organisations(slug,name,is_public,programme_status)
   select 'fixture-'||replace(gen_random_uuid()::text,'-',''),'Fixture Organisation',${listed},${listed ? "'affiliation_only'" : "'invited'"}
   from generate_series(1,${count});`;

const READ_CAPS = [
  {
    id: "LIM-F-get_my_billing",
    as: "member",
    cap: 100,
    seed: ({ user }, n) =>
      `insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,created_at)
       select ${lit(user.id)},'plan',gen_random_uuid(),100,'ZAR','{}'::jsonb,now()-make_interval(secs=>i) from generate_series(1,${n}) i;`,
    sql: () => `select api.get_my_billing() as r`,
    count: (r) => r.payments.length,
  },
  {
    id: "LIM-F-get_my_billing-2",
    as: "member",
    cap: 100,
    seed: ({ user }, n) =>
      `with p as (insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,created_at)
         select ${lit(user.id)},'plan',gen_random_uuid(),100,'ZAR','{}'::jsonb,now()-make_interval(secs=>i) from generate_series(1,${n}) i
         returning id)
       insert into private.invoices(payment_id,invoice_number,amount_ex_vat_cents,vat_cents,total_cents,description)
       select id,'FIX-'||id,100,0,100,'Fixture invoice' from p;`,
    sql: () => `select api.get_my_billing() as r`,
    count: (r) => r.invoices.length,
  },
  {
    id: "LIM-F-get_my_invoices",
    as: "member",
    cap: 100,
    seed: ({ user }, n) => customerInvoices(n, 2099, user.id),
    sql: () => `select api.get_my_invoices() as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-get_staff_invoices",
    as: "staff",
    cap: 50,
    seed: (_, n) => customerInvoices(n, 2098),
    sql: () => `select api.get_staff_invoices() as r`,
    count: (r) => r.items.length,
  },
  ...[
    ["LIM-F-get_my_slots", "get_my_slots"],
    ["LIM-F-get_my_slots_v2", "get_my_slots_v2"],
  ].map(([id, fn]) => ({
    id,
    as: "member",
    cap: 200,
    seed: ({ user }, n) =>
      `insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at,status)
       select ${lit(user.id)},'staff_grant',gen_random_uuid(),1,10,1,now()-interval '1 day',now()+make_interval(days=>i),'active'
       from generate_series(1,${n}) i;`,
    sql: () => `select api.${fn}() as r`,
    count: (r) => r.slots.length,
  })),
  {
    id: "LIM-F-staff_list_organisations",
    as: "staff",
    cap: 500,
    seed: (_, n) => organisations(n, false),
    sql: () => `select api.staff_list_organisations() as r`,
    count: (r) => r.length,
  },
  {
    id: "LIM-F-get_frontend_staff_organisation_directory",
    as: "staff",
    cap: 200,
    seed: (_, n) => organisations(n, false),
    sql: () => `select api.get_frontend_staff_organisation_directory() as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-public_organisation_directory-3",
    as: "visitor",
    cap: 200,
    seed: (_, n) => organisations(n, true),
    sql: () => `select api.public_organisation_directory() as r`,
    count: (r) => r.length,
  },
  {
    id: "LIM-F-list_member_invitations",
    as: "staff",
    cap: 500,
    seed: (_, n) =>
      `insert into private.member_invitations(email,invited_at,expires_at)
       select 'fixture-'||replace(gen_random_uuid()::text,'-','')||'@example.com',now(),now()+interval '7 days' from generate_series(1,${n});`,
    sql: () => `select api.list_member_invitations() as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-staff_list_partners",
    as: "staff",
    cap: 500,
    seed: (_, n) =>
      `insert into private.partners(account_id,code,created_by)
       select gen_random_uuid(),upper(substr(md5(gen_random_uuid()::text),1,12)),gen_random_uuid() from generate_series(1,${n});`,
    sql: () => `select api.staff_list_partners() as r`,
    count: (r) => r.length,
  },
  {
    id: "LIM-F-restored_owner_dashboard",
    as: "member",
    cap: 10,
    seed: ({ user }, n) =>
      `insert into private.posts(owner_id,kind,area,category_key,title,province_id,city_id,status)
       select ${lit(user.id)},'listing','market',(select category_key from private.post_category_contracts where kind='listing' order by 1 limit 1),
         'Fixture post','gp','gp_johannesburg','draft' from generate_series(1,${n});`,
    sql: () => `select api.get_my_dashboard() as r`,
    count: (r) => r.posts.length,
  },
  {
    id: "LIM-F-restored_owner_dashboard-2",
    as: "member",
    cap: 3,
    seed: ({ user }, n) =>
      `insert into private.enquiries(id,request_id,post_id,owner_id,buyer_name,buyer_email,email_confirmed,message,status,created_at,updated_at,retain_until)
       select gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),${lit(user.id)},'Fixture Buyer','buyer@example.com',false,
         'Is this still available please?','new',now(),now(),now()+interval '1 year' from generate_series(1,${n});`,
    sql: () => `select api.get_my_dashboard() as r`,
    count: (r) => r.recent_leads.length,
  },
  // Staff pages: one page of a long list.
  ...[
    ["LIM-F-get_staff_payment_list-2", "select api.get_staff_payment_list(1,null) as r"],
    [
      "LIM-F-get_frontend_staff_payments-2",
      "select internal.get_frontend_staff_payments(1,null) as r",
    ],
  ].map(([id, sql]) => ({
    id,
    as: id.includes("frontend") ? "staff-owner" : "staff",
    cap: 50,
    seed: ({ user }, n) =>
      `insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,created_at)
       select ${lit(user.id)},'plan',gen_random_uuid(),100,'ZAR','{}'::jsonb,now()-make_interval(secs=>i) from generate_series(1,${n}) i;`,
    sql: () => sql,
    count: (r) => r.items.length,
  })),
  {
    id: "LIM-F-get_frontend_support_inbox-2",
    as: "staff",
    cap: 50,
    seed: (_, n) =>
      `insert into private.support_tickets(name,email,category,message)
       select 'Fixture Person','fixture@example.com','general_support','A synthetic support message.' from generate_series(1,${n});`,
    sql: () => `select api.get_frontend_support_inbox(1,null) as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-get_frontend_privacy_queue-2",
    as: "staff",
    cap: 25,
    seed: (_, n) =>
      `insert into private.privacy_requests(type,requester_email,description,identity_check,received_at,due_by,legal_basis)
       select 'access','fixture@example.com','A synthetic request','manual',now(),now()+interval '30 days','POPIA section 23'
       from generate_series(1,${n});`,
    sql: () => `select api.get_frontend_privacy_queue('open',1) as r`,
    count: (r) => r.items.length,
  },
];

describe("database read caps", () => {
  for (const row of READ_CAPS) {
    test(`${row.id}: at most ${row.cap} rows`, async () => {
      const user = await h.member(`cap-${row.id}`);
      const staffUser = await h.staff(`cap-staff-${row.id}`);
      await h.seed(row.seed({ user, staff: staffUser }, row.cap + 1));
      const sql = row.sql({ user, staff: staffUser });
      const rows =
        row.as === "member"
          ? await h.asMember(user, sql)
          : row.as === "staff"
            ? await h.asStaff(staffUser, sql)
            : row.as === "staff-owner"
              ? await h.asOwner(sql, staffUser)
              : await h.asVisitor(sql);
      assert.equal(row.count(rows[0].r), row.cap);
    });
  }
});

describe("public search page size", () => {
  test("LIM-SQL-search-default-page: 24 results when the request names no page size", async () => {
    const owner = await h.member("search-owner");
    const c = (
      await h.db.query(
        `select c.category_key as key,c.area,(select a.key from private.category_activities a join private.categories k on k.key=a.category_key
           where a.category_key=c.category_key and k.activity_required order by a.key limit 1) as activity
         from private.post_category_contracts c where c.kind='event' order by c.category_key limit 1`
      )
    ).rows[0];
    await h.seed(`with p as (
        insert into private.posts(owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id,status,published_at,visible_until)
        select ${lit(owner.id)},'event',${lit(c.area)},${lit(c.key)},${c.activity ? lit(c.activity) : "null"},'Fixture event',
          'A synthetic description long enough for every rule.','gp','gp_johannesburg','live',now()-interval '1 hour',now()+interval '7 days'
        from generate_series(1,25) returning id),
      d as (insert into private.event_details(post_id,starts_at,ends_at,timezone)
        select id,now()+interval '1 day',now()+interval '2 days','Africa/Johannesburg' from p returning post_id)
      insert into private.post_search_documents(post_id,kind,area,category_key,province_id,locality_label,title,published_at,is_visible,document)
        select post_id,'event',${lit(c.area)},${lit(c.key)},'gp','Johannesburg','Fixture event',now()-interval '1 hour',true,to_tsvector('simple','fixture')
        from d;`);
    const page = (await h.asVisitor(`select api.search_posts(${json({ area: c.area })}) as r`))[0]
      .r;
    assert.equal(page.items.length, 24);
  });
});
