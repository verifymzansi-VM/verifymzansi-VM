// Shared checks for updates that add an outbox email kind queued by the minute
// job (api.run_slot_renewals) and claimed by the email job
// (internal.claim_supported_notification_outbox), as the term-ending notice
// (20261122111209) and the free credit reminder (20261122182304) do. Each such
// update replaces those two bodies, adds a "due" function and a queue
// function, and widens the outbox kind check.
import assert from "node:assert/strict";
import { assertReadOnlyPreflight, executeGrants } from "./foundation-sql-checks.mjs";
import {
  applyAndProveRollback,
  assertDriftRefused,
  functionBodyMd5,
} from "./foundation-staff-payment-world.mjs";

export const CLAIM = "internal.claim_supported_notification_outbox(text[],integer)";
export const RUN = "api.run_slot_renewals(integer)";
const SIGNATURES = [RUN, CLAIM, "api.claim_supported_notification_outbox(text[],integer)"];
const SERVICE_ONLY = { anon: false, authenticated: false, service_role: true };

/**
 * Before the update: the reviewed bodies, a read-only preflight whose only row
 * is a summary matching `notApplied`, then `before()`. Drift: a premature
 * rollback, a drifted claim or minute-job body and a drifted kind check are
 * refused (`drift`: the replaced bodies, the claim and the minute job by
 * default). Then the update is applied, rolled back and applied again (the
 * preflight summary matches `applied`), and the bodies are the update's.
 * Returns the execute grants of the replaced commands from before the update.
 */
export async function checkNoticeUpdate(
  { kit, database, check },
  { label, reviewed, updated, notApplied, applied, before, drift = [CLAIM, RUN] }
) {
  const { q, json, fails, preflight } = kit;
  const bodies = (expected) => {
    for (const [signature, md5] of Object.entries(expected))
      assert.equal(functionBodyMd5(kit, signature), md5, signature);
  };
  await check("before the update: the reviewed bodies, and the preflight reads not applied", () => {
    bodies(reviewed);
    const rows = preflight();
    assert.deepEqual(
      rows.map((r) => r[0]),
      ["summary"],
      JSON.stringify(rows)
    );
    assert.match(rows[0][1], notApplied);
    assertReadOnlyPreflight(database, kit.preflightSql);
    before();
  });
  await check("drift and a premature rollback are refused", () => {
    assertDriftRefused(kit, { label, signatures: drift, rows: 2 });
    const live = q(
      "select pg_get_constraintdef(oid) from pg_constraint where conname='outbox_events_kind_check';"
    );
    q(`alter table private.outbox_events drop constraint outbox_events_kind_check;
      alter table private.outbox_events add constraint outbox_events_kind_check check (kind <> '');`);
    assert.ok(preflight()[0][1].startsWith(`${label}: unexpected state;`));
    assert.ok(
      fails(kit.step.sql, "55000").includes(
        `${label} precondition: the outbox kind check is not the reviewed one`
      )
    );
    q(`alter table private.outbox_events drop constraint outbox_events_kind_check;
      alter table private.outbox_events add constraint outbox_events_kind_check ${live};`);
    assert.match(preflight()[0][1], notApplied);
  });
  const grants = executeGrants(json, SIGNATURES);
  await applyAndProveRollback(kit, database, check, { label, applied, notApplied });
  await check("after the update: the bodies are the update's", () => bodies(updated));
  return grants;
}

/**
 * The claim takes every kind of the outbox kind check, each once, and there
 * are `count` of them; one more, or an unknown kind, is refused.
 */
export function assertClaimKinds({ q, json, fails, service }, count) {
  const definition = q(
    "select pg_get_constraintdef(oid) from pg_constraint where conname='outbox_events_kind_check';"
  );
  const kinds = [...definition.matchAll(/'([a-z_]+)'::text/g)].map((m) => m[1]);
  assert.equal(kinds.length, count, definition);
  const list = (k) => `array[${k.map((x) => `'${x}'`).join(",")}]`;
  json(service(`select api.claim_supported_notification_outbox(${list(kinds)},1);`));
  fails(
    service(`select api.claim_supported_notification_outbox(${list([...kinds, "post_kept"])},1);`),
    "22023",
    /supported mail kinds required/
  );
  fails(
    service(`select api.claim_supported_notification_outbox(${list(["no_such_kind"])},1);`),
    "22023",
    /unsupported mail kind/
  );
}

/**
 * Who may run the replaced commands is unchanged (`grants`, service role
 * only); the queue function (security definer) is for the service role only
 * and the due function (security invoker) for no API role; both are owned by
 * postgres with a fixed search path.
 */
export function assertNoticeGrants({ json }, grants, { queue, due }) {
  assert.deepEqual(executeGrants(json, SIGNATURES), grants);
  for (const signature of SIGNATURES) assert.deepEqual(grants[signature], SERVICE_ONLY);
  assert.deepEqual(executeGrants(json, [queue, due]), {
    [queue]: SERVICE_ONLY,
    [due]: { anon: false, authenticated: false, service_role: false },
  });
  for (const [signature, definer] of [
    [queue, true],
    [due, false],
  ]) {
    const meta =
      json(`select jsonb_build_object('definer',prosecdef,'owner',proowner::regrole::text,'config',proconfig)
        from pg_proc where oid='${signature}'::regprocedure;`);
    assert.deepEqual(meta, { definer, owner: "postgres", config: ["search_path=pg_catalog"] });
  }
}
