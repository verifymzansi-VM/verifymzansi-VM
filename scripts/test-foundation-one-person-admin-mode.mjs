#!/usr/bin/env node
// Behaviour checks for 20261121143000_one_person_admin_mode.sql (owner's
// decisions of 21 and 22 November 2026): single-administrator mode for house
// slots and own posts, logged.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of scripts/test-foundation-house-slots.mjs
// (members and staff written directly as the database owner, accepted ID
// reviews as synthetic identity facts, members and staff acting through the
// production API commands with synthetic sessions). The script checks the
// read-only preflight, drifted bodies and a premature rollback, applies the
// update and proves apply -> rollback -> apply, then checks: no API role can
// run the grant or the mode check; with two ID-verified staff members the mode
// is off (a self-grant is refused, a grant needs a second ID-verified
// administrator) and the cap is 25; with one, that administrator may grant
// house slots to their own account (a written reason, never another account,
// never their second account without an ID review, at most 25, every event
// marked self_granted and append-only); any of their own pending posts and
// edits (house slot, free first post, paid slot, event) is listed, claimed and
// approved (never rejected) with an authenticator code from the last 15
// minutes, logged as self_approved and shown as post:self_approved in the staff
// Audit log; an admin account without an ID review can neither claim, open,
// renew nor decide a post; another member's post is approved as before; the
// owner's own ID review ending turns the mode off; a second ID-verified staff
// member ends the mode at once, for grants, listing, claims and items already
// claimed (every kind of own post), and removing them brings it back; the rollback refuses a changed function and once a self-granted or
// self-approved record exists; after every later update a self-approval still
// needs an authenticator code from the last 15 minutes.
//
//   node --import tsx scripts/test-foundation-one-person-admin-mode.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { assertReadOnlyPreflight, executeGrants } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  fingerprintOf,
  functionBodyMd5,
  grantHouseSlotsSql,
  ozowPurchase,
  P30,
  runTwoAdminUpdateCheck,
  sqlValue,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261121143000_one_person_admin_mode.sql";
const GRANT = "internal.grant_house_slots(text,integer,integer,text,text)";
const CONFLICT = "internal.queue_conflict(uuid,uuid,uuid)";
const CLAIM = "internal.claim_queue_items(text,integer)";
const MODERATE = "internal.moderate_post(uuid,integer,text,text,text,uuid)";
const READY = "internal.assert_posting_verification_ready(uuid,boolean)";
const CLAIM_ONE = "internal.claim_queue_item(text,uuid)";
const REVIEW = "internal.staff_review_post(uuid,text,uuid)";
const RENEW = "internal.renew_queue_claim(text,uuid,text,uuid)";
const SINGLE = "internal.single_administrator(uuid)";
const EVENT_GUARD = "internal.assert_event_duplicate_absent(uuid,boolean)";
const REPLACED = [GRANT, CONFLICT, CLAIM, MODERATE, READY, CLAIM_ONE, REVIEW, RENEW, EVENT_GUARD];
const NO_ID = /staff_identity_required|ID verification required to review posts/;
const NONE = { anon: false, authenticated: false, service_role: false };
const REASON = "Owner's own house slots for real offers";
const NOT_APPLIED =
  /^one-person admin mode: update not applied; ID-verified staff: \d+; house slots: \d+; post claims by staff without an ID review: \d+$/;
const MINUTE = 60;

