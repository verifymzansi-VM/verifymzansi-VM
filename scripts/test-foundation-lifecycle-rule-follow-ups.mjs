#!/usr/bin/env node
// Behaviour checks for 20261125225855_lifecycle_rule_follow_ups.sql (launch
// checklist item 56, batch D): the follow-ups to the small lifecycle rules of
// 20261125150215 (item 40).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks. Members call the
// production commands with synthetic sessions; the minute job runs
// api.run_slot_renewals and the email job claims through
// api.claim_supported_notification_outbox, both as `service_role`. Stickers,
// reports and full ID reviews are written as their flows write them (as the
// database owner); time is moved by shifting timestamps. No email is sent.
//
// It checks the read-only preflight, a drifted body and a premature rollback;
// shows that before the update a staff duplicate flag and a report past the
// clean-up's waiting time both stopped the owner's deletion and that an owner
// without a full ID review got a sticker reminder; applies the update and
// proves apply -> rollback -> apply; then: the owner's deletion waits for an
// open public report only while internal.post_report_deferred holds (60 + 7
// days after the last change, or 7 days after a deletion date), never for a
// staff duplicate flag (the scheduled clean-up still waits for it); a sticker
// reminder needs a full ID review, when queued and again before it is sent;
// a CIPC sticker gets none while a linked profile (cipc_link) is waiting or
// newer, but does after a rejected renewal; the reminder's key and its queue
// use the same 30 days; an event's edit copy keeps a stored start and is held
// to the 12-month limit when its start moves; who may run the commands is
// unchanged. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-lifecycle-rule-follow-ups.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertReadOnlyPreflight, executeGrants } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125225855_lifecycle_rule_follow_ups.sql";
const DELETE = "internal.delete_post(uuid,integer)";
const KEY = "internal.sticker_renewal_reminder_key(uuid,uuid)";
const QUEUE = "internal.queue_sticker_renewal_reminders(integer)";
const REVIEWED = {
  [DELETE]: "ba5e05f4803ab918135a4aa6dbf05ba1",
  [KEY]: "f0296fa207968b44d2249cbe31f02f1c",
};
const UPDATED = {
  [DELETE]: "eb15dab657d7512cc0f4d5f8036fa6db",
  [KEY]: "122a9d4ca00a7b25bf47909b88d43901",
};
const LABEL = "lifecycle rule follow-ups";
const summary = (state) =>
  new RegExp(
    `^lifecycle rule follow-ups: ${state}; posts with an open report: \\d+ \\(of which the owner may delete after the update: \\d+\\); reminders waiting: \\d+ \\(of which the owner's ID is not reviewed: \\d+\\)$`
  );
const NOT_APPLIED = summary("update not applied");
const ALREADY_APPLIED = summary("already applied");
const DAY_MS = 86_400_000;

