// Database limits from docs/testing/limits-register.json on what a read
// returns and how much a sweep does in one run: read caps (a read returns at
// most N rows when N + 1 exist), default page sizes, caps of 1,000 to 10,000
// rows, thresholds on stored counts, and batch sizes of the scheduled sweeps.
// Each runs the real function on the replayed production schema (embedded
// Postgres, no Docker, no hosted database). Large fixtures are written in one
// statement with generate_series.
//
//   node --import tsx --test scripts/limits-sql-reads.test.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import { lit, openLimitsDb, refused } from "./lib/limits-sql-harness.mjs";
import {
  acceptIdentity,
  businessCase,
  businessPost,
  heldIdentityCase,
  livePosts,
} from "./lib/limits-sql-fixtures.mjs";

let h;
before(async () => {
  h = await openLimitsDb();
});
after(async () => {
  await h?.db.close();
});

const call = (who, role, sql) =>
  role === "member"
    ? h.asMember(who, sql)
    : role === "staff"
      ? h.asStaff(who, sql)
      : role === "service"
        ? h.asService(sql)
        : role === "visitor"
          ? h.asVisitor(sql)
          : h.asOwner(sql, who);

// ---------------------------------------------------------------- fixture SQL

const CATEGORY = `(select category_key from private.post_category_contracts where kind='business' order by 1 limit 1)`;
/** `n` business posts of `owner` (drafts unless `status`), named by the series value. */
const draftBusinesses = (owner, n, status = "draft") =>
  `insert into private.posts(owner_id,kind,area,category_key,title,description,province_id,city_id,status,created_at)
   select ${lit(owner)},'business','business',${CATEGORY},'Fixture business','A synthetic description long enough for every rule.',
     'gp','gp_johannesburg',${lit(status)},now()-make_interval(secs=>i) from generate_series(1,${n}) i;`;
/** `n` listed organisations, returned by a CTE named `o`. */
const orgs = (n) =>
  `o as (insert into private.organisations(slug,name,is_public,programme_status)
     select 'fixture-'||replace(gen_random_uuid()::text,'-',''),'Fixture Organisation',true,'affiliation_only'
     from generate_series(1,${n}) returning id)`;
const messages = (checkId, n) =>
  `insert into private.frontend_business_check_messages(check_id,author_role,body,created_at)
   select ${lit(checkId)},'staff','A synthetic message',now()-make_interval(secs=>i) from generate_series(1,${n}) i;`;
/**
 * `n` business checks of `owner` (seen by default): an open one needs its own
 * business (one open check per business and kind), so each gets a new
 * business post unless `business` is given for decided checks.
 */
function businessChecks(owner, n, { status = "pending", kind = "seen", business = null } = {}) {
  const open = status === "pending";
  const post = business ? `${lit(business)}::uuid` : "gen_random_uuid()";
  const posts = business
    ? "select 1"
    : `insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id,status)
       select post,${lit(owner)},'business','business',${CATEGORY},'Fixture business','A synthetic description long enough for every rule.',
         'gp','gp_johannesburg','draft' from p returning 1`;
  // A seen check needs its method, slots and consent; a CIPC check its review.
  const seen = kind === "seen" ? "'video',array['Monday morning'],now()" : "null,null,null";
  const finish =
    kind === "seen"
      ? "select count(*) from b, posts, c"
      : `insert into private.frontend_cipc_reviews(check_id,registration_number,route,submitted_at)
         select id,'2020/'||lpad((row_number() over ())::text,6,'0')||'/07','director',now() from b`;
  return `with p as (select ${post} as post,gen_random_uuid() as id,i from generate_series(1,${n}) i),
     posts as (${posts}),
     c as (insert into private.evidence_cases(id,subject_id,kind,status)
       select id,${lit(owner)},'business',${open ? "'open'" : "'decided'"} from p returning id),
     b as (insert into private.frontend_business_checks(id,business_id,owner_id,kind,status,seen_method,available_slots,screenshots_consent_at,decided_at,created_at)
       select p.id,p.post,${lit(owner)},${lit(kind)},${lit(status)},${seen},${open ? "null" : "now()"},now()-make_interval(secs=>p.i) from p returning id)
   ${finish};`;
}

// ---------------------------------------------------------------- read caps
//
// Each row: `setup` (optional) makes the fixtures the read needs, `seed`
// writes cap + 1 rows, `sql` reads as the caller, `count` picks the list.