const SETUP = { update: UPDATE, label: "solo", title: "One-person admin mode" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin, admin2 } = run;
  const { q, json, fails, member, staff, service, preflight, fingerprint, count } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);

  // Ready posting: the current posting terms accepted, a ready cover image,
  // the form contact channel; a draft Market listing.
  q(`create function vmtest.terms(p_owner uuid) returns void language sql as $$
      insert into private.posting_terms_acceptances(owner_id,version,document_hash)
        select p_owner,v.version,v.document_hash from private.posting_terms_current c
          join private.posting_terms_versions v using(version) where c.singleton
      on conflict do nothing $$;
    create function vmtest.draft(p_owner uuid) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cover uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(cover,p_owner,'image','media/'||cover,1024,1024,encode(sha256(convert_to(cover::text,'UTF8')),'hex'),'image/jpeg',800,600,'ready');
      insert into private.posts(id,owner_id,kind,area,category_key,title,description,province_id,city_id)
        values(pid,p_owner,'listing','market','other_items','Solo listing '||left(pid::text,8),
          'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      insert into private.listing_details(post_id,price_mode,price_cents) values(pid,'amount',12000);
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,'listing',array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,cover,'cover',0);
      return pid;
    end$$;
    create function vmtest.event_draft(p_owner uuid) returns uuid language plpgsql as $$
    declare pid uuid:=gen_random_uuid(); cover uuid:=gen_random_uuid(); begin
      insert into private.media_objects(id,owner_id,kind,object_key,declared_bytes,size_bytes,sha256,mime,width,height,state)
        values(cover,p_owner,'image','media/'||cover,1024,1024,encode(sha256(convert_to(cover::text,'UTF8')),'hex'),'image/jpeg',800,600,'ready');
      insert into private.posts(id,owner_id,kind,area,category_key,activity_key,title,description,province_id,city_id)
        values(pid,p_owner,'event','tourism_events','events',(select a.key from private.category_activities a
            join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required
            order by a.key limit 1),
          'Solo event '||left(pid::text,8),'A synthetic description long enough for every rule.','gp','gp_johannesburg');
      insert into private.event_details(post_id,starts_at,ends_at,timezone)
        values(pid,date_trunc('milliseconds',now()+interval '20 days'),date_trunc('milliseconds',now()+interval '21 days'),'Africa/Johannesburg');
      insert into private.post_contacts(post_id,post_kind,channels) values(pid,'event',array['form']);
      insert into private.post_media(post_id,object_id,purpose,position) values(pid,cover,'cover',0);
      return pid;
    end$$;`);
  // Each person has accepted the current posting terms.
  const ready = (person) => (q(`select vmtest.terms('${person.id}');`), person);
  [admin, admin2].forEach(ready);

  const grantSql = grantHouseSlotsSql;
  const grant = (recipient, slots, days, approver, reason = REASON) =>
    json(grantSql(recipient, slots, days, reason, approver));
  const activeSlots = (person) =>
    json(`select coalesce(jsonb_agg(e.id order by e.ends_at, e.id),'[]') from private.entitlements e
      where e.owner_id='${person.id}' and e.source='staff_grant' and e.status='active';`);
  const events = (person) =>
    json(`select coalesce(jsonb_agg(to_jsonb(h) order by h.recorded_at, h.action, h.id),'[]')
      from private.house_slot_events h join private.entitlements e on e.id=h.entitlement_id
      where e.owner_id='${person.id}';`);
  const single = (person) => q(`select internal.single_administrator('${person.id}');`);
  const row = (id) =>
    json(`select to_jsonb(p)-'description' from private.posts p where p.id='${id}';`);
  const submitted = (owner) => {
    const id = q(`select vmtest.draft('${owner.id}');`);
    const done = json(member(owner, `select api.submit_post('${id}',${row(id).revision});`));
    assert.equal(done.status, "pending_moderation");
    return id;
  };
  const fundedBy = (id) =>
    q(
      `select coalesce((select entitlement_id::text from private.post_activations where post_id='${id}' and released_at is null),'');`
    );
  const listed = (who) =>
    json(staff(who, "select api.get_frontend_staff_moderation_queue(p_limit=>50);")).items.map(
      (i) => i.id
    );
  const claimSql = (who) => staff(who, "select api.claim_frontend_staff_items('content',25);");
  const claimed = (who) => json(claimSql(who)).items;
  const decideSql = (who, id, lease, decision, totpAt) =>
    staff(
      who,
      `select api.moderate_post(p_post_id=>'${id}',p_expected_revision=>${row(id).revision},p_decision=>'${decision}',
        p_reason=>${decision === "reject" ? "'Not right after all'" : "null"},p_claim_generation=>'${lease.claim_generation}',
        p_claim_nonce=>'${lease.claim_nonce}');`,
      totpAt
    );
  const decisions = (id) =>
    json(`select coalesce(jsonb_agg(jsonb_build_object('staff_id',m.staff_id,'decision',m.decision,
        'self_approved',m.self_approved) order by m.id),'[]') from private.moderation_log m where m.post_id='${id}';`);
  const revokeRole = (person) =>
    q(
      `update private.staff_roles set revoked_at=now(),revoked_by='${admin.id}' where user_id='${person.id}' and revoked_at is null;`
    );
  const now = () => Math.floor(Date.now() / 1000);

  // ------------------------------------------------------------ before
  await check("before the update: the mode check is absent; preflight reads 'not applied'", () => {
    assert.equal(bodyMd5(SINGLE), "missing");
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assert.match(
      rows[0][1],
      /; ID-verified staff: 2; house slots: 0; post claims by staff without an ID review: 0$/
    );
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and drifted bodies are refused", () => {
    assertDriftRefused(kit, { label: "one-person admin mode", signatures: REPLACED, rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "one-person admin mode",
    applied:
      /^one-person admin mode: already applied; ID-verified staff: 2; house slots: 0; post claims by staff without an ID review: 0; self-granted slot events: 0; self-approved decisions: 0$/,
    notApplied: NOT_APPLIED,
  });

  await check("no API role can run the grant or the mode check", () => {
    assert.deepEqual(executeGrants(json, [GRANT, SINGLE, CONFLICT]), {
      [GRANT]: NONE,
      [SINGLE]: NONE,
      [CONFLICT]: NONE,
    });
    for (const sql of [
      grantSql(admin, 1, 90, REASON, admin),
      `select internal.single_administrator('${admin.id}');`,
    ]) {
      fails(member(admin, sql), "42501");
      fails(staff(admin, sql), "42501");
      fails(service(sql), "42501");
    }
    assert.equal(count("private.house_slot_events"), 0);
  });

  // ------------------------------------------------ two ID-verified staff
  await check("two ID-verified staff members: the mode is off; the cap is 25", () => {
    assert.deepEqual([single(admin), single(admin2)], ["f", "f"]);
    fails(grantSql(admin, 1, 90, REASON, admin), "42501", /house_slots_self_approval/);
    // LIM-SQL-house-slots-count (docs/testing/limits-register.json)
    for (const slots of [null, 0, 26])
      fails(grantSql(admin2, slots, 90, REASON, admin), "22023", /house_slots_count_invalid/);
    const done = grant(admin2, 25, 90, admin);
    assert.deepEqual(
      [done.added, done.extended, done.approved_by, done.self_granted],
      [25, 0, admin.id, false]
    );
    assert.equal(activeSlots(admin2).length, 25);
    assert.ok(events(admin2).every((e) => e.self_granted === false && e.approved_by === admin.id));
    fails(grantSql(admin2, 24, 90, REASON, admin), "22023", /already holds 25 house slots/);
  });

  // ------------------------------------------------ one ID-verified staff
  // The owner's case: one ID-verified admin and a second admin account of the
  // same person without an ID review of its own.
  let second, ownFree, ownPaid;
  await check("one ID-verified staff member: the mode is on for that admin only", () => {
    revokeRole(admin2); // ends admin2's house slots (their role is gone)
    assert.equal(activeSlots(admin2).length, 0);
    second = ready(world.staffUser("solo-second", "admin"));
    assert.deepEqual([single(admin), single(second), single(admin2)], ["t", "f", "f"]);
    // Their own post funded by the free first post (no house slot yet).
    ownFree = submitted(admin);
    assert.equal(fundedBy(ownFree), "");
    // And one funded by a paid Individual slot.
    ozowPurchase(kit, admin, P30, 1);
    ownPaid = submitted(admin);
    assert.equal(
      q(
        `select e.source from private.entitlements e join private.post_activations a on a.entitlement_id=e.id
          where a.post_id='${ownPaid}' and a.released_at is null;`
      ),
      "retail_paid"
    );
  });
  await check("staff without an ID review never review posts: the second admin account", () => {
    // The owner's second admin account has an authenticator app and every
    // staff capability, but no ID review of its own.
    assert.ok(!listed(second).includes(ownFree));
    assert.deepEqual(claimed(second), []);
    fails(staff(second, `select api.claim_queue_item('post','${ownFree}');`), "42501", NO_ID);
    // Even holding a lease (written directly here, as a moderator whose ID
    // review ended mid-claim would), it can neither open, approve, reject nor
    // renew it.
    const lease = json(
      `select to_jsonb(c) from internal.take_queue_claim('${second.id}','${ownFree}',null) c;`
    );
    assert.match(preflight()[0][1], /; post claims by staff without an ID review: 1;/);
    fails(
      staff(
        second,
        `select api.staff_review_post('${ownFree}','${lease.claim_generation}','${lease.claim_nonce}');`
      ),
      "42501",
      NO_ID
    );
    for (const decision of ["approve", "reject"])
      fails(decideSql(second, ownFree, lease, decision), "42501", NO_ID);
    fails(
      staff(
        second,
        `select api.renew_queue_claim('post','${ownFree}','${lease.claim_generation}','${lease.claim_nonce}');`
      ),
      "42501",
      NO_ID
    );
    q(`update private.queue_claims set claimed_by=null,claim_nonce=null,claimed_at=null,
      claim_expires_at=null,renewals=0 where post_id='${ownFree}';`);
    assert.equal(row(ownFree).status, "pending_moderation");
    assert.equal(count(`private.moderation_log where post_id='${ownFree}'`), 0);
  });
  await check(
    "a self-grant needs the mode, a reason, the admin's own verified account and at most 25",
    () => {
      fails(grantSql(second, 1, 90, REASON, second), "42501", /house_slots_identity_required/);
      fails(
        grantSql(admin, 1, 90, REASON, second),
        "42501",
        /house_slots_approver_identity_required/
      );
      fails(grantSql(second, 1, 90, REASON, admin), "42501", /house_slots_identity_required/);
      for (const reason of [null, "", "ok", "x".repeat(501)])
        fails(grantSql(admin, 1, 90, reason, admin), "22023", /house_slots_reason_required/);
      fails(grantSql(admin, 26, 90, REASON, admin), "22023", /house_slots_count_invalid/);
      assert.equal(activeSlots(admin).length, 0);
      const done = grant(admin, 3, 90, admin);
      assert.deepEqual(
        [done.account_id, done.approved_by, done.added, done.extended, done.self_granted],
        [admin.id, admin.id, 3, 0, true]
      );
      // Up to 25: twenty-two added, the three extended to the new end.
      const more = grant(admin, 25, 120, admin.email.toUpperCase());
      assert.deepEqual([more.added, more.extended, more.slots.length], [22, 3, 25]);
      fails(grantSql(admin, 26, 120, REASON, admin), "22023", /house_slots_count_invalid/);
      fails(grantSql(admin, 24, 120, REASON, admin), "22023", /already holds 25 house slots/);
      assert.equal(activeSlots(admin).length, 25);
      const recorded = events(admin);
      assert.equal(recorded.length, 28);
      assert.ok(
        recorded.every(
          (e) => e.self_granted === true && e.approved_by === admin.id && e.reason === REASON
        )
      );
      assert.equal(
        q(
          `select count(*) from private.entitlements where owner_id='${admin.id}' and granted_by='${admin.id}';`
        ),
        "25"
      );
    }
  );
  await check("the self-granted record is append-only", () => {
    const [first] = events(admin);
    fails(
      `update private.house_slot_events set self_granted=false where id='${first.id}';`,
      "23514",
      /append-only/
    );
    fails(`delete from private.house_slot_events where id='${first.id}';`, "23514", /append-only/);
    fails(
      `insert into private.house_slot_events(entitlement_id,action,ends_at,approved_by,reason,self_granted)
        values('${first.entitlement_id}','ended',now(),null,${sqlValue(REASON)},true);`,
      "23514",
      /house_slot_events_self_granted_check/
    );
  });

  let own;
  // One lease on an item, through the single-item claim.
  const claimOne = (who, id) => json(staff(who, `select api.claim_queue_item('post','${id}');`));
  // A live post's edit with a changed title, submitted for review.
  const submittedEdit = (owner, id, title) => {
    const edit = json(
      member(owner, `select api.create_post_edit('${id}',${row(id).revision});`)
    ).id;
    q(`update private.posts set title=${sqlValue(title)} where id='${edit}';`);
    assert.equal(
      json(member(owner, `select api.submit_post('${edit}',${row(edit).revision});`)).status,
      "pending_moderation"
    );
    return edit;
  };
  // An event draft (no slot funds an event), submitted for review.
  const submittedEvent = (owner) => {
    const id = q(`select vmtest.event_draft('${owner.id}');`);
    const done = json(member(owner, `select api.submit_post('${id}',${row(id).revision});`));
    assert.equal(done.status, "pending_moderation");
    assert.equal(fundedBy(id), "");
    return id;
  };

  await check(
    "their own house-slot post is listed, claimed and approved with a fresh code, logged as self-approved",
    () => {
      own = submitted(admin);
      assert.ok(activeSlots(admin).includes(fundedBy(own)));
      // In the mode every own post is listed, whatever funds it.
      const queue = listed(admin);
      for (const id of [own, ownFree, ownPaid]) assert.ok(queue.includes(id), id);
      const lease = claimOne(admin, own);
      json(
        staff(
          admin,
          `select api.staff_review_post('${own}','${lease.claim_generation}','${lease.claim_nonce}');`
        )
      );
      // An authenticator code older than 15 minutes is refused.
      fails(
        decideSql(admin, own, lease, "approve", now() - 16 * MINUTE),
        "42501",
        /recent second-factor verification required/
      );
      // Never a rejection of one's own post.
      fails(decideSql(admin, own, lease, "reject"), "42501", /self-review is not allowed/);
      assert.equal(row(own).status, "pending_moderation");
      const done = json(decideSql(admin, own, lease, "approve", now() - 14 * MINUTE));
      assert.equal(done.status, "live");
      assert.equal(row(own).status, "live");
      assert.deepEqual(decisions(own), [
        { staff_id: admin.id, decision: "approve", self_approved: true },
      ]);
      // The staff Audit log shows it as a self-approval.
      const audit = json(
        staff(
          admin,
          `select api.get_frontend_staff_audit_page('{"page":1,"action":"post_self"}'::jsonb);`
        )
      );
      assert.deepEqual(
        audit.items.map((e) => [e.action, e.actor_id, e.target_id]),
        [["post_self_approved", admin.id, own]]
      );
      // A self-approved row must be an approval.
      fails(
        `insert into private.moderation_log(post_id,staff_id,decision,post_revision,reason,self_approved)
          values('${own}','${admin.id}','reject',1,'A synthetic reason',true);`,
        "23514",
        /moderation_log_self_approved_check/
      );
    }
  );
  await check(
    "every own post is self-approvable in the mode: free first post, paid slot, event and edits",
    () => {
      const ownEvent = submittedEvent(admin);
      for (const id of [ownFree, ownPaid, ownEvent]) {
        const lease = claimOne(admin, id);
        fails(decideSql(admin, id, lease, "reject"), "42501", /self-review is not allowed/);
        assert.equal(row(id).status, "pending_moderation");
        assert.equal(json(decideSql(admin, id, lease, "approve")).status, "live", id);
        assert.deepEqual(decisions(id), [
          { staff_id: admin.id, decision: "approve", self_approved: true },
        ]);
      }
      // An edit of a live own post: on a house slot here.
      const edit = submittedEdit(admin, own, "Solo listing, edited");
      assert.ok(listed(admin).includes(edit));
      const lease = claimOne(admin, edit);
      fails(decideSql(admin, edit, lease, "reject"), "42501", /self-review is not allowed/);
      assert.equal(json(decideSql(admin, edit, lease, "approve")).status, "merged");
      assert.equal(row(own).title, "Solo listing, edited");
      assert.deepEqual(decisions(own).at(-1), {
        staff_id: admin.id,
        decision: "approve",
        self_approved: true,
      });
      assert.equal(count("private.moderation_log where self_approved"), 5);
    }
  );
  await check("another member's post is approved as before, not marked", () => {
    const other = ready(world.verified("solo-member", admin));
    const theirs = submitted(other);
    const lease = claimOne(admin, theirs);
    assert.equal(json(decideSql(admin, theirs, lease, "approve")).status, "live");
    assert.deepEqual(decisions(theirs), [
      { staff_id: admin.id, decision: "approve", self_approved: false },
    ]);
    assert.equal(count("private.moderation_log where self_approved"), 5);
  });

  // ------------------------------------- a second ID-verified staff member
  await check(
    "a second ID-verified staff member ends the mode at once for every own post, also one already claimed",
    () => {
      // Claimed in the mode: a house-slot post, an event and edits of the
      // free-first-post and paid-slot posts.
      const next = submitted(admin);
      const items = [
        next,
        submittedEvent(admin),
        submittedEdit(admin, ownFree, "Free week listing, edited"),
        submittedEdit(admin, ownPaid, "Paid slot listing, edited"),
      ];
      const leases = items.map((id) => claimOne(admin, id));
      const moderator = world.staffUser("solo-mod", "moderator");
      world.review(moderator, admin, "solo-mod");
      assert.equal(single(admin), "f");
      items.forEach((id, i) => {
        fails(decideSql(admin, id, leases[i], "approve"), "42501", /self-review is not allowed/);
        assert.equal(row(id).status, "pending_moderation", id);
        assert.ok(!listed(admin).includes(id), id);
        fails(
          staff(admin, `select api.claim_queue_item('post','${id}');`),
          "42501",
          /self-review is not allowed/
        );
        // The other reviewer sees them.
        assert.ok(listed(moderator).includes(id), id);
      });
      fails(grantSql(admin, 25, 90, REASON, admin), "42501", /house_slots_self_approval/);
      assert.equal(count("private.moderation_log where self_approved"), 5);
      // Removing that staff member's role brings the mode back.
      revokeRole(moderator);
      assert.equal(single(admin), "t");
      for (const id of items) assert.ok(listed(admin).includes(id), id);
      // A suspended second staff member is not a second reviewer either.
      const governor = world.staffUser("solo-gov", "governor");
      world.review(governor, admin, "solo-gov");
      assert.equal(single(admin), "f");
      q(`update auth.users set banned_until=now()+interval '1 day' where id='${governor.id}';`);
      assert.equal(single(admin), "t");
      revokeRole(governor);
    }
  );
  await check("the owner's own ID review ending turns the mode off", () => {
    q(`set session_replication_role=replica;
      update private.accepted_identity_facts set revoked_at=now() where owner_id='${admin.id}' and revoked_at is null;
      set session_replication_role=origin;`);
    assert.equal(single(admin), "f");
    // No review of any post, own or not, and no self-grant.
    assert.deepEqual(listed(admin), []);
    fails(grantSql(admin, 25, 90, REASON, admin), "42501", /house_slots_identity_required/);
    // A new accepted review brings it back.
    q(`set session_replication_role=replica;
      insert into private.accepted_identity_facts(owner_id,submission_id,identity_hmac,reviewed_by)
        values('${admin.id}',gen_random_uuid(),'${fingerprintOf("solo-admin-again")}','${second.id}');
      set session_replication_role=origin;`);
    assert.equal(single(admin), "t");
  });

  await check(
    "the preflight counts; the rollback refuses once a self-granted record exists",
    () => {
      assert.match(
        preflight()[0][1],
        /^one-person admin mode: already applied; ID-verified staff: 1; house slots: 25; post claims by staff without an ID review: 0; self-granted slot events: 28; self-approved decisions: 5$/
      );
      const before = fingerprint();
      assert.match(fails(kit.rollbackSql, "55000"), /self-granted or self-approved records exist/);
      // A function changed after the update is refused first.
      const live = q(`select pg_get_functiondef('${MODERATE}'::regprocedure);`);
      q(
        `do $$begin execute replace(pg_get_functiondef('${MODERATE}'::regprocedure),'AS $function$','AS $function$ '); end$$;`
      );
      assert.match(fails(kit.rollbackSql, "55000"), /is not this update's body/);
      q(`${live};`);
      assert.equal(fingerprint(), before);
    }
  );

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) applySteps(database, later);
  await check(
    "after every later update: the mode holds and a self-approval still needs a code from the last 15 minutes",
    () => {
      assert.equal(single(admin), "t");
      assert.notEqual(bodyMd5(SINGLE), "missing");
      const post = submitted(admin);
      const lease = claimOne(admin, post);
      fails(
        decideSql(admin, post, lease, "approve", now() - 16 * MINUTE),
        "42501",
        /recent second-factor verification required/
      );
      assert.equal(row(post).status, "pending_moderation");
    }
  );
});
