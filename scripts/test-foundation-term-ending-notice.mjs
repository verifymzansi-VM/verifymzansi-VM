#!/usr/bin/env node
// Behaviour checks for 20261122111209_term_ending_notice.sql: one written
// notice, about 60 business days (63 to 84 calendar days) before a paid term
// of 180 days or more ends (Consumer Protection Act s14(2)(c), launch
// checklist item 68b).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate. Members buy Individual slots through the production slot checkout and
// the website server's settlement (as `service_role`, synthetic Ozow ids); the
// minute job runs api.run_slot_renewals and the email job claims through
// api.claim_supported_notification_outbox, both as `service_role`. Time is
// moved by shifting a grant's own dates (as the database owner, triggers off),
// as if days had passed; a refund is written the same way. No email is sent.
//
// It checks the read-only preflight and the update's refusals, applies the
// update, proves apply -> rollback -> apply returns the same fingerprints, then:
// a 180-day term gets one notice once its end is 84 days away (not at 85),
// never twice however often the job runs, and not again after the sent email
// is removed by retention; the email job gets the end date and the term kind;
// terms shorter than 180 days, ended terms, refunded or revoked terms, terms
// already under 63 days from their end and closed accounts get none; a term
// refunded after its notice was queued, or an unconfirmed address, gets no
// email (finished as skipped); the job never creates a payment; who may run
// the commands is unchanged. Any later updates are applied at the end.
//
//   node --import tsx scripts/test-foundation-term-ending-notice.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  assertReadOnlyPreflight,
  completeSlotOrder,
  executeGrants,
} from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  P180,
  P30,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261122111209_term_ending_notice.sql";
const CLAIM = "internal.claim_supported_notification_outbox(text[],integer)";
const RUN = "api.run_slot_renewals(integer)";
const DUE = "internal.term_ending_notice_due(uuid,uuid)";
const QUEUE = "internal.queue_term_ending_notices(integer)";
const REVIEWED = {
  [CLAIM]: "c7206aab3ac04b1f9d9b6ce2dc47bd0f",
  [RUN]: "b78dc0ac9c98fd46da971c17a3f07a43",
  [DUE]: "missing",
  [QUEUE]: "missing",
};
const UPDATED = {
  [CLAIM]: "d7bce6d6994095f93fb3ca5dac54e3e6",
  [RUN]: "64c3c57229ca6fe6b8163fd8d57dbfcc",
  [DUE]: "db5cfe64a62f97b249b9348d34599ce8",
  [QUEUE]: "70a197a68c46e8cb4a1fbc53056e0d86",
};
const P90 = { id: "6a449457-2384-457e-9434-23c2b0e73127", cents: 20700 };
const LABEL = "term ending notice";
const summary = (state, running, within, queued) =>
  new RegExp(
    `^${LABEL}: ${state}; paid terms of 180 days or more running: ${running}; ending within 84 days: ${within}; notices queued: ${queued}$`
  );

