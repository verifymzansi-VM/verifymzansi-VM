#!/usr/bin/env node
// Behaviour checks for the post lifecycle updates in database/foundation/updates:
// 20261109073519_post_lifecycle_guards.sql (staff holds, stable deletion
// clock, kept event submissions) and 20261109104020_post_expiry_rules.sql
// (3-day grace, sold and paused posts keep their slot, events deleted at
// their end, late-payment extension, cutover dates, owner reads with the
// deletion date), 20261109224337_fix_post_command_target.sql (saving an
// edit of an existing event) and 20261110045944_intro_trial_at_first_approval.sql
// (the free week starts when the first post is approved).
//
// Replays database/foundation (prelude, candidate.sql, every update) into the
// throwaway, network-less Postgres 17 container used by the SQL lint gate,
// seeds synthetic members and posts before each update, applies the update
// itself, and checks the backfills, the rules and their concurrency through
// the production API commands (member calls run as `authenticated` with
// synthetic claims and a live session row; jobs as `service_role`).
//
//   node --import tsx scripts/test-foundation-lifecycle-guards.mjs
//
// It also runs each update's read-only preflight (preflight/) before the
// update, and proves that apply -> rollback (rollback/) -> apply returns the
// schema fingerprint to the same values each time.
//
// Needs a local Docker daemon; it takes no connection settings at all. The
// Hide action and most hold releases are mirrored by vmtest.hide/release
// (same rows and lock order; the real staff commands need report and claim
// fixtures); one release goes through the real staff command. Plan slots are
// staff-granted entitlements, published posts get their approval snapshot
// directly (moderation has its own suites), and the time a rule waits for is
// simulated by moving a post's clock columns back. The only stand-in is
// internal.current_verified_identity (identity review is covered by its own
// suites), replaced after the posting terms update (the later updates do not
// define it) so submissions and reactivation reach the posting rules.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { replaySteps } from "./lib/foundation-replay.mjs";
import { applySteps, startLintDatabase } from "./lib/foundation-sql-lint.mjs";
import { buildRestoredPostInput } from "../src/lib/foundation/restored-post-input.ts";

const GUARDS = "20261109073519_post_lifecycle_guards.sql";
const RULES = "20261109104020_post_expiry_rules.sql";
const TERMS_V3 = "20261109173012_posting_terms_v3.sql";
const TARGET_FIX = "20261109224337_fix_post_command_target.sql";
const TRIAL = "20261110045944_intro_trial_at_first_approval.sql";
const companion = (folder, update, suffix) =>
  readFileSync(`database/foundation/${folder}/${update.replace(/\.sql$/, suffix)}`, "utf8");
const GUARDS_PREFLIGHT = companion("preflight", GUARDS, ".check.sql");
const GUARDS_ROLLBACK = companion("rollback", GUARDS, ".down.sql");
const RULES_PREFLIGHT = companion("preflight", RULES, ".check.sql");
const RULES_ROLLBACK = companion("rollback", RULES, ".down.sql");
const TERMS_V3_PREFLIGHT = companion("preflight", TERMS_V3, ".check.sql");
const TERMS_V3_ROLLBACK = companion("rollback", TERMS_V3, ".down.sql");
const TARGET_FIX_PREFLIGHT = companion("preflight", TARGET_FIX, ".check.sql");
const TARGET_FIX_ROLLBACK = companion("rollback", TARGET_FIX, ".down.sql");
const TRIAL_PREFLIGHT = companion("preflight", TRIAL, ".check.sql");
const TRIAL_ROLLBACK = companion("rollback", TRIAL, ".down.sql");
const CATALOGUE = JSON.parse(readFileSync("src/lib/legal/terms-documents/catalogue.json", "utf8"));
const FINGERPRINT = readFileSync("database/foundation/fingerprint.sql", "utf8");
const TERMS = {
  version: "posting-v1",
  document_hash: "RAXTzmTyM5iMYeLy8Xv_NvnvzqsjUKPYq5hQaqqNS1Q",
};
const checks = [];
let current = "start";

function check(id, fn) {
  current = id;
  return Promise.resolve(fn()).then(() => {
    checks.push(id);
    console.log(`PASS ${id}`);
  });
}

