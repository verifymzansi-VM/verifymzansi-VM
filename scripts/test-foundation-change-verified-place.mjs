#!/usr/bin/env node
// Behaviour checks for 20261125161326_change_verified_place.sql (launch
// checklist item 20, part 2): members change their verified place, at most
// once every 15 days, each change recorded; and a verified phone number
// changes through a new code, at most once every 15 days (no database change,
// proved here on the same schema).
//
// Replays database/foundation (prelude, candidate.sql, every update before this
// one) into the throwaway, network-less Postgres 17 container of the SQL lint
// gate, with the synthetic world of the staff payment checks (members written
// directly as the database owner with an accepted ID review, a verified phone
// and a place; members acting through the production API commands with
// synthetic sessions; phone codes through the production service commands as
// the website's server makes them, no SMS sent). The script checks the
// read-only preflight, drifted bodies and a premature rollback, shows that
// before the update a different place was refused, applies the update and
// proves apply -> rollback -> apply, then checks: a different place replaces
// the member's place and is recorded; the same place changes nothing; a second
// change within 15 days is refused with the next allowed time; after 15 days
// it is allowed; the profile save bumps the revision; the privacy export lists
// the changes; deleting the place (as erasure and retention do) deletes its
// history; no API role can read the record; a new phone code replaces the
// verified number, and a second change within 15 days is refused; the rollback
// refuses once a change exists.
//
//   node --import tsx scripts/test-foundation-change-verified-place.mjs
//
// Needs a local Docker daemon; it takes no connection settings at all.
import assert from "node:assert/strict";
import { phoneChecks } from "./lib/foundation-phone-checks.mjs";
import { assertReadOnlyPreflight } from "./lib/foundation-sql-checks.mjs";
import { applySteps } from "./lib/foundation-sql-lint.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
  runTwoAdminUpdateCheck,
} from "./lib/foundation-staff-payment-world.mjs";

const UPDATE = "20261125161326_change_verified_place.sql";
const PLACE = "internal.confirm_verification_locality(text,text)";
const EXPORT = "internal.frontend_privacy_export_data(uuid)";
const BODIES = {
  [PLACE]: ["0431a9726c90edf0f0b6519a4af17ff6", "c32f46a4b6f62223a0dce0d6701048dc"],
  [EXPORT]: ["b0d8e2600a63b8e5b298ee180f488c05", "0ddcef84e7abeef43fa2509a31d6a298"],
};
const NOT_APPLIED = /^verified place: update not applied; members with a place: \d+$/;
const APPLIED = /^verified place: already applied; members with a place: \d+; place changes: 0$/;
const DAY = 24 * 3600 * 1000;

