// Isolated PostgreSQL job lease regression. Never connects to a remote database.
import assert from "node:assert/strict";
import { createAdminDb } from "./lib/admin-db.mjs";

const { db, uuid, asService, migrate } = await createAdminDb();
await migrate(
  "20260927110000_staff_roles_authority.sql",
  "20260927110100_staff_role_changes.sql",
  "20260927120000_decision_execution_layer.sql",
  "20260930234241_operation_job_attempt_fencing.sql"
);
const id = uuid();
await db.query(
  "INSERT INTO operation_jobs(id,operation_key,kind,payload) VALUES($1,$2,'email_notice','{}')",
  [id, `test/${id}`]
);
const claim = () =>
  asService(
    async () =>
      (await db.query("SELECT attempts,locked_until::text FROM claim_operation_jobs(1)")).rows[0]
  );
const complete = (job, ok = true) =>
  asService(
    async () =>
      (
        await db.query("SELECT complete_operation_job($1,$2,NULL,$3,$4) AS result", [
          id,
          ok,
          job.attempts,
          job.locked_until,
        ])
      ).rows[0].result
  );
const first = await claim();
assert.equal(first.attempts, 1);
await db.query("UPDATE operation_jobs SET locked_until=now()-interval '1 second' WHERE id=$1", [
  id,
]);
assert.equal(
  await complete(first),
  null,
  "expired lease cannot complete even before another claim"
);
const second = await claim();
assert.equal(second.attempts, 2);
for (const ok of [true, false]) {
  assert.equal(await complete(first, ok), null);
  const current = (
    await db.query("SELECT status,attempts,locked_until FROM operation_jobs WHERE id=$1", [id])
  ).rows[0];
  assert.equal(current.status, "running");
  assert.equal(current.attempts, 2);
  assert(current.locked_until);
}
assert.equal(await complete(second), "succeeded");
assert.equal(await complete(second), null);
await assert.rejects(
  asService(() => db.query("SELECT complete_operation_job($1,true,NULL)", [id])),
  /permission denied/
);
await db.exec("SET ROLE authenticated");
await assert.rejects(
  db.query("SELECT complete_operation_job($1,true,NULL,2,now())", [id]),
  /permission denied/
);
await db.exec("RESET ROLE");
await db.close();
console.log(
  "Operation job lease checks passed: stale success/failure rejected, current claim completes once, old/member RPC access denied (PGlite; sequential lease simulation)."
);
