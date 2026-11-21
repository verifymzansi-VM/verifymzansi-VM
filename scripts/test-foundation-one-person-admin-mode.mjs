#!/usr/bin/env node
// Behaviour checks for 20261121181953_one_person_admin_mode.sql (owner's
// decision of 21 November 2026): single-administrator mode for house slots,
// logged.
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
// marked self_granted and append-only); their own pending post funded by one
// of their house slots is listed, claimed and approved (never rejected) with
// an authenticator code from the last 15 minutes, logged as self_approved and
// shown as post:self_approved in the staff Audit log, while their own post
// without a house slot stays a conflict; another member's post is approved as
// before; a second ID-verified staff member ends the mode at once, for grants,
// listing, claims and an item already claimed, and removing them brings it
// back; the rollback refuses once a self-granted or self-approved record
// exists.
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
  functionBodyMd5,
  runTwoAdminUpdateCheck,
  sqlValue,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261121181953_one_person_admin_mode.sql";
const GRANT = "internal.grant_house_slots(text,integer,integer,text,text)";
const CONFLICT = "internal.queue_conflict(uuid,uuid,uuid)";
const CLAIM = "internal.claim_queue_items(text,integer)";
const MODERATE = "internal.moderate_post(uuid,integer,text,text,text,uuid)";
const READY = "internal.assert_posting_verification_ready(uuid,boolean)";
const SINGLE = "internal.single_administrator(uuid)";
const REPLACED = [GRANT, CONFLICT, CLAIM, MODERATE, READY];
const NONE = { anon: false, authenticated: false, service_role: false };
const REASON = "Owner's own house slots for real offers";
const NOT_APPLIED =
  /^one-person admin mode: update not applied; ID-verified staff: \d+; house slots: \d+$/;
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
    end$$;`);
  const ready = (person) => {
    q(`select vmtest.terms('${person.id}');`);
    return person;
  };
  ready(admin);
  ready(admin2);

  const grantSql = (recipient, slots, days, reason, approver) =>
    `select internal.grant_house_slots(${sqlValue(recipient?.email ?? recipient)},${slots ?? "null"},${days ?? "null"},${sqlValue(reason)},${sqlValue(approver?.email ?? approver)});`;
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
    assert.match(rows[0][1], /; ID-verified staff: 2; house slots: 0$/);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and drifted bodies are refused", () => {
    assertDriftRefused(kit, { label: "one-person admin mode", signatures: REPLACED, rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "one-person admin mode",
    applied:
      /^one-person admin mode: already applied; ID-verified staff: 2; house slots: 0; self-granted slot events: 0; self-approved decisions: 0$/,
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
  let second, ownFree;
  await check("one ID-verified staff member: the mode is on for that admin only", () => {
    revokeRole(admin2); // ends admin2's house slots (their role is gone)
    assert.equal(activeSlots(admin2).length, 0);
    second = ready(world.staffUser("solo-second", "admin"));
    assert.deepEqual([single(admin), single(second), single(admin2)], ["t", "f", "f"]);
    // Their own post funded by the free first post (no house slot yet).
    ownFree = submitted(admin);
    assert.equal(fundedBy(ownFree), "");
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
  await check(
    "their own house-slot post is listed, claimed and approved with a fresh code, logged as self-approved",
    () => {
      own = submitted(admin);
      assert.ok(activeSlots(admin).includes(fundedBy(own)));
      // Listed and claimed; the post without a house slot is not.
      const queue = listed(admin);
      assert.ok(queue.includes(own));
      assert.ok(!queue.includes(ownFree));
      const leases = claimed(admin);
      assert.deepEqual(
        leases.map((l) => l.id),
        [own]
      );
      const [lease] = leases;
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
  await check("an edit of their own live house-slot post is self-approved too", () => {
    const edit = json(
      member(admin, `select api.create_post_edit('${own}',${row(own).revision});`)
    ).id;
    q(`update private.posts set title='Solo listing, edited' where id='${edit}';`);
    assert.equal(
      json(member(admin, `select api.submit_post('${edit}',${row(edit).revision});`)).status,
      "pending_moderation"
    );
    assert.ok(listed(admin).includes(edit));
    const [lease] = claimed(admin);
    assert.equal(lease.id, edit);
    assert.equal(json(decideSql(admin, edit, lease, "approve")).status, "merged");
    assert.equal(row(own).title, "Solo listing, edited");
    assert.deepEqual(decisions(own).at(-1), {
      staff_id: admin.id,
      decision: "approve",
      self_approved: true,
    });
  });
  await check(
    "their own post without a house slot stays a conflict; others' posts are as before",
    () => {
      fails(
        staff(admin, `select api.claim_queue_item('post','${ownFree}');`),
        "42501",
        /self-review is not allowed/
      );
      fails(
        staff(admin, `select api.staff_review_post('${ownFree}','1','${admin.session}');`),
        "42501",
        /self-review is not allowed/
      );
      const other = ready(world.verified("solo-member", admin));
      const theirs = submitted(other);
      const [lease] = claimed(admin);
      assert.equal(lease.id, theirs);
      assert.equal(json(decideSql(admin, theirs, lease, "approve")).status, "live");
      assert.deepEqual(decisions(theirs), [
        { staff_id: admin.id, decision: "approve", self_approved: false },
      ]);
      // The self-approval is never applied to another member's post.
      assert.equal(count("private.moderation_log where self_approved"), 2);
    }
  );

  // ------------------------------------- a second ID-verified staff member
  await check(
    "a second ID-verified staff member ends the mode at once, also for an item already claimed",
    () => {
      const next = submitted(admin);
      const [lease] = claimed(admin);
      assert.equal(lease.id, next);
      const moderator = world.staffUser("solo-mod", "moderator");
      world.review(moderator, admin, "solo-mod");
      assert.equal(single(admin), "f");
      fails(decideSql(admin, next, lease, "approve"), "42501", /self-review is not allowed/);
      assert.equal(row(next).status, "pending_moderation");
      assert.ok(!listed(admin).includes(next));
      fails(
        staff(admin, `select api.claim_queue_item('post','${next}');`),
        "42501",
        /self-review is not allowed/
      );
      fails(grantSql(admin, 25, 90, REASON, admin), "42501", /house_slots_self_approval/);
      // The other reviewer sees it.
      assert.ok(listed(moderator).includes(next));
      // Removing that staff member's role brings the mode back.
      revokeRole(moderator);
      assert.equal(single(admin), "t");
      assert.ok(listed(admin).includes(next));
      // A suspended second staff member is not a second reviewer either.
      const governor = world.staffUser("solo-gov", "governor");
      world.review(governor, admin, "solo-gov");
      assert.equal(single(admin), "f");
      q(`update auth.users set banned_until=now()+interval '1 day' where id='${governor.id}';`);
      assert.equal(single(admin), "t");
      revokeRole(governor);
    }
  );

  await check(
    "the preflight counts; the rollback refuses once a self-granted record exists",
    () => {
      assert.match(
        preflight()[0][1],
        /^one-person admin mode: already applied; ID-verified staff: 1; house slots: 25; self-granted slot events: 28; self-approved decisions: 2$/
      );
      const before = fingerprint();
      assert.match(fails(kit.rollbackSql, "55000"), /self-granted or self-approved records exist/);
      assert.equal(fingerprint(), before);
    }
  );

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep single-administrator mode", () => {
      assert.equal(single(admin), "t");
      assert.notEqual(bodyMd5(SINGLE), "missing");
    });
  }
});
