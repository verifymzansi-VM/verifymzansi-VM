#!/usr/bin/env node
// Behaviour checks for 20261123225900_posting_terms_v6.sql (launch checklist
// item 27): posting-v6 is published with its catalogue hash and made current
// in one step; members accept it once; new payments record it; the preflight
// is read only; the rollback makes posting-v5 current again; re-applying is
// harmless; and the update refuses a different posting-v6 document, a current
// version other than posting-v5 and a database without the written notice
// before a long term ends.
//
// Replays database/foundation (prelude, candidate.sql, every update before
// this one) into the throwaway, network-less Postgres 17 container of the SQL
// lint gate. Members act as `authenticated` with synthetic claims and a live
// session row; the website's server as `service_role`. The only stand-in is
// internal.current_verified_identity (the member's current accepted fact).
//
//   node --import tsx scripts/test-foundation-posting-terms-v6.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all. Nothing
// contacts Ozow, a bank or an email provider.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertReadOnlyPreflight } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  P30,
  ozowPurchase,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261123225900_posting_terms_v6.sql";
const CATALOGUE = JSON.parse(readFileSync("src/lib/legal/terms-documents/catalogue.json", "utf8"));
const V5 = { version: "posting-v5", document_hash: CATALOGUE.versions["posting-v5"] };
const V6 = { version: "posting-v6", document_hash: CATALOGUE.versions["posting-v6"] };

