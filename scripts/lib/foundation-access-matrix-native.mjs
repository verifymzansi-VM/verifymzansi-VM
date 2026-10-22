import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { buildFoundationEnquiry } from "../../src/lib/foundation/owner-inbox.ts";
import {
  attachFixtureCover,
  createPostingVerifier,
  createTrustedPostingFixture,
  publishFixturePost,
} from "./foundation-trusted-posting-fixture.mjs";
import reference from "../../src/lib/domains/taxonomy/reference.json" with { type: "json" };

// Reviewed role surface of the production API; every other command is for
// signed-in accounts only.
export const ANON_API = [
  "billing_catalogue",
  "get_current_posting_terms",
  "get_public_organisation",
  "get_public_post",
  "preview_organisation_invite",
  "public_organisation_directory",
  "public_post_affiliations",
  "public_post_sponsorships",
  "public_programme_showcases",
  "reference_catalog",
  "search_posts",
];
export const SERVICE_API = [
  "advance_evidence_artifact",
  "apply_provider_event",
  "approve_due_commissions",
  "attach_provider_request",
  "check_cost_alarms",
  "claim_evidence_cleanup",
  "claim_media_cleanup",
  "claim_verification_phone_attempt",
  "close_account_evidence",
  "create_verification_phone_challenge",
  "finalize_media",
  "finalize_verification_phone",
  "grant_verified_intro_trial",
  "identity_status",
  "mark_media_deleted",
  "purge_expired_identity_bans",
  "purge_expired_inbox",
  "purge_expired_trial_identities",
  "reconcile_verified_identity_ban",
  "register_identity_submission",
  "reverse_payment",
  "run_post_lifecycle",
  "run_retention",
  "submit_enquiry",
  "submit_report",
  "sweep_sponsorships",
];
// Local fixture drivers, never part of the clean candidate.
const FIXTURE_ONLY_API = [
  "enqueue_transport_reconciliation",
  "grant_intro_trial",
  "record_identity_ban",
  "rename_transport_resource",
];
// Reviewed exceptions: who may see which of owner A's private values, and
// through which command. Anything else observed by a non-owner fails.
const ALLOWED = new Set([
  // The organisation administrator reviews A's consented application and,
  // once approved, lists the affiliated business profile.
  "orgAdmin:org_list_applications:applicationId",
  "orgAdmin:org_list_applications:businessDraftId",
  "orgAdmin:org_list_affiliations:businessDraftId",
  // Staff with organisation:manage (admin, recent second factor) act for any
  // organisation and see the same minimal application and affiliation lists.
  "admin:org_list_applications:applicationId",
  "admin:org_list_applications:businessDraftId",
  "admin:org_list_affiliations:businessDraftId",
]);
const APPLICATION_SCHEMAS = ["public", "api", "private", "internal"];

