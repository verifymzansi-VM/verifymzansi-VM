#!/usr/bin/env node
// Behaviour checks for 20261125150215_small_lifecycle_rules.sql (launch
// checklist item 40): free events start at most 12 months ahead, one email 30
// days before a CIPC or Seen sticker ends, and a reported post cannot be
// deleted by its owner until staff have looked at the report.
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members call the production commands with synthetic sessions; the
// minute job runs api.run_slot_renewals and the email job claims through
// api.claim_supported_notification_outbox, both as `service_role`. Stickers
// and reports are written as their flows write them (as the database owner);
// time is moved by shifting a sticker's end. No email is sent.
//
// It checks the read-only preflight and the update's refusals (including an
// event already stored more than 365 days ahead), applies the update, proves
// apply -> rollback -> apply returns the same fingerprints, then: an event
// can be created or moved to start at most 365 days ahead, and an unchanged
// start is not checked again; a sticker gets one reminder once its end is 30
// days away (not before), never twice; the email job gets the address, the
// sticker's kind, its end and its business; a renewal waiting for review, a
// newer decision, a linked sticker, an archived business and a banned owner
// get none (before or after it was queued); a renewed sticker gets its own
// reminder; the owner cannot delete a post while a report on it is open
// (through either delete command), and can once staff have closed it; the
// claim takes 27 kinds; who may run the commands is unchanged. Any later
// updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-small-lifecycle-rules.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertClaimKinds,
  assertNoticeGrants,
  checkNoticeUpdate,
  CLAIM,
  RUN,
} from "./lib/foundation-outbox-notice-checks.mjs";
import { executeGrants } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import { runTwoAdminUpdateCheck } from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125150215_small_lifecycle_rules.sql";
const DELETE = "internal.delete_post(uuid,integer)";
const KEY = "internal.sticker_renewal_reminder_key(uuid,uuid)";
const QUEUE = "internal.queue_sticker_renewal_reminders(integer)";
const GUARD = "internal.event_start_within_a_year()";
const REVIEWED = {
  [CLAIM]: "368f515805291682c74f28b163c50687",
  [RUN]: "2dc453b1de85fbdb169b983c42109c5f",
  [DELETE]: "2aa04c741c9dee2e414be6ae1f03f73d",
  [KEY]: "missing",
  [QUEUE]: "missing",
  [GUARD]: "missing",
};
const UPDATED = {
  [CLAIM]: "407d5c969a5cf466602555fedb7b23df",
  [RUN]: "72556cba7602b4191dd1e2ee5811915f",
  [DELETE]: "ba5e05f4803ab918135a4aa6dbf05ba1",
  [KEY]: "f0296fa207968b44d2249cbe31f02f1c",
  [QUEUE]: "79ac584983c94b27efed334fe332ef1b",
  [GUARD]: "5e66f9025f39b986c066ee4de6ae464e",
};
const LABEL = "small lifecycle rules";
// Literal patterns for the preflight summary (one sticker ending within 30
// days, nothing else yet).
const NOT_APPLIED =
  /^small lifecycle rules: update not applied; events starting over 365 days ahead: 0; stickers ending within 30 days: 1; posts with an open report: 0; reminders queued: 0$/;
const ALREADY_APPLIED =
  /^small lifecycle rules: already applied; events starting over 365 days ahead: 0; stickers ending within 30 days: 1; posts with an open report: 0; reminders queued: 0$/;
const DAY_MS = 86_400_000;

