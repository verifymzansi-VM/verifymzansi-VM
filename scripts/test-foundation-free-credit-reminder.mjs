#!/usr/bin/env node
// Behaviour checks for 20261122182304_free_credit_reminder.sql: one email 3
// days before a free credit (20261122130744_free_credits.sql) ends (launch
// checklist item 70b).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Admins give and extend free credits through the production staff
// commands with synthetic sessions; the minute job runs api.run_slot_renewals
// and the email job claims through api.claim_supported_notification_outbox,
// both as `service_role`. Time is moved by shifting a gift's end (as the
// database owner, triggers off), as if days had passed; ending a gift early,
// a ban and a closed account are written the same way. No email is sent.
//
// It checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the same fingerprints, then:
// a gift gets one reminder once its end is 3 days away (not before), never
// twice however often the job runs; the email job gets the address and the
// end; a gift extended after its reminder gets a new one 3 days before its new
// end, and a reminder for an end that an extension replaced is not sent; a gift
// ended early gets none (before or after it was queued); a banned or closed
// member gets none (before or after it was queued); a paid slot gets no free
// credit reminder; the claim takes 23 kinds; who may run the commands is
// unchanged. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-free-credit-reminder.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertReadOnlyPreflight,
  completeSlotOrder,
  executeGrants,
  sqlLiteral,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  P30,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261122182304_free_credit_reminder.sql";
const CLAIM = "internal.claim_supported_notification_outbox(text[],integer)";
const RUN = "api.run_slot_renewals(integer)";
const KEY = "internal.free_credit_reminder_key(uuid,uuid)";
const QUEUE = "internal.queue_free_credit_reminders(integer)";
const REVIEWED = {
  [CLAIM]: "9a4c68c8ba330364831aac3bdf66b2aa",
  [RUN]: "64c3c57229ca6fe6b8163fd8d57dbfcc",
  [KEY]: "missing",
  [QUEUE]: "missing",
};
const UPDATED = {
  [CLAIM]: "f659e9ebf7dcf269e4759879537a10f0",
  [RUN]: "2dc453b1de85fbdb169b983c42109c5f",
  [KEY]: "7031f3b16ccc65060e6b1082d07341d3",
  [QUEUE]: "11040161aaa93a255c2a153c476d1d55",
};
const LABEL = "free credit reminder";
const REASON = "Recruited at the Richards Bay market day";
// Literal patterns for the preflight summary (one gift running, ending within
// 3 days, no reminder queued yet).
const NOT_APPLIED =
  /^free credit reminder: update not applied; free credits running: 1; ending within 3 days: 1; reminders queued: 0$/;
const ALREADY_APPLIED =
  /^free credit reminder: already applied; free credits running: 1; ending within 3 days: 1; reminders queued: 0$/;