const READ_CAPS = [
  {
    id: "LIM-F-get_frontend_affiliation_workspace-2",
    as: "member",
    cap: 1000,
    seed: ({ user }, n) => draftBusinesses(user.id, n),
    sql: () => `select api.get_frontend_affiliation_workspace(null) as r`,
    count: (r) => r.businesses.length,
  },
  {
    id: "LIM-F-get_frontend_affiliation_workspace-3",
    as: "member",
    cap: 100,
    seed: ({ user }, n) =>
      `with ${orgs(1)} insert into private.organisation_applications(organisation_id,post_id,post_kind,applicant_id,share_representative_name,consented_at,created_at)
       select o.id,gen_random_uuid(),'business',${lit(user.id)},false,now(),now()-make_interval(secs=>i) from o,generate_series(1,${n}) i;`,
    sql: () => `select api.get_frontend_affiliation_workspace(null) as r`,
    count: (r) => r.applications.length,
  },
  {
    id: "LIM-F-get_frontend_affiliation_workspace-4",
    as: "member",
    cap: 1000,
    setup: async ({ user }) => ({ post: await businessPost(h, user, { status: "draft" }) }),
    seed: ({ post }, n) =>
      `with ${orgs(n)} insert into private.organisation_affiliations(organisation_id,post_id,post_kind,status,confirmed_at,confirmed_by)
       select o.id,${lit(post)},'business','active',now(),gen_random_uuid() from o;`,
    sql: () => `select api.get_frontend_affiliation_workspace(null) as r`,
    count: (r) => r.affiliations.length,
  },
  {
    id: "LIM-F-get_frontend_appeal_queue",
    as: "staff",
    cap: 50,
    seed: (_, n) =>
      `insert into private.frontend_appeals(action_id,appellant_id,kind,reason,status)
       select gen_random_uuid(),gen_random_uuid(),'warning','A synthetic appeal reason','submitted' from generate_series(1,${n});`,
    sql: () => `select api.get_frontend_appeal_queue(null) as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-get_frontend_business_review_queue",
    as: "staff",
    cap: 200,
    setup: async () => ({ owner: await h.member("cipc-queue-owner") }),
    seed: ({ owner }, n) => businessChecks(owner.id, n, { kind: "cipc" }),
    sql: () => `select api.get_frontend_business_review_queue('review') as r`,
    count: (r) => r.rows.length,
  },
  {
    // The staff business review queue reads this internal function; called
    // directly with the staff member's claims (no API command of its own).
    id: "LIM-F-get_frontend_seen_queue",
    as: "staff-owner",
    cap: 200,
    setup: async () => ({ owner: await h.member("seen-queue-owner") }),
    seed: ({ owner }, n) => businessChecks(owner.id, n),
    sql: () => `select internal.get_frontend_seen_queue('visits') as r`,
    count: (r) => r.rows.length,
  },
  ...[
    [
      "LIM-F-get_frontend_cipc_case",
      "cipc",
      "get_frontend_cipc_case",
      (r) => r.messages.length,
      100,
    ],
    [
      "LIM-F-get_frontend_seen_case",
      "seen",
      "get_frontend_seen_case",
      (r) => r.messages.length,
      100,
    ],
  ].map(([id, kind, fn, count, cap]) => ({
    id,
    as: "staff",
    cap,
    setup: async ({ staff }) => {
      const owner = await h.member(`${fn}-owner`);
      const business = await businessPost(h, owner);
      return { c: await businessCase(h, owner, business, { kind, claimedBy: staff }) };
    },
    seed: ({ c }, n) => messages(c.id, n),
    sql: ({ c }) => `select api.${fn}(${lit(c.id)}) as r`,
    count,
  })),
  {
    id: "LIM-F-get_frontend_cipc_case-2",
    as: "staff",
    cap: 10,
    setup: async ({ staff }) => {
      const owner = await h.member("cipc-access-owner");
      const business = await businessPost(h, owner);
      return { c: await businessCase(h, owner, business, { kind: "cipc", claimedBy: staff }) };
    },
    seed: ({ c, staff }, n) =>
      `insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids,accessed_at)
       select ${lit(staff.id)},${lit(c.id)},'routine_review',1,1,'{}',now()-make_interval(mins=>i) from generate_series(1,${n}) i;`,
    sql: ({ c }) => `select api.get_frontend_cipc_case(${lit(c.id)}) as r`,
    count: (r) => r.accessLog.length,
  },
  ...[
    ["LIM-F-get_frontend_enforcement", 50, (r) => r.items.length],
    ["LIM-F-get_frontend_enforcement-2", 20, (r) => r.recent.length],
  ].map(([id, cap, count]) => ({
    id,
    as: "staff",
    cap,
    seed: (_, n) =>
      `with d as (insert into private.decisions(id,case_id,action,payload,case_version,reviewed_snapshot,proposed_by,status,approved_by,approved_at)
          select gen_random_uuid(),gen_random_uuid(),'restrict_account','{}'::jsonb,1,'[]'::jsonb,gen_random_uuid(),'approved',gen_random_uuid(),now()
          from generate_series(1,${n}) returning id)
       insert into private.frontend_account_restrictions(decision_id,account_id,kind,reason,emergency,starts_at)
       select id,gen_random_uuid(),'ban','A synthetic restriction reason',false,now()-make_interval(secs=>row_number() over ()) from d;`,
    sql: () => `select api.get_frontend_enforcement() as r`,
    count,
  })),
  {
    id: "LIM-F-get_frontend_partner_admin",
    as: "staff",
    cap: 500,
    seed: (_, n) =>
      `insert into private.partners(account_id,code,created_by)
       select gen_random_uuid(),upper(substr(md5(gen_random_uuid()::text),1,12)),gen_random_uuid() from generate_series(1,${n});`,
    sql: () => `select api.get_frontend_partner_admin() as r`,
    count: (r) => r.partners.length,
  },
  {
    id: "LIM-F-get_frontend_partner_admin-2",
    as: "staff",
    cap: 200,
    seed: ({ user }, n) =>
      `with p as (insert into private.partners(account_id,code,created_by) values(gen_random_uuid(),upper(substr(md5(gen_random_uuid()::text),1,12)),gen_random_uuid()) returning id),
         pay as (insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot)
           select ${lit(user.id)},'plan',gen_random_uuid(),1000,'ZAR','{}'::jsonb from generate_series(1,${n}) returning id)
       insert into private.partner_commissions(partner_id,payment_id,base_cents,rate_bps,amount_cents,eligible_at)
       select p.id,pay.id,1000,2000,200,now() from p,pay;`,
    sql: () => `select api.get_frontend_partner_admin() as r`,
    count: (r) => r.commissions.length,
  },
  {
    id: "LIM-F-get_frontend_staff_role_review-2",
    as: "staff",
    cap: 50,
    seed: (_, n) =>
      `insert into private.staff_roles(user_id,role,granted_at) select gen_random_uuid(),'moderator',now()+make_interval(secs=>i) from generate_series(1,${n}) i;`,
    sql: () => `select api.get_frontend_staff_role_review(1,null) as r`,
    count: (r) => r.staff.length,
  },
  ...[
    ["LIM-F-get_frontend_staff_role_review-3", 100, "proposed", "null", (r) => r.pending.length],
    ["LIM-F-get_frontend_staff_role_review-4", 25, "applied", "now()", (r) => r.history.length],
  ].map(([id, cap, status, decided, count]) => ({
    id,
    as: "staff",
    cap,
    seed: (_, n) =>
      `insert into private.frontend_staff_role_changes(target_id,from_role,to_role,proposer_id,reviewer_id,reason,status,created_at,expires_at,decided_at)
       select gen_random_uuid(),'member','moderator',gen_random_uuid(),${status === "applied" ? "gen_random_uuid()" : "null"},'A synthetic role reason',
         ${lit(status)},now(),now()+interval '1 day',${decided} from generate_series(1,${n});`,
    sql: () => `select api.get_frontend_staff_role_review(1,null) as r`,
    count,
  })),
  // internal.get_my_frontend_business_checks has no API command of its own; it
  // is called directly with the member's claims.
  ...[
    ["LIM-F-get_my_frontend_business_checks", "internal.get_my_frontend_business_checks", 100],
    [
      "LIM-F-get_my_frontend_business_review_state",
      "api.get_my_frontend_business_review_state",
      100,
    ],
  ].map(([id, fn, cap]) => ({
    id,
    as: fn.startsWith("internal.") ? "member-owner" : "member",
    cap,
    setup: async ({ user }) => {
      const business = await businessPost(h, user);
      return { business, c: await businessCase(h, user, business) };
    },
    seed: ({ c }, n) => messages(c.id, n),
    sql: ({ business }) => `select ${fn}(${lit(business)}) as r`,
    count: (r) => r.cases[0].messages.length,
  })),
  ...[
    ["LIM-F-get_my_frontend_business_checks-2", "internal.get_my_frontend_business_checks"],
    ["LIM-F-get_my_frontend_business_review_state-2", "api.get_my_frontend_business_review_state"],
  ].map(([id, fn]) => ({
    id,
    as: fn.startsWith("internal.") ? "member-owner" : "member",
    cap: 20,
    setup: async ({ user }) => ({ business: await businessPost(h, user) }),
    seed: ({ user, business }, n) => businessChecks(user.id, n, { status: "rejected", business }),
    sql: ({ business }) => `select ${fn}(${lit(business)}) as r`,
    count: (r) => r.cases.length,
  })),
  {
    // Approved CIPC stickers of the member's other businesses.
    id: "LIM-F-get_my_frontend_business_review_state-3",
    as: "member",
    cap: 100,
    setup: async ({ user }) => {
      await acceptIdentity(h, user);
      return { business: await businessPost(h, user) };
    },
    seed: ({ user }, n) =>
      `with p as (insert into private.posts(owner_id,kind,area,category_key,title,description,province_id,city_id,status)
           select ${lit(user.id)},'business','business',${CATEGORY},'Fixture business '||i,'A synthetic description long enough for every rule.',
             'gp','gp_johannesburg','draft' from generate_series(1,${n}) i returning id),
         c as (insert into private.evidence_cases(id,subject_id,kind,status) select gen_random_uuid(),${lit(user.id)},'business','decided' from p returning id),
         pc as (select p.id post, c.id check_id from (select id,row_number() over () r from p) p join (select id,row_number() over () r from c) c using (r)),
         b as (insert into private.frontend_business_checks(id,business_id,owner_id,kind,status,decided_at,expires_at)
           select check_id,post,${lit(user.id)},'cipc','approved',now(),now()+interval '300 days' from pc returning id)
       insert into private.frontend_cipc_reviews(check_id,registration_number,route,submitted_at)
       select id,'2021/'||lpad((row_number() over ())::text,6,'0')||'/07','director',now() from b;`,
    sql: ({ business }) =>
      `select api.get_my_frontend_business_review_state(${lit(business)}) as r`,
    count: (r) => r.linkable.length,
  },
  {
    id: "LIM-F-get_my_frontend_decisions",
    as: "member",
    cap: 100,
    seed: ({ user }, n) =>
      `insert into private.frontend_content_holds(id,account_id,reason,applied_at)
       select gen_random_uuid(),${lit(user.id)},'A synthetic hold reason',now()-make_interval(secs=>i) from generate_series(1,${n}) i;`,
    sql: () => `select api.get_my_frontend_decisions() as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-get_owner_business_event_editor",
    as: "member",
    cap: 101,
    setup: async ({ user }) => ({ business: await businessPost(h, user, { status: "draft" }) }),
    seed: ({ user, business }, n) =>
      `with m as (insert into private.media_objects(owner_id,kind,object_key,declared_bytes,state,sha256,size_bytes,mime)
           select ${lit(user.id)},'image','media/'||gen_random_uuid(),1024,'ready',repeat('a',64),1024,'image/jpeg' from generate_series(1,${n}) returning id)
       insert into private.post_media(post_id,object_id,purpose,position)
       select ${lit(business)},id,case when r<=50 then 'gallery' when r<=100 then 'video' when r=101 then 'cover' else 'logo' end,(r-1)%50
       from (select id,row_number() over () r from m) x;`,
    sql: ({ business }) => `select api.get_owner_business_event_editor(${lit(business)}) as r`,
    count: (r) => r.media.length,
  },
  {
    id: "LIM-F-get_public_frontend_business_affiliations-2",
    as: "visitor",
    cap: 1000,
    setup: async () => ({ post: (await livePosts(h, await h.member("public-badges")))[0] }),
    seed: ({ post }, n) =>
      `with ${orgs(n)} insert into private.organisation_affiliations(organisation_id,post_id,post_kind,status,confirmed_at,confirmed_by)
       select o.id,${lit(post)},'business','active',now(),gen_random_uuid() from o;`,
    sql: ({ post }) =>
      `select api.get_public_frontend_business_affiliations(array[${lit(post)}]::uuid[]) as r`,
    count: (r) => r.length,
  },
  ...[
    [
      "LIM-F-get_staff_expired_invoice_transfers",
      "get_staff_expired_invoice_transfers",
      200,
      "'expired'",
      "now()",
    ],
    [
      "LIM-F-get_staff_invoice_transfers",
      "get_staff_invoice_transfers",
      50,
      "'awaiting_confirmation'",
      "null",
    ],
  ].map(([id, fn, cap, status, expired]) => ({
    id,
    as: "staff",
    cap,
    seed: ({ user }, n) =>
      `insert into private.invoice_transfers(account_id,plan_version_id,slots,amount_received_cents,bank_reference,cleared_on,
         cooling_off_waiver_confirmed,reason,recorded_by,status,expired_at)
       select ${lit(user.id)},(select id from private.plan_versions where plan_code='individual_30d' order by version limit 1),1,
         1000+i,'REF'||lpad(i::text,6,'0'),current_date,true,'Synthetic transfer reason',gen_random_uuid(),${status},${expired}
       from generate_series(1,${n}) i;`,
    sql: () => `select api.${fn}() as r`,
    count: (r) => r.items.length,
  })),
  {
    id: "LIM-F-get_staff_ozow_refunds-2",
    as: "staff",
    cap: 20,
    seed: ({ user }, n) =>
      `with p as (insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,fulfillment_status,
           completed_at,provider_transaction_id)
         select ${lit(user.id)},'plan',gen_random_uuid(),1000,'ZAR','{}'::jsonb,'complete','fulfilled',now(),gen_random_uuid()::text
         from generate_series(1,${n}) returning id)
       insert into private.payment_refund_requests(id,payment_id,account_id,kind,reason_code,reason,ozow_reference,amount_cents,recorded_before_cents,
         needs_approval,status,requested_by,channel,approved_at,ozow_transaction_id,sent_at,send_attempts,last_send_at,send_outcome,failed_at,failure_reason)
       select r,p.id,${lit(user.id)},'refunded','billing_error','Synthetic refund reason','vm-refund-'||r,1000,0,false,'failed',gen_random_uuid(),
         'api',now()-interval '1 day',gen_random_uuid(),now()-interval '1 day',1,now()-interval '1 day','refused',now(),'ozow_refused'
       from (select id,gen_random_uuid() r from p) p;`,
    sql: () => `select api.get_staff_ozow_refunds('{}'::uuid[]) as r`,
    count: (r) => r.attention.length,
  },
  {
    id: "LIM-F-get_staff_package_invoice_requests",
    as: "staff",
    cap: 100,
    seed: (_, n) =>
      `insert into private.package_invoice_requests(account_id,member_request_id,plan_version_id,term_days,slots,unit_price_cents,total_cents,consent_at,consent_version)
       select gen_random_uuid(),gen_random_uuid(),(select id from private.plan_versions where plan_code='slot_package_30d'),30,5,10000,50000,now(),'invoice-cooling-off-v1'
       from generate_series(1,${n});`,
    sql: () => `select api.get_staff_package_invoice_requests() as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-get_staff_package_move_failures",
    as: "staff",
    cap: 50,
    seed: (_, n) =>
      `insert into private.slot_package_move_failures(package_id,post_id,direction,first_failed_at,last_failed_at,reason)
       select gen_random_uuid(),gen_random_uuid(),'out_of_package',now(),now(),'busy' from generate_series(1,${n});`,
    sql: () => `select api.get_staff_package_move_failures() as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-list_identity_disclosures",
    as: "staff",
    cap: 50,
    seed: ({ staff }, n) =>
      `insert into private.identity_disclosures(opened_by,opened_at,closes_at,request_type,request_reference,reason,attested,lookup_kind,lookup_value,outcome,match_count)
       select ${lit(staff.id)},now(),now()+interval '15 minutes','subpoena','REF-1','A synthetic disclosure reason',true,'email',
         'fixture@example.com','no_match',0 from generate_series(1,${n});`,
    sql: () => `select api.list_identity_disclosures() as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-my_organisation_links",
    as: "member",
    cap: 100,
    setup: async ({ user }) => ({ post: await businessPost(h, user, { status: "draft" }) }),
    seed: ({ user, post }, n) =>
      `with ${orgs(n)} insert into private.organisation_applications(organisation_id,post_id,post_kind,applicant_id,share_representative_name,consented_at)
       select o.id,${lit(post)},'business',${lit(user.id)},false,now() from o;`,
    sql: () => `select api.my_organisation_links() as r`,
    count: (r) => r.applications.length,
  },
  {
    id: "LIM-F-my_partner_dashboard",
    as: "member",
    cap: 50,
    seed: ({ user }, n) =>
      `with p as (insert into private.partners(account_id,code,created_by) values(${lit(user.id)},upper(substr(md5(gen_random_uuid()::text),1,12)),gen_random_uuid()) returning id)
       insert into private.partner_commissions(partner_id,payment_id,base_cents,rate_bps,amount_cents,eligible_at)
       select p.id,gen_random_uuid(),1000,2000,200,now() from p,generate_series(1,${n});`,
    sql: () => `select api.my_partner_dashboard() as r`,
    count: (r) => r.recent.length,
  },
  {
    id: "LIM-F-my_sponsorships",
    as: "member",
    cap: 100,
    seed: ({ user }, n) =>
      `with ${orgs(1)} insert into private.organisation_sponsorships(organisation_id,affiliation_id,post_id,owner_id,sponsor_type,status,requested_by)
       select o.id,gen_random_uuid(),gen_random_uuid(),${lit(user.id)},'organisation','waitlisted',${lit(user.id)} from o,generate_series(1,${n});`,
    sql: () => `select api.my_sponsorships() as r`,
    count: (r) => r.length,
  },
  ...[
    [
      "LIM-F-org_list_affiliations",
      500,
      (org, owner, n) =>
        `with p as (insert into private.posts(owner_id,kind,area,category_key,title,province_id,city_id,status)
             select ${lit(owner)},'business','business',${CATEGORY},'Fixture business','gp','gp_johannesburg','draft' from generate_series(1,${n}) returning id)
         insert into private.organisation_affiliations(organisation_id,post_id,post_kind,status,confirmed_at,confirmed_by)
         select ${lit(org)},id,'business','active',now(),gen_random_uuid() from p;`,
      (org) => `select api.org_list_affiliations(${lit(org)}) as r`,
    ],
    [
      "LIM-F-org_list_applications",
      200,
      (org, owner, n) =>
        `with p as (insert into private.posts(owner_id,kind,area,category_key,title,province_id,city_id,status)
             select ${lit(owner)},'business','business',${CATEGORY},'Fixture business','gp','gp_johannesburg','draft' from generate_series(1,${n}) returning id)
         insert into private.organisation_applications(organisation_id,post_id,post_kind,applicant_id,share_representative_name,consented_at)
         select ${lit(org)},id,'business',${lit(owner)},false,now() from p;`,
      (org) => `select api.org_list_applications(${lit(org)},null) as r`,
    ],
  ].map(([id, cap, seed, sql]) => ({
    id,
    as: "staff",
    cap,
    setup: async () => ({ org: randomUUID(), owner: await h.member(`${id}-owner`) }),
    seed: ({ org, owner }, n) =>
      `insert into private.organisations(id,slug,name,is_public,programme_status) values(${lit(org)},'fixture-'||replace(${lit(org)},'-',''),'Fixture Organisation',true,'affiliation_only');
       ${seed(org, owner.id, n)}`,
    sql: ({ org }) => sql(org),
    count: (r) => r.length,
  })),
  {
    id: "LIM-F-org_list_sponsorships",
    as: "staff",
    cap: 500,
    setup: async () => ({ org: randomUUID() }),
    seed: ({ org, user }, n) =>
      `insert into private.organisations(id,slug,name,is_public,programme_status) values(${lit(org)},'fixture-'||replace(${lit(org)},'-',''),'Fixture Organisation',true,'affiliation_only');
       insert into private.organisation_sponsorships(organisation_id,affiliation_id,post_id,owner_id,sponsor_type,status,requested_by)
       select ${lit(org)},gen_random_uuid(),gen_random_uuid(),${lit(user.id)},'organisation','waitlisted',${lit(user.id)} from generate_series(1,${n});`,
    sql: ({ org }) => `select api.org_list_sponsorships(${lit(org)}) as r`,
    count: (r) => r.items.length,
  },
  {
    id: "LIM-F-staff_cost_overview",
    as: "staff",
    cap: 10,
    seed: (_, n) =>
      `insert into private.media_objects(owner_id,kind,object_key,declared_bytes,state)
       select gen_random_uuid(),'image','media/'||gen_random_uuid(),1024*(100+i),'intent' from generate_series(1,${n}) i;`,
    sql: () => `select api.staff_cost_overview() as r`,
    count: (r) => r.largest_storage_accounts.length,
  },
  {
    id: "LIM-F-staff_dashboard_overview",
    as: "staff",
    cap: 40,
    seed: ({ staff }, n) =>
      `insert into private.queue_claims(post_id,claimed_by,claim_nonce,claimed_at,claim_expires_at,claim_generation)
       select gen_random_uuid(),${lit(staff.id)},gen_random_uuid(),now(),now()+interval '15 minutes',1 from generate_series(1,${n});`,
    sql: () => `select internal.staff_dashboard_overview() as r`,
    count: (r) => r.claims.length,
  },
  {
    id: "LIM-F-staff_get_organisation",
    as: "staff",
    cap: 50,
    setup: async () => ({ org: randomUUID() }),
    seed: ({ org, staff }, n) =>
      `insert into private.organisations(id,slug,name,is_public,programme_status) values(${lit(org)},'fixture-'||replace(${lit(org)},'-',''),'Fixture Organisation',true,'affiliation_only');
       insert into private.organisation_notes(organisation_id,author_id,note) select ${lit(org)},${lit(staff.id)},'A synthetic note' from generate_series(1,${n});`,
    sql: ({ org }) => `select api.staff_get_organisation(${lit(org)}) as r`,
    count: (r) => r.notes.length,
  },
  {
    id: "LIM-F-staff_list_commissions",
    as: "staff",
    cap: 500,
    seed: (_, n) =>
      `with p as (insert into private.partners(account_id,code,created_by) values(gen_random_uuid(),upper(substr(md5(gen_random_uuid()::text),1,12)),gen_random_uuid()) returning id)
       insert into private.partner_commissions(partner_id,payment_id,base_cents,rate_bps,amount_cents,eligible_at)
       select p.id,gen_random_uuid(),1000,2000,200,now() from p,generate_series(1,${n});`,
    sql: () => `select api.staff_list_commissions(null,null) as r`,
    count: (r) => r.length,
  },
];

describe("database read caps", () => {
  for (const row of READ_CAPS) {
    test(`${row.id}: at most ${row.cap} rows`, async () => {
      const user = await h.member(`cap-${row.id}`);
      const staff = await h.staff(`cap-staff-${row.id}`);
      const ctx = { user, staff, ...(row.setup ? await row.setup({ user, staff }) : {}) };
      await h.seed(row.seed(ctx, row.cap + 1));
      const rows = await call(row.as.startsWith("member") ? user : staff, row.as, row.sql(ctx));
      assert.equal(row.count(rows[0].r), row.cap);
    });
  }
});

// ---------------------------------------------------------------- reads with a structure

describe("read caps that need a held case or a subject", () => {
  test("LIM-F-get_frontend_staff_identity_context: the 100 latest access records of the held ID case", async () => {
    const staff = await h.staff("identity-context");
    const c = await heldIdentityCase(h, staff, 0);
    await h.seed(`insert into private.evidence_access_log(staff_id,case_id,purpose,case_version,claim_generation,artifact_ids,accessed_at)
      select ${lit(staff.id)},${lit(c.case)},'routine_review',1,1,array[${lit(c.idPhoto)}]::uuid[],now()-make_interval(mins=>i)
      from generate_series(1,101) i;`);
    const log = (
      await h.asStaff(
        staff,
        `select api.get_frontend_staff_identity_context(${lit(c.owner.id)},null) as r`
      )
    )[0].r.access_log;
    // One entry per file of each record: count the records.
    assert.equal(new Set(log.map((entry) => entry.id.split(":")[0])).size, 100);
  });

  test("LIM-F-get_my_frontend_verification_uploads: one upload per purpose (the read's own limit 2 is redundant)", async () => {
    const owner = await h.member("my-uploads");
    const c = randomUUID();
    await h.seed(`insert into private.evidence_cases(id,subject_id,kind) values(${lit(c)},${lit(owner.id)},'kyc');
      with a as (insert into private.evidence_artifacts(id,case_id,owner_id,purpose,object_key,state,sha256,content_sha256)
          select gen_random_uuid(),${lit(c)},${lit(owner.id)},p,'evidence/'||gen_random_uuid(),'clean',repeat('a',64),repeat('a',64)
          from unnest(array['id_front','id_front','selfie','selfie']) p returning id,purpose)
      insert into private.frontend_verification_uploads(owner_id,request_id,session_id,case_id,case_version,purpose,request_digest,artifact_id,completed_at,
          capture_method,browser_liveness_passed)
        select ${lit(owner.id)},gen_random_uuid(),${lit(owner.session)},${lit(c)},1,purpose,repeat('b',64),id,now(),
          case when purpose='selfie' then 'camera' end,case when purpose='selfie' then true end from a;`);
    const uploads = (
      await h.asMember(owner, `select api.get_my_frontend_verification_uploads() as r`)
    )[0].r;
    assert.deepEqual(uploads.map((u) => u.purpose).sort(), ["id_front", "selfie"]);
  });

  test("LIM-F-identity_disclosure_record and LIM-F-identity_disclosure_record-2: at most 20 attempts and 20 phones in a disclosure record", async () => {
    const subject = await h.member("disclosure-subject");
    await acceptIdentity(h, subject);
    const fp = await h.one(
      `select identity_hmac from private.accepted_identity_facts where owner_id=$1 and revoked_at is null`,
      [subject.id]
    );
    await h.seed(`
      insert into private.verification_identity_submissions(case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,identity_hmac,
          identity_key_id,encryption_key_id,receipt_id,recipe,risk_score,number_erased_at)
        select gen_random_uuid(),${lit(subject.id)},1,gen_random_uuid(),gen_random_uuid(),${lit(fp)},'identity-match-v1','identity-number-v1',
          gen_random_uuid(),'manual-id-selfie-v1',0,now() from generate_series(1,21);
      insert into private.verification_phone_proofs(owner_id,challenge_id,phone,verified_at,revoked_at)
        select ${lit(subject.id)},gen_random_uuid(),'+2784'||lpad(i::text,7,'0'),now()-make_interval(days=>i),now()-make_interval(days=>i)
        from generate_series(1,21) i;`);
    const record = async (outcome) =>
      (
        await h.db.query(
          `select internal.identity_disclosure_record(jsonb_populate_record(null::private.identity_disclosures,
             jsonb_build_object('outcome',$1::text,'lookup_value',$2::text)),$3) as r`,
          [outcome, fp, subject.id]
        )
      ).rows[0].r;
    assert.equal((await record("attempt_only")).attempts.length, 20);
    assert.equal((await record("match")).phones.length, 20);
  });

  test("LIM-F-staff_identity_history and LIM-F-staff_identity_history-2: 20 identity records a page, 21 read to know there are more", async () => {
    const staff = await h.staff("identity-history");
    const history = async (count) => {
      const subject = await h.member(`history-${count}`);
      await h.seed(`insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by,reviewed_at,revoked_at)
        select ${lit(subject.id)},gen_random_uuid(),left(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),42)||'A',gen_random_uuid(),
          now()-make_interval(days=>i),now() from generate_series(1,${count}) i;`);
      return (
        await h.asStaff(staff, `select api.staff_identity_history(${lit(subject.id)}) as r`)
      )[0].r;
    };
    const full = await history(20);
    assert.deepEqual([full.identities.length, full.next_cursor], [20, null]);
    const more = await history(21);
    assert.equal(more.identities.length, 20);
    assert.ok(more.next_cursor);
  });
});

describe("default page sizes", () => {
  test("LIM-F-staff_audit_page and LIM-F-get_frontend_staff_audit_page: 25 and 50 audit events by default", async () => {
    const staff = await h.staff("audit-pages");
    const member = await h.member("audit-pages-member");
    await h.seed(`insert into private.invoice_transfers(account_id,plan_version_id,slots,amount_received_cents,bank_reference,cleared_on,
        cooling_off_waiver_confirmed,reason,recorded_by,status,expired_at)
      select ${lit(member.id)},(select id from private.plan_versions where plan_code='individual_30d' order by version limit 1),1,
        2000+i,'AUD'||lpad(i::text,6,'0'),current_date,true,'Synthetic transfer reason',${lit(staff.id)},'expired',now()
      from generate_series(1,51) i;`);
    assert.equal(
      (await h.asStaff(staff, `select api.staff_audit_page() as r`))[0].r.items.length,
      25
    );
    assert.equal(
      (await h.asStaff(staff, `select api.get_frontend_staff_audit_page() as r`))[0].r.items.length,
      50
    );
  });

  test("LIM-F-staff_decision_page: 25 decisions by default", async () => {
    const staff = await h.staff("decision-page");
    await h.seed(`with c as (insert into private.evidence_cases(id,subject_id,kind) select gen_random_uuid(),gen_random_uuid(),'restriction'
          from generate_series(1,26) returning id)
      insert into private.decisions(case_id,action,payload,case_version,reviewed_snapshot,proposed_by)
        select id,'restrict_account','{}'::jsonb,1,'[]'::jsonb,gen_random_uuid() from c;`);
    assert.equal(
      (await h.asStaff(staff, `select api.staff_decision_page() as r`))[0].r.items.length,
      25
    );
  });
});

describe("caps of 1,300 and 1,400 rows a staff view", () => {
  test("LIM-F-get_frontend_staff_claims-2 and LIM-F-get_frontend_staff_claims-3: at most 1,300 claims in one view", async () => {
    const staff = await h.staff("claims-1300");
    const hold = (n) =>
      h.seed(`insert into private.queue_claims(post_id,claimed_by,claim_nonce,claimed_at,claim_expires_at,claim_generation)
        select gen_random_uuid(),${lit(staff.id)},gen_random_uuid(),now(),now()+interval '15 minutes',1 from generate_series(1,${n});`);
    const view = () => h.asStaff(staff, `select api.get_frontend_staff_claims('[]'::jsonb) as r`);
    await hold(1300);
    assert.equal((await view())[0].r.items.length, 1300);
    await hold(1);
    await refused(view(), "PT409", /too many claim subjects/);
  });

  test("LIM-F-get_frontend_staff_verification_queue-2 and LIM-F-get_frontend_staff_verification_queue-3: at most 1,400 ID cases in one view", async () => {
    const staff = await h.staff("queue-1400");
    // ID cases of new members held by this reviewer, each with its current
    // submission; the profile comes from the sign-up trigger.
    const hold = async (n) => {
      await h.db.query(`insert into auth.users(id,email,email_confirmed_at)
        select gen_random_uuid(),'queue-'||gen_random_uuid()||'@example.invalid',now() from generate_series(1,${n})`);
      await h.seed(`with u as (select id from auth.users where email like 'queue-%' and id not in (select subject_id from private.evidence_cases)),
          c as (insert into private.evidence_cases(id,subject_id,kind,claimed_by,claim_expires_at,claim_generation,claim_nonce)
            select gen_random_uuid(),id,'kyc',${lit(staff.id)},now()+interval '30 minutes',1,gen_random_uuid() from u returning id,subject_id),
          s as (insert into private.verification_identity_submissions(case_id,owner_id,case_version,id_artifact_id,selfie_artifact_id,identity_hmac,
              identity_key_id,encryption_key_id,receipt_id,recipe,risk_score,number_erased_at)
            select id,subject_id,1,gen_random_uuid(),gen_random_uuid(),left(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),42)||'A',
              'identity-match-v1','identity-number-v1',gen_random_uuid(),'manual-id-selfie-v1',90,now() from c returning id,case_id)
        insert into private.verification_current_submissions(case_id,submission_id) select case_id,id from s;`);
    };
    const view = () =>
      h.asStaff(staff, `select api.get_frontend_staff_verification_queue(1,'{}'::uuid[]) as r`);
    await hold(1400);
    assert.equal((await view())[0].r.groups.length, 1400);
    await hold(1);
    await refused(view(), "PT409", /narrow the identity queue selection/);
  });
});

describe("the privacy export", () => {
  const exportOf = (subject) =>
    h.db
      .query(`select internal.frontend_privacy_export_data($1) as r`, [subject.id])
      .then((r) => r.rows[0].r);

  test("LIM-F-frontend_privacy_export_data: the 2,000 latest likes, and a summary of all", async () => {
    const subject = await h.member("export-likes");
    await h.seed(`insert into private.post_likes(post_id,account_id,created_at)
      select gen_random_uuid(),${lit(subject.id)},now()-make_interval(secs=>i) from generate_series(1,2001) i;`);
    const data = await exportOf(subject);
    assert.equal(data.post_likes.length, 2000);
    assert.equal(data.post_likes_summary[0].total, 2001);
  });

  test("LIM-F-frontend_privacy_export_data-2: at most 2,500 rows a dataset", async () => {
    const subject = await h.member("export-rows");
    const cases = (n) =>
      h.seed(
        `insert into private.evidence_cases(subject_id,kind,status) select ${lit(subject.id)},'business','decided' from generate_series(1,${n});`
      );
    await cases(2500);
    assert.equal((await exportOf(subject)).verification_cases.length, 2500);
    await cases(1);
    await refused(exportOf(subject), "PT413", /exceeds the direct delivery limit/);
  });

  test("LIM-F-frontend_privacy_export_data-2: at most 4,194,304 bytes in all", async () => {
    // 64 posts with a presentation of 64,000 characters (a presentation holds
    // at most 64 KB), and one more padded to land on the bound.
    const subject = await h.member("export-bytes");
    await h.seed(`${draftBusinesses(subject.id, 65)}
      insert into private.post_presentations(post_id,data)
        select id,jsonb_build_object('pad',case when row_number() over (order by id)=1 then '' else repeat('a',64000) end)
        from private.posts where owner_id=${lit(subject.id)};`);
    const last = await h.one(`select id from private.posts where owner_id=$1 order by id limit 1`, [
      subject.id,
    ]);
    const pad = (length) =>
      h.seed(
        `update private.post_presentations set data=jsonb_build_object('pad',repeat('a',${length})) where post_id=${lit(last)};`
      );
    const size = async () =>
      Number(
        await h.one(
          `select sum(octet_length(value::text)) from jsonb_each(internal.frontend_privacy_export_data($1))`,
          [subject.id]
        )
      );
    const length = 4194304 - (await size());
    assert.ok(length > 0 && length < 65000, `last presentation of ${length} characters`);
    await pad(length);
    assert.equal(await size(), 4194304);
    await pad(length + 1);
    await refused(exportOf(subject), "PT413", /exceeds the direct delivery limit/);
  });
});

describe("operations health", () => {
  test("LIM-F-get_staff_operations_health: an email or notice is stuck after its 8th attempt or a day", async () => {
    const staff = await h.staff("ops-stuck");
    const owner = await h.member("ops-stuck-owner");
    const health = async () =>
      (await h.asStaff(staff, `select api.get_staff_operations_health() as r`))[0].r;
    const email = (attempts, age) =>
      h.seed(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,delivery_attempts,created_at)
        values('payment_completed',gen_random_uuid(),${lit(owner.id)},'fixture:'||gen_random_uuid(),${attempts},now()-interval ${lit(age)});`);
    const notice = (attempts, age) =>
      h.seed(`with r as (insert into private.privacy_requests(type,requester_email,description,identity_check,received_at,due_by,legal_basis)
          values('access','fixture@example.com','A synthetic request','manual',now(),now()+interval '30 days','POPIA section 23') returning id)
        insert into private.privacy_notice_jobs(request_id,kind,attempts,created_at) select id,'submitted',${attempts},now()-interval ${lit(age)} from r;`);
    for (const [add, key] of [
      [email, "emails"],
      [notice, "notices"],
    ]) {
      const before = Number((await health())[key].stuck);
      await add(7, "1 minute");
      await add(0, "23 hours");
      assert.equal(Number((await health())[key].stuck), before, `${key}: not stuck yet`);
      await add(8, "1 minute");
      assert.equal(Number((await health())[key].stuck), before + 1, `${key}: 8th attempt`);
      await add(0, "25 hours");
      assert.equal(Number((await health())[key].stuck), before + 2, `${key}: a day old`);
    }
  });

  test("LIM-F-get_staff_operations_health-2: each list shows at most 50", async () => {
    const staff = await h.staff("ops-lists");
    const owner = await h.member("ops-lists-owner");
    await h.seed(`
      insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,delivery_attempts)
        select 'payment_completed',gen_random_uuid(),${lit(owner.id)},'fixture:'||gen_random_uuid(),8 from generate_series(1,51);
      with r as (insert into private.privacy_requests(type,requester_email,description,identity_check,received_at,due_by,legal_basis)
          select 'access','fixture@example.com','A synthetic request','manual',now(),now()+interval '30 days','POPIA section 23'
          from generate_series(1,51) returning id)
        insert into private.privacy_notice_jobs(request_id,kind,attempts) select id,'submitted',8 from r;
      insert into private.payment_problems(payment_id,reason,source) select gen_random_uuid(),'amount_mismatch','notice' from generate_series(1,51);
      insert into private.account_erasures(user_id,closed_at,erase_after,closed_by,blocked_at,blocked_reason)
        select gen_random_uuid(),now(),now()+interval '30 days','member',now(),'legal_hold' from generate_series(1,51);
      insert into private.cost_alarms(metric,level,period,used,free_quantity)
        select 'fixture_metric_'||i,'warning','2026-11',1,10 from generate_series(1,51) i;`);
    const r = (await h.asStaff(staff, `select api.get_staff_operations_health() as r`))[0].r;
    for (const list of [r.emails, r.notices, r.payments, r.deletions, r.incidents])
      assert.equal(list.items.length, 50);
  });

  test("LIM-F-list_my_email_history-2: an unsent email is shown as failed after its 8th attempt", async () => {
    const owner = await h.member("email-history");
    const email = (attempts) =>
      h.seed(`insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key,delivery_attempts)
        values('payment_completed',gen_random_uuid(),${lit(owner.id)},'fixture:'||gen_random_uuid(),${attempts});`);
    const listed = async () =>
      (await h.asMember(owner, `select api.list_my_email_history(50) as r`))[0].r.items.length;
    await email(7);
    assert.equal(await listed(), 0);
    await email(8);
    assert.equal(await listed(), 1);
  });
});