const started = Date.now();
const database = await startLintDatabase({ log: (line) => console.log(line) });
try {
  const { steps } = replaySteps();
  const guardsIndex = steps.findIndex((step) => step.label === GUARDS);
  const rulesIndex = steps.findIndex((step) => step.label === RULES);
  assert.ok(guardsIndex > 0, `${GUARDS} is missing`);
  assert.ok(rulesIndex > guardsIndex, `${RULES} is missing`);
  applySteps(database, steps.slice(0, guardsIndex));

  // ---------------------------------------------------------------- helpers
  const run = (sql) => database.psql(`\\set VERBOSITY verbose\n${sql}`, ["-A", "-t"]);
  const q = (sql) => {
    const result = run(sql);
    if (result.status !== 0) throw new Error(`[${current}] SQL failed: ${result.stderr.trim()}`);
    return result.stdout.trim();
  };
  const json = (sql) => JSON.parse(q(sql));
  const claims = (user) =>
    JSON.stringify({
      sub: user.id,
      role: "authenticated",
      session_id: user.session,
      aal: "aal1",
      is_anonymous: false,
    });
  const member = (user, sql) =>
    `\\o /dev/null\nselect set_config('request.jwt.claim.sub','${user.id}',false),set_config('request.jwt.claims','${claims(user)}',false);\n\\o\nset role authenticated;\n${sql}`;
  // A staff session that verified its authenticator app just now.
  const staffClaims = (user) =>
    JSON.stringify({
      ...JSON.parse(claims(user)),
      aal: "aal2",
      amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }],
    });
  const staffMember = (user, sql) =>
    `\\o /dev/null\nselect set_config('request.jwt.claim.sub','${user.id}',false),set_config('request.jwt.claims','${staffClaims(user)}',false);\n\\o\nset role authenticated;\n${sql}`;
  const fingerprint = () => q(`set search_path to pg_catalog;\n${FINGERPRINT}`);
  const preflight = (sql) =>
    q(sql)
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("|"));
  const service = (sql) => `set role service_role;\n${sql}`;
  const fails = (sql, state) => {
    const result = run(sql);
    assert.notEqual(result.status, 0, `[${current}] expected ${state}, the command succeeded`);
    const sqlstate = /ERROR:\s+([0-9A-Z]{5}):/.exec(result.stderr)?.[1];
    assert.equal(sqlstate, state, `[${current}] ${result.stderr}`);
    return result.stderr;
  };
  const job = () => json(service("select api.run_post_lifecycle(500);"));
  const cleanup = () => json(service("select api.claim_media_cleanup(500);"));
  const scalar = (sql) => q(sql);

  // A separate psql session, for the concurrency checks.
  const session = (sql) =>
    new Promise((resolve) => {
      const child = spawn(
        "docker",
        [
          "exec",
          "-i",
          database.name,
          "psql",
          "-X",
          "-q",
          "-A",
          "-t",
          "-v",
          "ON_ERROR_STOP=1",
          "-U",
          "postgres",
          "-d",
          "postgres",
        ],
        { windowsHide: true }
      );
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (data) => (stdout += data));
      child.stderr.on("data", (data) => (stderr += data));
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(`\\set VERBOSITY verbose\n${sql}`);
    });
  const later = (ms, sql) =>
    new Promise((resolve) => setTimeout(resolve, ms)).then(() => session(sql));

  // ------------------------------------------------------- synthetic world
  q(`create schema vmtest;
    create function vmtest.member(p_label text) returns jsonb language plpgsql as $$
    declare uid uuid:=gen_random_uuid(); sid uuid:=gen_random_uuid(); begin
      insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data)
        values(uid,p_label||'-'||uid||'@example.invalid',now(),jsonb_build_object('display_name','Fixture '||p_label));
      insert into auth.sessions(id,user_id,aal) values(sid,uid,'aal1');
      insert into private.posting_terms_acceptances(owner_id,version,document_hash)
        select uid,v.version,v.document_hash from private.posting_terms_current c
          join private.posting_terms_versions v using(version) where c.singleton;
      return jsonb_build_object('id',uid,'session',sid);
    end$$;
    create function vmtest.media(p_owner uuid) returns uuid language plpgsql as $$
    declare oid uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(oid,p_owner,'image','media/'||oid,1024,1024,encode(sha256(convert_to(oid::text,'UTF8')),'hex'),'image/jpeg',800,600,'ready');
      return oid;
    end$$;
    -- A post in the given state, with one ready cover image and the form
    -- contact channel. Ages are days before now.
    create function vmtest.post(p_owner uuid,p_kind text,p_status text,p_status_age integer default 0,
      p_submitted_age integer default null,p_reason text default null) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cover uuid:=vmtest.media(p_owner); area text; cat text; begin
      area:=case p_kind when 'listing' then 'market' when 'business' then 'business' else 'tourism_events' end;
      cat:=case p_kind when 'listing' then 'other_items' when 'business' then 'general_other' else 'events' end;
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,p_kind,area,cat,(select a.key from private.category_activities a join private.categories c on c.key=a.category_key
          where a.category_key=cat and c.activity_required order by a.key limit 1),
          'Fixture '||p_kind||' '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      if p_kind='listing' then insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      elsif p_kind='business' then insert into private.business_details(post_id) values(pid);
      else insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(pid,date_trunc('milliseconds',now()+interval '20 days'),date_trunc('milliseconds',now()+interval '21 days'),'Africa/Johannesburg'); end if;
      if p_kind<>'business' then insert into private.post_contacts(post_id,post_kind,channels) values(pid,p_kind,array['form']); end if;
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,cover,'cover',0);
      if p_status in('live','expired','sold','archived','paused') then
        update private.posts set status='live',published_at=now()-interval '40 days',
          visible_until=case when p_kind='event' then (select e.ends_at from private.event_details e where e.post_id=pid)
            else now()+interval '5 days' end where id=pid;
      end if;
      if p_status<>'draft' and p_status<>'live' then
        if p_status='pending_moderation' or p_submitted_age is not null then
          update private.posts set submitted_at=now()-make_interval(days=>coalesce(p_submitted_age,0)) where id=pid;
        end if;
        update private.posts set status=p_status,status_reason=p_reason where id=pid;
      end if;
      update private.posts set submitted_at=coalesce(submitted_at,case when p_submitted_age is not null then now()-make_interval(days=>p_submitted_age) end),
        status_changed_at=now()-make_interval(days=>p_status_age),content_updated_at=now()-make_interval(days=>p_status_age) where id=pid;
      return pid;
    end$$;
    -- Mirrors the staff Hide action's effect and lock order
    -- (internal.execute_frontend_report_action_v2): subject lock, post row,
    -- paused/staff_hidden with a hold state, then the hold row.
    create function vmtest.hide(p_post uuid,p_staff uuid) returns uuid language plpgsql as $$
    declare post private.posts; hold uuid:=gen_random_uuid(); begin
      select * into post from private.posts where id=p_post;
      perform internal.lock_verification_subject(post.owner_id);
      select * into post from private.posts where id=p_post for update;
      insert into private.frontend_post_hold_state(post_id,prior_status,prior_reason,hidden_revision)
        values(post.id,post.status,post.status_reason,post.revision+1) on conflict(post_id) do nothing;
      update private.posts set status='paused',status_reason='staff_hidden',revision=revision+1 where id=post.id;
      insert into private.frontend_content_holds(id,post_id,account_id,actor_id,reason,applied_at)
        values(hold,post.id,post.owner_id,p_staff,'Synthetic staff visibility hold',clock_timestamp());
      return hold;
    end$$;
    -- Mirrors the release's hold row change (internal.release_frontend_content_hold).
    create function vmtest.release(p_hold uuid,p_staff uuid) returns void language sql as $$
      update private.frontend_content_holds set version=version+1,released_at=clock_timestamp(),released_by=p_staff,
        release_reason='Synthetic review cleared' where id=p_hold;
    $$;
    -- A staff member with a verified authenticator and an AAL2 session.
    create function vmtest.staff(p_label text,p_role text) returns jsonb language plpgsql as $$
    declare m jsonb:=vmtest.member(p_label); begin
      update auth.sessions set aal='aal2' where id=(m->>'session')::uuid;
      insert into auth.mfa_factors(user_id,factor_type,status) values((m->>'id')::uuid,'totp','verified');
      insert into private.staff_roles(user_id,role) values((m->>'id')::uuid,p_role);
      return m;
    end$$;
    -- A plan slot: a staff-granted entitlement running for p_days more days.
    create function vmtest.slot(p_owner uuid,p_staff uuid,p_capacity integer default 1,p_days integer default 20)
    returns uuid language sql as $$
      insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values(p_owner,'staff_grant',p_staff,p_capacity,10,1,now()-interval '1 day',now()+make_interval(days=>p_days))
        returning id;
    $$;
    -- A live Market post published in that slot until the slot ends, with the
    -- approval snapshot moderation records.
    create function vmtest.slot_post(p_owner uuid,p_slot uuid) returns uuid language plpgsql as $$
    declare pid uuid:=vmtest.post(p_owner,'listing','live'); begin
      insert into private.post_activations(post_id,entitlement_id,owner_id) values(pid,p_slot,p_owner);
      update private.posts set visible_until=(select e.ends_at from private.entitlements e where e.id=p_slot) where id=pid;
      insert into private.frontend_post_approval_snapshots(post_id,digest,approved_at,structural_digest)
        values(pid,internal.frontend_post_approval_digest(pid),now(),internal.frontend_post_structural_digest(pid));
      return pid;
    end$$;
    -- The slot's plan ends now; the posts it funds reach the end of their run.
    create function vmtest.end_slot(p_slot uuid) returns void language sql as $$
      update private.entitlements set ends_at=clock_timestamp()-interval '1 second' where id=p_slot;
      update private.posts set visible_until=clock_timestamp()-interval '1 second'
        where id in(select a.post_id from private.post_activations a where a.entitlement_id=p_slot)
          and status in('live','paused');
    $$;
    create table vmtest.marker(id uuid);`);
  const user = (label) => json(`select vmtest.member('${label}');`);
  const post = (owner, kind, status, age = 0, submitted = null, reason = null) =>
    scalar(
      `select vmtest.post('${owner.id}','${kind}','${status}',${age},${submitted ?? "null"},${reason ? `'${reason}'` : "null"});`
    );
  const row = (id) =>
    json(
      `select coalesce((select to_jsonb(p)-'title'-'description' from private.posts p where p.id='${id}'),'null'::jsonb);`
    );
  const outbox = (id, kind) =>
    Number(
      scalar(
        `select count(*) from private.outbox_events where subject_id='${id}' and kind='${kind}';`
      )
    );
  const exists = (id) =>
    scalar(`select exists(select 1 from private.posts where id='${id}');`) === "t";

  const staff = user("staff"),
    alice = user("alice"), // edit-flow owner
    bea = user("bea"), // held-post owner
    cara = user("cara"), // free events owner
    dube = user("dube"), // legal hold owner
    fikile = user("fikile"), // concurrent events owner
    gugu = user("gugu"); // concurrency hold owner

  // Edits: the restored form's edit payload for the post's own cover, staged
  // by the server with the target post and consumed by the owner, exactly as
  // the website does (src/lib/foundation/restored-post-route.ts).
  const stageEdit = (owner, collection, id, fields) => {
    const p = row(id);
    const cover = scalar(
      `select object_id from private.post_media where post_id='${id}' and purpose='cover';`
    );
    const request = randomUUID();
    const input = buildRestoredPostInput(
      collection,
      {
        postRequestId: request,
        postingTerms: TERMS,
        expectedRevision: p.revision,
        province: "Gauteng",
        city: "Johannesburg",
        images: [`https://media.verifymzansi.com/media/${cover}`],
        ...fields,
      },
      undefined,
      true
    );
    const bound = {
      ...input,
      target_id: id,
      media: input.media.map(({ object_key, ...item }) => {
        assert.equal(object_key, `media/${cover}`);
        return { ...item, object_id: cover };
      }),
    };
    const digest = createHash("sha256").update(JSON.stringify(bound)).digest("hex");
    q(
      service(
        `select api.stage_frontend_post_command('${owner.id}','${request}','${digest}',$payload$${JSON.stringify(bound)}$payload$::jsonb);`
      )
    );
    return request;
  };
  const consume = (owner, request) =>
    member(owner, `select api.consume_frontend_post_command('${request}');`);
  const edit = (owner, id) =>
    json(
      consume(
        owner,
        stageEdit(owner, "listings", id, {
          title: "Edited fixture listing",
          description: "An edited synthetic description long enough for every rule.",
          price_zar: 150,
          category: "other_items",
          attributes: {},
          condition: "good",
          contactMethods: ["form"],
        })
      )
    );
  // The restored event form's edit with a new event window (and, optionally,
  // a new contact choice; fixture posts start with the form channel only).
  const eventEdit = (owner, id, window, contactMethods = ["form"]) =>
    stageEdit(owner, "promotions", id, {
      title: "Edited fixture event",
      description: "An edited synthetic event description long enough for every rule.",
      promotion_type: "event",
      contact_methods: contactMethods,
      start_date: window.starts_at,
      end_date: window.ends_at,
      event_details: { event_type: row(id).activity_key },
    });

  // ------------------------------------- state before the lifecycle guards
  const expiredListing = post(alice, "listing", "expired", 10, 12);
  const soldListing = post(alice, "listing", "sold", 5, 40);
  const characterised = post(alice, "listing", "expired", 3, 20);
  const liveListing = post(alice, "listing", "live");
  const approvalDigest = scalar(
    `select internal.frontend_post_approval_digest('${expiredListing}')||':'||internal.frontend_post_structural_digest('${expiredListing}');`
  );
  // Free events: counted = the original formula of internal.submit_post.
  const eventAges = [
    ["live", 2],
    ["live", 4],
    ["expired", 6],
    ["expired", 9],
    ["rejected", 11],
    ["rejected", 14],
    ["draft", 16],
    ["paused", 20],
    ["expired", 25],
    ["expired", 35],
  ];
  const caraEvents = eventAges.map(([status, age]) => post(cara, "event", status, 1, age));
  const oldFormula = (owner) =>
    Number(
      scalar(
        `select count(*) from private.posts p where p.owner_id='${owner.id}' and p.kind='event' and p.edit_of is null and p.submitted_at>statement_timestamp()-interval '30 days';`
      )
    );
  const caraBefore = oldFormula(cara);
  assert.equal(caraBefore, 9);
  const fikileEvents = Array.from({ length: 9 }, (_, n) =>
    post(fikile, "event", "expired", 1, n + 1)
  );
  assert.equal(fikileEvents.length, 9);
  // A hold that is already open when the update is applied.
  const heldListing = post(bea, "listing", "live");
  const logo = scalar(`select vmtest.media('${bea.id}');`);
  q(
    `insert into private.post_presentation_media(post_id,object_id,purpose,position) values('${heldListing}','${logo}','logo',0);`
  );
  const heldCover = scalar(
    `select object_id from private.post_media where post_id='${heldListing}' and purpose='cover';`
  );
  const preexistingHold = scalar(`select vmtest.hide('${heldListing}','${staff.id}');`);

  await check("pre-update: the edit flow resets the expiry clock and re-sends post_expired", () => {
    q(service("select api.run_post_lifecycle(500);"));
    assert.equal(outbox(characterised, "post_expired"), 1);
    const before = row(characterised).status_changed_at;
    const answer = edit(alice, characterised);
    assert.equal(answer.status, "expired");
    assert.notEqual(row(characterised).status_changed_at, before);
    q(service("select api.run_post_lifecycle(500);"));
    assert.equal(outbox(characterised, "post_expired"), 2);
  });
  // Created after the old job ran: past its deletion date, not yet deleted.
  const oldExpired = post(alice, "listing", "expired", 31, 45);
  const remindersBefore = outbox(expiredListing, "post_expiry_reminder");
  assert.equal(outbox(expiredListing, "post_expired"), 1);
  assert.equal(remindersBefore, 1, "the earlier job queued one 7-day reminder");

  // Rows that cannot be made through any command, written with triggers off,
  // that a backfill's deferred checks would refuse.
  const brokenRows = (extra) => {
    const [job, attrs, bare] = [randomUUID(), randomUUID(), randomUUID()];
    const broken = (id, category, status) =>
      `insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id,status${extra.columns})
         values('${id}','${alice.id}','listing','market','${category}','Broken fixture','A broken synthetic row.','gp','gp_johannesburg','${status}'${extra.values});`;
    q(`set session_replication_role=replica;
       ${broken(job, "jobs_services", "expired")}
       insert into private.listing_details(post_id,price_mode,price_cents) values('${job}','free',0);
       ${broken(attrs, "other_items", "sold")}
       insert into private.listing_details(post_id,price_mode,price_cents,attributes) values('${attrs}','amount',100,'{"no_such_field":"x"}');
       ${broken(bare, "other_items", "archived")}`);
    return {
      expected: [
        ["deferred check: exactly one detail row", bare],
        ["deferred check: job salary cannot be free or negotiable", job],
        ["deferred check: listing attributes", attrs],
      ].sort(),
      remove: () =>
        q(`set session_replication_role=replica;
           delete from private.listing_details where post_id in('${job}','${attrs}');
           delete from private.posts where id in('${job}','${attrs}','${bare}');`),
    };
  };
  const problems = (sql) =>
    preflight(sql)
      .filter((r) => r[1] !== "summary")
      .map((r) => [r[1], r[2]])
      .sort();

  await check("guards preflight: read only, and silent when the backfill will pass", () => {
    const rows = preflight(GUARDS_PREFLIGHT);
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0][1], "summary");
    // As one transaction (like the SQL editor), any write after it is refused.
    const write = database.psql(
      `${GUARDS_PREFLIGHT}\ninsert into vmtest.marker values(gen_random_uuid());`,
      ["-A", "-t", "-1", "-v", "VERBOSITY=verbose"]
    );
    assert.notEqual(write.status, 0);
    assert.match(write.stderr, /ERROR:\s+25006:/);
  });
  await check("guards preflight: reports rows the backfill's deferred checks would refuse", () => {
    const rows = brokenRows({ columns: "", values: "" });
    assert.deepEqual(problems(GUARDS_PREFLIGHT), rows.expected);
    rows.remove();
    assert.equal(preflight(GUARDS_PREFLIGHT).length, 1);
  });
  await check("rules preflight: refuses to run before the lifecycle guards", () => {
    const result = run(RULES_PREFLIGHT);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /apply 20261109073519_post_lifecycle_guards\.sql first/);
  });

  // ----------------------------------------- apply the lifecycle guards
  const guardsBefore = fingerprint();
  applySteps(database, [steps[guardsIndex]]);
  const guardsAfter = fingerprint();
  await check("guards rollback: apply, roll back and apply again are clean", () => {
    assert.notEqual(guardsAfter, guardsBefore);
    applySteps(database, [{ label: "guards rollback", sql: GUARDS_ROLLBACK }]);
    assert.equal(fingerprint(), guardsBefore, "the rollback leaves the pre-update schema");
    assert.equal(exists(expiredListing), true);
    applySteps(database, [steps[guardsIndex]]);
    assert.equal(fingerprint(), guardsAfter, "re-applying gives the same schema");
  });
  applySteps(database, steps.slice(guardsIndex + 1, rulesIndex));

  await check("guards backfill: ended posts keep their deletion date; others have none", () => {
    for (const id of [expiredListing, soldListing, oldExpired]) {
      const p = row(id);
      assert.equal(p.ended_at, p.status_changed_at);
      assert.equal(
        scalar(
          `select (deletes_at=status_changed_at+interval '30 days')::text from private.posts where id='${id}';`
        ),
        "true"
      );
    }
    for (const id of [liveListing, heldListing]) {
      assert.equal(row(id).ended_at, null);
      assert.equal(row(id).deletes_at, null);
    }
  });
  await check("guards backfill: the free-event count is unchanged for every owner", () => {
    const ledger = (owner) =>
      Number(
        scalar(
          `select count(distinct post_id) from private.event_submissions where owner_id='${owner.id}' and released_at is null and submitted_at>statement_timestamp()-interval '30 days';`
        )
      );
    assert.equal(ledger(cara), caraBefore);
    assert.equal(ledger(fikile), 9);
    assert.equal(
      Number(
        scalar(`select count(*) from private.event_submissions where post_id='${caraEvents[9]}';`)
      ),
      0,
      "a submission outside the window is not copied"
    );
  });
  await check("guards backfill: open holds keep the media the post showed", () => {
    assert.equal(
      scalar(
        `select string_agg(object_id::text,',' order by object_id) from private.frontend_content_hold_media where hold_id='${preexistingHold}';`
      ),
      [heldCover, logo].sort().join(",")
    );
  });
  const digestUnchanged = () =>
    assert.equal(
      scalar(
        `select internal.frontend_post_approval_digest('${expiredListing}')||':'||internal.frontend_post_structural_digest('${expiredListing}');`
      ),
      approvalDigest
    );
  await check("approval digests do not include the lifecycle columns", digestUnchanged);

  // ------------------------------------- state before the expiry rules
  // Posts as the lifecycle guards leave them (deletion 30 days after the run
  // ended; pausing and selling released the slot).
  const dana = user("dana");
  const endedAgo = (id, days) =>
    q(
      `update private.posts set ended_at=now()-make_interval(days=>${days}),deletes_at=now()-make_interval(days=>${days})+interval '30 days' where id='${id}';`
    );
  const cutExpired = post(dana, "listing", "expired", 25);
  endedAgo(cutExpired, 25);
  const cutExpiredRecent = post(dana, "listing", "expired", 1);
  endedAgo(cutExpiredRecent, 1);
  const cutArchived = post(dana, "listing", "archived", 1);
  endedAgo(cutArchived, 1);
  const cutExpiredEvent = post(dana, "event", "expired", 5);
  endedAgo(cutExpiredEvent, 5);
  const cutLiveEvent = post(dana, "event", "live");
  const cutPausedEvent = post(dana, "event", "paused");
  const cutOverEvent = post(dana, "event", "live");
  q(`update private.event_details set starts_at=date_trunc('milliseconds',now()-interval '2 hours'),
       ends_at=date_trunc('milliseconds',now()-interval '1 hour') where post_id='${cutOverEvent}';
     update private.posts set visible_until=(select ends_at from private.event_details where post_id='${cutOverEvent}')
       where id='${cutOverEvent}';`);
  const cutDraftEvent = post(dana, "event", "draft");
  const cutPendingEvent = post(dana, "event", "pending_moderation", 0, 1);
  const cutOverDraft = post(dana, "event", "draft");
  q(`update private.event_details set starts_at=date_trunc('milliseconds',now()-interval '3 hours'),
       ends_at=date_trunc('milliseconds',now()-interval '2 hours') where post_id='${cutOverDraft}';`);
  // A paused post that still holds a slot whose run has ended (a staff hold
  // released without restoring it leaves one like this).
  const cutPausedSlotEnt = scalar(`select vmtest.slot('${dana.id}','${staff.id}');`);
  const cutPausedSlot = scalar(`select vmtest.slot_post('${dana.id}','${cutPausedSlotEnt}');`);
  q(`update private.posts set status='paused' where id='${cutPausedSlot}';
     select vmtest.end_slot('${cutPausedSlotEnt}');`);
  const cutSlot = scalar(`select vmtest.slot('${dana.id}','${staff.id}',2);`);
  const cutSold = scalar(`select vmtest.slot_post('${dana.id}','${cutSlot}');`);
  const cutPaused = scalar(`select vmtest.slot_post('${dana.id}','${cutSlot}');`);
  q(member(dana, `select api.set_post_state('${cutSold}',${row(cutSold).revision},'sold');`));
  q(member(dana, `select api.set_post_state('${cutPaused}',${row(cutPaused).revision},'pause');`));
  const openSlot = (id) =>
    scalar(
      `select coalesce((select id::text from private.post_activations where post_id='${id}' and released_at is null),'')`
    );
  assert.equal(openSlot(cutSold), "", "the lifecycle guards release a sold post's slot");
  assert.equal(openSlot(cutPaused), "", "the lifecycle guards release a paused post's slot");
  const count = (sql) => Number(scalar(`select count(*) from (${sql}) x;`));

  await check("rules preflight: read only, and its summary counts what the update changes", () => {
    const rows = preflight(RULES_PREFLIGHT);
    assert.equal(rows.length, 1, JSON.stringify(rows));
    assert.equal(rows[0][1], "summary");
    const ended = count("select 1 from private.posts where status in('expired','sold','archived')");
    const notices = count(
      "select 1 from private.posts where (status='expired' and kind<>'event') or status='sold'"
    );
    const unended =
      "select 1 from private.posts p join private.event_details e on e.post_id=p.id where p.kind='event' and p.edit_of is null and p.ended_at is null and p.status not in('expired','sold','archived')";
    const events = count(unended);
    const over = count(`${unended} and e.ends_at<=now()`);
    assert.equal(over, 2);
    const ran = count(
      "select 1 from private.posts p where p.status='paused' and p.kind<>'event' and p.visible_until<=now() and exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null) and not exists(select 1 from private.frontend_content_holds h where h.post_id=p.id and h.released_at is null)"
    );
    assert.equal(ran, 1);
    const paused = count(
      "select 1 from private.posts p where status='paused' and not exists(select 1 from private.post_activations a where a.post_id=p.id and a.released_at is null)"
    );
    const holds = count("select 1 from private.frontend_content_holds where released_at is null");
    const reported = count(
      "select 1 from private.posts p where p.status in('expired','sold','archived') and exists(select 1 from private.reports r where r.post_id=p.id and r.status='open')"
    );
    assert.equal(
      rows[0][3],
      `${ended} ended posts get a deletion date at least 3 days away (${notices} new notices); ` +
        `${events} events get their end as deletion date (${over} already over); ` +
        `${ran} paused posts with a slot whose run has ended expire at the first run; ` +
        `${paused} paused posts without a slot keep the idle rule; ` +
        `${reported} ended posts with an open report; ${holds} open staff holds`
    );
    const write = database.psql(
      `${RULES_PREFLIGHT}\ninsert into vmtest.marker values(gen_random_uuid());`,
      ["-A", "-t", "-1", "-v", "VERBOSITY=verbose"]
    );
    assert.notEqual(write.status, 0);
    assert.match(write.stderr, /ERROR:\s+25006:/);
  });
  await check("rules preflight: reports rows the backfill's deferred checks would refuse", () => {
    const rows = brokenRows({
      columns: ",ended_at,deletes_at",
      values: ",now(),now()+interval '30 days'",
    });
    assert.deepEqual(problems(RULES_PREFLIGHT), rows.expected);
    rows.remove();
    assert.equal(preflight(RULES_PREFLIGHT).length, 1);
  });

  // --------------------------------------------- apply the expiry rules
  const rulesBefore = fingerprint();
  applySteps(database, [steps[rulesIndex]]);
  const rulesAfter = fingerprint();
  await check("rules rollback: apply, roll back and apply again are clean", () => {
    assert.notEqual(rulesAfter, rulesBefore);
    // State only the expiry rules make: a paused and a sold post keep their
    // slot, and a sold notice is queued.
    const slotId = scalar(`select vmtest.slot('${dana.id}','${staff.id}',2);`);
    const paused = scalar(`select vmtest.slot_post('${dana.id}','${slotId}');`);
    const sold = scalar(`select vmtest.slot_post('${dana.id}','${slotId}');`);
    q(member(dana, `select api.set_post_state('${paused}',${row(paused).revision},'pause');`));
    q(member(dana, `select api.set_post_state('${sold}',${row(sold).revision},'sold');`));
    assert.notEqual(openSlot(paused), "");
    assert.notEqual(openSlot(sold), "");
    job();
    assert.equal(outbox(sold, "post_sold"), 1);
    applySteps(database, [{ label: "rules rollback", sql: RULES_ROLLBACK }]);
    assert.equal(fingerprint(), rulesBefore, "the rollback leaves the pre-update schema");
    assert.equal(openSlot(paused), "", "a paused post releases its slot, as before");
    assert.equal(openSlot(sold), "", "a sold post releases its slot, as before");
    assert.equal(
      count(
        "select 1 from private.posts where status in('expired','sold','archived') and deletes_at<>ended_at+interval '30 days'"
      ),
      0
    );
    assert.equal(row(cutLiveEvent).deletes_at, null);
    assert.equal(
      count("select 1 from private.outbox_events where kind in('post_sold','post_kept')"),
      0
    );
    assert.equal(
      scalar(
        "select to_regprocedure('internal.ended_post_decision(private.posts)') is null and to_regclass('private.post_deletion_extensions') is null and to_regclass('private.payments_owner_plan_created_idx') is null and to_regclass('private.reports_open_post_idx') is null;"
      ),
      "t"
    );
    assert.equal(
      scalar("select to_regprocedure('api.get_my_frontend_post_v2(uuid)') is null;"),
      "t"
    );
    assert.equal(exists(cutExpired) && exists(sold), true);
    applySteps(database, [steps[rulesIndex]]);
    assert.equal(fingerprint(), rulesAfter, "re-applying gives the same schema");
  });
  // The cutover instant is the re-application above; posts that ended before
  // it are dated from it.
  const cutover = scalar(
    "select max(deletes_at)-interval '3 days' from private.posts where status in('expired','sold','archived');"
  );
  const fixIndex = steps.findIndex((step) => step.label === TARGET_FIX);
  assert.ok(fixIndex > rulesIndex, `${TARGET_FIX} is missing`);
  applySteps(database, steps.slice(rulesIndex + 1, fixIndex));
  console.log(`Applied ${GUARDS}, ${RULES} and the updates before ${TARGET_FIX}.`);
  await check("posting terms v3: current after the expiry rules, rollback and re-apply", () => {
    const termsStep = steps.find((step) => step.label === TERMS_V3);
    assert.ok(termsStep && steps.indexOf(termsStep) > rulesIndex, `${TERMS_V3} is missing`);
    const currentTerms = () =>
      json(
        "select jsonb_build_object('version',v.version,'document_hash',v.document_hash) from private.posting_terms_current c join private.posting_terms_versions v using(version) where c.singleton;"
      );
    const v3 = { version: "posting-v3", document_hash: CATALOGUE.versions["posting-v3"] };
    assert.equal(CATALOGUE.active_version, "posting-v3");
    assert.deepEqual(currentTerms(), v3);
    const after = fingerprint();
    const summary = preflight(TERMS_V3_PREFLIGHT);
    assert.equal(summary.length, 1);
    assert.equal(summary[0][0], "summary");
    applySteps(database, [{ label: "terms v3 rollback", sql: TERMS_V3_ROLLBACK }]);
    assert.deepEqual(currentTerms(), TERMS);
    assert.deepEqual(
      preflight(TERMS_V3_PREFLIGHT).map((line) => line[0]),
      ["summary"]
    );
    applySteps(database, [termsStep]);
    assert.deepEqual(currentTerms(), v3);
    applySteps(database, [termsStep]);
    assert.equal(fingerprint(), after, "re-applying gives the same schema");
    // Published versions stay immutable.
    fails(
      "update private.posting_terms_versions set document_hash=document_hash where version='posting-v3';",
      "23514"
    );
    // Members created so far accepted posting-v1; they accept posting-v3 now.
    TERMS.version = v3.version;
    TERMS.document_hash = v3.document_hash;
    q(
      `insert into private.posting_terms_acceptances(owner_id,version,document_hash) select u.id,'${v3.version}','${v3.document_hash}' from auth.users u on conflict do nothing;`
    );
  });
  q(`create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path=pg_catalog as $$
      select 'fixture-identity'::text where exists(select 1 from private.current_account_access a where a.id=p_owner) $$;`);

  // ------------------------------------ post commands with a target post
  // Event edits carry target_id and reach the event window branch of
  // internal.consume_frontend_post_command, which the fix corrects.
  const fixStep = steps[fixIndex];
  const nandi = user("nandi"); // event edit owner
  const targetDraft = post(nandi, "event", "draft");
  const targetPaused = post(nandi, "event", "paused");
  const targetRejected = post(nandi, "event", "rejected", 0, 1);
  const targetLive = post(nandi, "event", "live");
  const DAY = 24 * 60 * 60 * 1000;
  const eventWindow = (days) => ({
    starts_at: new Date(Date.now() + days * DAY).toISOString(),
    ends_at: new Date(Date.now() + (days + 1) * DAY).toISOString(),
    timezone: "Africa/Johannesburg",
  });
  const savedWindow = (id) =>
    json(
      `select jsonb_build_object('starts_at',to_char(starts_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'ends_at',to_char(ends_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'timezone',timezone) from private.event_details where post_id='${id}';`
    );
  const channels = (id) =>
    scalar(
      `select array_to_string(channels,',') from private.post_contacts where post_id='${id}';`
    );
  const fixPreflight = () => preflight(TARGET_FIX_PREFLIGHT);
  const refusedEdit = (request) => {
    const stderr = fails(consume(nandi, request), "42725");
    assert.match(stderr, /operator is not unique: unknown - unknown/);
  };
  const BUGGY = "3a2351c232554b060e0c7dd49bd3c7e3";
  const FIXED = "48f301b07ef97551cc810c17c4512283";
  const commandBody = () =>
    scalar(
      "select md5(replace(prosrc,E'\\r\\n',E'\\n')) from pg_proc where oid='internal.consume_frontend_post_command(uuid)'::regprocedure;"
    );
  const staleWindow = eventWindow(32);
  let staleRequest;

  await check("post command target: before the fix, every event edit fails with 42725", () => {
    assert.equal(commandBody(), BUGGY);
    for (const id of [targetDraft, targetPaused, targetRejected, targetLive]) {
      const before = row(id);
      refusedEdit(eventEdit(nandi, id, eventWindow(30)));
      assert.deepEqual(row(id), before, "a refused edit changes nothing");
    }
    assert.equal(count(`select 1 from private.posts where edit_of='${targetLive}'`), 0);
    staleRequest = eventEdit(nandi, targetDraft, staleWindow);
    refusedEdit(staleRequest);
    // A listing edit carries target_id too, but never reaches the event branch.
    assert.equal(edit(alice, post(alice, "listing", "draft")).status, "draft");
  });
  await check(
    "post command target preflight: read only, summary only, counts refused edits",
    () => {
      const rows = fixPreflight();
      assert.deepEqual(
        rows.map((r) => r[0]),
        ["summary"],
        JSON.stringify(rows)
      );
      assert.match(
        rows[0][1],
        /reviewed live body, fix not applied; unexpired event edits without a result: 5$/
      );
      const write = database.psql(
        `${TARGET_FIX_PREFLIGHT}\ninsert into vmtest.marker values(gen_random_uuid());`,
        ["-A", "-t", "-1", "-v", "VERBOSITY=verbose"]
      );
      assert.notEqual(write.status, 0);
      assert.match(write.stderr, /ERROR:\s+25006:/);
    }
  );
  await check("post command target: drift and a premature rollback are refused", () => {
    const before = fingerprint();
    // The rollback needs the fixed body.
    const early = fails(TARGET_FIX_ROLLBACK, "55000");
    assert.match(early, /rollback precondition/);
    assert.equal(fingerprint(), before);
    // Any other body: the preflight reports it and the update refuses it.
    const live = q(
      "select pg_get_functiondef('internal.consume_frontend_post_command(uuid)'::regprocedure);"
    );
    q(
      `do $$begin execute replace(pg_get_functiondef('internal.consume_frontend_post_command(uuid)'::regprocedure),'end$function$','end;$function$'); end$$;`
    );
    assert.notEqual(commandBody(), BUGGY);
    const rows = fixPreflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /is not the reviewed body/);
    const refusedUpdate = fails(fixStep.sql, "55000");
    assert.match(refusedUpdate, /post command drift/);
    q(`${live};`);
    assert.equal(commandBody(), BUGGY);
    assert.equal(fingerprint(), before);
  });

  const fixBefore = fingerprint();
  applySteps(database, [fixStep]);
  const fixAfter = fingerprint();
  await check("post command target: apply, roll back and apply again are clean", () => {
    assert.notEqual(fixAfter, fixBefore);
    assert.equal(commandBody(), FIXED);
    assert.match(fixPreflight()[0][1], /already fixed/);
    applySteps(database, [{ label: "post command target rollback", sql: TARGET_FIX_ROLLBACK }]);
    assert.equal(fingerprint(), fixBefore, "the rollback leaves the pre-update schema");
    assert.equal(commandBody(), BUGGY);
    refusedEdit(eventEdit(nandi, targetDraft, eventWindow(30)));
    applySteps(database, [fixStep]);
    assert.equal(fingerprint(), fixAfter, "re-applying gives the same schema");
    applySteps(database, [fixStep]);
    assert.equal(fingerprint(), fixAfter, "a repeated run changes nothing");
  });
  await check(
    "post command target: a refused edit sent again before it expires is saved once",
    () => {
      // Staged before the update; the rollback check refused one more.
      assert.match(
        fixPreflight()[0][1],
        /already fixed; unexpired event edits without a result: 6$/
      );
      const answer = json(consume(nandi, staleRequest));
      assert.equal(answer.id, targetDraft);
      assert.equal(answer.status, "draft");
      assert.deepEqual(savedWindow(targetDraft), staleWindow);
      assert.deepEqual(json(consume(nandi, staleRequest)), answer, "the receipt is replayed");
      assert.match(
        fixPreflight()[0][1],
        /already fixed; unexpired event edits without a result: 5$/
      );
    }
  );
  await check(
    "post command target: after the fix, non-live event edits save the new window",
    () => {
      for (const [id, status] of [
        [targetDraft, "draft"],
        [targetPaused, "paused"],
        [targetRejected, "rejected"],
      ]) {
        const window = eventWindow(40);
        const before = row(id);
        assert.equal(channels(id), "form");
        const answer = json(consume(nandi, eventEdit(nandi, id, window, ["call", "form"])));
        assert.equal(answer.id, id);
        assert.equal(answer.original_id, id);
        assert.equal(answer.edit_of, null);
        assert.equal(answer.status, status);
        assert.ok(answer.revision > before.revision);
        assert.equal(row(id).status, status);
        assert.deepEqual(savedWindow(id), window);
        assert.equal(
          scalar(`select title from private.posts where id='${id}';`),
          "Edited fixture event"
        );
        assert.equal(channels(id), "call,form", "the new contact choice is saved");
      }
    }
  );
  await check(
    "post command target: a live event edit becomes a review copy, the original stays live",
    () => {
      const window = eventWindow(45);
      const original = savedWindow(targetLive);
      const answer = json(consume(nandi, eventEdit(nandi, targetLive, window)));
      assert.equal(answer.original_id, targetLive);
      assert.equal(answer.edit_of, targetLive);
      assert.notEqual(answer.id, targetLive);
      assert.equal(answer.status, "pending_moderation");
      assert.equal(row(targetLive).status, "live");
      assert.deepEqual(
        savedWindow(targetLive),
        original,
        "the public event is unchanged until review"
      );
      assert.deepEqual(savedWindow(answer.id), window);
    }
  );
  await check(
    "post command target: an expired event edit saves the new window, stays expired and keeps its deletion date",
    () => {
      const expired = post(nandi, "event", "expired");
      const before = row(expired);
      assert.equal(before.status, "expired");
      assert.ok(before.ended_at && before.deletes_at, JSON.stringify(before));
      const window = eventWindow(50);
      const answer = json(consume(nandi, eventEdit(nandi, expired, window, ["call", "form"])));
      assert.equal(answer.id, expired);
      assert.equal(answer.original_id, expired);
      assert.equal(answer.edit_of, null);
      assert.equal(answer.status, "expired");
      const after = row(expired);
      assert.equal(after.status, "expired");
      assert.ok(after.revision > before.revision);
      assert.equal(after.ended_at, before.ended_at, "the run's end is unchanged");
      assert.equal(after.deletes_at, before.deletes_at, "the deletion date is unchanged");
      assert.deepEqual(savedWindow(expired), window);
      assert.equal(channels(expired), "call,form");
      // Removed again: the cutover checks below expect every ended post to be
      // one that ended before the expiry rules were applied.
      q(`delete from private.posts where id='${expired}';`);
      assert.equal(exists(expired), false);
    }
  );
  await check(
    "post command target: another member's edit of an event is refused and changes nothing",
    () => {
      const other = user("olwethu");
      const before = row(targetDraft);
      const window = savedWindow(targetDraft);
      const contacts = channels(targetDraft);
      const stderr = fails(
        consume(other, eventEdit(other, targetDraft, eventWindow(55), ["whatsapp"])),
        "42501"
      );
      assert.match(stderr, /owned post unavailable/);
      assert.deepEqual(row(targetDraft), before);
      assert.deepEqual(savedWindow(targetDraft), window);
      assert.equal(channels(targetDraft), contacts);
    }
  );
  await check(
    "post command target: an event awaiting review cannot be edited and is unchanged",
    () => {
      const pending = post(nandi, "event", "pending_moderation", 0, 1);
      const before = row(pending);
      const window = savedWindow(pending);
      const stderr = fails(
        consume(nandi, eventEdit(nandi, pending, eventWindow(60), ["call", "form"])),
        "PT409"
      );
      assert.match(stderr, /post cannot be edited now/);
      assert.deepEqual(row(pending), before);
      assert.deepEqual(savedWindow(pending), window);
      assert.equal(channels(pending), "form");
    }
  );
  // --------------------------- the free week starts at the first approval
  // 20261110045944_intro_trial_at_first_approval.sql: verification no longer
  // starts the 7-day trial; a post submitted without a plan waits for it, and
  // its approval starts it. Staff decisions go through the real queue claim
  // and moderation commands.
  const trialIndex = steps.findIndex((step) => step.label === TRIAL);
  assert.ok(trialIndex > fixIndex, `${TRIAL} is missing`);
  applySteps(database, steps.slice(fixIndex + 1, trialIndex));
  const trialStep = steps[trialIndex];
  // For this section the identity stand-in gives each member a fingerprint of
  // the production form (the accepted identity fact's, when the member has
  // one), so trial grants and identity records work as in production.
  const sharedIdentity = q(
    "select pg_get_functiondef('internal.current_verified_identity(uuid)'::regprocedure);"
  );
  q(`create or replace function internal.current_verified_identity(p_owner uuid) returns text
      language sql set search_path=pg_catalog as $$
      select coalesce((select f.identity_hmac from private.accepted_identity_facts f
          where f.owner_id=p_owner and f.revoked_at is null order by f.reviewed_at desc limit 1),
        left(translate(encode(sha256(convert_to(p_owner::text,'UTF8')),'base64'),'+/=','-_'),42)||'A')
      where exists(select 1 from private.current_account_access a where a.id=p_owner) $$;
    -- The verification facts the earlier job looked for (accepted identity,
    -- phone, area); their review records are not needed here.
    create function vmtest.verified(p_owner uuid,p_staff uuid) returns text language plpgsql as $$
    declare fp text:=left(translate(encode(sha256(convert_to('fact-'||p_owner::text,'UTF8')),'base64'),'+/=','-_'),42)||'A'; begin
      perform set_config('session_replication_role','replica',true);
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by)
        values(p_owner,gen_random_uuid(),fp,p_staff);
      insert into private.verification_phone_proofs(owner_id,challenge_id,phone)
        values(p_owner,gen_random_uuid(),'+2782'||lpad((abs(hashtext(p_owner::text))%10000000)::text,7,'0'));
      insert into private.verification_localities(owner_id,province_id,city_id) values(p_owner,'gp','gp_johannesburg');
      perform set_config('session_replication_role','origin',true);
      return fp;
    end$$;`);
  const moderator = json(`select vmtest.staff('trialmod','moderator');`);
  const verified = (label) => {
    const m = user(label);
    m.fingerprint = scalar(`select vmtest.verified('${m.id}','${staff.id}');`);
    return m;
  };
  const trials = (owner) =>
    json(
      `select coalesce(jsonb_agg(jsonb_build_object('id',id,'status',status,'starts_at',starts_at,'ends_at',ends_at,
         'seconds',extract(epoch from ends_at-starts_at)::bigint,'revoked_reason',revoked_reason) order by created_at),'[]')
       from private.entitlements where owner_id='${owner.id}' and source='intro_trial';`
    );
  const activeTrials = (owner) => trials(owner).filter((t) => t.status === "active");
  const identityRows = (owner) =>
    Number(scalar(`select count(*) from private.trial_identities where owner_id='${owner.id}';`));
  const waits = (id) =>
    scalar(`select count(*) from private.intro_trial_requests where post_id='${id}';`) === "1";
  const openActivation = (id) =>
    scalar(
      `select coalesce((select entitlement_id::text from private.post_activations where post_id='${id}' and released_at is null),'');`
    );
  const submitPost = (owner, id) =>
    member(owner, `select api.submit_post('${id}',${row(id).revision});`);
  const decide = (id, decision, reason = null) => {
    const lease = json(staffMember(moderator, `select api.claim_queue_item('post','${id}');`));
    return staffMember(
      moderator,
      `select api.moderate_post(p_post_id=>'${id}',p_expected_revision=>${row(id).revision},p_decision=>'${decision}',
        p_reason=>${reason ? `'${reason}'` : "null"},p_claim_generation=>'${lease.claim_generation}',p_claim_nonce=>'${lease.claim_nonce}');`
    );
  };
  const freeWeek = (owner) => json(member(owner, "select api.get_my_intro_trial();"));
  const allowance = (owner, area = "market") =>
    json(member(owner, `select api.get_my_frontend_posting_allowance_v2('${area}');`));
  const allowanceV1 = (owner, area = "market") =>
    json(member(owner, `select api.get_my_frontend_posting_allowance('${area}');`));
  const reconcile = () => Number(scalar(service("select api.reconcile_intro_trials(20);")));
  // The restored listing form's new-post command, staged by the server and
  // consumed by the member, as the website does (with a fresh upload).
  const stageNew = (owner, trialDays = 7) => {
    const media = scalar(`select vmtest.media('${owner.id}');`);
    const request = randomUUID();
    const input = buildRestoredPostInput("listings", {
      postRequestId: request,
      postingTerms: TERMS,
      title: "Free week fixture listing",
      description: "A synthetic description long enough for every rule of the form.",
      price_zar: 150,
      category: "other_items",
      attributes: {},
      condition: "good",
      contactMethods: ["form"],
      province: "Gauteng",
      city: "Johannesburg",
      images: [`https://media.verifymzansi.com/media/${media}`],
      trialDays,
      termsAccepted: true,
    });
    const bound = {
      ...input,
      media: input.media.map(({ object_key, ...item }) => {
        assert.equal(object_key, `media/${media}`);
        return { ...item, object_id: media };
      }),
    };
    const digest = createHash("sha256").update(JSON.stringify(bound)).digest("hex");
    q(
      service(
        `select api.stage_frontend_post_command('${owner.id}','${request}','${digest}',$payload$${JSON.stringify(bound)}$payload$::jsonb);`
      )
    );
    return request;
  };
  const trialPreflight = () => preflight(TRIAL_PREFLIGHT);
  const DAY_S = 86_400;

  // State under the earlier rule: three verified members whose trials the
  // job started at verification; one never posts, one has a post awaiting
  // review in the trial's slot, one has a published post.
  const ayanda = verified("ayanda"),
    sipho = verified("sipho"),
    lerato = verified("lerato");
  let siphoListing, leratoListing;
  await check("free week: before the update, verification starts the 7-day trial (BL-03)", () => {
    assert.equal(reconcile(), 3);
    for (const m of [ayanda, sipho, lerato]) {
      const [trial] = trials(m);
      assert.equal(trial.status, "active");
      assert.equal(trial.seconds, 7 * DAY_S);
      assert.equal(identityRows(m), 1, "the identity is recorded as used at verification");
    }
    siphoListing = post(sipho, "listing", "draft");
    assert.equal(json(submitPost(sipho, siphoListing)).status, "pending_moderation");
    assert.equal(openActivation(siphoListing), trials(sipho)[0].id);
    leratoListing = post(lerato, "listing", "draft");
    q(submitPost(lerato, leratoListing));
    const published = json(decide(leratoListing, "approve"));
    assert.equal(published.status, "live");
    assert.equal(
      Date.parse(published.visible_until),
      Date.parse(trials(lerato)[0].ends_at),
      "the earlier rule: the trial began at verification and the post ends with it"
    );
  });
  // Two more earlier-rule trials that look used but never paid for a
  // published post: one whose post was rejected in it and then published
  // under a plan, one holding a post that was published earlier under a plan
  // and is back in review. And one that did pay for a published post without
  // review (an unchanged post reactivated in it, then archived), and one of a
  // member sponsored after verification.
  const kagiso = verified("kagiso"),
    thabo = verified("thabo"),
    vuyo = verified("vuyo"),
    sizwe = verified("sizwe"),
    thandeka = verified("thandeka");
  let kagisoListing, thaboListing, thaboPlan, vuyoListing, sizweSponsorship, thandekaSponsorship;
  const sponsorshipOf = (owner) =>
    scalar(
      `insert into private.entitlements(owner_id,source,area,sponsorship_id,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values('${owner.id}','sponsorship','business',gen_random_uuid(),1,10,1,now(),now()+interval '180 days') returning id;`
    );
  // A post published under a plan, which then expires (its slot released).
  const publishedThenExpired = (owner) => {
    const plan = scalar(`select vmtest.slot('${owner.id}','${staff.id}',1,20);`);
    const listing = post(owner, "listing", "draft");
    q(submitPost(owner, listing));
    assert.equal(json(decide(listing, "approve")).status, "live");
    q(`update private.post_activations set released_at=now(),release_reason='expired'
         where post_id='${listing}' and released_at is null;
       update private.posts set status='expired',status_reason='Visibility period ended',
         visible_until=now()-interval '1 second' where id='${listing}';`);
    return [listing, plan];
  };
  const ownerAction = (owner, id, name) => {
    const p = row(id);
    return json(
      member(
        owner,
        `select api.execute_my_frontend_post_action('${randomUUID()}','${id}',${p.revision},'${name}','${p.kind}','${p.area}');`
      )
    );
  };
  await check(
    "free week: before the update, a trial can look used without paying for a published post",
    () => {
      // Thabo's and Vuyo's posts are published under a plan before any trial,
      // then expire.
      [thaboListing, thaboPlan] = publishedThenExpired(thabo);
      [vuyoListing] = publishedThenExpired(vuyo);
      assert.equal(reconcile(), 5);
      // Kagiso's post is rejected in the trial, then published under a plan
      // that ends sooner (so it is chosen first).
      kagisoListing = post(kagiso, "listing", "draft");
      q(submitPost(kagiso, kagisoListing));
      assert.equal(openActivation(kagisoListing), trials(kagiso)[0].id);
      assert.equal(
        json(decide(kagisoListing, "reject", "Synthetic rejection reason")).status,
        "rejected"
      );
      const plan = scalar(`select vmtest.slot('${kagiso.id}','${staff.id}',1,3);`);
      assert.equal(ownerAction(kagiso, kagisoListing, "resubmit").status, "pending_moderation");
      assert.equal(openActivation(kagisoListing), plan);
      assert.equal(json(decide(kagisoListing, "approve")).status, "live");
      // Thabo's expired post goes back to review, into the trial's slot.
      assert.equal(ownerAction(thabo, thaboListing, "resubmit").status, "pending_moderation");
      assert.equal(openActivation(thaboListing), trials(thabo)[0].id);
      // Vuyo reactivates the unchanged post: it goes live in the trial's slot
      // without a review, and is then archived (its slot released by the owner).
      assert.equal(ownerAction(vuyo, vuyoListing, "reactivate").status, "live");
      assert.equal(openActivation(vuyoListing), trials(vuyo)[0].id);
      q(
        member(
          vuyo,
          `select api.set_post_state('${vuyoListing}',${row(vuyoListing).revision},'archive');`
        )
      );
      assert.equal(row(vuyoListing).status, "archived");
      // Sizwe and Thandeka are sponsored after verification: the
      // sponsorship's own identity record is not written, because the trial's
      // holds the identity (internal.start_sponsorship, on conflict do
      // nothing). Sizwe's trial still runs; Thandeka's has lapsed unused.
      sizweSponsorship = sponsorshipOf(sizwe);
      thandekaSponsorship = sponsorshipOf(thandeka);
      q(`update private.entitlements set starts_at=now()-interval '8 days',ends_at=now()-interval '1 day'
           where owner_id='${thandeka.id}' and source='intro_trial';`);
    }
  );
  await check("free week preflight: read only, summary only, counts the earlier trials", () => {
    const rows = trialPreflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.equal(
      rows[0][1],
      "free week: reviewed live bodies, update not applied; trials to restart: 5 (posts awaiting review among them: 2); sponsored members whose record moves to the sponsorship: 1; trials kept: 3 (running trials of sponsored members among them: 1); members with an unfunded post awaiting review: 0; emails not yet sent: 5"
    );
    const write = database.psql(
      `${TRIAL_PREFLIGHT}\ninsert into vmtest.marker values(gen_random_uuid());`,
      ["-A", "-t", "-1", "-v", "VERBOSITY=verbose"]
    );
    assert.notEqual(write.status, 0);
    assert.match(write.stderr, /ERROR:\s+25006:/);
  });
  await check("free week: drift and a premature rollback are refused", () => {
    const before = fingerprint();
    assert.match(fails(TRIAL_ROLLBACK, "55000"), /rollback precondition/);
    assert.equal(fingerprint(), before);
    const live = q(
      "select pg_get_functiondef('internal.moderate_post(uuid,integer,text,text,text,uuid)'::regprocedure);"
    );
    q(
      `do $$begin execute replace(pg_get_functiondef('internal.moderate_post(uuid,integer,text,text,text,uuid)'::regprocedure),'end;\n$function$','end;\n\n$function$'); end$$;`
    );
    const rows = trialPreflight();
    assert.equal(rows.length, 2, JSON.stringify(rows));
    assert.match(rows[1][1], /internal\.moderate_post.* is not the reviewed body/);
    assert.match(fails(trialStep.sql, "55000"), /free week drift: internal\.moderate_post/);
    q(`${live};`);
    assert.equal(fingerprint(), before);
    assert.equal(trialPreflight().length, 1);
  });

  const trialBefore = fingerprint();
  applySteps(database, [trialStep]);
  const trialAfter = fingerprint();
  await check("free week: earlier trials that never paid for a published post restart", () => {
    assert.notEqual(trialAfter, trialBefore);
    // Never used: withdrawn, the identity free again, the unsent email dropped.
    const [ayandaTrial] = trials(ayanda);
    assert.equal(ayandaTrial.status, "revoked");
    assert.equal(ayandaTrial.revoked_reason, "intro_trial_restarts_at_first_approval");
    assert.equal(identityRows(ayanda), 0);
    assert.equal(
      scalar(
        `select count(*) from private.outbox_events where kind='trial_started' and subject_id='${ayandaTrial.id}' and processed_at is null;`
      ),
      "0"
    );
    // Its slot held a post awaiting review: the post waits for the free week.
    assert.equal(trials(sipho)[0].status, "revoked");
    assert.equal(identityRows(sipho), 0);
    assert.equal(row(siphoListing).status, "pending_moderation");
    assert.equal(openActivation(siphoListing), "");
    assert.equal(waits(siphoListing), true);
    assert.equal(
      scalar(`select count(*) from private.post_trial_claims where post_id='${siphoListing}';`),
      "0"
    );
    // Paid for a published post: kept as it is.
    assert.deepEqual(
      activeTrials(lerato).map((t) => t.id),
      [trials(lerato)[0].id]
    );
    assert.equal(identityRows(lerato), 1);
    assert.equal(row(leratoListing).status, "live");
    // Looked used but never paid for a published post: restarted too.
    assert.equal(trials(kagiso)[0].status, "revoked");
    assert.equal(identityRows(kagiso), 0);
    assert.equal(row(kagisoListing).status, "live", "the post published under the plan stays");
    assert.equal(trials(thabo)[0].status, "revoked");
    assert.equal(waits(thaboListing), true);
    assert.equal(openActivation(thaboListing), "");
    // Paid for a published post without a review, then archived: kept.
    assert.equal(activeTrials(vuyo).length, 1);
    assert.equal(identityRows(vuyo), 1);
    // A sponsored member's trial that still runs is kept (the sponsorship
    // pays only for business posts): a Market listing still uses it.
    const [sizweTrial] = trials(sizwe);
    assert.equal(sizweTrial.status, "active");
    assert.equal(
      scalar(`select entitlement_id from private.trial_identities where owner_id='${sizwe.id}';`),
      sizweTrial.id
    );
    const sizweListing = post(sizwe, "listing", "draft");
    assert.equal(json(submitPost(sizwe, sizweListing)).status, "pending_moderation");
    assert.equal(openActivation(sizweListing), sizweTrial.id);
    assert.equal(
      scalar(`select count(*) from private.entitlements where id='${sizweSponsorship}';`),
      "1"
    );
    // Once lapsed, the trial is withdrawn but the identity record moves to
    // the sponsorship: still no later trial.
    assert.equal(trials(thandeka)[0].status, "revoked");
    assert.equal(
      scalar(
        `select entitlement_id from private.trial_identities where owner_id='${thandeka.id}';`
      ),
      thandekaSponsorship
    );
    assert.equal(freeWeek(thandeka).status, "used");
    const thandekaListing = post(thandeka, "listing", "draft");
    assert.match(
      fails(submitPost(thandeka, thandekaListing), "PT402"),
      /no active plan covers this post/
    );
    assert.equal(waits(thandekaListing), false);
    assert.match(
      trialPreflight()[0][1],
      /^free week: already applied; trials to restart: 0 \(posts awaiting review among them: 0\); sponsored members whose record moves to the sponsorship: 0; trials kept: 3 \(running trials of sponsored members among them: 1\); members with an unfunded post awaiting review: 2;/
    );
    // Removed: the cutover checks below expect only earlier ended posts.
    q(`delete from private.posts where id='${vuyoListing}';`);
  });
  await check("free week: apply, roll back and apply again are clean", () => {
    // A waiting post that got a slot of its own meanwhile.
    const zanele = verified("zanele");
    const funded = post(zanele, "listing", "draft");
    q(submitPost(zanele, funded));
    const zanelePlan = scalar(`select vmtest.slot('${zanele.id}','${staff.id}',1,20);`);
    q(member(zanele, `select api.activate_post('${funded}');`));
    assert.equal(waits(funded), true);
    applySteps(database, [{ label: "free week rollback", sql: TRIAL_ROLLBACK }]);
    assert.equal(fingerprint(), trialBefore, "the rollback leaves the pre-update schema");
    // The waiting post got the earlier behaviour: a trial from now, in its slot.
    const [restarted] = activeTrials(sipho);
    assert.ok(restarted, "the rollback grants the waiting post's member a trial");
    assert.equal(openActivation(siphoListing), restarted.id);
    assert.equal(identityRows(sipho), 1);
    assert.equal(activeTrials(ayanda).length, 0, "a withdrawn trial stays withdrawn");
    // A member with a free slot gets it, not a trial; a post with a slot keeps it.
    assert.equal(openActivation(thaboListing), thaboPlan);
    assert.equal(activeTrials(thabo).length, 0);
    assert.equal(openActivation(funded), zanelePlan);
    assert.deepEqual(trials(zanele), []);
    applySteps(database, [trialStep]);
    assert.equal(fingerprint(), trialAfter, "re-applying gives the same schema");
    // The re-application restarts the trial the rollback granted.
    assert.equal(activeTrials(sipho).length, 0);
    assert.equal(waits(siphoListing), true);
    assert.equal(openActivation(siphoListing), "");
    applySteps(database, [trialStep]);
    assert.equal(fingerprint(), trialAfter, "a repeated run changes nothing");
    assert.equal(waits(siphoListing), true);
    assert.equal(waits(thaboListing), false, "the post the rollback funded keeps its slot");
    assert.equal(openActivation(thaboListing), thaboPlan);
    assert.equal(activeTrials(lerato).length, 1);
  });
  await check(
    "free week: a repeated run lets an unfunded post in review wait for an unused free week",
    () => {
      // Posts in review that no slot pays for any more (made directly here).
      const mpho = verified("mpho");
      const newer = post(mpho, "listing", "pending_moderation", 0, 2);
      const older = post(mpho, "listing", "pending_moderation", 0, 3);
      const used = post(lerato, "listing", "pending_moderation", 0, 1);
      applySteps(database, [trialStep]);
      assert.equal(fingerprint(), trialAfter);
      assert.equal(waits(older), true, "the oldest one per member waits");
      assert.equal(waits(newer), false);
      assert.equal(waits(used), false, "a member whose week is used gets nothing");
      json(decide(older, "approve"));
      assert.equal(trials(mpho)[0].seconds, 7 * DAY_S);
      // Removed again: the later checks expect only their own posts in review.
      q(`delete from private.posts where id in('${newer}','${used}');`);
    }
  );
  const bongi = verified("bongi");
  await check("free week: verification creates no trial", () => {
    assert.equal(reconcile(), 0);
    assert.deepEqual(trials(bongi), []);
    assert.equal(trials(ayanda).length, 1, "the restarted member gets nothing either");
    assert.equal(identityRows(bongi) + identityRows(ayanda), 0);
    assert.deepEqual(freeWeek(bongi), { status: "available", starts_at: null, ends_at: null });
    const offer = allowance(bongi).trial_offer;
    assert.equal(offer.eligible, true);
    assert.equal(offer.sevenDayAvailable, true);
    assert.equal(offer.thirtyDayAvailable, false, "the free week is 7 days");
    assert.equal(allowanceV1(bongi).trial_offer.thirtyDayAvailable, false);
    fails(service("select api.reconcile_intro_trials(0);"), "22023");
  });
  let bongiListing;
  await check("free week: a post submitted without a plan waits for it and holds no slot", () => {
    bongiListing = post(bongi, "listing", "draft");
    const answer = json(submitPost(bongi, bongiListing));
    assert.equal(answer.status, "pending_moderation");
    assert.equal(waits(bongiListing), true);
    assert.equal(openActivation(bongiListing), "");
    assert.deepEqual(trials(bongi), [], "nothing is granted at submission");
    assert.equal(identityRows(bongi), 0);
    assert.deepEqual(freeWeek(bongi), {
      status: "awaiting_approval",
      starts_at: null,
      ends_at: null,
    });
    for (const read of [allowance(bongi), allowanceV1(bongi)]) {
      assert.equal(read.capacity, 0);
      assert.equal(read.trial_ends_at, null);
      assert.equal(read.trial_used, false);
      assert.equal(read.trial_offer.eligible, false, "the offer is in use while it waits");
      assert.equal(read.trial_offer.sevenDayAvailable, false);
      assert.equal(read.max_photos, 0);
    }
  });
  await check("free week: only one post at a time waits for it; events are unaffected", () => {
    const second = post(bongi, "listing", "draft");
    assert.match(fails(submitPost(bongi, second), "PT409"), /all posting capacity is in use/);
    assert.equal(row(second).status, "draft");
    assert.equal(waits(second), false);
    // Through the form too (its command is refused and stays unconsumed).
    assert.match(
      fails(
        member(bongi, `select api.consume_frontend_post_command('${stageNew(bongi)}');`),
        "PT409"
      ),
      /all posting capacity is in use/
    );
    const event = post(bongi, "event", "draft");
    assert.equal(json(submitPost(bongi, event)).status, "pending_moderation");
    assert.equal(waits(event), false);
  });
  await check(
    "free week: the first approval starts 7 days from approval; moderation time does not shorten it",
    () => {
      // Ten days in review, more than the whole week.
      q(
        `update private.posts set submitted_at=now()-interval '10 days' where id='${bongiListing}';
         update private.intro_trial_requests set requested_at=now()-interval '10 days' where post_id='${bongiListing}';`
      );
      const answer = json(decide(bongiListing, "approve"));
      assert.equal(answer.status, "live");
      const live = row(bongiListing);
      const [trial] = trials(bongi);
      assert.equal(trials(bongi).length, 1);
      assert.equal(trial.status, "active");
      assert.equal(trial.seconds, 7 * DAY_S);
      assert.equal(
        Date.parse(trial.starts_at),
        Date.parse(live.published_at),
        "it starts at approval"
      );
      assert.equal(Date.parse(live.visible_until), Date.parse(trial.ends_at));
      assert.equal(Date.parse(answer.visible_until), Date.parse(trial.ends_at));
      assert.equal(openActivation(bongiListing), trial.id);
      assert.equal(waits(bongiListing), false);
      assert.equal(identityRows(bongi), 1);
      assert.equal(
        scalar(`select identity_hmac from private.trial_identities where owner_id='${bongi.id}';`),
        scalar(`select internal.current_verified_identity('${bongi.id}');`)
      );
      assert.equal(
        scalar(
          `select count(*) from private.post_trial_claims where post_id='${bongiListing}' and trial_entitlement_id='${trial.id}';`
        ),
        "1"
      );
      assert.equal(outbox(trial.id, "trial_started"), 1);
      assert.deepEqual(freeWeek(bongi), {
        status: "running",
        starts_at: trial.starts_at,
        ends_at: trial.ends_at,
      });
      const read = allowance(bongi);
      assert.equal(Date.parse(read.trial_ends_at), Date.parse(trial.ends_at));
      assert.equal(read.trial_used, true);
      assert.equal(read.trial_offer.eligible, false);
      // The trial's single slot is now in use; a second post is refused as before.
      const second = post(bongi, "listing", "draft");
      assert.match(fails(submitPost(bongi, second), "PT409"), /all posting capacity is in use/);
    }
  );
  const pule = verified("pule");
  await check("free week: the mail claim gives the trial's end with its email", () => {
    const [trial] = trials(bongi);
    const claimed = json(
      service("select api.claim_supported_notification_outbox(array['trial_started'],50);")
    );
    const mail = claimed.find((item) => item.subject_id === trial.id);
    assert.ok(mail, "the trial_started email is claimed");
    assert.equal(Date.parse(mail.trial_ends_at), Date.parse(trial.ends_at));
    assert.equal(mail.trial_funds_post, true);
    // Paused, the post is no longer live: the email does not say it is.
    q(
      member(
        bongi,
        `select api.set_post_state('${bongiListing}',${row(bongiListing).revision},'pause');`
      )
    );
    q(
      `insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('trial_started','${trial.id}','${bongi.id}','free-week-paused:${trial.id}');`
    );
    const paused = json(
      service("select api.claim_supported_notification_outbox(array['trial_started'],50);")
    ).find((item) => item.subject_id === trial.id);
    assert.equal(paused.trial_funds_post, false);
    // A service grant pays for no post yet: its email says so.
    q(service(`select api.grant_verified_intro_trial('${pule.id}',7);`));
    const [grant] = trials(pule);
    const grantMail = json(
      service("select api.claim_supported_notification_outbox(array['trial_started'],50);")
    ).find((item) => item.subject_id === grant.id);
    assert.equal(Date.parse(grantMail.trial_ends_at), Date.parse(grant.ends_at));
    assert.equal(grantMail.trial_funds_post, false);
    // Another kind carries no trial end.
    const deleted = post(bongi, "listing", "draft");
    q(
      `insert into private.outbox_events(kind,subject_id,owner_id,dedupe_key) values('post_deleted','${deleted}','${bongi.id}','free-week-check:${deleted}');`
    );
    const other = json(
      service("select api.claim_supported_notification_outbox(array['post_deleted'],50);")
    ).find((item) => item.subject_id === deleted);
    assert.equal(other.trial_ends_at, null);
    assert.equal(other.trial_funds_post, null);
  });
  await check(
    "free week: a later run leaves trials granted after the first application alone",
    () => {
      // As if the first application was an hour ago: Pule's service grant is
      // newer and stays, although it pays for no post.
      q("update private.intro_trial_rule set first_applied_at=now()-interval '1 hour';");
      applySteps(database, [trialStep]);
      assert.equal(activeTrials(pule).length, 1);
      assert.equal(identityRows(pule), 1);
    }
  );
  await check(
    "free week: a rejected post does not use it; resubmitting it waits again and its approval starts it",
    () => {
      const chris = verified("chris");
      const listing = post(chris, "listing", "draft");
      q(submitPost(chris, listing));
      assert.equal(waits(listing), true);
      assert.equal(
        json(decide(listing, "reject", "Synthetic rejection reason")).status,
        "rejected"
      );
      assert.equal(row(listing).status, "rejected");
      assert.equal(waits(listing), false);
      assert.deepEqual(trials(chris), []);
      assert.equal(identityRows(chris), 0);
      assert.equal(freeWeek(chris).status, "available");
      assert.equal(allowance(chris).trial_offer.eligible, true);
      // Resubmitted through the owner action the website uses.
      const p = row(listing);
      const resubmitted = json(
        member(
          chris,
          `select api.execute_my_frontend_post_action('${randomUUID()}','${listing}',${p.revision},'resubmit','listing','market');`
        )
      );
      assert.equal(resubmitted.status, "pending_moderation");
      assert.equal(waits(listing), true);
      q(`update private.posts set submitted_at=now()-interval '3 days' where id='${listing}';`);
      json(decide(listing, "approve"));
      const [trial] = trials(chris);
      assert.equal(trial.seconds, 7 * DAY_S);
      assert.equal(Date.parse(trial.starts_at), Date.parse(row(listing).published_at));
    }
  );
  await check(
    "free week: the form's submission waits for the free week, whatever length it picked",
    () => {
      const dumi = verified("dumi");
      const answer = json(
        member(dumi, `select api.consume_frontend_post_command('${stageNew(dumi, 30)}');`)
      );
      assert.equal(answer.status, "pending_moderation");
      assert.equal(waits(answer.id), true);
      assert.deepEqual(trials(dumi), [], "the form no longer grants a trial at submission");
      json(decide(answer.id, "approve"));
      assert.equal(trials(dumi)[0].seconds, 7 * DAY_S, "the free week is 7 days");
    }
  );
  await check("free week: the earlier trial's waiting post gets the full week at approval", () => {
    json(decide(siphoListing, "approve"));
    const [trial] = activeTrials(sipho);
    assert.equal(trial.seconds, 7 * DAY_S);
    assert.equal(Date.parse(trial.starts_at), Date.parse(row(siphoListing).published_at));
    assert.equal(openActivation(siphoListing), trial.id);
  });
  await check(
    "free week: taken while the post waited, approval uses a slot the member has, or is refused",
    () => {
      // A staff grant recorded the identity meanwhile: its running trial pays.
      const lindi = verified("lindi");
      const listing = post(lindi, "listing", "draft");
      q(submitPost(lindi, listing));
      assert.equal(waits(listing), true);
      q(service(`select api.grant_verified_intro_trial('${lindi.id}',7);`));
      const [granted] = trials(lindi);
      // A running trial is what the member sees, even while a post still waits.
      assert.deepEqual(freeWeek(lindi), {
        status: "running",
        starts_at: granted.starts_at,
        ends_at: granted.ends_at,
      });
      assert.equal(json(decide(listing, "approve")).status, "live");
      assert.equal(trials(lindi).length, 1, "no second trial");
      assert.equal(openActivation(listing), granted.id);
      assert.equal(waits(listing), false);
      // A banned identity with no slot: refused, the post stays in review.
      const mandla = verified("mandla");
      const banned = post(mandla, "listing", "draft");
      q(submitPost(mandla, banned));
      q(`select set_config('session_replication_role','replica',false);
        insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
          values('${mandla.fingerprint}',gen_random_uuid(),'fraud',now(),now()+interval '5 years');
        select set_config('session_replication_role','origin',false);`);
      // The card does not promise a week that approval would refuse.
      assert.equal(freeWeek(mandla).status, "unavailable");
      assert.match(
        fails(decide(banned, "approve"), "PT402"),
        /no plan or free week covers this post/
      );
      assert.equal(row(banned).status, "pending_moderation");
      assert.deepEqual(trials(mandla), []);
      // A plan that ends within the week, or one that does not allow the
      // post's photos, does not pay for it: the week is granted.
      const kopano = verified("kopano");
      const soon = post(kopano, "listing", "draft");
      q(submitPost(kopano, soon));
      const shortPlan = scalar(`select vmtest.slot('${kopano.id}','${staff.id}',1,2);`);
      assert.equal(json(decide(soon, "approve")).status, "live");
      const [kopanoWeek] = trials(kopano);
      assert.equal(kopanoWeek.seconds, 7 * DAY_S);
      assert.equal(openActivation(soon), kopanoWeek.id);
      assert.notEqual(openActivation(soon), shortPlan);
      const lebo = verified("lebo");
      const photographed = post(lebo, "listing", "draft");
      q(`insert into private.post_media(post_id,object_id,purpose,position)
           values('${photographed}',vmtest.media('${lebo.id}'),'gallery',1);`);
      q(submitPost(lebo, photographed));
      const onePhoto = scalar(
        `insert into private.entitlements(owner_id,source,granted_by,slot_capacity,max_photos,max_videos,starts_at,ends_at)
          values('${lebo.id}','staff_grant','${staff.id}',1,1,0,now()-interval '1 day',now()+interval '30 days') returning id;`
      );
      assert.equal(json(decide(photographed, "approve")).status, "live");
      const [leboWeek] = trials(lebo);
      assert.equal(openActivation(photographed), leboWeek.id);
      assert.notEqual(openActivation(photographed), onePhoto);
      // A plan bought while the post waited pays for it; the week stays unused.
      const tumi = verified("tumi");
      const bought = post(tumi, "listing", "draft");
      q(submitPost(tumi, bought));
      const tumiPlan = scalar(`select vmtest.slot('${tumi.id}','${staff.id}',1,20);`);
      assert.equal(json(decide(bought, "approve")).status, "live");
      assert.equal(openActivation(bought), tumiPlan);
      assert.deepEqual(trials(tumi), []);
      assert.equal(freeWeek(tumi).status, "available");
      // A waiting post that got a slot of its own no longer holds the free week.
      const nomvula = verified("nomvula");
      const own = post(nomvula, "listing", "draft");
      q(submitPost(nomvula, own));
      const plan = scalar(`select vmtest.slot('${nomvula.id}','${staff.id}',1,20);`);
      q(member(nomvula, `select api.activate_post('${own}');`));
      assert.equal(freeWeek(nomvula).status, "available");
      assert.equal(json(decide(own, "approve")).status, "live");
      assert.equal(openActivation(own), plan);
      assert.deepEqual(trials(nomvula), [], "the plan paid; the free week is still unused");
    }
  );
  await check("free week: none is left after it ends, or for a banned identity", () => {
    // Bongi's week is over (its post is gone): a new post needs a plan.
    q(`update private.entitlements set starts_at=now()-interval '8 days',ends_at=now()-interval '1 second'
         where owner_id='${bongi.id}' and source='intro_trial';
       delete from private.posts where id='${bongiListing}';`);
    assert.equal(freeWeek(bongi).status, "used");
    const next = post(bongi, "listing", "draft");
    assert.match(fails(submitPost(bongi, next), "PT402"), /no active plan covers this post/);
    assert.equal(waits(next), false);
    assert.match(
      fails(
        member(bongi, `select api.consume_frontend_post_command('${stageNew(bongi)}');`),
        "PT402"
      ),
      /an active posting plan is required/
    );
    // A banned identity gets no free week.
    const eli = verified("eli");
    q(`select set_config('session_replication_role','replica',false);
      insert into private.banned_identities(identity_hmac,decision_id,category,banned_at,retain_until)
        values('${eli.fingerprint}',gen_random_uuid(),'fraud',now(),now()+interval '5 years');
      select set_config('session_replication_role','origin',false);`);
    const banned = post(eli, "listing", "draft");
    fails(submitPost(eli, banned), "PT402");
    assert.equal(freeWeek(eli).status, "unavailable");
    assert.equal(allowance(eli).trial_offer.eligible, false);
  });
  await check("free week: another member can neither read nor decide it", () => {
    const fana = verified("fana");
    const listing = post(fana, "listing", "draft");
    q(submitPost(fana, listing));
    // Each member reads only their own free week.
    assert.equal(freeWeek(fana).status, "awaiting_approval");
    assert.equal(freeWeek(lerato).status, "running");
    // A member cannot submit or moderate someone else's post.
    fails(
      member(lerato, `select api.submit_post('${listing}',${row(listing).revision});`),
      "22023"
    );
    fails(
      member(
        lerato,
        `select api.moderate_post(p_post_id=>'${listing}',p_expected_revision=>${row(listing).revision},p_decision=>'approve',p_claim_generation=>'1',p_claim_nonce=>'${randomUUID()}');`
      ),
      "42501"
    );
    assert.equal(waits(listing), true);
    assert.deepEqual(trials(fana), []);
    // The helpers are not callable by members.
    fails(member(fana, `select internal.start_intro_trial('${listing}');`), "42501");
    fails(member(fana, `select internal.queue_intro_trial('${listing}');`), "42501");
    q(`delete from private.posts where id='${listing}';`);
    assert.equal(waits(listing), false, "deleting the post removes its request");
  });
  await check("free week concurrency: two submissions at once queue exactly one", async () => {
    const gift = verified("gift");
    const [a, b] = [post(gift, "listing", "draft"), post(gift, "listing", "draft")];
    const results = await Promise.all([session(submitPost(gift, a)), session(submitPost(gift, b))]);
    assert.deepEqual(
      results.map((r) => r.status).sort(),
      [0, 3],
      JSON.stringify(results.map((r) => r.stderr))
    );
    assert.match(results.find((r) => r.status !== 0).stderr, /ERROR:\s+PT409:/);
    assert.equal(Number(waits(a)) + Number(waits(b)), 1);
  });
  await check(
    "free week concurrency: two moderators approving at once start one trial",
    async () => {
      const hlengi = verified("hlengi");
      const listing = post(hlengi, "listing", "draft");
      q(submitPost(hlengi, listing));
      const second = json(`select vmtest.staff('trialmod2','moderator');`);
      const lease = json(
        staffMember(moderator, `select api.claim_queue_item('post','${listing}');`)
      );
      const approve = (staffUser) =>
        staffMember(
          staffUser,
          `select api.moderate_post(p_post_id=>'${listing}',p_expected_revision=>${row(listing).revision},p_decision=>'approve',
          p_claim_generation=>'${lease.claim_generation}',p_claim_nonce=>'${lease.claim_nonce}');`
        );
      const results = await Promise.all([
        session(`begin;\n${approve(moderator)}\nselect pg_sleep(2); commit;`),
        later(700, approve(second)),
      ]);
      assert.equal(results[0].status, 0, results[0].stderr);
      assert.notEqual(results[1].status, 0);
      assert.equal(row(listing).status, "live");
      assert.equal(trials(hlengi).length, 1);
      assert.equal(identityRows(hlengi), 1);
    }
  );
  await check(
    "free week concurrency: a submission racing the first approval never gets a second trial",
    async () => {
      const ivy = verified("ivy");
      const first = post(ivy, "listing", "draft");
      q(submitPost(ivy, first));
      const next = post(ivy, "listing", "draft");
      // Staged before the race: synchronous commands would stall the sessions.
      const formRequest = stageNew(ivy);
      const lease = json(staffMember(moderator, `select api.claim_queue_item('post','${first}');`));
      const [approval, submitted] = await Promise.all([
        session(
          `begin;\n${staffMember(
            moderator,
            `select api.moderate_post(p_post_id=>'${first}',p_expected_revision=>${row(first).revision},p_decision=>'approve',
              p_claim_generation=>'${lease.claim_generation}',p_claim_nonce=>'${lease.claim_nonce}');`
          )}\nselect pg_sleep(2); commit;`
        ),
        later(700, member(ivy, `select api.consume_frontend_post_command('${formRequest}');`)),
        later(900, submitPost(ivy, next)),
      ]).then(([a, b, c]) => [a, [b, c]]);
      assert.equal(approval.status, 0, approval.stderr);
      // The form waits for the member's subject lock and finds the trial's
      // slot taken; a direct submission finds the slot taken or the week used.
      assert.match(submitted[0].stderr, /ERROR:\s+PT409:/);
      assert.match(submitted[1].stderr, /ERROR:\s+PT40[29]:/);
      assert.equal(trials(ivy).length, 1);
      assert.equal(row(next).status, "draft");
    }
  );
  // The later checks keep the stand-in they were written with.
  q(`${sharedIdentity};`);
  applySteps(database, steps.slice(trialIndex + 1));
  console.log(`Applied ${TRIAL} and any later updates.`);

  // ----------------------------------------------------- cutover safety
  const endedRows = () =>
    json(
      "select coalesce(jsonb_agg(jsonb_build_object('id',id,'deletes_at',deletes_at) order by id),'[]') from private.posts where status in('expired','sold','archived');"
    );
  await check(
    "cutover: every ended post is kept at least 3 days and the first job run deletes none",
    () => {
      const before = endedRows();
      assert.ok(before.length >= 15, `${before.length} ended posts`);
      assert.equal(
        count(
          `select 1 from private.posts where status in('expired','sold','archived') and deletes_at<>'${cutover}'::timestamptz+interval '3 days'`
        ),
        0,
        "posts that ended before the update are deleted 3 days after it"
      );
      assert.equal(
        scalar(
          `select ('${cutover}'::timestamptz between now()-interval '10 minutes' and now())::text;`
        ),
        "true"
      );
      job();
      const after = new Map(endedRows().map((r) => [r.id, r.deletes_at]));
      for (const r of before) assert.equal(after.get(r.id), r.deletes_at, r.id);
    }
  );
  await check(
    "cutover: their owners get one notice of the 3-day rule; expired events and archived posts none",
    () => {
      const fresh = (id, kind) =>
        count(
          `select 1 from private.outbox_events where subject_id='${id}' and kind='${kind}' and dedupe_key like '%:3d'`
        );
      for (const id of [cutExpired, cutExpiredRecent, expiredListing, oldExpired]) {
        assert.equal(fresh(id, "post_expired"), 1, id);
      }
      assert.equal(outbox(cutSold, "post_sold"), 1);
      assert.equal(outbox(soldListing, "post_sold"), 1);
      assert.equal(fresh(cutExpiredEvent, "post_expired"), 0);
      assert.equal(outbox(cutArchived, "post_expired") + outbox(cutArchived, "post_sold"), 0);
      job();
      assert.equal(fresh(cutExpired, "post_expired"), 1, "not repeated");
      assert.equal(outbox(cutSold, "post_sold"), 1, "not repeated");
      assert.equal(
        outbox(expiredListing, "post_expiry_reminder"),
        remindersBefore,
        "no new reminders"
      );
    }
  );
  await check(
    "cutover: events that have not ended their run are dated at their end; those already over get 3 days",
    () => {
      for (const id of [cutLiveEvent, cutPausedEvent, cutDraftEvent, cutPendingEvent]) {
        assert.equal(
          scalar(
            `select (p.deletes_at=e.ends_at)::text from private.posts p join private.event_details e on e.post_id=p.id where p.id='${id}';`
          ),
          "true"
        );
      }
      assert.equal(
        scalar(
          `select bool_and(abs(extract(epoch from deletes_at-('${cutover}'::timestamptz+interval '3 days')))<5)::text from private.posts where id in('${cutOverEvent}','${cutOverDraft}');`
        ),
        "true"
      );
      job();
      assert.equal(exists(cutOverEvent) && exists(cutOverDraft), true);
      // A later change of state keeps those 3 days.
      const granted = row(cutOverEvent).deletes_at;
      q(
        member(
          dana,
          `select api.set_post_state('${cutOverEvent}',${row(cutOverEvent).revision},'pause');`
        )
      );
      assert.equal(row(cutOverEvent).status, "paused");
      assert.equal(row(cutOverEvent).deletes_at, granted);
      job();
      assert.equal(exists(cutOverEvent), true);
    }
  );
  await check(
    "cutover: a paused post holding a slot whose run has ended expires at the first run",
    () => {
      // The rollback above released its slot, as the earlier rules do; the
      // slot is given back to recreate the state the preflight counted.
      q(`insert into private.post_activations(post_id,entitlement_id,owner_id)
           values('${cutPausedSlot}','${cutPausedSlotEnt}','${dana.id}');`);
      job();
      assert.equal(row(cutPausedSlot).status, "expired");
      assert.equal(outbox(cutPausedSlot, "post_expired"), 1);
    }
  );
  await check(
    "cutover: a post paused before the update holds no slot and keeps the idle rule",
    () => {
      q(
        `update private.posts set status_changed_at=now()-interval '61 days',content_updated_at=now()-interval '61 days' where id='${cutPaused}';`
      );
      job();
      assert.equal(exists(cutPaused), false);
      assert.equal(outbox(cutPaused, "draft_deletion_warning"), 1);
    }
  );

  await check("access: new tables and functions are closed to API roles", () => {
    for (const table of [
      "private.event_submissions",
      "private.frontend_content_hold_media",
      "private.post_deletion_extensions",
    ]) {
      assert.equal(
        scalar(`select relrowsecurity from pg_class where oid='${table}'::regclass;`),
        "t"
      );
      for (const role of ["anon", "authenticated", "service_role"]) {
        assert.equal(
          scalar(`select has_table_privilege('${role}','${table}','select,insert,update,delete');`),
          "f"
        );
      }
    }
    for (const fn of [
      "internal.post_lifecycle_clock()",
      "internal.guard_frontend_content_hold_delete()",
      "internal.snapshot_frontend_content_hold_media()",
      "internal.release_frontend_content_hold_media()",
      "internal.event_submission_guard()",
      "internal.event_deletion_clock()",
      "internal.frontend_owner_post_v2(uuid,uuid)",
    ]) {
      for (const role of ["anon", "authenticated", "service_role", "public"]) {
        assert.equal(scalar(`select has_function_privilege('${role}','${fn}','execute');`), "f");
      }
    }
    const audience = (fn) =>
      ["anon", "authenticated", "service_role"]
        .map((role) => scalar(`select has_function_privilege('${role}','${fn}','execute');`))
        .join("");
    assert.equal(audience("internal.run_post_lifecycle(integer)"), "fft");
    assert.equal(audience("internal.claim_supported_notification_outbox(text[],integer)"), "fft");
    for (const fn of [
      "api.get_my_frontend_post_v2(uuid)",
      "internal.get_my_frontend_post_v2(uuid)",
      "api.list_my_frontend_posts_v2(text,text,integer,integer)",
      "internal.list_my_frontend_posts_v2(text,text,integer,integer)",
    ]) {
      assert.equal(audience(fn), "ftf", fn);
    }
  });
  await check("approval digests are unchanged by the expiry rules", digestUnchanged);

  // -------------------------------------------------------- 2. edit clock
  await check("edit: a post past its deletion date is still deleted after an edit", () => {
    q(
      `update private.posts set ended_at=clock_timestamp()-interval '3 days',deletes_at=clock_timestamp()-interval '1 second' where id='${oldExpired}';`
    );
    edit(alice, oldExpired);
    assert.equal(row(oldExpired).status, "expired");
    job();
    assert.equal(exists(oldExpired), false);
    assert.equal(outbox(oldExpired, "post_deleted"), 1);
  });
  await check("edit: an expired post keeps its deletion date and gets no second notice", () => {
    const notices = outbox(expiredListing, "post_expired");
    const before = row(expiredListing);
    const answer = edit(alice, expiredListing);
    assert.equal(answer.status, "expired");
    const after = row(expiredListing);
    assert.equal(after.status, "expired");
    assert.equal(after.ended_at, before.ended_at);
    assert.equal(after.deletes_at, before.deletes_at);
    assert.notEqual(after.content_updated_at, before.content_updated_at);
    job();
    edit(alice, expiredListing);
    job();
    assert.equal(outbox(expiredListing, "post_expired"), notices);
    assert.equal(outbox(expiredListing, "post_expiry_reminder"), remindersBefore);
  });
  await check("edit: a sold post keeps its deletion date", () => {
    const before = row(soldListing);
    assert.equal(edit(alice, soldListing).status, "sold");
    const after = row(soldListing);
    assert.equal(after.status, "sold");
    assert.equal(after.ended_at, before.ended_at);
    assert.equal(after.deletes_at, before.deletes_at);
  });
  const threeDays = (id) =>
    scalar(
      `select (deletes_at=ended_at+interval '3 days')::text from private.posts where id='${id}';`
    );
  await check("lifecycle: real state changes still start and clear the clock", () => {
    const listing = post(alice, "listing", "live");
    const p = row(listing);
    q(member(alice, `select api.set_post_state('${listing}',${p.revision},'sold');`));
    const sold = row(listing);
    assert.ok(sold.ended_at);
    assert.equal(threeDays(listing), "true");
    q(
      `update private.posts set status='live',published_at=now(),visible_until=now()+interval '1 day' where id='${listing}';`
    );
    assert.equal(row(listing).ended_at, null);
    assert.equal(row(listing).deletes_at, null);
    q(
      `update private.posts set visible_until=now()-interval '1 second',published_at=now()-interval '1 day' where id='${listing}';`
    );
    job();
    const expired = row(listing);
    assert.equal(expired.status, "expired");
    assert.ok(expired.ended_at && expired.ended_at !== sold.ended_at);
    fails(`update private.posts set deletes_at=null where id='${listing}';`, "23514");
  });

  // ------------------------------------------------------ 1. content holds
  const idleHeld = post(bea, "listing", "paused", 61);
  const idleHold = scalar(`select vmtest.hide('${idleHeld}','${staff.id}');`);
  q(
    `update private.posts set status_changed_at=now()-interval '61 days',content_updated_at=now()-interval '61 days' where id='${idleHeld}';`
  );
  const idleFree = post(bea, "listing", "paused", 61);
  const idleFreeCover = scalar(
    `select object_id from private.post_media where post_id='${idleFree}' and purpose='cover';`
  );
  await check("hold: the lifecycle job neither deletes nor warns about a held post", () => {
    job();
    assert.equal(exists(idleHeld), true);
    assert.equal(outbox(idleHeld, "draft_deletion_warning"), 0);
    assert.equal(exists(idleFree), false, "an idle post without a hold is still deleted");
    assert.equal(outbox(idleFree, "draft_deletion_warning"), 1);
  });
  await check("hold: the owner cannot mark sold, archive or delete a held post", () => {
    const p = row(heldListing);
    for (const sql of [
      `select api.set_post_state('${heldListing}',${p.revision},'sold');`,
      `select api.set_post_state('${heldListing}',${p.revision},'archive');`,
      `select api.delete_post('${heldListing}',${p.revision});`,
      `select api.execute_my_frontend_post_action('${randomUUID()}','${heldListing}',${p.revision},'mark_sold','listing','market');`,
      `select api.execute_my_frontend_post_action('${randomUUID()}','${heldListing}',${p.revision},'delete','listing','market');`,
    ]) {
      const message = fails(member(bea, sql), "PT423");
      assert.match(message, /staff visibility hold requires independent release/);
    }
    const after = row(heldListing);
    assert.equal(after.status, "paused");
    assert.equal(after.revision, p.revision);
    assert.equal(
      scalar(
        `select count(*) from private.frontend_post_action_receipts where post_id='${heldListing}';`
      ),
      "0"
    );
  });
  await check("hold: any other delete of a held post is refused", () => {
    fails(`delete from private.posts where id='${heldListing}';`, "PT423");
    assert.equal(exists(heldListing), true);
  });
  const idleHeldCover = scalar(
    `select object_id from private.post_media where post_id='${idleHeld}' and purpose='cover';`
  );
  await check("hold: media the post showed are not cleaned while the hold is open", () => {
    // heldListing's hold predates the update (backfill); idleHeld's was placed
    // after it (trigger). The owner removes each cover while hidden.
    q(`delete from private.post_media where post_id in('${heldListing}','${idleHeld}') and purpose='cover';
       update private.media_objects set created_at=now()-interval '3 days',unlinked_at=now()-interval '25 hours'
         where id in('${heldCover}','${idleHeldCover}','${idleFreeCover}');`);
    assert.equal(
      scalar(
        `select count(*) from private.frontend_content_hold_media where hold_id='${idleHold}' and object_id='${idleHeldCover}';`
      ),
      "1"
    );
    const claimed = cleanup().map((item) => item.object_id);
    assert.ok(!claimed.includes(heldCover), "media of an earlier hold were claimed for deletion");
    assert.ok(!claimed.includes(idleHeldCover), "media of a new hold were claimed for deletion");
    assert.ok(claimed.includes(idleFreeCover), "unheld unlinked media are still cleaned");
  });
  await check("legal hold refusal is unchanged", () => {
    const listing = post(dube, "listing", "live");
    q(
      `insert into private.legal_holds(subject_id,reason,placed_by) values('${dube.id}','Synthetic legal hold','${staff.id}');`
    );
    const message = fails(
      member(dube, `select api.delete_post('${listing}',${row(listing).revision});`),
      "PT409"
    );
    assert.match(message, /posts cannot be deleted during a legal hold/);
  });
  await check("hold release: media become cleanable and the idle clock restarts", () => {
    q(`select vmtest.release('${preexistingHold}','${staff.id}');`);
    assert.equal(
      scalar(
        `select count(*) from private.frontend_content_hold_media where hold_id='${preexistingHold}';`
      ),
      "0"
    );
    const claimed = cleanup().map((item) => item.object_id);
    assert.ok(claimed.includes(heldCover));
    assert.ok(!claimed.includes(logo), "media still shown by the post are kept");
    q(`select vmtest.release('${idleHold}','${staff.id}');`);
    assert.ok(
      cleanup()
        .map((item) => item.object_id)
        .includes(idleHeldCover)
    );
    job();
    assert.equal(exists(idleHeld), true, "released post deleted at once");
    assert.equal(outbox(idleHeld, "draft_deletion_warning"), 0);
    q(
      `update private.frontend_content_holds set released_at=now()-interval '61 days' where id='${idleHold}';`
    );
    job();
    assert.equal(exists(idleHeld), false);
  });
  const endsAt = (id) =>
    json(`select to_jsonb(ends_at) from private.event_details where post_id='${id}';`);
  const datedAtEnd = (id) =>
    scalar(
      `select (p.deletes_at=e.ends_at)::text from private.posts p join private.event_details e on e.post_id=p.id where p.id='${id}';`
    );
  await check("hold release: the staff release command restores a hidden event", () => {
    const releaser = json(`select vmtest.staff('releaser','admin');`);
    const event = post(bea, "event", "live");
    const cover = scalar(
      `select object_id from private.post_media where post_id='${event}' and purpose='cover';`
    );
    const hold = scalar(`select vmtest.hide('${event}','${staff.id}');`);
    assert.equal(
      scalar(`select count(*) from private.frontend_content_hold_media where hold_id='${hold}';`),
      "1"
    );
    fails(member(bea, `select api.delete_post('${event}',${row(event).revision});`), "PT423");
    const version = Number(
      scalar(`select version from private.frontend_content_holds where id='${hold}';`)
    );
    const released = json(
      staffMember(
        releaser,
        `select api.release_frontend_content_hold('${hold}',${version},'Synthetic review found no problem');`
      )
    );
    assert.equal(released.status, "released");
    assert.equal(released.restored, true);
    const after = row(event);
    assert.equal(after.status, "live");
    assert.equal(after.ended_at, null);
    assert.equal(datedAtEnd(event), "true", "a restored event is still deleted at its end");
    assert.equal(
      scalar(`select count(*) from private.frontend_content_hold_media where hold_id='${hold}';`),
      "0"
    );
    assert.equal(scalar(`select internal.media_object_in_use('${cover}');`), "t");
  });

  // ------------------------------------------------- 3. free-event ledger
  const submit = (owner, id) =>
    member(owner, `select api.submit_post('${id}',${row(id).revision});`);
  const draft = (owner) => post(owner, "event", "draft");
  await check("events: the 10th submission passes and the 11th is refused", () => {
    q(submit(cara, draft(cara)));
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check("events: deletion by the lifecycle job keeps the place", () => {
    const ended = caraEvents[2];
    q(`update private.posts set deletes_at=now()-interval '1 minute' where id='${ended}';`);
    job();
    assert.equal(exists(ended), false);
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check("events: any non-owner delete keeps the place", () => {
    q(`delete from private.posts where id='${caraEvents[4]}';`);
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check(
    "events: an owner deleting their own event before it ends returns the place (DEC-32)",
    () => {
      const own = caraEvents[5];
      q(member(cara, `select api.delete_post('${own}',${row(own).revision});`));
      assert.equal(
        scalar(`select release_reason from private.event_submissions where post_id='${own}';`),
        "owner_deleted"
      );
      q(submit(cara, draft(cara)));
      fails(submit(cara, draft(cara)), "PT429");
    }
  );
  await check("events: resubmitting the same event does not count twice", () => {
    const rejected = caraEvents[1]; // live -> reject it, then resubmit
    q(`update private.posts set status='rejected' where id='${rejected}';`);
    q(submit(cara, rejected));
    assert.equal(
      Number(scalar(`select count(*) from private.event_submissions where post_id='${rejected}';`)),
      2
    );
    fails(submit(cara, draft(cara)), "PT429");
  });
  await check("events: the member's privacy export includes their submissions", () => {
    const exported = json(`select internal.frontend_privacy_export_data('${cara.id}');`);
    assert.equal(Object.keys(exported).length, 33);
    const rows = exported.event_submissions;
    assert.equal(
      rows.length,
      Number(scalar(`select count(*) from private.event_submissions where owner_id='${cara.id}';`))
    );
    assert.deepEqual(Object.keys(rows[0]).sort(), [
      "post_id",
      "release_reason",
      "released_at",
      "submitted_at",
    ]);
    assert.ok(rows.some((r) => r.release_reason === "owner_deleted"));
  });
  await check("events: the ledger is append-only and purged after the window", () => {
    const id = scalar(
      `select id from private.event_submissions where owner_id='${cara.id}' order by submitted_at desc limit 1;`
    );
    fails(
      `update private.event_submissions set submitted_at=now()-interval '40 days' where id='${id}';`,
      "23514"
    );
    fails(`update private.event_submissions set released_at=now() where id='${id}';`, "23514");
    fails(`delete from private.event_submissions where id='${id}';`, "23514");
    q(
      `insert into private.event_submissions(owner_id,post_id,submitted_at) values('${cara.id}',gen_random_uuid(),now()-interval '32 days');`
    );
    job();
    assert.equal(
      scalar(
        `select count(*) from private.event_submissions where submitted_at<=now()-interval '31 days';`
      ),
      "0"
    );
    // Erasing an account removes its recent rows with it.
    const erased = randomUUID();
    q(`insert into auth.users(id,email,email_confirmed_at) values('${erased}','erased-${erased}@example.invalid',now());
       insert into private.event_submissions(owner_id,post_id) values('${erased}',gen_random_uuid());
       delete from auth.users where id='${erased}';`);
    assert.equal(
      scalar(`select count(*) from private.event_submissions where owner_id='${erased}';`),
      "0"
    );
    // A delete issued from inside another trigger is refused like any other.
    q(`create table vmtest.purge_signal(id uuid);
       create function vmtest.purge_submission() returns trigger language plpgsql as $$
       begin delete from private.event_submissions where id=new.id; return null; end$$;
       create trigger purge_submission after insert on vmtest.purge_signal
         for each row execute function vmtest.purge_submission();`);
    fails(`insert into vmtest.purge_signal values('${id}');`, "23514");
    assert.equal(scalar(`select count(*) from private.event_submissions where id='${id}';`), "1");
  });

  // ------------------------------------------ 4. slot posts: expiry and grace
  const slot = (owner, capacity = 1, days = 20) =>
    scalar(`select vmtest.slot('${owner.id}','${staff.id}',${capacity},${days});`);
  const slotPost = (owner, ent) => scalar(`select vmtest.slot_post('${owner.id}','${ent}');`);
  const endSlot = (ent) => q(`select vmtest.end_slot('${ent}');`);
  const slotActivations = (ent) =>
    Number(scalar(`select count(*) from private.post_activations where entitlement_id='${ent}';`));
  const openOn = (ent) =>
    Number(
      scalar(
        `select count(*) from private.post_activations where entitlement_id='${ent}' and released_at is null;`
      )
    );
  const releaseReason = (activation) =>
    scalar(`select release_reason from private.post_activations where id='${activation}';`);
  const action = (owner, id, name) => {
    const p = row(id);
    return `select api.execute_my_frontend_post_action('${randomUUID()}','${id}',${p.revision},'${name}','${p.kind}','${p.area}');`;
  };
  const setState = (owner, id, name) =>
    json(member(owner, `select api.set_post_state('${id}',${row(id).revision},'${name}');`));
  const remove = (owner, id) =>
    json(member(owner, `select api.delete_post('${id}',${row(id).revision});`));
  // The 3 days have passed (to the millisecond, or not quite).
  const graceEnds = (id, early = "0 seconds") =>
    q(
      `update private.posts set ended_at=clock_timestamp()-interval '3 days'+interval '${early}',
         deletes_at=clock_timestamp()+interval '${early}' where id='${id}';`
    );

  await check(
    "expiry: a slot post expires when its run ends, releases its slot and is notified once",
    () => {
      const hana = user("hana");
      const ent = slot(hana);
      const listing = slotPost(hana, ent);
      const activation = openSlot(listing);
      endSlot(ent);
      assert.deepEqual(job().expired >= 1, true);
      const expired = row(listing);
      assert.equal(expired.status, "expired");
      assert.equal(threeDays(listing), "true");
      assert.equal(releaseReason(activation), "expired");
      assert.equal(outbox(listing, "post_expired"), 1);
      job();
      assert.equal(outbox(listing, "post_expired"), 1, "not repeated");
      // No 7- or 21-day reminders any more: a post that expired 22 days ago
      // (kept by a legal hold until now) gets its expiry notice only.
      const old = post(hana, "listing", "expired");
      q(
        `update private.posts set ended_at=clock_timestamp()-interval '22 days',deletes_at=clock_timestamp()+interval '1 hour' where id='${old}';`
      );
      job();
      assert.equal(outbox(old, "post_expired"), 1);
      assert.equal(outbox(old, "post_expiry_reminder"), 0);
    }
  );
  await check(
    "grace: an expired post is kept until exactly 3 days after it expired, then deleted with its media",
    () => {
      const iris = user("iris");
      const ent = slot(iris);
      const listing = slotPost(iris, ent);
      const cover = scalar(
        `select object_id from private.post_media where post_id='${listing}' and purpose='cover';`
      );
      endSlot(ent);
      job();
      graceEnds(listing, "1 second");
      job();
      assert.equal(exists(listing), true, "deleted before its 3 days were over");
      graceEnds(listing);
      job();
      assert.equal(exists(listing), false);
      assert.equal(outbox(listing, "post_deleted"), 1);
      assert.equal(scalar(`select internal.media_object_in_use('${cover}');`), "f");
      assert.equal(
        scalar(`select unlinked_at is not null from private.media_objects where id='${cover}';`),
        "t"
      );
    }
  );
  await check("grace: the owner can delete an expired post during the 3 days", () => {
    const jo = user("jo");
    const ent = slot(jo);
    const listing = slotPost(jo, ent);
    endSlot(ent);
    job();
    assert.equal(remove(jo, listing).status, "deleted");
    assert.equal(exists(listing), false);
  });
  await check(
    "grace: after buying a plan, reactivating within the 3 days republishes it unchanged",
    () => {
      const kim = user("kim");
      const ent = slot(kim);
      const listing = slotPost(kim, ent);
      endSlot(ent);
      job();
      fails(member(kim, action(kim, listing, "reactivate")), "PT402");
      assert.equal(row(listing).status, "expired");
      const plan = slot(kim, 1, 30);
      const answer = json(member(kim, action(kim, listing, "reactivate")));
      assert.equal(answer.status, "live");
      const live = row(listing);
      assert.equal(live.ended_at, null);
      assert.equal(live.deletes_at, null);
      assert.equal(
        scalar(
          `select (p.visible_until=e.ends_at)::text from private.posts p, private.entitlements e where p.id='${listing}' and e.id='${plan}';`
        ),
        "true"
      );
      assert.equal(openOn(plan), 1);
    }
  );

  // ---------------------------------------------------------------- 5. sold
  await check(
    "sold: the slot stays taken, the owner is told, and the post is deleted 3 days later",
    () => {
      const lerato = user("lerato");
      const ent = slot(lerato);
      const listing = slotPost(lerato, ent);
      const activation = openSlot(listing);
      assert.equal(setState(lerato, listing, "sold").status, "sold");
      assert.equal(openSlot(listing), activation, "the sold post still holds its slot");
      assert.equal(threeDays(listing), "true");
      job();
      assert.equal(outbox(listing, "post_sold"), 1);
      assert.equal(outbox(listing, "post_expired"), 0);
      graceEnds(listing, "1 second");
      job();
      assert.equal(exists(listing), true);
      graceEnds(listing);
      job();
      assert.equal(exists(listing), false);
      assert.equal(releaseReason(activation), "deleted", "deletion frees the slot");
      assert.equal(openOn(ent), 0);
    }
  );
  await check("sold: deleting a sold post early frees its slot for a new post", () => {
    const musa = user("musa");
    const ent = slot(musa);
    const listing = slotPost(musa, ent);
    setState(musa, listing, "sold");
    const next = post(musa, "listing", "draft");
    const refused = fails(submit(musa, next), "PT409");
    assert.match(refused, /all posting capacity is in use/);
    remove(musa, listing);
    assert.equal(json(submit(musa, next)).status, "pending_moderation");
    assert.notEqual(openSlot(next), "");
    assert.equal(openOn(ent), 1);
  });
  await check(
    "sold: undoing it within the 3 days brings it back for the slot's remaining days, with no new activation",
    () => {
      const nomsa = user("nomsa");
      const ent = slot(nomsa, 1, 12);
      const listing = slotPost(nomsa, ent);
      const activation = openSlot(listing);
      setState(nomsa, listing, "sold");
      const answer = json(member(nomsa, action(nomsa, listing, "reactivate")));
      assert.equal(answer.status, "live");
      const live = row(listing);
      assert.equal(live.status, "live");
      assert.equal(live.deletes_at, null);
      assert.equal(openSlot(listing), activation);
      assert.equal(slotActivations(ent), 1);
      assert.equal(
        scalar(
          `select (p.visible_until=e.ends_at)::text from private.posts p, private.entitlements e where p.id='${listing}' and e.id='${ent}';`
        ),
        "true"
      );
      // Once the slot itself has ended, there is nothing left to go back to.
      setState(nomsa, listing, "sold");
      endSlot(ent);
      fails(member(nomsa, action(nomsa, listing, "reactivate")), "PT402");
      assert.equal(row(listing).status, "sold");
    }
  );

  // -------------------------------------------------------------- 6. paused
  await check("pause: pausing keeps the slot and reactivating spends no activation", () => {
    const olwethu = user("olwethu");
    const ent = slot(olwethu);
    const listing = slotPost(olwethu, ent);
    const activation = openSlot(listing);
    assert.equal(setState(olwethu, listing, "pause").status, "paused");
    assert.equal(openSlot(listing), activation);
    const capacity = json(member(olwethu, "select api.my_posting_capacity();"));
    assert.equal(capacity.active, 1, "a paused post still uses its slot");
    const next = post(olwethu, "listing", "draft");
    fails(submit(olwethu, next), "PT409");
    const answer = json(member(olwethu, action(olwethu, listing, "reactivate")));
    assert.equal(answer.status, "live");
    assert.equal(openSlot(listing), activation);
    assert.equal(slotActivations(ent), 1);
  });
  await check(
    "pause: a paused post that holds a slot is not deleted or warned about as idle",
    () => {
      const palesa = user("palesa");
      const ent = slot(palesa);
      const listing = slotPost(palesa, ent);
      setState(palesa, listing, "pause");
      q(
        `update private.posts set status_changed_at=now()-interval '61 days',content_updated_at=now()-interval '61 days' where id='${listing}';`
      );
      job();
      assert.equal(row(listing).status, "paused");
      assert.equal(outbox(listing, "draft_deletion_warning"), 0);
    }
  );
  await check("pause: a paused post expires with its plan, then follows the 3-day rule", () => {
    const qiniso = user("qiniso");
    const ent = slot(qiniso);
    const listing = slotPost(qiniso, ent);
    const activation = openSlot(listing);
    setState(qiniso, listing, "pause");
    endSlot(ent);
    job();
    const expired = row(listing);
    assert.equal(expired.status, "expired");
    assert.equal(threeDays(listing), "true");
    assert.equal(releaseReason(activation), "expired");
    assert.equal(outbox(listing, "post_expired"), 1);
    graceEnds(listing);
    job();
    assert.equal(exists(listing), false);
  });

  // -------------------------------------------------------- 7. late payment
  const payment = (owner, created, version = 0) =>
    scalar(`set session_replication_role=replica;
      insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,created_at)
        values('${owner.id}','plan',(select id from private.plan_versions order by created_at,id offset ${version} limit 1),10000,'ZAR','{}'::jsonb,${created})
        returning id;`);
  const confirm = (pay, fulfilment = "fulfilled", at = "clock_timestamp()") =>
    q(`update private.payments set status='complete',fulfillment_status='${fulfilment}',completed_at=${at},
         provider_transaction_id='synthetic-'||gen_random_uuid(),status_changed_at=clock_timestamp() where id='${pay}';`);
  const fail = (pay) =>
    q(
      `update private.payments set status='failed',status_changed_at=clock_timestamp() where id='${pay}';`
    );
  const keptFor = (listing, pay) =>
    scalar(
      `select (p.deletes_at=pay.completed_at+interval '3 days')::text from private.posts p, private.payments pay where p.id='${listing}' and pay.id='${pay}';`
    );
  const expiredSlotPost = (label) => {
    const owner = user(label);
    const ent = slot(owner);
    const listing = slotPost(owner, ent);
    endSlot(ent);
    job();
    assert.equal(row(listing).status, "expired");
    return { owner, listing };
  };
  await check(
    "late payment: a plan payment still being confirmed when the 3 days end extends them once by 24 hours",
    () => {
      const { owner, listing } = expiredSlotPost("rudo");
      graceEnds(listing);
      const due = row(listing).deletes_at;
      const pay = payment(owner, "clock_timestamp()-interval '1 hour'");
      assert.equal(job().extended, 1);
      assert.equal(exists(listing), true);
      assert.equal(
        scalar(
          `select (deletes_at='${due}'::timestamptz+interval '24 hours')::text from private.posts where id='${listing}';`
        ),
        "true"
      );
      assert.equal(
        scalar(
          `select payment_id from private.post_deletion_extensions where post_id='${listing}';`
        ),
        pay
      );
      const extended = row(listing).deletes_at;
      job();
      assert.equal(row(listing).deletes_at, extended, "extended only once");
      // The payment fails: the 24 hours are still waited out, since a failed
      // payment can be confirmed late; then the post goes.
      q(
        `update private.payments set status='failed',status_changed_at=clock_timestamp() where id='${pay}';`
      );
      job();
      assert.equal(exists(listing), true, "deleted before its extension ended");
      q(
        `update private.posts set deletes_at=clock_timestamp()-interval '1 second' where id='${listing}';`
      );
      job();
      assert.equal(exists(listing), false);
      assert.equal(
        scalar(`select count(*) from private.post_deletion_extensions where post_id='${listing}';`),
        "0"
      );
    }
  );
  await check("late payment: still unconfirmed after the 24 hours, the post is deleted", () => {
    const { owner, listing } = expiredSlotPost("sipho");
    graceEnds(listing);
    payment(owner, "clock_timestamp()-interval '2 hours'");
    job();
    assert.equal(exists(listing), true);
    q(
      `update private.posts set deletes_at=clock_timestamp()-interval '1 second' where id='${listing}';`
    );
    job();
    assert.equal(exists(listing), false);
  });
  await check(
    "late payment: a payment started more than a day before the post expired does not extend it",
    () => {
      const { owner, listing } = expiredSlotPost("thabo");
      graceEnds(listing);
      payment(owner, "clock_timestamp()-interval '4 days 1 hour'");
      job();
      assert.equal(exists(listing), false);
    }
  );
  await check("late payment: a renewal started just before the post expired counts", () => {
    const { owner, listing } = expiredSlotPost("themba");
    graceEnds(listing);
    payment(owner, "clock_timestamp()-interval '3 days 2 hours'");
    assert.equal(job().extended, 1);
    assert.equal(exists(listing), true);
  });
  await check(
    "late payment: reactivating during the extension keeps the post and clears the extension",
    () => {
      const { owner, listing } = expiredSlotPost("uzo");
      graceEnds(listing);
      payment(owner, "clock_timestamp()-interval '1 hour'");
      job();
      slot(owner, 1, 30); // the confirmed plan
      assert.equal(json(member(owner, action(owner, listing, "reactivate"))).status, "live");
      assert.equal(
        scalar(`select count(*) from private.post_deletion_extensions where post_id='${listing}';`),
        "0"
      );
      assert.equal(row(listing).deletes_at, null);
    }
  );
  await check(
    "late payment: once the payment is confirmed the post is kept 3 days after it, and the owner is told",
    () => {
      const { owner, listing } = expiredSlotPost("bongani");
      graceEnds(listing);
      const pay = payment(owner, "clock_timestamp()-interval '1 hour'");
      assert.equal(job().extended, 1);
      confirm(pay);
      assert.equal(job().kept, 1);
      assert.equal(exists(listing), true);
      assert.equal(keptFor(listing, pay), "true");
      assert.equal(outbox(listing, "post_kept"), 1);
      assert.equal(
        scalar(
          `select kept_at is not null from private.post_deletion_extensions where post_id='${listing}';`
        ),
        "t"
      );
      job();
      assert.equal(outbox(listing, "post_kept"), 1, "told once");
      assert.equal(keptFor(listing, pay), "true");
      // 3 days after the payment.
      q(`update private.payments set completed_at=clock_timestamp()-interval '3 days 1 second' where id='${pay}';
         update private.posts set deletes_at=(select completed_at+interval '3 days' from private.payments where id='${pay}')
           where id='${listing}';`);
      job();
      assert.equal(exists(listing), false, "not reactivated within the 3 days after paying");
    }
  );
  await check(
    "late payment: a payment confirmed during the 3 days keeps the post 3 days after it",
    () => {
      const { owner, listing } = expiredSlotPost("cebo");
      graceEnds(listing);
      const pay = payment(owner, "clock_timestamp()-interval '2 hours'");
      confirm(pay, "fulfilled", "clock_timestamp()-interval '1 hour'");
      job();
      assert.equal(exists(listing), true);
      assert.equal(keptFor(listing, pay), "true");
      assert.equal(outbox(listing, "post_kept"), 1);
    }
  );
  await check(
    "late payment: a payment cancelled and retried during the extension keeps the post once confirmed",
    () => {
      const { owner, listing } = expiredSlotPost("dumi");
      graceEnds(listing);
      const first = payment(owner, "clock_timestamp()-interval '1 hour'");
      assert.equal(job().extended, 1);
      fail(first);
      job();
      assert.equal(exists(listing), true, "the extension is waited out");
      const retry = payment(owner, "clock_timestamp()", 1);
      job();
      assert.equal(exists(listing), true);
      confirm(retry);
      assert.equal(job().kept, 1);
      assert.equal(keptFor(listing, retry), "true");
      assert.equal(outbox(listing, "post_kept"), 1);
    }
  );
  await check("late payment: a late confirmation of the failed payment keeps the post too", () => {
    const { owner, listing } = expiredSlotPost("dudu");
    graceEnds(listing);
    const pay = payment(owner, "clock_timestamp()-interval '1 hour'");
    job();
    fail(pay);
    job();
    confirm(pay); // the provider confirms it after all
    assert.equal(job().kept, 1);
    assert.equal(keptFor(listing, pay), "true");
  });
  await check(
    "late payment: a confirmed payment still being reconciled counts as being confirmed",
    () => {
      const { owner, listing } = expiredSlotPost("eli");
      graceEnds(listing);
      const pay = payment(owner, "clock_timestamp()-interval '1 hour'");
      confirm(pay, "needs_reconciliation");
      assert.equal(job().extended, 1);
      assert.equal(exists(listing), true);
      assert.equal(outbox(listing, "post_kept"), 0);
    }
  );

  // ------------------------------------- 7b. slots lost by refund or sponsorship
  const paidSlot = (owner) => {
    const pay = scalar(`set session_replication_role=replica;
      insert into private.payments(owner_id,product_kind,plan_version_id,amount_cents,currency,snapshot,status,
          fulfillment_status,completed_at,provider_transaction_id)
        values('${owner.id}','plan',(select id from private.plan_versions order by created_at,id limit 1),10000,'ZAR','{}'::jsonb,
          'complete','fulfilled',now(),'synthetic-'||gen_random_uuid())
        returning id;`);
    const ent =
      scalar(`insert into private.entitlements(owner_id,source,payment_id,slot_capacity,max_photos,max_videos,starts_at,ends_at)
        values('${owner.id}','retail_paid','${pay}',2,10,1,now()-interval '1 day',now()+interval '20 days') returning id;`);
    return { pay, ent };
  };
  const idleFor = (id, days) =>
    q(
      `update private.posts set status_changed_at=now()-make_interval(days=>${days}),content_updated_at=now()-make_interval(days=>${days}) where id='${id}';`
    );
  await check(
    "refund: a paused post funded by a refunded plan expires with the 3-day rule; a held one stays paused",
    () => {
      const yanga = user("yanga");
      const { pay, ent } = paidSlot(yanga);
      const paused = slotPost(yanga, ent);
      const held = slotPost(yanga, ent);
      setState(yanga, paused, "pause");
      idleFor(paused, 70); // paused long ago: the idle rule alone would delete it now
      scalar(`select vmtest.hide('${held}','${staff.id}');`);
      q(`select internal.reverse_payment('${pay}','refunded','Synthetic refund for the check');`);
      const after = row(paused);
      assert.equal(after.status, "expired");
      assert.equal(after.status_reason, "Payment refunded");
      assert.equal(threeDays(paused), "true");
      assert.equal(openSlot(paused), "");
      assert.equal(row(held).status, "paused");
      job();
      assert.equal(exists(paused), true, "deleted without its 3 days");
      assert.equal(outbox(paused, "post_expired"), 1);
      assert.equal(outbox(paused, "draft_deletion_warning"), 0);
    }
  );
  await check("sponsorship end: a paused post in the ended place expires the same way", () => {
    const zola = user("zola");
    const ent = slot(zola);
    const paused = slotPost(zola, ent);
    setState(zola, paused, "pause");
    idleFor(paused, 70);
    q(`select internal.release_sponsorship_entitlement('${ent}');`);
    assert.equal(row(paused).status, "expired");
    assert.equal(row(paused).status_reason, "Sponsorship ended");
    assert.equal(threeDays(paused), "true");
    job();
    assert.equal(exists(paused), true);
  });
  await check("release: the slot of a paused or sold post cannot be released by hand", () => {
    const amahle = user("amahle");
    const ent = slot(amahle, 2);
    const paused = slotPost(amahle, ent);
    const sold = slotPost(amahle, ent);
    setState(amahle, paused, "pause");
    setState(amahle, sold, "sold");
    for (const id of [paused, sold]) {
      const message = fails(member(amahle, `select api.release_post('${id}','owner');`), "22023");
      assert.match(message, /keeps its slot until it is deleted/);
      assert.notEqual(openSlot(id), "");
    }
  });
  await check(
    "archive: archiving releases the slot at once and the post goes 3 days later, without a notice",
    () => {
      const jabu = user("jabu");
      const ent = slot(jabu);
      const listing = slotPost(jabu, ent);
      const activation = openSlot(listing);
      setState(jabu, listing, "archive");
      assert.equal(releaseReason(activation), "owner");
      assert.equal(threeDays(listing), "true");
      job();
      assert.equal(outbox(listing, "post_expired") + outbox(listing, "post_sold"), 0);
      graceEnds(listing);
      job();
      assert.equal(exists(listing), false);
    }
  );
  await check("sold notice: undoing and redoing sold sends it once for the slot", () => {
    const fana = user("fana");
    const ent = slot(fana);
    const listing = slotPost(fana, ent);
    setState(fana, listing, "sold");
    job();
    for (let n = 0; n < 3; n++) {
      assert.equal(json(member(fana, action(fana, listing, "reactivate"))).status, "live");
      setState(fana, listing, "sold");
      job();
    }
    assert.equal(outbox(listing, "post_sold"), 1);
  });
  await check("sold: plan payments neither extend nor keep a sold post", () => {
    const kwame = user("kwame");
    const ent = slot(kwame);
    const listing = slotPost(kwame, ent);
    setState(kwame, listing, "sold");
    graceEnds(listing);
    payment(kwame, "clock_timestamp()-interval '1 hour'");
    const paid = payment(kwame, "clock_timestamp()-interval '2 hours'", 1);
    confirm(paid, "fulfilled", "clock_timestamp()-interval '30 minutes'");
    job();
    assert.equal(exists(listing), false);
    assert.equal(outbox(listing, "post_kept"), 0);
  });
  await check("sold notice: once per sale, even when a refund later frees the slot", () => {
    const lindo = user("lindo");
    const { pay, ent } = paidSlot(lindo);
    const listing = slotPost(lindo, ent);
    setState(lindo, listing, "sold");
    job();
    assert.equal(outbox(listing, "post_sold"), 1);
    q(`select internal.reverse_payment('${pay}','refunded','Synthetic refund for the check');`);
    assert.equal(openSlot(listing), "");
    job();
    assert.equal(outbox(listing, "post_sold"), 1);
  });
  await check(
    "notices: an ended post already due gets the deletion notice, not a late expiry notice",
    () => {
      const ian = user("ian");
      const listing = post(ian, "listing", "expired");
      q(
        `update private.posts set ended_at=now()-interval '4 days',deletes_at=now()-interval '1 second' where id='${listing}';`
      );
      job();
      assert.equal(exists(listing), false);
      assert.equal(outbox(listing, "post_expired"), 0);
      assert.equal(outbox(listing, "post_deleted"), 1);
    }
  );

  // ---------------------------------------------------------------- 8. events
  const liveEvent = (owner) => {
    const event = draft(owner);
    q(submit(owner, event));
    q(`update private.posts set status='live',published_at=now()-interval '1 hour',
         visible_until=(select ends_at from private.event_details where post_id='${event}') where id='${event}';`);
    return event;
  };
  const eventEnds = (id) =>
    q(`update private.event_details set starts_at=date_trunc('milliseconds',clock_timestamp()-interval '2 hours'),
         ends_at=date_trunc('milliseconds',clock_timestamp()-interval '1 millisecond') where post_id='${id}';`);
  const place = (id) =>
    scalar(
      `select coalesce(release_reason,'kept') from private.event_submissions where post_id='${id}' order by submitted_at desc limit 1;`
    );
  await check(
    "events: a live event is deleted as soon as it ends, with no expiry notice, keeping its place",
    () => {
      const ella = user("ella");
      const event = liveEvent(ella);
      assert.equal(datedAtEnd(event), "true");
      job();
      assert.equal(exists(event), true, "deleted before it ended");
      eventEnds(event);
      assert.equal(datedAtEnd(event), "true", "the deletion date follows a changed end");
      job();
      assert.equal(exists(event), false);
      assert.equal(outbox(event, "post_expired"), 0);
      assert.equal(outbox(event, "post_deleted"), 1);
      assert.equal(place(event), "kept");
    }
  );
  await check(
    "events: a draft, pending or rejected event is deleted at its end; a held one is kept",
    () => {
      const hope = user("hope");
      const drafted = draft(hope);
      const pending = draft(hope);
      q(submit(hope, pending));
      const rejected = draft(hope);
      q(submit(hope, rejected));
      q(
        `update private.posts set status='rejected',status_reason='Synthetic rejection' where id='${rejected}';`
      );
      const held = liveEvent(hope);
      scalar(`select vmtest.hide('${held}','${staff.id}');`);
      for (const id of [drafted, pending, rejected, held]) {
        assert.equal(datedAtEnd(id), "true", id);
        eventEnds(id);
      }
      job();
      for (const id of [drafted, pending, rejected]) assert.equal(exists(id), false, id);
      assert.equal(exists(held), true);
    }
  );
  await check("events: an end in the past is refused when an event is created or edited", () => {
    const gabi = user("gabi");
    const at = (hours) =>
      new Date(Math.floor(Date.now() / 1000) * 1000 + hours * 3_600_000).toISOString();
    const past = { starts_at: at(-3), ends_at: at(-1), timezone: "Africa/Johannesburg" };
    const activity = scalar(
      "select coalesce((select a.key from private.category_activities a join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required order by a.key limit 1),'')"
    );
    const created = fails(
      member(
        gabi,
        `select api.create_core_draft('event','tourism_events','events','${JSON.stringify(past)}'::jsonb,${activity ? `'${activity}'` : "null"});`
      ),
      "22023"
    );
    assert.match(created, /event end must be in the future/);
    const event = liveEvent(gabi);
    setState(gabi, event, "pause");
    const before = endsAt(event);
    const edited = fails(
      member(
        gabi,
        `select api.save_business_event_context('${event}',${row(event).revision},'${JSON.stringify({ event_window: past })}'::jsonb);`
      ),
      "22023"
    );
    assert.match(edited, /event end must be in the future/);
    assert.equal(endsAt(event), before);
    const future = { starts_at: at(48), ends_at: at(50), timezone: "Africa/Johannesburg" };
    q(
      member(
        gabi,
        `select api.save_business_event_context('${event}',${row(event).revision},'${JSON.stringify({ event_window: future })}'::jsonb);`
      )
    );
    assert.equal(datedAtEnd(event), "true", "the deletion date follows the moved end");
    assert.equal(Date.parse(endsAt(event)), Date.parse(future.ends_at));
  });
  await check("events: a paused event is deleted at its end too", () => {
    const fezeka = user("fezeka");
    const event = liveEvent(fezeka);
    setState(fezeka, event, "pause");
    assert.equal(datedAtEnd(event), "true");
    eventEnds(event);
    job();
    assert.equal(exists(event), false);
    assert.equal(outbox(event, "post_expired"), 0);
  });
  await check(
    "events: an owner deleting an event before it ends returns its place; after its end it does not",
    () => {
      const gcina = user("gcina");
      const early = liveEvent(gcina);
      remove(gcina, early);
      assert.equal(place(early), "owner_deleted");
      const late = liveEvent(gcina);
      eventEnds(late); // over, but the job has not run yet
      remove(gcina, late);
      assert.equal(place(late), "kept");
    }
  );

  const openReport = (post_, owner) =>
    scalar(`set session_replication_role=replica;
      insert into private.reports(post_id,subject_account_id,category,description,reporter_ip_hmac)
        values('${post_}','${owner.id}','scam','Synthetic open report for the check',
          substr(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),1,43))
        returning id;`);
  await check(
    "reports: an open report keeps a post due for deletion until it is handled, at most 7 days",
    () => {
      const mandla = user("mandla");
      const reported = post(mandla, "listing", "expired");
      const report = openReport(reported, mandla);
      graceEnds(reported);
      job();
      assert.equal(exists(reported), true, "deleted with an open report");
      q(`set session_replication_role=replica;
       update private.reports set status='resolved',resolved_at=now(),resolved_by='${staff.id}',
         resolution_note='Synthetic review done' where id='${report}';`);
      job();
      assert.equal(exists(reported), false);
      // Never more than 7 days past the deletion date.
      const stale = post(mandla, "listing", "expired");
      openReport(stale, mandla);
      q(
        `update private.posts set ended_at=now()-interval '10 days 1 minute',deletes_at=now()-interval '7 days 1 minute' where id='${stale}';`
      );
      job();
      assert.equal(exists(stale), false);
      // An event that has ended waits the same way.
      const event = liveEvent(mandla);
      openReport(event, mandla);
      eventEnds(event);
      job();
      assert.equal(exists(event), true);
    }
  );
  // ------------------------------------------------------------ 9. holds
  await check("holds: a held post neither expires with its plan nor is deleted at its end", () => {
    const hlengiwe = user("hlengiwe");
    const ent = slot(hlengiwe);
    const listing = slotPost(hlengiwe, ent);
    scalar(`select vmtest.hide('${listing}','${staff.id}');`);
    endSlot(ent);
    const event = liveEvent(hlengiwe);
    scalar(`select vmtest.hide('${event}','${staff.id}');`);
    eventEnds(event);
    job();
    assert.equal(row(listing).status, "paused");
    assert.equal(row(listing).status_reason, "staff_hidden");
    assert.notEqual(openSlot(listing), "", "the slot is not released while held");
    assert.equal(exists(event), true);
    assert.equal(outbox(listing, "post_expired"), 0);
  });

  // ------------------------------------------------- 10. owner reads (v2)
  await check(
    "owner reads: the v2 reads add the deletion date; the original reads are unchanged",
    () => {
      const vusi = user("vusi");
      const ent = slot(vusi);
      const listing = slotPost(vusi, ent);
      setState(vusi, listing, "sold");
      const due = row(listing).deletes_at;
      const v1 = json(member(vusi, `select api.get_my_frontend_post('${listing}');`));
      const v2 = json(member(vusi, `select api.get_my_frontend_post_v2('${listing}');`));
      assert.equal("deletes_at" in v1, false);
      const { deletes_at, ...rest } = v2;
      assert.equal(deletes_at, due);
      assert.deepEqual(rest, v1);
      const listed = json(member(vusi, "select api.list_my_frontend_posts_v2('listing');"));
      assert.equal(listed.total, 1);
      assert.equal(listed.items[0].deletes_at, due);
      assert.equal(
        json(member(vusi, "select api.list_my_frontend_posts('listing');")).items[0].deletes_at,
        undefined
      );
      const event = liveEvent(vusi);
      const eventRead = json(member(vusi, `select api.get_my_frontend_post_v2('${event}');`));
      assert.equal(eventRead.deletes_at, endsAt(event));
      const draftEvent = draft(vusi);
      const draftRead = json(member(vusi, `select api.get_my_frontend_post_v2('${draftEvent}');`));
      assert.equal(draftRead.deletes_at, endsAt(draftEvent));
      const draftListing = post(vusi, "listing", "draft");
      assert.equal(
        json(member(vusi, `select api.get_my_frontend_post_v2('${draftListing}');`)).deletes_at,
        null
      );
      // Another member sees nothing.
      assert.equal(
        scalar(member(alice, `select api.get_my_frontend_post_v2('${listing}') is null;`)),
        "t"
      );
      assert.equal(
        json(member(alice, "select api.list_my_frontend_posts_v2('event');")).items.some(
          (item) => item.id === event
        ),
        false
      );
      fails(member(vusi, "select api.list_my_frontend_posts_v2('listing',null,101);"), "22023");
    }
  );
  await check(
    "notices: the mail claim accepts the new kinds and the earlier list, with dates",
    () => {
      const earlier = [
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
      ];
      const claim = (kinds) =>
        service(
          `select api.claim_supported_notification_outbox(array[${kinds.map((k) => `'${k}'`).join(",")}],50);`
        );
      const sold = json(claim(["post_sold"]));
      const earlierSold = sold.find((item) => item.post_id === soldListing);
      assert.ok(earlierSold, "the sold notice is claimed");
      assert.equal(earlierSold.deletes_at, row(soldListing).deletes_at);
      assert.equal(
        earlierSold.holds_slot,
        false,
        "sold before the update: its slot is already free"
      );
      const holding = sold.find((item) => item.holds_slot === true);
      assert.ok(holding, "a post sold under these rules still holds its slot");
      assert.equal(holding.deletes_at, row(holding.post_id).deletes_at);
      q(claim(["post_kept"]));
      q(claim(earlier)); // the list of the application deployed before this update
      q(claim([...earlier, "post_sold"]));
      q(claim([...earlier, "post_sold", "post_kept"]));
      fails(claim([...earlier, "post_sold", "post_kept", "post_kept"]), "22023");
    }
  );

  // ----------------------------------------------------------- concurrency
  await check("concurrency: two submissions at the limit admit exactly one", async () => {
    const [a, b] = [draft(fikile), draft(fikile)];
    const results = await Promise.all([session(submit(fikile, a)), session(submit(fikile, b))]);
    assert.deepEqual(results.map((r) => r.status).sort(), [0, 3]);
    assert.match(results.find((r) => r.status !== 0).stderr, /ERROR:\s+PT429:/);
  });
  await check("concurrency: a delete racing a hide never removes the post", async () => {
    const listing = post(gugu, "listing", "live");
    const revision = row(listing).revision;
    const [hide, remove] = await Promise.all([
      session(`begin; select vmtest.hide('${listing}','${staff.id}'); select pg_sleep(2); commit;`),
      later(700, member(gugu, `select api.delete_post('${listing}',${revision});`)),
    ]);
    assert.equal(hide.status, 0, hide.stderr);
    assert.notEqual(remove.status, 0);
    assert.match(remove.stderr, /ERROR:\s+PT4(09|23):/);
    assert.equal(exists(listing), true);
    // With the current revision the hold itself is the refusal.
    fails(member(gugu, `select api.delete_post('${listing}',${row(listing).revision});`), "PT423");
  });
  await check("concurrency: mark sold racing a hide never starts deletion", async () => {
    const listing = post(gugu, "listing", "live");
    const revision = row(listing).revision;
    const [hide, sold] = await Promise.all([
      session(`begin; select vmtest.hide('${listing}','${staff.id}'); select pg_sleep(2); commit;`),
      later(700, member(gugu, `select api.set_post_state('${listing}',${revision},'sold');`)),
    ]);
    assert.equal(hide.status, 0, hide.stderr);
    assert.notEqual(sold.status, 0);
    const after = row(listing);
    assert.equal(after.status, "paused");
    assert.equal(after.deletes_at, null);
  });
  await check("concurrency: the lifecycle job skips a post while it is being hidden", async () => {
    const idle = post(gugu, "listing", "paused", 61);
    const [hide, sweep] = await Promise.all([
      session(`begin; select vmtest.hide('${idle}','${staff.id}');
        update private.posts set status_changed_at=now()-interval '61 days',content_updated_at=now()-interval '61 days' where id='${idle}';
        select pg_sleep(2); commit;`),
      later(700, service("select api.run_post_lifecycle(500);")),
    ]);
    assert.equal(hide.status, 0, hide.stderr);
    assert.equal(sweep.status, 0, sweep.stderr);
    assert.equal(exists(idle), true);
    job();
    assert.equal(exists(idle), true);
  });
  await check(
    "concurrency: a new post racing the deletion of a sold post never overfills the slot",
    async () => {
      const wandile = user("wandile");
      const ent = slot(wandile);
      const listing = slotPost(wandile, ent);
      setState(wandile, listing, "sold");
      graceEnds(listing);
      const next = post(wandile, "listing", "draft");
      const [sweep, submitted] = await Promise.all([
        session(service(`begin; select api.run_post_lifecycle(500); select pg_sleep(2); commit;`)),
        later(700, submit(wandile, next)),
      ]);
      assert.equal(sweep.status, 0, sweep.stderr);
      assert.equal(exists(listing), false);
      if (submitted.status !== 0) {
        // It saw the slot still taken by the uncommitted deletion; it can retry.
        assert.match(submitted.stderr, /ERROR:\s+PT409:/);
        q(submit(wandile, next));
      }
      assert.equal(row(next).status, "pending_moderation");
      assert.equal(openOn(ent), 1);
    }
  );
  await check(
    "concurrency: undoing sold racing its deletion either keeps it live or deletes it, never both",
    async () => {
      const xolani = user("xolani");
      const ent = slot(xolani);
      const listing = slotPost(xolani, ent);
      setState(xolani, listing, "sold");
      graceEnds(listing);
      const [sweep, undo] = await Promise.all([
        session(service(`begin; select api.run_post_lifecycle(500); select pg_sleep(2); commit;`)),
        later(700, member(xolani, action(xolani, listing, "reactivate"))),
      ]);
      assert.equal(sweep.status, 0, sweep.stderr);
      if (undo.status === 0) assert.equal(row(listing).status, "live");
      else assert.equal(exists(listing), false);
      assert.ok(openOn(ent) <= 1);
    }
  );
} catch (error) {
  console.error(`FAIL ${current}`);
  throw error;
} finally {
  database.stop();
}
console.log(
  `Post lifecycle checks passed: ${checks.length} in ${Math.round((Date.now() - started) / 1000)} s.`
);