await runTwoAdminUpdateCheck(
  { update: UPDATE, label: "term", title: "Term ending notice" },
  async ({ database, check, kit, world, admin }) => {
    const { q, json, fails, member, service, preflight, steps, index } = kit;
    const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
    const replica = (sql) =>
      q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
    const verified = (label) => world.verified(label, admin);
    /** One completed Individual slot order; returns its grant. */
    const buy = (owner, plan = P180) => {
      const payment = completeSlotOrder(
        { q, json, member, service },
        owner,
        plan,
        1,
        randomUUID()
      ).id;
      return q(`select id from private.entitlements where payment_id='${payment}';`);
    };
    /** The grant ends `days` from now and runs `length` days in all. */
    const endsIn = (grant, days, length = 180) =>
      replica(`update private.entitlements set starts_at=now()+interval '${days - length} days',
        ends_at=now()+interval '${days} days' where id='${grant}';`);
    const sweep = () => json(service("select api.run_slot_renewals(100);"));
    const notices = (grant) =>
      Number(
        q(
          `select count(*) from private.outbox_events where kind='term_ending_notice' and subject_id='${grant}';`
        )
      );
    const claim = () =>
      json(
        service("select api.claim_supported_notification_outbox(array['term_ending_notice'],50);")
      );
    const complete = (job, error = null) =>
      q(
        service(
          `select api.complete_notification_outbox('${job.id}','${job.claim_token}',true,${
            error ? `'${error}'` : "null"
          });`
        )
      );
    const SIGNATURES = [RUN, CLAIM, "api.claim_supported_notification_outbox(text[],integer)"];

    // ------------------------------------------------------------ before
    const early = verified("term-early");
    const earlyGrant = buy(early);
    endsIn(earlyGrant, 80);
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
        assert.match(rows[0][1], summary("update not applied", 1, 1, 0));
        assertReadOnlyPreflight(database, kit.preflightSql);
        // The renewal sweep queues no such notice yet.
        sweep();
        assert.equal(notices(earlyGrant), 0);
      }
    );
    await check("drift and a premature rollback are refused", () => {
      assertDriftRefused(kit, { label: LABEL, signatures: [CLAIM, RUN], rows: 2 });
      const live = q(
        "select pg_get_constraintdef(oid) from pg_constraint where conname='outbox_events_kind_check';"
      );
      q(`alter table private.outbox_events drop constraint outbox_events_kind_check;
        alter table private.outbox_events add constraint outbox_events_kind_check check (kind <> '');`);
      assert.match(preflight()[0][1], /^term ending notice: unexpected state;/);
      assert.match(
        fails(kit.step.sql, "55000"),
        /term ending notice precondition: the outbox kind check is not the reviewed one/
      );
      q(`alter table private.outbox_events drop constraint outbox_events_kind_check;
        alter table private.outbox_events add constraint outbox_events_kind_check ${live};`);
      assert.match(preflight()[0][1], summary("update not applied", 1, 1, 0));
    });

    // ------------------------------------------------------------- apply
    const grants = executeGrants(json, SIGNATURES);
    await applyAndProveRollback(kit, database, check, {
      label: LABEL,
      applied: summary("already applied", 1, 1, 0),
      notApplied: summary("update not applied", 1, 1, 0),
    });
    await check("after the update: the bodies are the update's", () => {
      for (const [signature, md5] of Object.entries(UPDATED))
        assert.equal(bodyMd5(signature), md5, signature);
    });

    const thandi = verified("term-thandi");
    const thandiGrant = buy(thandi);
    const payments = () => Number(q("select count(*) from private.payments;"));
    await check("a 180-day term gets one notice once its end is 84 days away", () => {
      const paid = payments();
      // Just bought: 180 days to go.
      assert.equal(sweep().term_ending_notices, 1, "only the term bought before the update");
      assert.equal(notices(thandiGrant), 0);
      endsIn(thandiGrant, 85);
      assert.equal(sweep().term_ending_notices, 0);
      assert.equal(notices(thandiGrant), 0);
      endsIn(thandiGrant, 84 - 1 / 1440);
      assert.equal(sweep().term_ending_notices, 1);
      assert.equal(notices(thandiGrant), 1);
      const row =
        json(`select jsonb_build_object('owner',owner_id,'key',dedupe_key,'processed',processed_at is not null)
        from private.outbox_events where kind='term_ending_notice' and subject_id='${thandiGrant}';`);
      assert.deepEqual(row, {
        owner: thandi.id,
        key: `term_ending_notice:${thandiGrant}`,
        processed: false,
      });
      // The job runs every minute: never a second notice.
      for (let run = 0; run < 3; run++) assert.equal(sweep().term_ending_notices, 0);
      endsIn(thandiGrant, 70);
      assert.equal(sweep().term_ending_notices, 0);
      assert.equal(notices(thandiGrant), 1);
      assert.equal(payments(), paid, "the job never creates a payment");
    });
    await check("the email job gets the address, the end date and the kind of term", () => {
      const jobs = claim();
      const job = jobs.find((j) => j.subject_id === thandiGrant);
      assert.ok(job, JSON.stringify(jobs));
      assert.equal(job.kind, "term_ending_notice");
      assert.equal(job.owner_id, thandi.id);
      assert.equal(job.recipient, thandi.email);
      assert.equal(
        job.term_ends_at,
        json(`select to_jsonb(ends_at) from private.entitlements where id='${thandiGrant}';`)
      );
      assert.equal(job.term_kind, "individual");
      assert.equal(job.slot_ends_at, null);
      assert.equal(complete(job), "t");
      // The notice for the term bought before the update went out too.
      const other = jobs.find((j) => j.subject_id === earlyGrant);
      assert.ok(other && other.recipient === early.email, JSON.stringify(jobs));
      complete(other);
      assert.deepEqual(claim(), []);
    });
    await check("retention removing the sent email does not bring the notice back", () => {
      // Retention removes a sent email 30 days after sending: by then the end
      // is under 63 days away.
      endsIn(thandiGrant, 54);
      q(
        `delete from private.outbox_events where kind='term_ending_notice' and subject_id='${thandiGrant}';`
      );
      assert.equal(sweep().term_ending_notices, 0);
      assert.equal(notices(thandiGrant), 0);
    });
    await check(
      "shorter terms, ended terms and terms under 63 days from their end get none",
      () => {
        const sipho = verified("term-sipho");
        const ninety = buy(sipho, P90);
        endsIn(ninety, 80, 90);
        const thirty = buy(verified("term-lerato"), P30);
        endsIn(thirty, 20, 30);
        // Just short of 180 days.
        const almost = buy(verified("term-almost"));
        endsIn(almost, 80, 179);
        const ended = buy(verified("term-ended"));
        endsIn(ended, -1);
        const late = buy(verified("term-late"));
        endsIn(late, 62);
        assert.equal(sweep().term_ending_notices, 0);
        for (const grant of [ninety, thirty, almost, ended, late]) assert.equal(notices(grant), 0);
        // At exactly 180 days it qualifies.
        endsIn(almost, 80, 180);
        assert.equal(sweep().term_ending_notices, 1);
        assert.equal(notices(almost), 1);
      }
    );
    await check("refunded and revoked terms and closed accounts get none", () => {
      const refunded = buy(verified("term-refunded"));
      endsIn(refunded, 80);
      replica(`update private.payment_lines set status='reversed',reversal_kind='refunded',
          reversal_reason='Cancelled within 14 days',reversed_at=now()
        where id=(select payment_line_id from private.entitlements where id='${refunded}');`);
      const revoked = buy(verified("term-revoked"));
      endsIn(revoked, 80);
      replica(
        `update private.entitlements set status='revoked',revoked_reason='refunded' where id='${revoked}';`
      );
      const chargeback = buy(verified("term-chargeback"));
      endsIn(chargeback, 80);
      replica(`update private.payments set status='chargeback'
        where id=(select payment_id from private.entitlements where id='${chargeback}');`);
      const closedOwner = verified("term-closed");
      const closed = buy(closedOwner);
      endsIn(closed, 80);
      replica(`insert into private.account_closures(user_id,closed_at,evidence_delete_after)
        values('${closedOwner.id}',now(),now()+interval '90 days');`);
      assert.equal(sweep().term_ending_notices, 0);
      for (const grant of [refunded, revoked, chargeback, closed]) assert.equal(notices(grant), 0);
    });
    await check("a term refunded after its notice was queued gets no email", () => {
      const nomsa = verified("term-nomsa");
      const grant = buy(nomsa);
      endsIn(grant, 80);
      assert.equal(sweep().term_ending_notices, 1);
      replica(
        `update private.entitlements set status='revoked',revoked_reason='refunded' where id='${grant}';`
      );
      const job = claim().find((j) => j.subject_id === grant);
      assert.ok(job);
      assert.equal(job.recipient, null);
      assert.equal(complete(job, "skipped"), "t");
      assert.equal(sweep().term_ending_notices, 0, "never queued again");
    });
    await check("an unconfirmed address gets no email", () => {
      const zola = verified("term-zola");
      const grant = buy(zola);
      endsIn(grant, 80);
      q(`update auth.users set email_confirmed_at=null where id='${zola.id}';`);
      assert.equal(sweep().term_ending_notices, 1);
      const job = claim().find((j) => j.subject_id === grant);
      assert.ok(job);
      assert.equal(job.recipient, null);
      complete(job, "skipped");
    });
    await check("the claim takes 22 kinds, each once", () => {
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
      assert.deepEqual(executeGrants(json, [QUEUE, DUE]), {
        [QUEUE]: { anon: false, authenticated: false, service_role: true },
        [DUE]: { anon: false, authenticated: false, service_role: false },
      });
      for (const [signature, definer] of [
        [QUEUE, true],
        [DUE, false],
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
      await check("later updates keep one notice per term", () => {
        const owner = verified("term-later");
        const grant = buy(owner);
        endsIn(grant, 80);
        sweep();
        sweep();
        assert.equal(notices(grant), 1);
      });
    }
  }
);