describe("public organisation pages", () => {
  /** A listed organisation with a permitted logo, affiliated with `count` live businesses. */
  async function organisationWith(count, extra = {}) {
    const owner = await h.member("org-businesses");
    const posts = await livePosts(h, owner, count);
    const org = randomUUID();
    const logo = randomUUID();
    await h.seed(`
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,state,sha256,size_bytes,mime)
        values(${lit(logo)},${lit(owner.id)},'image','media/'||${lit(logo)},1024,'ready',repeat('a',64),1024,'image/png');
      insert into private.organisations(id,slug,name,is_public,programme_status,logo_object_id,logo_permission_at,logo_permission_reference,show_on_strip,show_on_home,logo_permission_by)
        values(${lit(org)},'fixture-'||replace(${lit(org)},'-',''),'Aa Fixture Organisation',true,'affiliation_only',${lit(logo)},now(),'REF-1',true,true,gen_random_uuid());
      insert into private.organisation_affiliations(organisation_id,post_id,post_kind,status,confirmed_at,confirmed_by)
        select ${lit(org)},id,'business','active',now(),gen_random_uuid() from unnest(array[${posts.map(lit).join(",")}]::uuid[]) id;
      ${extra.sql ? extra.sql(org, posts, owner) : ""}`);
    return { org, posts, owner };
  }
  const slugOf = (org) => `fixture-${org.org.replaceAll("-", "")}`;

  test("LIM-F-public_organisation_directory and LIM-F-public_organisation_directory-2: on the strip and the home page from 5 live businesses", async () => {
    const five = await organisationWith(5);
    const four = await organisationWith(4);
    const directory = (await h.asVisitor(`select api.public_organisation_directory() as r`))[0].r;
    const a = directory.find((item) => item.slug === slugOf(five));
    assert.deepEqual([a.live_businesses, a.on_strip, a.on_home], [5, true, true]);
    const b = directory.find((item) => item.slug === slugOf(four));
    assert.deepEqual([b.live_businesses, b.on_strip, b.on_home], [4, false, false]);
  });

  test("LIM-F-public_programme_showcases and LIM-F-public_programme_showcases-2: a showcase needs 3 cards, and a placement shows 2", async () => {
    // Each business has a ready cover and a visible search document; each
    // organisation has one showcase.
    const showcase = (placement, order) => (org, posts, owner) => `
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,state,sha256,size_bytes,mime)
        select id,${lit(owner.id)},'image','media/'||id,1024,'ready',repeat('a',64),1024,'image/jpeg' from unnest(array[${posts.map(lit).join(",")}]::uuid[]) id;
      insert into private.post_media(post_id,object_id,purpose,position) select id,id,'cover',0 from unnest(array[${posts.map(lit).join(",")}]::uuid[]) id;
      insert into private.post_search_documents(post_id,kind,area,category_key,province_id,locality_label,title,published_at,visible_until,is_visible,document)
        select p.id,'business','business',p.category_key,'gp','Johannesburg',p.title,now()-interval '1 hour',now()+interval '30 days',true,to_tsvector('simple','fixture')
        from private.posts p where p.id=any(array[${posts.map(lit).join(",")}]::uuid[]);
      insert into private.programme_showcases(organisation_id,title,placement,enabled,starts_at,ends_at,display_order,created_by)
        values(${lit(org)},'Fixture showcase',${lit(placement)},true,now()-interval '1 hour',now()+interval '30 days',${order},gen_random_uuid());`;
    const read = async (placement) =>
      (await h.asVisitor(`select api.public_programme_showcases(${lit(placement)}) as r`))[0].r;
    // LIM-F-public_programme_showcases: 3 cards are shown, 2 are not.
    const three = await organisationWith(3, { sql: showcase("tourism", 1) });
    await organisationWith(2, { sql: showcase("tourism", 2) });
    const tourism = await read("tourism");
    assert.deepEqual(
      tourism.map((s) => s.organisation_slug),
      [slugOf(three)],
      JSON.stringify(tourism)
    );
    // LIM-F-public_programme_showcases-2: of 3 showcases, 2 are shown.
    for (let n = 0; n < 3; n += 1) await organisationWith(3, { sql: showcase("market", n) });
    assert.equal((await read("market")).length, 2);
  });
});