const SETUP = { update: UPDATE, label: "place", title: "Change verified place" };
await runTwoAdminUpdateCheck(SETUP, async (run) => {
  const { database, check, kit, world, admin } = run;
  const { q, json, fails, member, preflight } = kit;
  const bodyMd5 = (signature) => functionBodyMd5(kit, signature);
  const asOwner = (sql) =>
    q(`set session_replication_role=replica;\n${sql}\nset session_replication_role=origin;`);
  const placeSql = (who, province, city) =>
    member(who, `select api.confirm_verification_locality('${province}','${city}');`);
  const place = (who) =>
    json(
      `select jsonb_build_object('province',province_id,'city',city_id) from private.verification_localities where owner_id='${who.id}';`
    );
  const changes = (who) =>
    json(
      `select coalesce(jsonb_agg(to_jsonb(c)-'id'-'owner_id' order by c.changed_at,c.id),'[]') from private.verification_locality_changes c where c.owner_id='${who.id}';`
    );
  const reason = (stderr) => /^DETAIL:\s+(\S+)/m.exec(stderr)?.[1];
  // world.verified: an accepted ID review, a verified phone and the place
  // gp / gp_johannesburg.
  const thandi = world.verified("place-thandi", admin);

  // ------------------------------------------------------------ before
  await check("before the update: a confirmed place could not change", () => {
    assert.equal(bodyMd5(PLACE), BODIES[PLACE][0]);
    assert.equal(bodyMd5(EXPORT), BODIES[EXPORT][0]);
    fails(placeSql(thandi, "kzn", "kzn_durban"), "PT409", /approved locality requires/);
    assert.deepEqual(place(thandi), { province: "gp", city: "gp_johannesburg" });
  });
  await check("preflight: read only, summary only, before the update", () => {
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"]
    );
    assert.match(rows[0][1], NOT_APPLIED);
    assertReadOnlyPreflight(database, kit.preflightSql);
  });
  await check("a premature rollback and drifted bodies are refused", () => {
    assertDriftRefused(kit, { label: "verified place", signatures: [PLACE, EXPORT], rows: 2 });
  });

  // ------------------------------------------------------------- apply
  await applyAndProveRollback(kit, database, check, {
    label: "verified place",
    applied: APPLIED,
    notApplied: NOT_APPLIED,
  });

  // ------------------------------------------------------------- after
  await check("no API role can read or write the change record", () => {
    for (const role of ["anon", "authenticated", "service_role"])
      for (const privilege of ["select", "insert", "update", "delete"])
        assert.equal(
          q(
            `select has_table_privilege('${role}','private.verification_locality_changes','${privilege}');`
          ),
          "f",
          `${role} ${privilege}`
        );
  });

  await check("a different place replaces the member's place and is recorded", () => {
    assert.equal(bodyMd5(PLACE), BODIES[PLACE][1]);
    const changed = json(placeSql(thandi, "kzn", "kzn_durban"));
    assert.equal(changed.changed, true);
    assert.deepEqual(place(thandi), { province: "kzn", city: "kzn_durban" });
    const [recorded, ...more] = changes(thandi);
    assert.equal(more.length, 0);
    assert.equal(recorded.from_province_id, "gp");
    assert.equal(recorded.from_city_id, "gp_johannesburg");
    assert.equal(recorded.to_province_id, "kzn");
    assert.equal(recorded.to_city_id, "kzn_durban");
    // The same place again changes nothing.
    assert.equal(json(placeSql(thandi, "kzn", "kzn_durban")).reused, true);
    assert.equal(changes(thandi).length, 1);
    // A city that is not in the province is refused.
    fails(placeSql(thandi, "gp", "kzn_durban"), "22023");
  });

  await check("a second change within 15 days is refused with the next allowed time", () => {
    const stderr = fails(placeSql(thandi, "gp", "gp_johannesburg"), "PT409");
    assert.equal(reason(stderr), "location_change_cooldown");
    const hint = /^HINT:\s+(\S+)/m.exec(stderr)?.[1];
    const next = Date.parse(hint);
    assert.ok(Math.abs(next - (Date.now() + 15 * DAY)) < 10 * 60 * 1000, hint);
    assert.deepEqual(place(thandi), { province: "kzn", city: "kzn_durban" });
    // 15 days later the change is allowed.
    asOwner(`update private.verification_locality_changes set changed_at=changed_at-interval '15 days 1 minute'
      where owner_id='${thandi.id}';`);
    assert.equal(json(placeSql(thandi, "gp", "gp_johannesburg")).changed, true);
    assert.equal(changes(thandi).length, 2);
  });

  await check("the profile save changes the place and bumps the revision", () => {
    const nomsa = world.verified("place-nomsa", admin);
    const revision = Number(
      q(`select revision from private.profiles where account_id='${nomsa.id}';`)
    );
    const saved = json(
      member(
        nomsa,
        `select api.save_my_frontend_profile(${revision},'Nomsa Zulu','A short bio','kzn','kzn_pietermaritzburg');`
      )
    );
    assert.equal(saved.revision, revision + 1);
    assert.deepEqual(place(nomsa), { province: "kzn", city: "kzn_pietermaritzburg" });
    assert.equal(changes(nomsa).length, 1);
  });

  await check("the privacy export lists the changes", () => {
    const exported = json(`select internal.frontend_privacy_export_data('${thandi.id}');`);
    assert.deepEqual(
      exported.locality_changes.map((c) => [c.from_city_id, c.to_city_id]),
      [
        ["gp_johannesburg", "kzn_durban"],
        ["kzn_durban", "gp_johannesburg"],
      ]
    );
    assert.equal(exported.locality_verification.length, 1);
  });

  await check("a phone change needs a new code and waits 15 days between changes", () => {
    const { createSql, prove, refusedWith } = phoneChecks(kit);
    const sipho = world.verified("place-sipho", admin);
    const active = () =>
      q(
        `select phone from private.verification_phone_proofs where owner_id='${sipho.id}' and revoked_at is null;`
      );
    const first = active();
    // The fixture's number was verified just now: a change waits 15 days.
    refusedWith(createSql(sipho, "+27720000101"), "phone_change_cooldown");
    asOwner(`update private.verification_phone_proofs set contact_changed_at=now()-interval '16 days'
      where owner_id='${sipho.id}' and revoked_at is null;`);
    prove(sipho, "+27720000101");
    assert.equal(active(), "+27720000101");
    // The old number stays on record (a ban still finds it), no longer active.
    assert.equal(
      q(
        `select count(*) from private.verification_phone_proofs where owner_id='${sipho.id}' and phone='${first}' and revoked_at is not null;`
      ),
      "1"
    );
    refusedWith(createSql(sipho, "+27720000102"), "phone_change_cooldown");
    assert.equal(active(), "+27720000101");
  });

  await check(
    "the rollback refuses while a change exists; deleting the place deletes its history",
    () => {
      // A change exists, so the rollback is refused.
      assert.match(fails(kit.rollbackSql, "55000"), /changed their place/);
      const nomsa = q(
        `select l.owner_id from private.verification_localities l join private.verification_locality_changes c using(owner_id)
        where l.city_id='kzn_pietermaritzburg' limit 1;`
      );
      // As erasure and the retention sweep do (the foreign key action fires).
      q(`delete from private.verification_localities where owner_id='${nomsa}';`);
      assert.equal(
        q(`select count(*) from private.verification_locality_changes where owner_id='${nomsa}';`),
        "0"
      );
    }
  );

  const later = kit.steps.slice(kit.index + 1);
  if (later.length) {
    applySteps(database, later);
    await check("later updates keep the place rule", () => {
      assert.equal(bodyMd5(PLACE), BODIES[PLACE][1]);
    });
  }
});
