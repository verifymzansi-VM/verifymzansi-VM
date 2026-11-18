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
// - builds owner A's private world through the production commands (legal
//   name, an accepted identity review, a verified phone, a live event with an
//   enquiry, a business draft, an organisation application, a payment);
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
// succeed outright only for a floor number of commands.
//
//   node --import tsx scripts/test-foundation-access-matrix.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Members
// and staff are Auth rows written as the database owner (staff with a verified
// authenticator app and an AAL2 session), as the other replayed-schema checks
// do; everything else goes through the production API commands.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
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
  ["orgAdmin:list_my_frontend_notifications:businessDraftId", "own notice of A's application"],
  // Staff with organisation:manage act for any organisation and see the same
  // minimal application list.
  ["admin:org_list_applications:applicationId", "organisation:manage, same minimal list"],
  ["admin:org_list_applications:businessDraftId", "organisation:manage, same minimal list"],
]);
// Reviewed exceptions: who may change which of owner A's rows, and through
// which command (principal:command:table). Staff may change A's rows only
// through a command gated by a capability their role holds; anything else
// changed by a non-owner fails.
const ALLOWED_CHANGES = new Map([
  // The organisation administrator decides A's consented application, and A
  // is notified of the decision (as on the prototype fixture).
  ["orgAdmin:org_decide_application:organisation_applications", "decides A's application"],
  ["orgAdmin:org_decide_application:notifications", "A is told of the decision"],
]);
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
// The intended principal's synthetic arguments reach a successful answer for
// at least this many commands; the rest stop at input or state validation
// (an unknown id, a missing claim), never at a grant or a staff check.
const INTENDED_SUCCESS_FLOOR = 130;

const APPLICATION_SCHEMAS = ["public", "api", "private", "internal"];
const OWNER_TABLES = [
  ["profiles", "account_id=$1"],
  ["identity_submission_names", "owner_id=$1"],
  ["posts", "owner_id=$1"],
  ["post_contacts", "post_id in (select id from private.posts where owner_id=$1)"],
  ["post_media", "post_id in (select id from private.posts where owner_id=$1)"],
  ["media_objects", "owner_id=$1"],
  ["enquiries", "owner_id=$1"],
  ["notifications", "account_id=$1"],
  ["evidence_cases", "subject_id=$1"],
  ["evidence_artifacts", "owner_id=$1"],
  ["verification_identity_submissions", "owner_id=$1"],
  ["accepted_identity_facts", "owner_id=$1"],
  ["verification_phone_proofs", "owner_id=$1"],
  ["verification_localities", "owner_id=$1"],
  ["payments", "owner_id=$1"],
  ["entitlements", "owner_id=$1"],
  ["organisation_applications", "applicant_id=$1"],
  ["legal_holds", "subject_id=$1"],
  ["organisation_sponsorships", "owner_id=$1"],
  ["account_acquisitions", "account_id=$1"],
  ["partners", "account_id=$1"],
  ["partner_commissions", "referred_account_id=$1"],
];

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
    // The only policy is the Auth sign-up hook's read of owner invitations.
    assert.equal(
      sql(
        `select coalesce(string_agg(schemaname||'.'||tablename||':'||policyname||':'||array_to_string(roles,','),' '),'') from pg_policies where schemaname in (${schemas});`
      ),
      "private.owner_admin_invitations:owner_admin_signup_hook:supabase_auth_admin"
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

  // ------------------------------------------------------ calling commands
  // One psql session for every call. vmtest.try runs one command as the given
  // role and JWT claims inside a subtransaction, catches its error, and (for
  // the sweep) fingerprints owner A's rows before and after it and rolls it
  // back, so every call sees the same world.
  const ownerDigest = OWNER_TABLES.map(
    ([table, where]) =>
      `'${table}',(select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'')) from private.${table} t where ${where.replaceAll("$1", "p_owner")})`
  ).join(",");
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
    create function vmtest.digest(p_owner uuid) returns jsonb language sql as $$
      select jsonb_build_object(${ownerDigest}) $$;
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
        reviewer,
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

  // Another member's invoice whose bank transfer expired
  // (20261118032610_bank_transfer_expiry.sql). It belongs to `other`, not to
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
    ]
      .map((value) => JSON.stringify(value))
      .join("");
    for (const name of [
      "surname",
      "buyerEmail",
      "buyerPhone",
      "buyerMessage",
      "enquiryId",
      "notificationId",
    ])
      assert.ok(leaks(ownView, "").includes(name), "owner view lacks " + name);
  });

  // ------------------------------------------------------------ arguments
  const { ids, live, business, org, orgSlug, programme, tokenHash } = world;
  const revisionOf = (id) =>
    Number(
      sql(
        `select coalesce((select revision from private.posts where id='${id}'),(select revision from private.organisations where id='${id}'),1);`
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
      p_case: [ids.caseId],
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
      p_payment_id: [ids.paymentId],
      p_object_id: mediaIds.slice(0, 2),
      p_fact: [ids.factId],
      p_challenge: [randomUUID()],
      p_product_id: [plans[0]?.id ?? randomUUID()],
      p_plan_id: [plans[0]?.id ?? randomUUID()],
      p_entitlement_id: entitlementIds.slice(0, 1),
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
      p_organisation_slug: orgSlug,
      p_token_hash: tokenHash,
      p_kind: "listing",
      p_queue: "posts",
      p_outcome: "dismissed",
      p_category: "other",
      p_email: owner.email,
      p_account_email: owner.email,
      p_phone: world.verified.phone,
      p_invoice_number: world.otherInvoice,
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
          revisionTarget: (target) => target.p_post_id ?? target.p_id ?? target.p_post ?? live.id,
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

  // 20261118032610_bank_transfer_expiry.sql: the sweep is the service role's
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
        if (caps.every((cap) => granted[role].includes(cap)))
          assert.ok(!results.some(capabilityRefusal), `${role} refused ${fn.name}`);
        else if (direct?.length === 1 && !granted[role].includes(direct[0]))
          assert.ok(results.every(capabilityRefusal), `${role} lacks ${direct[0]} for ${fn.name}`);
        else continue;
        capabilityChecks++;
      }
      // Members are never let through a staff check.
      for (const label of ["unverified", "other", "orgAdmin", "owner"])
        if (direct?.length === 1 && !MEMBER_WITH_STAFF_BRANCH.has(fn.name))
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
        const caps = capabilities[name] ?? [];
        return !caps.some((cap) => granted[label].includes(cap));
      })
      .sort();
    assert.deepEqual(unexpected, []);
  });

  let intendedOk = 0;
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
      if (results.some((r) => r.ok)) intendedOk++;
      assert.ok(
        !results.some(
          (r) => grantRefusal(r) || (!r.ok && STAFF_SESSION_REFUSALS.includes(r.message))
        ),
        `${label} refused ${fn.name}`
      );
    }
    assert.ok(intendedOk >= INTENDED_SUCCESS_FLOOR, `only ${intendedOk} commands succeeded`);
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