describe("caps of 1,000 to 200,000 rows in a sweep", () => {
  test("LIM-F-purge_post_engagement and LIM-F-purge_post_engagement-2: view marks go 10,000 a batch, at most 20 batches a run", async () => {
    await h.seed(`insert into private.post_view_marks(mark,seen_at)
      select sha256(convert_to('mark-'||i,'UTF8')),now()-interval '2 days' from generate_series(1,200001) i;`);
    const purge = async () =>
      (await h.asService(`select api.purge_post_engagement() as r`))[0].r.marks;
    assert.equal(await purge(), 200000);
    assert.equal(await purge(), 1);
  });

  test("LIM-F-purge_post_engagement-3: likes of at most 1,000 posts are released a run", async () => {
    await h.seed(`with p as (select gen_random_uuid() id from generate_series(1,1001)),
        t as (insert into private.post_engagement_totals(post_id) select id from p returning post_id)
      insert into private.post_likes(post_id,account_id,counts_from,waiting) select post_id,gen_random_uuid(),now()-interval '1 minute',true from t;`);
    const release = async () =>
      (await h.asService(`select api.purge_post_engagement() as r`))[0].r.likes_released;
    assert.equal(await release(), 1000);
    assert.equal(await release(), 1);
  });

  test("LIM-F-remove_account_sign_in: at most 10,000 sign-in log entries of the account a run", async () => {
    const user = await h.member("sign-in-log");
    await h.seed(`insert into auth.audit_log_entries(id,payload,created_at)
      select gen_random_uuid(),json_build_object('actor_id',${lit(user.id)}),now() from generate_series(1,10001);`);
    await h.asOwner(`select internal.remove_account_sign_in(${lit(user.id)})`);
    assert.equal(
      Number(
        await h.one(`select count(*) from auth.audit_log_entries where payload->>'actor_id'=$1`, [
          user.id,
        ])
      ),
      1
    );
  });

  test("LIM-F-run_retention-2: the retention run erases at most 20 accounts", async () => {
    await h.seed(`insert into private.account_erasures(user_id,closed_at,erase_after,closed_by)
      select gen_random_uuid(),now()-interval '31 days',now()-interval '1 day','member' from generate_series(1,21);`);
    const accounts = (await h.asService(`select api.run_retention(5000) as r`))[0].r.accounts;
    assert.equal(accounts.erased + accounts.held + accounts.failed, 20);
  });

  test("LIM-F-sweep_sponsorships-2: waiting lists of at most 100 organisations a run", async () => {
    // Settle anything earlier tests left waiting.
    await h.asService(`select api.sweep_sponsorships(1000)`);
    await h.seed(`with o as (insert into private.organisations(slug,name,is_public,programme_status,sponsored_capacity)
        select 'fixture-'||replace(gen_random_uuid()::text,'-',''),'Sweep Organisation',true,'founding_trial',1 from generate_series(1,101) returning id)
      insert into private.organisation_sponsorships(organisation_id,affiliation_id,post_id,owner_id,sponsor_type,status,requested_by)
      select id,gen_random_uuid(),gen_random_uuid(),gen_random_uuid(),'founding','waitlisted',gen_random_uuid() from o;`);
    const waiting = () =>
      h.one(`select count(*)::integer from private.organisation_sponsorships s join private.organisations o on o.id=s.organisation_id
        where s.status='waitlisted' and o.name='Sweep Organisation'`);
    await h.asService(`select api.sweep_sponsorships(1000)`);
    // Each waiting place has no valid basis, so the sweep closes it.
    assert.equal(await waiting(), 1);
    await h.asService(`select api.sweep_sponsorships(1000)`);
    assert.equal(await waiting(), 0);
  });
});