await runTwoAdminUpdateCheck(
  { update: UPDATE, label: "lrf", title: "Lifecycle rule follow-ups" },
  async ({ database, check, kit, world, admin }) => {
    const { q, json, fails, member, service, steps, index, preflight } = kit;
    const replica = (sql) =>
      q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
    const bodies = (expected) => {
      for (const [signature, md5] of Object.entries(expected))
        assert.equal(functionBodyMd5(kit, signature), md5, signature);
    };
    /** A member with a full accepted ID review (what renewing a sticker needs). */
    const reviewed = (label) => world.reviewedId(label, admin);
    /** A member whose accepted fact has no reviewed ID photo and selfie behind it. */
    const factOnly = (label) => world.verified(label, admin);

    // ------------------------------------------------------------ stickers
    /** An approved sticker check of `kind` on `business`, ending `days` from now; its id. */
    const sticker = (owner, business, kind, days) => {
      const id = randomUUID();
      replica(`insert into private.evidence_cases(id,subject_id,kind,status) values('${id}','${owner.id}','business','decided');
        insert into private.frontend_business_checks(id,business_id,owner_id,kind,status,seen_method,available_slots,
          screenshots_consent_at,decided_at,expires_at)
        values('${id}','${business}','${owner.id}','${kind}','approved',
          ${kind === "seen" ? "'video',array['Monday morning'],now()" : "null,null,null"},
          now()-interval '335 days',now()+make_interval(secs=>${days}*86400));`);
      return id;
    };
    /** A later check of `kind` on `business` with `status` (decided now unless pending). */
    const laterCheck = (owner, business, kind, status) => {
      const id = randomUUID();
      const open = status === "pending" || status === "info_requested";
      replica(`insert into private.evidence_cases(id,subject_id,kind,status) values('${id}','${owner.id}','business',
          '${open ? "open" : "decided"}');
        insert into private.frontend_business_checks(id,business_id,owner_id,kind,status,decided_at,expires_at)
        values('${id}','${business}','${owner.id}','${kind}','${status}',${open ? "null" : "now()"},
          ${status === "approved" ? "now()+interval '365 days'" : "null"});`);
      return id;
    };
    const businessOf = (owner) => world.post(owner, "business", "business");
    const sweep = () => json(service("select api.run_slot_renewals(100);"));
    const reminders = (id) =>
      json(`select coalesce(jsonb_agg(dedupe_key order by created_at, id),'[]') from private.outbox_events
        where kind='sticker_renewal_reminder' and subject_id='${id}';`);
    const keyOf = (id) =>
      `sticker_renewal_reminder:${id}:${q(
        `select floor(extract(epoch from expires_at))::bigint from private.frontend_business_checks where id='${id}';`
      )}`;
    const claimAll = () =>
      json(
        service(
          "select api.claim_supported_notification_outbox(array['sticker_renewal_reminder'],50);"
        )
      );
    const claimFor = (id) => {
      const jobs = claimAll();
      const job = jobs.find((j) => j.subject_id === id);
      assert.ok(job, JSON.stringify(jobs));
      return job;
    };
    const complete = (job, error = null) =>
      q(
        service(
          `select api.complete_notification_outbox('${job.id}','${job.claim_token}',true,${
            error ? `'${error}'` : "null"
          });`
        )
      );

    // ------------------------------------------------------------ reports
    /** An open public report about `post`, as the report flow writes it; its id. */
    const report = (owner, post) =>
      q(`insert into private.reports(post_id,subject_account_id,category,severity,description,
          reporter_ip_hmac,frontend_reason)
        values('${post}','${owner.id}','scam','standard','A synthetic report description.',
          '${"B".repeat(42)}${(Math.random() * 10) | 0}','fake_listing') returning id;`);
    /** An open staff duplicate flag on the pair (x, y), as flag_duplicate_events
     * writes it: about the pair's first post (firstOf). */
    const staffFlag = (x, y, staffMember) =>
      replica(`insert into private.reports(post_id,subject_account_id,category,description,reporter_id,reporter_ip_hmac,
          report_origin,duplicate_post_a,duplicate_post_b,duplicate_revision_a,duplicate_revision_b,
          duplicate_owner_b,duplicate_created_by)
        select a.id,a.owner_id,'duplicate_event','Synthetic duplicate flag.','${staffMember.id}',null,'staff',
          a.id,b.id,a.revision,b.revision,b.owner_id,'${staffMember.id}'
        from private.posts a, private.posts b
        where a.id=least('${x}'::uuid,'${y}'::uuid) and b.id=greatest('${x}'::uuid,'${y}'::uuid);`);
    const firstOf = (x, y) => q(`select least('${x}'::uuid,'${y}'::uuid);`);
    const deferred = (post) =>
      q(`select internal.post_report_deferred(p) from private.posts p where p.id='${post}';`) ===
      "t";
    /** Moves the post's last change `days` back (no deletion date). */
    const lastChanged = (post, days) =>
      replica(`update private.posts set content_updated_at=now()-make_interval(secs=>${days}*86400),
          status_changed_at=now()-make_interval(secs=>${days}*86400) where id='${post}';`);
    const exists = (id) => q(`select count(*) from private.posts where id='${id}';`) === "1";
    const revision = (id) => q(`select revision from private.posts where id='${id}';`);
    const deleteSql = (owner, id) =>
      member(owner, `select api.delete_post('${id}',${revision(id)});`);
    const actionDeleteSql = (owner, id) =>
      member(
        owner,
        `select api.execute_my_frontend_post_action('${randomUUID()}','${id}',${revision(id)},'delete','listing','market');`
      );
    const refusedDelete = (owner, id) => {
      fails(deleteSql(owner, id), "PT409", /DETAIL:\s+post_report_open/);
      assert.equal(exists(id), true);
    };

    // ------------------------------------------------------------ events
    const at = (days) =>
      new Date(Math.floor((Date.now() + days * DAY_MS) / 1000) * 1000).toISOString();
    const window = (startDays, lengthDays = 1) => ({
      starts_at: at(startDays),
      ends_at: at(startDays + lengthDays),
      timezone: "Africa/Johannesburg",
    });
    const activity = q(
      "select coalesce((select a.key from private.category_activities a join private.categories c on c.key=a.category_key where a.category_key='events' and c.activity_required order by a.key limit 1),'')"
    );
    const createEvent = (person, w) =>
      json(
        member(
          person,
          `select api.create_core_draft('event','tourism_events','events','${JSON.stringify(w)}'::jsonb,${
            activity ? `'${activity}'` : "null"
          });`
        )
      ).id;
    const moveSql = (person, id, w) =>
      member(
        person,
        `select api.save_business_event_context('${id}',${revision(id)},'${JSON.stringify({ event_window: w })}'::jsonb);`
      );
    const startOf = (id) =>
      Date.parse(
        json(`select to_jsonb(starts_at) from private.event_details where post_id='${id}';`)
      );

    // ------------------------------------------------------------ before
    const thabo = reviewed("lrf-thabo");
    const neighbour = reviewed("lrf-neighbour");
    const flaggedPair = [
      world.post(thabo, "listing", "market"),
      world.post(neighbour, "listing", "market"),
    ];
    const agedPost = world.post(thabo, "listing", "market");
    const unreviewed = factOnly("lrf-unreviewed");
    const unreviewedSticker = sticker(unreviewed, businessOf(unreviewed), "cipc", 20);
    let flagged;
    await check(
      "before the update: the reviewed bodies, and the preflight reads not applied",
      () => {
        bodies(REVIEWED);
        const rows = preflight();
        assert.deepEqual(
          rows.map((r) => r[0]),
          ["summary"],
          JSON.stringify(rows)
        );
        assert.match(rows[0][1], NOT_APPLIED);
        assertReadOnlyPreflight(database, kit.preflightSql);
      }
    );
    await check("before the update: any open report stops deletion for good", () => {
      // A staff duplicate flag on a pair stops the owner of its first post.
      staffFlag(...flaggedPair, admin);
      flagged = firstOf(...flaggedPair);
      const owner = flagged === flaggedPair[0] ? thabo : neighbour;
      refusedDelete(owner, flagged);
      // A public report stops it after the clean-up would have stopped waiting.
      report(thabo, agedPost);
      lastChanged(agedPost, 68);
      assert.equal(deferred(agedPost), false);
      refusedDelete(thabo, agedPost);
      assert.match(
        preflight()[0][1],
        /posts with an open report: 2 \(of which the owner may delete after the update: 2\)/
      );
    });
    await check("before the update: an owner without a full ID review gets a reminder", () => {
      assert.equal(sweep().sticker_renewal_reminders, 1);
      assert.deepEqual(reminders(unreviewedSticker), [keyOf(unreviewedSticker)]);
      assert.match(
        preflight()[0][1],
        /reminders waiting: 1 \(of which the owner's ID is not reviewed: 1\)$/
      );
    });
    await check("a premature rollback and a drifted body are refused", () => {
      assertDriftRefused(kit, { label: LABEL, signatures: [DELETE, KEY], rows: 2 });
      assert.match(preflight()[0][1], NOT_APPLIED);
    });
    const grants = executeGrants(json, [DELETE, KEY, QUEUE]);

    // ------------------------------------------------------------ apply
    await applyAndProveRollback(kit, database, check, {
      label: LABEL,
      applied: ALREADY_APPLIED,
      notApplied: NOT_APPLIED,
    });
    await check("after the update: the bodies are the update's", () => bodies(UPDATED));

    // ------------------------------------------------------------ rule 1
    await check("a staff duplicate flag does not stop the owner's deletion", () => {
      // The clean-up still waits for it.
      assert.equal(deferred(flagged), true);
      const owner = flagged === flaggedPair[0] ? thabo : neighbour;
      q(deleteSql(owner, flagged));
      assert.equal(exists(flagged), false);
      // A new flag, through the other delete command.
      const a = world.post(thabo, "listing", "market");
      const b = world.post(neighbour, "listing", "market");
      staffFlag(a, b, admin);
      const first = firstOf(a, b);
      q(actionDeleteSql(first === a ? thabo : neighbour, first));
      assert.equal(exists(first), false);
    });
    await check("a public report holds deletion only while the clean-up would wait", () => {
      // Past the waiting time (68 days since the last change): deleted.
      q(deleteSql(thabo, agedPost));
      assert.equal(exists(agedPost), false);
      // A fresh report on a fresh post: refused, through both commands.
      const post = world.post(thabo, "listing", "market");
      report(thabo, post);
      for (const sql of [deleteSql(thabo, post), actionDeleteSql(thabo, post)]) {
        const refusal = fails(sql, "PT409");
        assert.match(
          refusal,
          /a reported post cannot be deleted until staff have looked at the report/
        );
        assert.match(refusal, /DETAIL:\s+post_report_open/);
      }
      // 66 days after the last change it still waits; 68 days, it does not.
      lastChanged(post, 66);
      refusedDelete(thabo, post);
      // With a deletion date, until 7 days after it.
      replica(`update private.posts set deletes_at=now()-interval '6 days' where id='${post}';`);
      refusedDelete(thabo, post);
      replica(`update private.posts set deletes_at=now()-interval '8 days' where id='${post}';`);
      assert.equal(deferred(post), false);
      q(deleteSql(thabo, post));
      assert.equal(exists(post), false);
      // A public report and a staff flag together: the report decides.
      const c = world.post(thabo, "listing", "market");
      const d = world.post(neighbour, "listing", "market");
      staffFlag(c, d, admin);
      const first = firstOf(c, d);
      const owner = first === c ? thabo : neighbour;
      report(owner, first);
      refusedDelete(owner, first);
      lastChanged(first, 68);
      q(deleteSql(owner, first));
      assert.equal(exists(first), false);
    });

    // ------------------------------------------------------------ rule 2
    await check("a queued reminder is not sent while the owner's ID is not reviewed", () => {
      const job = claimFor(unreviewedSticker);
      assert.equal(job.recipient, null);
      assert.equal(complete(job, "skipped"), "t");
      // And no new one is queued for it.
      assert.equal(sweep().sticker_renewal_reminders, 0);
    });
    await check(
      "a sticker reminder needs a full ID review, when queued and before it is sent",
      () => {
        const none = factOnly("lrf-fact-only");
        const noneSticker = sticker(none, businessOf(none), "seen", 20);
        const lindiwe = reviewed("lrf-lindiwe");
        const lindiweSticker = sticker(lindiwe, businessOf(lindiwe), "cipc", 20);
        assert.equal(sweep().sticker_renewal_reminders, 1);
        assert.deepEqual(reminders(noneSticker), []);
        assert.deepEqual(reminders(lindiweSticker), [keyOf(lindiweSticker)]);
        const job = claimFor(lindiweSticker);
        assert.equal(job.recipient, lindiwe.email);
        assert.equal(complete(job), "t");
        // The review ends after the reminder was queued: it is skipped.
        const sizwe = reviewed("lrf-sizwe");
        const sizweSticker = sticker(sizwe, businessOf(sizwe), "seen", 20);
        assert.equal(sweep().sticker_renewal_reminders, 1);
        replica(
          `update private.accepted_identity_facts set revoked_at=now() where owner_id='${sizwe.id}';`
        );
        const skipped = claimFor(sizweSticker);
        assert.equal(skipped.recipient, null);
        assert.equal(complete(skipped, "skipped"), "t");
      }
    );
    await check("a linked profile stops a CIPC reminder; a rejected renewal does not", () => {
      // A linked profile (cipc_link) waiting for review stops the CIPC
      // reminder, not the Seen one.
      const ayo = reviewed("lrf-ayo");
      const ayoBusiness = businessOf(ayo);
      const ayoCipc = sticker(ayo, ayoBusiness, "cipc", 20);
      const ayoSeen = sticker(ayo, ayoBusiness, "seen", 20);
      laterCheck(ayo, ayoBusiness, "cipc_link", "pending");
      // A linked profile approved after the sticker.
      const kea = reviewed("lrf-kea");
      const keaBusiness = businessOf(kea);
      const keaCipc = sticker(kea, keaBusiness, "cipc", 20);
      laterCheck(kea, keaBusiness, "cipc_link", "approved");
      // A rejected renewal leaves the sticker current: still reminded.
      const nandi = reviewed("lrf-nandi");
      const nandiBusiness = businessOf(nandi);
      const nandiCipc = sticker(nandi, nandiBusiness, "cipc", 20);
      laterCheck(nandi, nandiBusiness, "cipc", "rejected");
      assert.equal(sweep().sticker_renewal_reminders, 2);
      assert.deepEqual(reminders(ayoCipc), []);
      assert.deepEqual(reminders(keaCipc), []);
      assert.deepEqual(reminders(ayoSeen), [keyOf(ayoSeen)]);
      assert.deepEqual(reminders(nandiCipc), [keyOf(nandiCipc)]);
      // One email job run claims both.
      const jobs = claimAll();
      for (const id of [ayoSeen, nandiCipc]) {
        const job = jobs.find((j) => j.subject_id === id);
        assert.ok(job, JSON.stringify(jobs));
        assert.equal(complete(job), "t");
      }
    });
    await check("the reminder's key and its queue use the same 30 days", () => {
      const intervals = (signature) =>
        q(`select prosrc from pg_proc where oid='${signature}'::regprocedure;`).match(
          /interval '\d+ days?'/g
        );
      assert.deepEqual(intervals(KEY), ["interval '30 days'"]);
      assert.deepEqual(intervals(QUEUE), ["interval '30 days'"]);
      // At the boundary both agree: just over 30 days, none; just under, one.
      const pule = reviewed("lrf-pule");
      const puleSticker = sticker(pule, businessOf(pule), "cipc", 30 + 1 / 1440);
      assert.equal(sweep().sticker_renewal_reminders, 0);
      replica(`update private.frontend_business_checks set expires_at=now()+interval '30 days'-interval '1 minute'
        where id='${puleSticker}';`);
      assert.equal(sweep().sticker_renewal_reminders, 1);
      complete(claimFor(puleSticker));
    });

    // ------------------------------------------------------------ events
    await check("an event's edit copy keeps its start and is held to 12 months", () => {
      const owner = reviewed("lrf-events");
      const id = createEvent(owner, window(300));
      const start = startOf(id);
      replica(`update private.posts set status='live',published_at=now(),status_changed_at=now(),
          visible_until=(select ends_at from private.event_details where post_id='${id}') where id='${id}';`);
      const edit = json(member(owner, `select api.create_post_edit('${id}',${revision(id)});`)).id;
      assert.equal(startOf(edit), start, "the edit copy keeps the stored start");
      fails(moveSql(owner, edit, window(366)), "22023", /event_too_far_ahead/);
      assert.equal(startOf(edit), start);
      const later = window(360);
      q(moveSql(owner, edit, later));
      assert.equal(startOf(edit), Date.parse(later.starts_at));
      // A copy of a start already stored too far ahead (only a direct write
      // could store one) is refused like any new start.
      q(`delete from private.posts where id='${edit}';`);
      replica(`update private.event_details set starts_at=date_trunc('second',now())+interval '400 days',
          ends_at=date_trunc('second',now())+interval '401 days'
          where post_id='${id}';`);
      fails(
        member(owner, `select api.create_post_edit('${id}',${revision(id)});`),
        "22023",
        /event_too_far_ahead/
      );
    });

    await check("who may run them is unchanged", () => {
      assert.deepEqual(executeGrants(json, [DELETE, KEY, QUEUE]), grants);
      assert.deepEqual(grants[DELETE], { anon: false, authenticated: true, service_role: false });
      assert.deepEqual(grants[KEY], { anon: false, authenticated: false, service_role: false });
    });

    const later = steps.slice(index + 1);
    if (later.length) {
      applySteps(database, later);
      await check("later updates keep both rules", () => {
        const owner = reviewed("lrf-later");
        const post = world.post(owner, "listing", "market");
        report(owner, post);
        refusedDelete(owner, post);
        const none = factOnly("lrf-later-fact-only");
        const noneSticker = sticker(none, businessOf(none), "cipc", 10);
        sweep();
        assert.deepEqual(reminders(noneSticker), []);
      });
    }
  }
);