await runTwoAdminUpdateCheck(
  { update: UPDATE, label: "terms-v6", title: "Posting terms v6" },
  async ({ database, check, kit, world, admin }) => {
    const { q, json, fails, member, preflight, fingerprint, step, steps, index } = kit;
    const currentTerms = () =>
      json(`select jsonb_build_object('version',c.version,'document_hash',v.document_hash)
        from private.posting_terms_current c join private.posting_terms_versions v on v.version=c.version
        where c.singleton;`);
    const v6Rows = () =>
      q(
        "select coalesce(string_agg(document_hash, ','), '') from private.posting_terms_versions where version='posting-v6';"
      );
    const accept = (owner, terms) =>
      member(
        owner,
        `select api.accept_posting_terms('${terms.version}','${terms.document_hash}');`
      );
    const summary = (detail) => [["summary", detail]];

    // ---------------------------------------------------------- before
    const early = world.verified("terms-v6-early", admin);
    await check("before: posting-v5 is current and posting-v6 is not published", () => {
      assert.equal(CATALOGUE.active_version, "posting-v6");
      assert.match(V6.document_hash, /^[A-Za-z0-9_-]{43}$/);
      assert.ok(step.sql.includes(`values('posting-v6','${V6.document_hash}')`));
      assert.deepEqual(currentTerms(), V5);
      assert.equal(v6Rows(), "");
      assert.deepEqual(
        preflight(),
        summary(
          "current posting-v5 (update not applied); posting-v6 not published; accounts that accepted posting-v6: 0"
        )
      );
      assertReadOnlyPreflight(database, kit.preflightSql);
      assert.equal(json(accept(early, V5)).version, "posting-v5");
    });

    await check(
      "the update refuses a different posting-v6, another current version or no notice",
      () => {
        // A posting-v6 row with another document (the guard trigger is bypassed
        // to plant it and to remove it again).
        q(`select set_config('session_replication_role','replica',false);
        insert into private.posting_terms_versions(version,document_hash) values('posting-v6','${"A".repeat(43)}');
        select set_config('session_replication_role','origin',false);`);
        assert.deepEqual(
          preflight().map((row) => row[1]),
          [
            "current posting-v5 (update not applied); posting-v6 published with another document; accounts that accepted posting-v6: 0",
            "posting-v6 is published with another document",
          ]
        );
        fails(step.sql, "55000", /posting-v6 is already published with a different document/);
        q(`select set_config('session_replication_role','replica',false);
        delete from private.posting_terms_versions where version='posting-v6';
        select set_config('session_replication_role','origin',false);`);
        // Another current version.
        q("update private.posting_terms_current set version='posting-v4' where singleton;");
        fails(step.sql, "55000", /current posting terms are posting-v4, expected posting-v5/);
        assert.equal(preflight().length, 2);
        q("update private.posting_terms_current set version='posting-v5' where singleton;");
        // The written notice before a long term ends is missing.
        q(
          "alter function internal.queue_term_ending_notices(integer) rename to queue_term_ending_notices_hidden;"
        );
        fails(step.sql, "55000", /apply 20261122111209_term_ending_notice.sql first/);
        assert.equal(preflight().length, 2);
        q(
          "alter function internal.queue_term_ending_notices_hidden(integer) rename to queue_term_ending_notices;"
        );
        assert.deepEqual(currentTerms(), V5);
        assert.equal(v6Rows(), "");
      }
    );

    // ----------------------------------------------------------- apply
    const before = fingerprint();
    applySteps(database, [step]);
    await check("the update publishes posting-v6 and makes it current, changing no schema", () => {
      assert.deepEqual(currentTerms(), V6);
      assert.equal(v6Rows(), V6.document_hash);
      assert.equal(fingerprint(), before, "the update changes no schema");
      assert.deepEqual(
        preflight(),
        summary(
          "current posting-v6 (update already applied); posting-v6 published; accounts that accepted posting-v6: 0"
        )
      );
      // Published terms are immutable.
      fails(
        `update private.posting_terms_versions set document_hash='${"B".repeat(43)}' where version='posting-v6';`,
        "23514"
      );
    });

    await check("members accept posting-v6 once; posting-v5 acceptance does not carry over", () => {
      const asked = json(member(early, "select api.get_owner_posting_terms();"));
      assert.equal(asked.version, "posting-v6");
      assert.equal(asked.document_hash, V6.document_hash);
      assert.equal(asked.accepted_at, null);
      fails(accept(early, V5), "PT409", /posting terms changed/);
      const accepted = json(accept(early, V6));
      assert.equal(accepted.version, "posting-v6");
      assert.notEqual(accepted.accepted_at, null);
      assert.match(preflight()[0][1], /accounts that accepted posting-v6: 1$/);
    });

    await check("a new payment records posting-v6 with its cooling-off consent", () => {
      const buyer = world.verified("terms-v6-buyer", admin);
      const paid = ozowPurchase(kit, buyer, P30, 1);
      assert.equal(
        q(
          `select snapshot->'cooling_off_consent'->>'terms_version' from private.payments where id='${paid}';`
        ),
        "posting-v6"
      );
    });

    // -------------------------------------------------------- rollback
    await check(
      "the rollback makes posting-v5 current; re-applying makes posting-v6 current",
      () => {
        applySteps(database, [{ label: `${UPDATE} rollback`, sql: kit.rollbackSql }]);
        assert.deepEqual(currentTerms(), V5);
        assert.equal(v6Rows(), V6.document_hash, "the posting-v6 row stays (immutable)");
        assert.equal(fingerprint(), before);
        assert.deepEqual(
          preflight(),
          summary(
            "current posting-v5 (update not applied); posting-v6 published; accounts that accepted posting-v6: 1"
          )
        );
        fails(kit.rollbackSql, "55000", /posting-v6 is not the current posting terms/);
        applySteps(database, [step]);
        applySteps(database, [step]);
        assert.deepEqual(currentTerms(), V6);
        assert.equal(v6Rows(), V6.document_hash);
        assert.equal(fingerprint(), before);
        // The member's earlier acceptance of posting-v6 still counts.
        assert.notEqual(
          json(member(early, "select api.get_owner_posting_terms();")).accepted_at,
          null
        );
      }
    );

    const later = steps.slice(index + 1);
    if (later.length) {
      applySteps(database, later);
      await check("later updates keep posting-v6 published", () => {
        assert.equal(v6Rows(), V6.document_hash);
        assert.equal(currentTerms().version, CATALOGUE.active_version);
      });
    }
  }
);