describe("Multi-listing package moves in the renewal sweep", () => {
  /**
   * A package of `owner` ending in 3 days holding one live post, and
   * Individual slots that outlast it (the latest first): `wrong` slots of
   * another area, then one the post can move into.
   */
  async function endingPackage(owner, wrong) {
    const plan = await h.one(`select id from internal.slot_package_term_plan(30)`);
    const individual = await h.one(
      `select id from private.plan_versions where plan_code='individual_30d' and retired_at is null order by version desc limit 1`
    );
    const pkg = randomUUID();
    const post = (await livePosts(h, owner, 1))[0];
    await h.seed(`
      insert into private.slot_packages(id,owner_id,term_days,slot_count) values(${lit(pkg)},${lit(owner.id)},30,5);
      with pay as (insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,fulfillment_status,completed_at,provider)
          values(${lit(owner.id)},'plan',${lit(plan)},100,'ZAR','{}'::jsonb,'complete','fulfilled',now(),'invoice') returning id),
        line as (insert into private.payment_lines(payment_id,line_number,plan_version_id,amount_cents,slot_count) select id,1,${lit(plan)},100,5 from pay returning id,payment_id),
        e as (insert into private.entitlements(owner_id,source,payment_id,payment_line_id,package_id,slot_capacity,activations_per_period,max_photos,max_videos,starts_at,ends_at,status)
          select ${lit(owner.id)},'retail_paid',payment_id,id,${lit(pkg)},5,20,10,1,now()-interval '20 days',now()+interval '3 days','active' from line returning id)
      update private.post_activations a set entitlement_id=e.id from e where a.post_id=${lit(post)};
      with s as (select i,case when i<=${wrong} then 'tourism_events' else null end area from generate_series(1,${wrong + 1}) i),
        pay as (insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,fulfillment_status,completed_at,provider)
          select ${lit(owner.id)},'plan',${lit(individual)},6900,'ZAR',jsonb_build_object('i',i),'complete','fulfilled',now(),'invoice' from s returning id,(snapshot->>'i')::integer i),
        line as (insert into private.payment_lines(payment_id,line_number,plan_version_id,amount_cents) select id,1,${lit(individual)},6900 from pay returning id,payment_id)
      insert into private.entitlements(owner_id,source,area,payment_id,payment_line_id,slot_capacity,max_photos,max_videos,starts_at,ends_at,status)
        select ${lit(owner.id)},'retail_paid',s.area,pay.id,line.id,1,10,1,now()-interval '1 day',now()+make_interval(days=>40-s.i),'active'
        from pay join line on line.payment_id=pay.id join s on s.i=pay.i;`);
    return { pkg, post };
  }
  const movedOut = (post) =>
    h.one(
      `select e.package_id is null from private.post_activations a join private.entitlements e on e.id=a.entitlement_id
       where a.post_id=$1 and a.released_at is null`,
      [post]
    );

  test("LIM-F-run_slot_renewals-2: a post leaving a package tries at most 20 free places", async () => {
    const a = await endingPackage(await h.member("renewal-places-20"), 19);
    const b = await endingPackage(await h.member("renewal-places-21"), 20);
    await h.asService(`select api.run_slot_renewals(5000)`);
    assert.equal(await movedOut(a.post), true, "the 20th place is tried");
    assert.equal(await movedOut(b.post), false, "the 21st place is not");
  });

  test("LIM-F-run_slot_renewals-3: at most 20 stuck package moves are reported a run", async () => {
    const owner = await h.member("renewal-stuck");
    const pkg = randomUUID();
    await h.seed(`insert into private.slot_packages(id,owner_id,term_days,slot_count) values(${lit(pkg)},${lit(owner.id)},30,5);
      insert into private.slot_package_move_failures(package_id,post_id,direction,tries,first_failed_at,last_failed_at,reason)
        select ${lit(pkg)},gen_random_uuid(),'out_of_package',5,now()-interval '1 hour'-make_interval(secs=>i),now(),'busy' from generate_series(1,21) i;`);
    const r = (await h.asService(`select api.run_slot_renewals(5000) as r`))[0].r;
    assert.ok(r.package_stuck >= 21);
    assert.equal(r.package_stuck_moves.length, 20);
  });
});