await runTwoAdminUpdateCheck(
  { update: UPDATE, label: "credit", title: "Free credit reminder" },
  async ({ database, check, kit, world, admin }) => {
    const { q, json, fails, member, staff, service, preflight, steps, index } = kit;
    const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
    const replica = (sql) =>
      q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
    const verified = (label) => world.verified(label, admin);
    /** A free credit of 1 post for 30 days, given now by the admin; returns its id. */
    const give = (person) =>
      json(
        staff(admin, `select api.give_free_credit(${sqlLiteral(person.email)},1,30,'${REASON}');`)
      ).id;
    const extend = (gift, days) =>
      json(staff(admin, `select api.extend_free_credit('${gift}',${days},'${REASON}');`));
    /** The gift ends `days` from now (time has passed). */
    const endsIn = (gift, days) =>
      replica(`update private.entitlements set ends_at=now()+make_interval(secs=>${days}*86400)
        where id='${gift}';`);
    const endOf = (gift) =>
      json(`select to_jsonb(ends_at) from private.entitlements where id='${gift}';`);
    const sweep = () => json(service("select api.run_slot_renewals(100);"));
    const reminders = (gift) =>
      json(`select coalesce(jsonb_agg(dedupe_key order by created_at, id),'[]') from private.outbox_events
        where kind='free_credit_reminder' and subject_id='${gift}';`);
    const claim = () =>
      json(
        service("select api.claim_supported_notification_outbox(array['free_credit_reminder'],50);")
      );
    const claimFor = (gift) => {
      const jobs = claim();
      const job = jobs.find((j) => j.subject_id === gift);
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
    const keyOf = (gift) =>
      `free_credit_reminder:${gift}:${q(
        `select floor(extract(epoch from ends_at))::bigint from private.entitlements where id='${gift}';`
      )}`;
    const SIGNATURES = [RUN, CLAIM, "api.claim_supported_notification_outbox(text[],integer)"];

    // ------------------------------------------------------------ before
    const early = verified("credit-early");
    const earlyGift = give(early);
    endsIn(earlyGift, 2);
    await check(
      "before the update: the reviewed bodies, and the preflight reads not applied",
      () => {
        for (const [signature, md5] of Object.entries(REVIEWED))
          assert.equal(bodyMd5(signature), md5, signature);
        const rows = preflight();
        assert.deepEqual(
          rows.map((r) => r[0]),
          ["summary"],
          JSON.stringify(rows)
        );
        assert.match(rows[0][1], NOT_APPLIED);
        assertReadOnlyPreflight(database, kit.preflightSql);
        // The minute job queues no such reminder yet.
        assert.equal(sweep().free_credit_reminders, undefined);
      }
    );
    await check("drift and a premature rollback are refused", () => {
      assertDriftRefused(kit, { label: LABEL, signatures: [CLAIM, RUN], rows: 2 });
      const live = q(
        "select pg_get_constraintdef(oid) from pg_constraint where conname='outbox_events_kind_check';"
      );
      q(`alter table private.outbox_events drop constraint outbox_events_kind_check;
        alter table private.outbox_events add constraint outbox_events_kind_check check (kind <> '');`);
      assert.match(preflight()[0][1], /^free credit reminder: unexpected state;/);
      assert.match(
        fails(kit.step.sql, "55000"),
        /free credit reminder precondition: the outbox kind check is not the reviewed one/
      );
      q(`alter table private.outbox_events drop constraint outbox_events_kind_check;
        alter table private.outbox_events add constraint outbox_events_kind_check ${live};`);
      assert.match(preflight()[0][1], NOT_APPLIED);
    });

    // ------------------------------------------------------------- apply
    const grants = executeGrants(json, SIGNATURES);
    await applyAndProveRollback(kit, database, check, {
      label: LABEL,
      applied: ALREADY_APPLIED,
      notApplied: NOT_APPLIED,
    });
    await check("after the update: the bodies are the update's", () => {
      for (const [signature, md5] of Object.entries(UPDATED))
        assert.equal(bodyMd5(signature), md5, signature);
    });

    const thandi = verified("credit-thandi");
    const thandiGift = give(thandi);
    const payments = () => Number(q("select count(*) from private.payments;"));
    await check("once per gift: one reminder once its end is 3 days away", () => {
      const paid = payments();
      // Just given: 30 days to go. Only the gift given before the update is due.
      assert.equal(sweep().free_credit_reminders, 1);
      assert.deepEqual(reminders(earlyGift), [keyOf(earlyGift)]);
      assert.deepEqual(reminders(thandiGift), []);
      endsIn(thandiGift, 3 + 1 / 1440);
      assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(thandiGift), []);
      endsIn(thandiGift, 3 - 1 / 1440);
      assert.equal(sweep().free_credit_reminders, 1);
      assert.deepEqual(reminders(thandiGift), [keyOf(thandiGift)]);
      assert.equal(
        q(`select owner_id from private.outbox_events where dedupe_key='${keyOf(thandiGift)}';`),
        thandi.id
      );
      // The job runs every minute: never a second reminder.
      for (let run = 0; run < 3; run++) assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(thandiGift), [keyOf(thandiGift)]);
      assert.equal(payments(), paid, "the job never creates a payment");
    });
    await check("the email job gets the address and the gift's end", () => {
      const jobs = claim();
      const job = jobs.find((j) => j.subject_id === thandiGift);
      assert.ok(job, JSON.stringify(jobs));
      assert.equal(job.kind, "free_credit_reminder");
      assert.equal(job.owner_id, thandi.id);
      assert.equal(job.recipient, thandi.email);
      assert.equal(job.credit_ends_at, endOf(thandiGift));
      assert.equal(job.term_ends_at, null);
      assert.equal(job.slot_ends_at, null);
      assert.equal(complete(job), "t");
      // The reminder for the gift given before the update went out too.
      const other = jobs.find((j) => j.subject_id === earlyGift);
      assert.ok(other, JSON.stringify(jobs));
      assert.equal(other.recipient, early.email);
      complete(other);
      assert.deepEqual(claim(), []);
      // Sent: still never queued again.
      assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(thandiGift), [keyOf(thandiGift)]);
    });
    await check("re-arm on extend: the new end gets its own reminder 3 days before", () => {
      const first = keyOf(thandiGift);
      // Extended by 10 days after the reminder went out: the new end is 13
      // days away, so nothing yet.
      extend(thandiGift, 10);
      assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(thandiGift), [first]);
      // Days pass: the new end is 2 days away.
      endsIn(thandiGift, 2);
      assert.equal(sweep().free_credit_reminders, 1);
      assert.deepEqual(reminders(thandiGift), [first, keyOf(thandiGift)]);
      const job = claimFor(thandiGift);
      assert.equal(job.recipient, thandi.email);
      assert.equal(job.credit_ends_at, endOf(thandiGift));
      complete(job);
      assert.equal(sweep().free_credit_reminders, 0);
    });
    await check("a reminder for an end that an extension replaced is not sent", () => {
      const sipho = verified("credit-sipho");
      const gift = give(sipho);
      endsIn(gift, 2);
      assert.equal(sweep().free_credit_reminders, 1);
      const old = keyOf(gift);
      // Extended before the email went out: the new end is 7 days away.
      extend(gift, 5);
      const job = claimFor(gift);
      assert.equal(job.recipient, null);
      assert.equal(complete(job, "skipped"), "t");
      assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(gift), [old]);
    });
    await check("none after early end: a gift ended early gets no reminder", () => {
      // Ended before it was due.
      const lerato = verified("credit-lerato");
      const ended = give(lerato);
      endsIn(ended, 2);
      replica(`update private.entitlements set status='revoked',revoked_reason='ended_early'
        where id='${ended}';`);
      assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(ended), []);
      // Ended after the reminder was queued, before it was sent.
      const nomsa = verified("credit-nomsa");
      const gift = give(nomsa);
      endsIn(gift, 2);
      assert.equal(sweep().free_credit_reminders, 1);
      replica(`update private.entitlements set status='revoked',revoked_reason='ended_early'
        where id='${gift}';`);
      const job = claimFor(gift);
      assert.equal(job.recipient, null);
      assert.equal(complete(job, "skipped"), "t");
      assert.equal(sweep().free_credit_reminders, 0, "never queued again");
      // A gift whose end has passed gets none either.
      const late = verified("credit-late");
      const passed = give(late);
      replica(`update private.entitlements set starts_at=now()-interval '30 days',
        ends_at=now()-interval '1 minute' where id='${passed}';`);
      assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(passed), []);
    });
    await check("none for banned members (or closed accounts)", () => {
      // Banned before it was due.
      const banned = verified("credit-banned");
      const gift = give(banned);
      endsIn(gift, 2);
      q(`update auth.users set banned_until=now()+interval '1 year' where id='${banned.id}';`);
      assert.equal(
        q(`select count(*) from private.current_account_access where id='${banned.id}';`),
        "0"
      );
      assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(gift), []);
      // Closed account.
      const closedOwner = verified("credit-closed");
      const closed = give(closedOwner);
      endsIn(closed, 2);
      replica(`insert into private.account_closures(user_id,closed_at,evidence_delete_after)
        values('${closedOwner.id}',now(),now()+interval '90 days');`);
      assert.equal(sweep().free_credit_reminders, 0);
      assert.deepEqual(reminders(closed), []);
      // Banned after the reminder was queued, before it was sent.
      const zola = verified("credit-zola");
      const queued = give(zola);
      endsIn(queued, 2);
      assert.equal(sweep().free_credit_reminders, 1);
      q(`update auth.users set banned_until=now()+interval '1 year' where id='${zola.id}';`);
      const job = claimFor(queued);
      assert.equal(job.recipient, null);
      assert.equal(complete(job, "skipped"), "t");
    });
    await check("a paid slot ending within 3 days gets no free credit reminder", () => {
      const owner = verified("credit-paid");
      const payment = completeSlotOrder(
        { q, json, member, service },
        owner,
        P30,
        1,
        randomUUID()
      ).id;
      const slot = q(`select id from private.entitlements where payment_id='${payment}';`);
      replica(
        `update private.entitlements set ends_at=now()+interval '2 days' where id='${slot}';`
      );
      const result = sweep();
      assert.equal(result.free_credit_reminders, 0);
      assert.equal(result.reminders, 1, "the slot's own renewal reminder");
      assert.deepEqual(reminders(slot), []);
    });
    await check("the claim takes 23 kinds, each once", () => {
      const kinds = [
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
      const list = (k) => `array[${k.map((x) => `'${x}'`).join(",")}]`;
      json(service(`select api.claim_supported_notification_outbox(${list(kinds)},1);`));
      fails(
        service(
          `select api.claim_supported_notification_outbox(${list([...kinds, "post_kept"])},1);`
        ),
        "22023",
        /supported mail kinds required/
      );
      fails(
        service(`select api.claim_supported_notification_outbox(${list(["no_such_kind"])},1);`),
        "22023",
        /unsupported mail kind/
      );
    });
    await check("who may run them is unchanged; the new functions are internal", () => {
      assert.deepEqual(executeGrants(json, SIGNATURES), grants);
      for (const signature of SIGNATURES)
        assert.deepEqual(grants[signature], {
          anon: false,
          authenticated: false,
          service_role: true,
        });
      assert.deepEqual(executeGrants(json, [QUEUE, KEY]), {
        [QUEUE]: { anon: false, authenticated: false, service_role: true },
        [KEY]: { anon: false, authenticated: false, service_role: false },
      });
      for (const [signature, definer] of [
        [QUEUE, true],
        [KEY, false],
      ]) {
        const meta =
          json(`select jsonb_build_object('definer',prosecdef,'owner',proowner::regrole::text,'config',proconfig)
            from pg_proc where oid='${signature}'::regprocedure;`);
        assert.deepEqual(meta, { definer, owner: "postgres", config: ["search_path=pg_catalog"] });
      }
    });

    const later = steps.slice(index + 1);
    if (later.length) {
      applySteps(database, later);
      await check("later updates keep one reminder per gift end", () => {
        const owner = verified("credit-later");
        const gift = give(owner);
        endsIn(gift, 2);
        sweep();
        sweep();
        assert.equal(reminders(gift).length, 1);
      });
    }
  }
);