await runTwoAdminUpdateCheck(
  { update: UPDATE, label: "life", title: "Small lifecycle rules" },
  async ({ database, check, kit, world, admin }) => {
    const { q, json, fails, member, service, steps, index, preflight } = kit;
    const replica = (sql) =>
      q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
    const verified = (label) => world.verified(label, admin);

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
    const endsIn = (id, days) =>
      replica(`update private.frontend_business_checks set expires_at=now()+make_interval(secs=>${days}*86400)
        where id='${id}';`);
    /** A business owner with a business post. */
    const businessOwner = (label) => {
      const owner = verified(label);
      return { owner, business: world.post(owner, "business", "business") };
    };
    const sweep = () => json(service("select api.run_slot_renewals(100);"));
    const reminders = (id) =>
      json(`select coalesce(jsonb_agg(dedupe_key order by created_at, id),'[]') from private.outbox_events
        where kind='sticker_renewal_reminder' and subject_id='${id}';`);
    const claim = () =>
      json(
        service(
          "select api.claim_supported_notification_outbox(array['sticker_renewal_reminder'],50);"
        )
      );
    const claimFor = (id) => {
      const jobs = claim();
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
    const keyOf = (id) =>
      `sticker_renewal_reminder:${id}:${q(
        `select floor(extract(epoch from expires_at))::bigint from private.frontend_business_checks where id='${id}';`
      )}`;
    const endOf = (id) =>
      json(`select to_jsonb(expires_at) from private.frontend_business_checks where id='${id}';`);

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
    const createEventSql = (person, w) =>
      member(
        person,
        `select api.create_core_draft('event','tourism_events','events','${JSON.stringify(w)}'::jsonb,${
          activity ? `'${activity}'` : "null"
        });`
      );
    const revision = (id) => q(`select revision from private.posts where id='${id}';`);
    const moveSql = (person, id, w) =>
      member(
        person,
        `select api.save_business_event_context('${id}',${revision(id)},'${JSON.stringify({ event_window: w })}'::jsonb);`
      );
    const startOf = (id) =>
      Date.parse(
        json(`select to_jsonb(starts_at) from private.event_details where post_id='${id}';`)
      );

    // ------------------------------------------------------------ reports
    /** An open public report about `post`, as the report flow writes it; its id. */
    const report = (owner, post) =>
      q(`insert into private.reports(post_id,subject_account_id,category,severity,description,
          reporter_ip_hmac,frontend_reason)
        values('${post}','${owner.id}','scam','standard','A synthetic report description.',
          '${"B".repeat(42)}${(Math.random() * 10) | 0}','fake_listing') returning id;`);
    const closeReport = (id, staffMember) =>
      q(`update private.reports set status='dismissed',resolved_at=now(),resolved_by='${staffMember.id}',
          resolution_note='Synthetic review: nothing wrong.' where id='${id}';`);
    const exists = (id) => q(`select count(*) from private.posts where id='${id}';`) === "1";
    const deleteSql = (owner, id) =>
      member(owner, `select api.delete_post('${id}',${revision(id)});`);
    const actionDeleteSql = (owner, id) =>
      member(
        owner,
        `select api.execute_my_frontend_post_action('${randomUUID()}','${id}',${revision(id)},'delete','listing','market');`
      );

    // ------------------------------------------------------------ before
    const early = businessOwner("life-early");
    const earlySticker = sticker(early.owner, early.business, "cipc", 20);
    const grants = await checkNoticeUpdate(
      { kit, database, check },
      {
        label: LABEL,
        reviewed: REVIEWED,
        updated: UPDATED,
        notApplied: NOT_APPLIED,
        applied: ALREADY_APPLIED,
        drift: [CLAIM, RUN, DELETE],
        before: () => {
          // The minute job queues no such reminder yet.
          assert.equal(sweep().sticker_renewal_reminders, undefined);
          // A start two years ahead is still accepted, and an open report
          // does not stop deletion yet.
          const far = verified("life-before-far");
          const event = json(createEventSql(far, window(730))).id;
          q(`delete from private.posts where id='${event}';`);
          const owner = verified("life-before-report");
          const post = world.post(owner, "listing", "market");
          const id = report(owner, post);
          q(deleteSql(owner, post));
          assert.equal(exists(post), false);
          q(`delete from private.outbox_events where subject_id='${id}';
            delete from private.reports where id='${id}';`);
        },
      }
    );

    // ------------------------------------------------------------ rule 1
    await check("an event already stored over 365 days ahead stops the update", () => {
      const owner = verified("life-stored-far");
      const id = json(createEventSql(owner, window(30))).id;
      replica(`update private.event_details set starts_at=date_trunc('second',now())+interval '400 days',
        ends_at=date_trunc('second',now())+interval '401 days' where post_id='${id}';`);
      const rows = preflight();
      assert.equal(rows.length, 2, JSON.stringify(rows));
      assert.match(rows[0][1], /events starting over 365 days ahead: 1;/);
      assert.match(rows[1][1], /^1 events start more than 365 days ahead/);
      assert.match(
        fails(kit.step.sql, "55000"),
        /small lifecycle rules precondition: 1 events start more than 365 days ahead/
      );
      // An unchanged start is not checked again.
      q(`update private.event_details set starts_at=starts_at where post_id='${id}';`);
      q(`delete from private.posts where id='${id}';`);
      assert.match(preflight()[0][1], ALREADY_APPLIED);
    });
    await check("free events: a start at most 365 days ahead, when created or moved", () => {
      const owner = verified("life-events");
      const tooFar = fails(createEventSql(owner, window(366)), "22023");
      assert.match(tooFar, /events can start at most 12 months ahead/);
      assert.match(tooFar, /DETAIL:\s+event_too_far_ahead/);
      const id = json(createEventSql(owner, window(364))).id;
      const start = startOf(id);
      const moved = fails(moveSql(owner, id, window(365.5)), "22023");
      assert.match(moved, /DETAIL:\s+event_too_far_ahead/);
      assert.equal(startOf(id), start, "the refused move changed nothing");
      const nearer = window(200, 90);
      q(moveSql(owner, id, nearer));
      assert.equal(startOf(id), Date.parse(nearer.starts_at));
      // Written directly too (any command, any role): the rule is on the table.
      assert.match(
        fails(
          `update private.event_details set starts_at=now()+interval '366 days',
            ends_at=now()+interval '367 days' where post_id='${id}';`,
          "22023"
        ),
        /event_too_far_ahead/
      );
    });

    // ------------------------------------------------------------ rule 2
    const thandi = businessOwner("life-thandi");
    const thandiCipc = sticker(thandi.owner, thandi.business, "cipc", 60);
    const thandiSeen = sticker(thandi.owner, thandi.business, "seen", 60);
    await check("once per sticker: one reminder once its end is 30 days away", () => {
      // Only the sticker from before the update is due.
      assert.equal(sweep().sticker_renewal_reminders, 1);
      assert.deepEqual(reminders(earlySticker), [keyOf(earlySticker)]);
      assert.deepEqual(reminders(thandiCipc), []);
      endsIn(thandiCipc, 30 + 1 / 1440);
      assert.equal(sweep().sticker_renewal_reminders, 0);
      endsIn(thandiCipc, 30 - 1 / 1440);
      endsIn(thandiSeen, 29);
      assert.equal(sweep().sticker_renewal_reminders, 2);
      assert.deepEqual(reminders(thandiCipc), [keyOf(thandiCipc)]);
      assert.deepEqual(reminders(thandiSeen), [keyOf(thandiSeen)]);
      // The job runs every minute: never a second reminder.
      for (let run = 0; run < 3; run++) assert.equal(sweep().sticker_renewal_reminders, 0);
      assert.deepEqual(reminders(thandiCipc), [keyOf(thandiCipc)]);
    });
    await check("the email job gets the address, the sticker, its end and its business", () => {
      const jobs = claim();
      for (const [id, kind] of [
        [thandiCipc, "cipc"],
        [thandiSeen, "seen"],
      ]) {
        const job = jobs.find((j) => j.subject_id === id);
        assert.ok(job, JSON.stringify(jobs));
        assert.equal(job.kind, "sticker_renewal_reminder");
        assert.equal(job.owner_id, thandi.owner.id);
        assert.equal(job.recipient, thandi.owner.email);
        assert.equal(job.sticker_kind, kind);
        assert.equal(job.sticker_expires_at, endOf(id));
        assert.equal(job.sticker_business_id, thandi.business);
        assert.equal(job.post_id, null);
        assert.equal(job.post_title, null);
        assert.equal(complete(job), "t");
      }
      const other = jobs.find((j) => j.subject_id === earlySticker);
      assert.ok(other, JSON.stringify(jobs));
      assert.equal(other.recipient, early.owner.email);
      complete(other);
      assert.deepEqual(claim(), []);
      assert.equal(sweep().sticker_renewal_reminders, 0);
    });
    await check("a renewed sticker gets its own reminder 30 days before its new end", () => {
      const first = keyOf(thandiCipc);
      // Renewed: a newer approval ending in a year; the old one is no longer current.
      const renewed = sticker(thandi.owner, thandi.business, "cipc", 365);
      replica(
        `update private.frontend_business_checks set decided_at=now() where id='${renewed}';`
      );
      assert.equal(sweep().sticker_renewal_reminders, 0);
      endsIn(renewed, 10);
      assert.equal(sweep().sticker_renewal_reminders, 1);
      assert.deepEqual(reminders(thandiCipc), [first]);
      assert.deepEqual(reminders(renewed), [keyOf(renewed)]);
      complete(claimFor(renewed));
    });
    await check("none while a renewal waits for review, or after a newer decision", () => {
      // A renewal asked for before the reminder was due.
      const sipho = businessOwner("life-sipho");
      const cipc = sticker(sipho.owner, sipho.business, "cipc", 20);
      const pending = randomUUID();
      replica(`insert into private.evidence_cases(id,subject_id,kind) values('${pending}','${sipho.owner.id}','business');
        insert into private.frontend_business_checks(id,business_id,owner_id,kind)
        values('${pending}','${sipho.business}','${sipho.owner.id}','cipc');`);
      assert.equal(sweep().sticker_renewal_reminders, 0);
      assert.deepEqual(reminders(cipc), []);
      // A Seen sticker on the same business is a separate kind: still reminded.
      const seen = sticker(sipho.owner, sipho.business, "seen", 20);
      assert.equal(sweep().sticker_renewal_reminders, 1);
      assert.deepEqual(reminders(seen), [keyOf(seen)]);
      // A renewal asked for after the reminder was queued, before it was sent.
      const pendingSeen = randomUUID();
      replica(`insert into private.evidence_cases(id,subject_id,kind) values('${pendingSeen}','${sipho.owner.id}','business');
        insert into private.frontend_business_checks(id,business_id,owner_id,kind,seen_method,available_slots,screenshots_consent_at)
        values('${pendingSeen}','${sipho.business}','${sipho.owner.id}','seen','video',array['Friday'],now());`);
      const job = claimFor(seen);
      assert.equal(job.recipient, null);
      assert.equal(complete(job, "skipped"), "t");
      // A newer decision (withdrawn) replaces the sticker.
      const lerato = businessOwner("life-lerato");
      const old = sticker(lerato.owner, lerato.business, "seen", 20);
      const withdrawn = sticker(lerato.owner, lerato.business, "seen", 200);
      replica(`update private.frontend_business_checks set status='withdrawn',revoked_at=now(),
        decided_at=now(),expires_at=null where id='${withdrawn}';`);
      assert.equal(sweep().sticker_renewal_reminders, 0);
      assert.deepEqual(reminders(old), []);
    });
    await check("none for a linked sticker, an archived business or a banned owner", () => {
      const nomsa = businessOwner("life-nomsa");
      const linked = sticker(nomsa.owner, nomsa.business, "cipc_link", 20);
      assert.equal(sweep().sticker_renewal_reminders, 0);
      assert.deepEqual(reminders(linked), []);
      // Archived business.
      const zola = businessOwner("life-zola");
      const archived = sticker(zola.owner, zola.business, "cipc", 20);
      replica(`update private.posts set status='archived',ended_at=now(),
        deletes_at=now()+interval '3 days' where id='${zola.business}';`);
      assert.equal(sweep().sticker_renewal_reminders, 0);
      assert.deepEqual(reminders(archived), []);
      // Banned before it was due.
      const banned = businessOwner("life-banned");
      const bannedSticker = sticker(banned.owner, banned.business, "seen", 20);
      q(
        `update auth.users set banned_until=now()+interval '1 year' where id='${banned.owner.id}';`
      );
      assert.equal(sweep().sticker_renewal_reminders, 0);
      assert.deepEqual(reminders(bannedSticker), []);
      // Banned after it was queued, before it was sent.
      const ayanda = businessOwner("life-ayanda");
      const queued = sticker(ayanda.owner, ayanda.business, "cipc", 20);
      assert.equal(sweep().sticker_renewal_reminders, 1);
      q(
        `update auth.users set banned_until=now()+interval '1 year' where id='${ayanda.owner.id}';`
      );
      const job = claimFor(queued);
      assert.equal(job.recipient, null);
      assert.equal(complete(job, "skipped"), "t");
      // A sticker whose end has passed gets none either.
      const late = businessOwner("life-late");
      const ended = sticker(late.owner, late.business, "cipc", 1);
      endsIn(ended, -1 / 1440);
      assert.equal(sweep().sticker_renewal_reminders, 0);
      assert.deepEqual(reminders(ended), []);
    });

    // ------------------------------------------------------------ rule 3
    await check("a reported post cannot be deleted until staff have looked", () => {
      const owner = verified("life-reported");
      const post = world.post(owner, "listing", "market");
      const id = report(owner, post);
      assert.match(preflight()[0][1], /posts with an open report: 1;/);
      for (const sql of [deleteSql(owner, post), actionDeleteSql(owner, post)]) {
        const refusal = fails(sql, "PT409");
        assert.match(
          refusal,
          /a reported post cannot be deleted until staff have looked at the report/
        );
        assert.match(refusal, /DETAIL:\s+post_report_open/);
        assert.equal(exists(post), true);
      }
      // Staff closed the report: the owner can delete it now.
      closeReport(id, admin);
      q(actionDeleteSql(owner, post));
      assert.equal(exists(post), false);
      // A post without a report is deleted as before.
      const plain = world.post(owner, "listing", "market");
      q(deleteSql(owner, plain));
      assert.equal(exists(plain), false);
      // A report on another post does not stop it.
      const other = verified("life-other");
      const reported = world.post(other, "listing", "market");
      report(other, reported);
      const mine = world.post(owner, "listing", "market");
      q(deleteSql(owner, mine));
      assert.equal(exists(mine), false);
      assert.equal(exists(reported), true);
    });

    await check("the claim takes 27 kinds, each once", () => assertClaimKinds(kit, 27));
    await check("who may run them is unchanged; the new functions are internal", () => {
      assertNoticeGrants(kit, grants, { queue: QUEUE, due: KEY });
      assert.deepEqual(executeGrants(json, [DELETE, GUARD]), {
        [DELETE]: { anon: false, authenticated: true, service_role: false },
        [GUARD]: { anon: false, authenticated: false, service_role: false },
      });
    });

    const later = steps.slice(index + 1);
    if (later.length) {
      applySteps(database, later);
      await check("later updates keep the three rules", () => {
        const owner = verified("life-later");
        fails(createEventSql(owner, window(400)), "22023", /event_too_far_ahead/);
        const { owner: holder, business } = businessOwner("life-later-sticker");
        sticker(holder, business, "cipc", 10);
        assert.equal(sweep().sticker_renewal_reminders, 1);
        const post = world.post(owner, "listing", "market");
        report(owner, post);
        fails(deleteSql(owner, post), "PT409", /post_report_open/);
      });
    }
  }
);