// Synthetic local proof that owner A's personal data is reachable only by A,
// by A's consented organisation reviewer, and by staff whose capability
// covers it; that signed-out visitors and other accounts get none of it; and
// that no other caller can change it. Every production API command is called
// as every principal with A's real identifiers and the current revisions.
export async function testAccessMatrix({
  createUser,
  rpc,
  sql,
  sqlFails,
  record,
  fixtureAdminId,
  stage,
}) {
  stage("access matrix catalogue role surface");
  const catalogue = JSON.parse(
    sql(
      "select json_agg(json_build_object('name',p.proname,'definer',p.prosecdef," +
        "'anon',has_function_privilege('anon',p.oid,'execute')," +
        "'authenticated',has_function_privilege('authenticated',p.oid,'execute')," +
        "'service',has_function_privilege('service_role',p.oid,'execute')," +
        "'args',coalesce((select json_agg(json_build_object('name',p.proargnames[i+1],'type',format_type(p.proargtypes[i],null)) order by i) from generate_series(0,p.pronargs-1) i),'[]'::json)) order by p.proname) " +
        "from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='api';"
    )
  ).filter((fn) => !FIXTURE_ONLY_API.includes(fn.name));
  const byRole = (pick) =>
    catalogue
      .filter(pick)
      .map((fn) => fn.name)
      .sort();
  assert.deepEqual(
    byRole((fn) => fn.anon),
    [...ANON_API].sort()
  );
  assert.deepEqual(
    byRole((fn) => fn.anon && !fn.authenticated),
    []
  );
  assert.deepEqual(
    byRole((fn) => fn.service && !fn.anon && !fn.authenticated),
    [...SERVICE_API].sort()
  );
  assert.deepEqual(
    byRole((fn) => fn.service && fn.authenticated),
    []
  );
  assert.deepEqual(
    byRole((fn) => !fn.anon && !fn.authenticated && !fn.service),
    []
  );
  assert.deepEqual(
    byRole((fn) => fn.definer),
    []
  );
  // Internal commands open to signed-out callers are exactly the public reads.
  const anonInternal = sql(
    "select coalesce(string_agg(p.proname,',' order by p.proname),'') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='internal' and has_function_privilege('anon',p.oid,'execute');"
  ).split(",");
  assert.deepEqual(anonInternal, [...ANON_API].sort());
  record("native-access-api-role-surface-matches-reviewed-anon-service-authenticated-lists");

  const schemas = APPLICATION_SCHEMAS.map((s) => "'" + s + "'").join(",");
  assert.equal(
    sql(
      "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (" +
        schemas +
        ") and c.relkind in ('r','p') and not c.relrowsecurity;"
    ),
    "0"
  );
  assert.equal(
    sql(
      "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join unnest(array['anon','authenticated','service_role']) r " +
        "where n.nspname in (" +
        schemas +
        ") and c.relkind in ('r','p','v','m','f','S') and (" +
        "has_table_privilege(r,c.oid,'select,insert,update,delete,truncate,references,trigger') or " +
        "(c.relkind<>'S' and has_any_column_privilege(r,c.oid,'select,insert,update,references')) or " +
        "(c.relkind='S' and has_sequence_privilege(r,c.oid,'usage,select,update')));"
    ),
    "0"
  );
  assert.equal(sql("select count(*) from pg_policies where schemaname in (" + schemas + ");"), "0");
  assert.equal(
    sql(
      "select has_schema_privilege('anon','private','usage')::text||has_schema_privilege('authenticated','private','usage')::text||has_schema_privilege('service_role','private','usage')::text;"
    ),
    "falsefalsefalse"
  );
  assert.equal(
    sql(
      "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in (" +
        schemas +
        ") and c.relkind in ('v','m') and not coalesce(c.reloptions @> array['security_invoker=true'],false);"
    ),
    "0"
  );
  record(
    "native-access-every-application-table-rls-no-role-grants-no-policies-private-schema-closed"
  );

  stage("access matrix RLS event trigger");
  assert.equal(
    sql(
      "select evtenabled::text||':'||evtevent||':'||evtfoid::regproc::text from pg_event_trigger where evtname='require_table_rls';"
    ),
    "O:ddl_command_end:internal.require_table_rls"
  );
  const probe = "zz_rls_guard_" + randomBytes(4).toString("hex");
  try {
    sql("create table private." + probe + "(id integer primary key);");
    sql("create table public." + probe + " as select 1 as id;");
    assert.equal(
      sql(
        "select string_agg(relrowsecurity::text,',') from pg_class where relname='" + probe + "';"
      ),
      "true,true"
    );
    sqlFails("alter table private." + probe + " disable row level security;", "42501");
    sqlFails("alter table public." + probe + " disable row level security;", "42501");
    assert.equal(
      sql("select bool_and(relrowsecurity) from pg_class where relname='" + probe + "';"),
      "t"
    );
  } finally {
    sql("drop table if exists private." + probe + "; drop table if exists public." + probe + ";");
  }
  record("native-access-new-application-tables-get-rls-and-cannot-drop-it");

  stage("access matrix principals");
  const reviewer = await createPostingVerifier({ createUser, sql, fixtureAdminId });
  const fixture = createTrustedPostingFixture({ rpc, sql, reviewer });
  const staff = {};
  for (const role of ["moderator", "governor", "admin"])
    staff[role] = await createPostingVerifier({
      createUser,
      sql,
      fixtureAdminId,
      role,
      label: "access-" + role,
    });
  const owner = await createUser("access-owner");
  const other = await createUser("access-other");
  const unverified = await createUser("access-unverified");
  const orgAdmin = await createUser("access-org-admin");
  const call = async (name, body, user = owner, service = false) => {
    const response = await rpc(name, body, user?.token ?? null, service);
    assert.equal(response.status, 200, "access fixture " + name);
    return response.data;
  };
  const letters = () => [...randomBytes(8)].map((b) => String.fromCharCode(97 + (b % 26))).join("");
  const surname = "Zq" + letters();
  const profile = await call("get_my_profile", {});
  await call("save_my_legal_name", {
    p_expected_revision: profile.revision,
    p_first_name: "Access",
    p_last_name: surname,
  });
  const verified = await fixture.ready(owner);
  await fixture.ready(other);
  await fixture.ready(orgAdmin);

  stage("access matrix owner data");
  const liveEvent = async () => {
    let post = await call("create_core_draft", {
      p_kind: "event",
      p_area: "tourism_events",
      p_category_key: "events",
      p_activity_key: reference.activities.find((a) => a.category === "events").key,
      p_detail: {
        contact_channels: ["form", "call"],
        starts_at: new Date(Date.now() - 60000).toISOString(),
        ends_at: new Date(Date.now() + 7200000).toISOString(),
        timezone: "Africa/Johannesburg",
      },
    });
    post = await call("save_post_content", {
      p_post_id: post.id,
      p_expected_revision: post.revision,
      p_content: {
        title: "Synthetic access matrix event",
        description: "Synthetic local access matrix verification event.",
        province_id: "gp",
        city_id: "gp_johannesburg",
      },
    });
    post = await attachFixtureCover(call, post, owner);
    return publishFixturePost({ call, sql, post, reviewer });
  };
  const live = await liveEvent();
  const buyer = {
    email: "buyer-" + letters() + "@example.invalid",
    phone: "+2782" + String(randomBytes(4).readUInt32BE(0) % 10000000).padStart(7, "0"),
    name: "Buyer " + letters(),
    message: "Synthetic private question " + letters(),
  };
  const enquiry = await rpc(
    "submit_enquiry",
    buildFoundationEnquiry(
      {
        request_id: randomUUID(),
        post_id: live.id,
        buyer_name: buyer.name,
        buyer_email: buyer.email,
        buyer_phone: buyer.phone,
        message: buyer.message,
      },
      null
    ),
    null,
    true
  );
  assert.equal(enquiry.status, 200);
  await call("grant_verified_intro_trial", { p_owner: owner.id, p_days: 7 }, null, true);
  let business = await call("create_core_draft", {
    p_kind: "business",
    p_area: "business",
    p_category_key: "automotive_services",
    p_detail: {},
  });
  business = await call("save_post_content", {
    p_post_id: business.id,
    p_expected_revision: business.revision,
    p_content: {
      title: "Synthetic access workshop",
      description: "Synthetic local business for access matrix verification.",
      province_id: "gp",
      city_id: "gp_johannesburg",
    },
  });
  business = await attachFixtureCover(call, business, owner);
  await staff.admin.refresh();
  const reason = "Synthetic access matrix organisation";
  const orgSlug = "access-org-" + letters();
  const org = await call(
    "create_organisation",
    { p_slug: orgSlug, p_name: "Synthetic Access Org", p_type: "other", p_reason: reason },
    staff.admin
  );
  await call(
    "update_organisation",
    {
      p_id: org.id,
      p_expected_revision: org.revision,
      p_patch: { is_public: true, programme_status: "founding_trial", admin_limit: 2 },
      p_reason: reason,
    },
    staff.admin
  );
  const programme = await call(
    "save_organisation_programme",
    { p_org: org.id, p_slug: "access-pilot", p_name: "Access pilot", p_reason: reason },
    staff.admin
  );
  const inviteToken = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(inviteToken).digest("hex");
  const emailOf = (user) => sql("select email from auth.users where id='" + user.id + "';");
  await call(
    "invite_organisation_admin",
    { p_org: org.id, p_email: emailOf(orgAdmin), p_token_hash: tokenHash, p_reason: reason },
    staff.admin
  );
  await call("accept_organisation_invite", { p_token_hash: tokenHash }, orgAdmin);
  const application = await call("apply_to_organisation", {
    p_org: org.id,
    p_post_id: business.id,
    p_programme: programme.id,
    p_share_representative_name: false,
    p_consent: true,
    p_reason: "We are members of this synthetic organisation.",
  });
  const plans = (await call("billing_catalogue", {}, null)).plans;
  const checkout = await call("start_checkout", {
    p_product_id: plans.find((plan) => plan.code === "market_30d").id,
  });

  // Owner A's private values. Phone numbers are matched on their last nine
  // digits so a reformatted number is still caught.
  const one = (statement) => sql(statement).split("\n").filter(Boolean);
  const ids = {
    caseId: verified.caseId,
    submissionId: verified.submissionId,
    factId: verified.factId,
    proofId: verified.proofId,
    enquiryId: one("select id from private.enquiries where owner_id='" + owner.id + "';")[0],
    notificationId: one(
      "select id from private.notifications where account_id='" +
        owner.id +
        "' order by created_at limit 1;"
    )[0],
    paymentId: checkout.payment_id,
    applicationId: application.id,
    businessDraftId: business.id,
  };
  one(
    "select id from private.evidence_artifacts where owner_id='" + owner.id + "' order by id;"
  ).forEach((id, index) => (ids["artifactId" + index] = id));
  for (const [name, value] of Object.entries(ids))
    assert.match(value ?? "", /^[a-f0-9-]{36}$/, name);
  const canaries = {
    ...ids,
    surname,
    ownerEmail: emailOf(owner),
    ownerPhone: verified.phone.slice(-9),
    buyerEmail: buyer.email,
    buyerPhone: buyer.phone.slice(-9),
    buyerName: buyer.name,
    buyerMessage: buyer.message,
  };
  const leaks = (text, sent) =>
    Object.entries(canaries)
      .filter(([, value]) => text.includes(value) && !sent.includes(value))
      .map(([name]) => name);

  // The owner sees their own data, so the probes are known to be detectable.
  const ownView = [
    JSON.stringify(await call("get_my_profile", {})),
    JSON.stringify(await call("list_my_enquiries", {})),
    JSON.stringify(await call("list_my_notifications", {})),
    JSON.stringify(await call("get_owner_post_contacts", { p_post_id: live.id })),
    JSON.stringify(await call("get_owner_verification_readiness", {})),
  ].join("");
  for (const name of [
    "surname",
    "buyerEmail",
    "buyerPhone",
    "buyerMessage",
    "enquiryId",
    "notificationId",
  ])
    assert.ok(leaks(ownView, "").includes(name), "owner view lacks " + name);
  // The verified phone and sign-in email are stored but no command returns
  // them, not even to the owner; they still count as leaks if any caller sees them.
  assert.equal(leaks(ownView, "").includes("ownerPhone"), false);
  assert.equal(
    sql(
      "select count(*) from private.verification_phone_proofs where owner_id='" +
        owner.id +
        "' and revoked_at is null and phone like '%" +
        canaries.ownerPhone +
        "';"
    ),
    "1"
  );
  record("native-access-owner-reads-own-profile-enquiries-and-notifications");

  stage("access matrix sweep");
  const digest = (skip = []) =>
    sql(
      "select md5(coalesce(string_agg(x,'|' order by x),'')) from (" +
        [
          ["profiles", "account_id='" + owner.id + "'"],
          ["identity_submission_names", "owner_id='" + owner.id + "'"],
          ["posts", "owner_id='" + owner.id + "'"],
          [
            "post_contacts",
            "post_id in (select id from private.posts where owner_id='" + owner.id + "')",
          ],
          [
            "post_media",
            "post_id in (select id from private.posts where owner_id='" + owner.id + "')",
          ],
          ["media_objects", "owner_id='" + owner.id + "'"],
          ["enquiries", "owner_id='" + owner.id + "'"],
          ["notifications", "account_id='" + owner.id + "'"],
          ["evidence_cases", "subject_id='" + owner.id + "'"],
          ["evidence_artifacts", "owner_id='" + owner.id + "'"],
          ["verification_identity_submissions", "owner_id='" + owner.id + "'"],
          ["accepted_identity_facts", "owner_id='" + owner.id + "'"],
          ["verification_phone_proofs", "owner_id='" + owner.id + "'"],
          ["verification_localities", "owner_id='" + owner.id + "'"],
          ["payments", "owner_id='" + owner.id + "'"],
          ["entitlements", "owner_id='" + owner.id + "'"],
          ["organisation_applications", "applicant_id='" + owner.id + "'"],
          ["legal_holds", "subject_id='" + owner.id + "'"],
          ["organisation_sponsorships", "owner_id='" + owner.id + "'"],
          ["account_acquisitions", "account_id='" + owner.id + "'"],
          ["partners", "account_id='" + owner.id + "'"],
          ["partner_commissions", "referred_account_id='" + owner.id + "'"],
        ]
          .filter(([table]) => !skip.includes(table))
          .map(
            ([table, where]) =>
              "select '" +
              table +
              "'||to_jsonb(t)::text x from private." +
              table +
              " t where " +
              where
          )
          .join(" union all ") +
        ") rows;"
    );
  // Revision fences take the target's current value, so a missing ownership
  // check would let the call succeed.
  const revisionOf = (id) =>
    Number(
      sql(
        "select coalesce((select revision from private.posts where id='" +
          id +
          "'),(select revision from private.organisations where id='" +
          id +
          "'),1);"
      )
    );
  const caseVersion = () =>
    Number(sql("select version from private.evidence_cases where id='" + ids.caseId + "';"));
  const mediaIds = one(
    "select id from private.media_objects where owner_id='" + owner.id + "' order by id;"
  );
  const uuidCandidates = (name) =>
    ({
      p_post_id: [live.id, business.id],
      p_id: [live.id, business.id, org.id],
      p_post_a: [live.id],
      p_post_b: [business.id],
      p_target_post: [live.id],
      p_case: [ids.caseId],
      p_case_id: [ids.caseId],
      p_submission: [ids.submissionId],
      p_artifact_id: [ids.artifactId0],
      p_owner: [owner.id],
      p_account: [owner.id],
      p_user_id: [owner.id],
      p_subject_id: [owner.id],
      p_sender: [owner.id],
      p_reporter_id: [owner.id],
      p_application: [ids.applicationId],
      p_org: [org.id],
      p_programme: [programme.id],
      p_payment_id: [ids.paymentId],
      p_object_id: mediaIds.slice(0, 2),
      p_fact: [ids.factId],
      p_challenge: one(
        "select id from private.verification_phone_challenges where owner_id='" +
          owner.id +
          "' limit 1;"
      ),
      p_product_id: [plans[0].id],
      p_before_id: [ids.enquiryId],
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
      p_token_hash: tokenHash,
      p_kind: "listing",
      p_queue: "posts",
      p_outcome: "dismissed",
      p_category: "other",
      p_email: emailOf(other),
    })[name] ?? "Synthetic access sweep value";
  const intValue = (name, body) =>
    name === "p_expected_version"
      ? caseVersion()
      : name === "p_expected_revision_a"
        ? revisionOf(body.p_post_a)
        : name === "p_expected_revision_b"
          ? revisionOf(body.p_post_b)
          : /revision/.test(name)
            ? revisionOf(body.p_post_id ?? body.p_id ?? live.id)
            : name === "p_limit"
              ? 50
              : name === "p_bytes" || name === "p_size"
                ? 128
                : 1;
  const bodies = (fn) => {
    let combos = [{}];
    for (const arg of fn.args) {
      let values;
      if (arg.type === "uuid") values = uuidCandidates(arg.name);
      else if (arg.type === "uuid[]")
        values = [arg.name === "p_ids" ? [ids.notificationId] : [live.id, business.id]];
      else if (arg.type === "integer") values = [null];
      else if (arg.type === "boolean") values = [true];
      else if (arg.type === "jsonb") values = [{}];
      else if (arg.type.startsWith("timestamp")) values = [null];
      else if (arg.name === "p_status" && fn.name.includes("list_")) values = [null];
      else values = [textValue(arg.name)];
      combos = combos.flatMap((body) => values.map((value) => ({ ...body, [arg.name]: value })));
    }
    return combos.slice(0, 8).map((body) => {
      for (const arg of fn.args)
        if (arg.type === "integer") body[arg.name] = intValue(arg.name, body);
      return body;
    });
  };
  const observed = [];
  const outcomes = new Map();
  const sweep = async (label, principal) => {
    for (const fn of catalogue) {
      for (const body of bodies(fn)) {
        if (principal?.refresh) await principal.refresh();
        const response = await rpc(fn.name, body, principal?.token ?? null);
        if (!principal && !fn.anon) {
          assert.equal(response.status, 401, label + " " + fn.name);
          assert.equal(response.data.code, "42501");
        } else if (principal && !fn.authenticated) {
          assert.equal(response.status, 403, label + " " + fn.name);
          assert.equal(response.data.code, "42501");
        }
        const key = label + ":" + fn.name;
        outcomes.set(key, [...(outcomes.get(key) ?? []), response]);
        for (const name of leaks(JSON.stringify(response.data), JSON.stringify(body)))
          observed.push(label + ":" + fn.name + ":" + name);
      }
    }
  };
  const before = digest();
  await sweep("anon", null);
  await sweep("other", other);
  await sweep("unverified", unverified);
  assert.equal(digest(), before, "a non-owner changed owner A's data");
  // The organisation administrator may decide A's consented application (and
  // A is notified); nothing else of A's may change.
  const beforeOrg = digest(["organisation_applications", "notifications"]);
  await sweep("orgAdmin", orgAdmin);
  assert.equal(digest(["organisation_applications", "notifications"]), beforeOrg);
  record("native-access-anon-other-unverified-and-org-admin-cannot-change-owner-data");
  for (const role of ["moderator", "governor", "admin"]) await sweep(role, staff[role]);
  const unexpected = [...new Set(observed)].filter((entry) => !ALLOWED.has(entry)).sort();
  assert.deepEqual(unexpected, []);
  // Each staff role is refused exactly the commands whose capability it lacks,
  // as read from private.staff_capabilities; a role holding the capability
  // always gets past the capability check.
  const granted = JSON.parse(
    sql(
      "select json_object_agg(role,caps) from (select role,json_agg(capability) caps from private.staff_capabilities group by role) r;"
    )
  );
  const capabilities = JSON.parse(
    sql(
      "select json_object_agg(p.proname,c.caps) from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral (select array_agg(distinct m[1]) caps from regexp_matches(p.prosrc,'staff_actor[(]''([a-z_:]+)''[)]','g') m) c where n.nspname='internal' and c.caps is not null;"
    )
  );
  let capabilityChecks = 0;
  for (const fn of catalogue) {
    const caps = capabilities[fn.name];
    if (!fn.authenticated || !caps || caps.length !== 1) continue;
    for (const role of ["moderator", "governor", "admin"]) {
      const results = outcomes.get(role + ":" + fn.name);
      const denied = (r) => r.status === 403 && r.data.message === "capability not granted";
      if (granted[role].includes(caps[0])) assert.ok(!results.some(denied), role + " " + fn.name);
      else assert.ok(results.every(denied), role + " lacks " + caps[0] + " for " + fn.name);
      capabilityChecks++;
    }
  }
  assert.ok(capabilityChecks >= 60);
  // Positive control: the consented reviewer really does see the application.
  assert.ok(observed.includes("orgAdmin:org_list_applications:applicationId"));
  record("native-access-every-api-command-as-every-principal-reveals-only-reviewed-owner-data", {
    commands: catalogue.length,
    principals: 7,
    capabilityChecks,
    reviewedExceptions: [...ALLOWED].sort(),
  });
}
