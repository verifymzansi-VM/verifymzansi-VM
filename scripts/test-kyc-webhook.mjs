// Isolated PostgreSQL checks using checked-in schema definitions; no network or env loading.
import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs";
import assert from "node:assert/strict";

const read = (name) => fs.readFileSync(`supabase/migrations/${name}`, "utf8");
const initial = read("20240101000000_initial_schema.sql");
const fraud = read("20260224000000_kyc_fraud_resistant_schema.sql");
const match = (source, pattern) => {
  const result = source.match(pattern);
  assert(result, `Missing schema definition ${pattern}`);
  return result[0];
};
const db = new PGlite();
const uuid = () => crypto.randomUUID();
const call = async (ref, status, scores = {}, ocr = null, raw = null) => {
  const result = await db.query(
    "SELECT public.apply_kyc_provider_webhook($1,$2,$3,$4,$5) AS result",
    [ref, status, scores, ocr, raw]
  );
  return result.rows[0].result;
};
async function snapshot(id) {
  return (
    await db.query(
      `SELECT p.provider_status,p.face_match_score,p.ocr_payload,s.risk_score,s.risk_level,s.auto_status
    FROM kyc_provider_results p JOIN verification_steps s ON s.user_id=p.user_id WHERE p.id=$1`,
      [id]
    )
  ).rows[0];
}
async function fixture({ risk = 20, stepStatus = "pending", ref = uuid() } = {}) {
  const user = uuid(),
    artifact = uuid(),
    result = uuid();
  await db.query("INSERT INTO auth.users VALUES ($1)", [user]);
  await db.query(
    "INSERT INTO verification_steps(user_id,step_type,status,risk_score) VALUES ($1,'id_doc',$2,$3)",
    [user, stepStatus, risk]
  );
  await db.query(
    "INSERT INTO kyc_artifacts(id,user_id,step_type,r2_key,content_type,file_size_bytes) VALUES ($1,$2,'id_doc','test','image/jpeg',1)",
    [artifact, user]
  );
  await db.query("INSERT INTO verification_sessions(user_id,id_artifact_id) VALUES ($1,$2)", [
    user,
    artifact,
  ]);
  await db.query(
    "INSERT INTO kyc_provider_results(id,user_id,artifact_id,provider_status,provider_ref,face_match_score) VALUES ($1,$2,$3,'pending',$4,80)",
    [result, user, artifact, ref]
  );
  return { user, artifact, result, ref };
}

try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
    ${[
      "verification_step_type",
      "verification_status",
      "document_type",
      "location_method",
      "user_role",
      "marketplace_area",
    ]
      .map((type) => match(initial, new RegExp(`CREATE TYPE ${type} AS ENUM \\([\\s\\S]*?;`)))
      .join("\n")}
    ALTER TYPE user_role ADD VALUE 'system';
    ${["verification_steps", "kyc_artifacts", "audit_logs"]
      .map((table) => match(initial, new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\);`)))
      .join("\n")}
    ${match(fraud, /ALTER TABLE verification_steps[\s\S]*?id_number_hmac TEXT;/)}
    ${["verification_sessions", "kyc_provider_results"]
      .map((table) =>
        match(fraud, new RegExp(`CREATE TABLE IF NOT EXISTS ${table} \\([\\s\\S]*?\\n\\);`))
      )
      .join("\n")}
    GRANT USAGE ON SCHEMA public TO service_role,anon,authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;`);
  // Reproduce the old lookup against the actual migration schema.
  await assert.rejects(
    db.query("SELECT updated_at FROM kyc_provider_results"),
    (error) => error.code === "42703"
  );
  const migration = read("20260930170000_atomic_kyc_provider_webhook.sql");
  await db.exec(migration);
  await db.exec(migration);

  const approved = await fixture();
  await db.exec("SET ROLE service_role");
  assert.equal((await call(approved.ref, "approved", { liveness_score: 90 })).outcome, "applied");
  await db.exec("RESET ROLE");
  assert.deepEqual(await snapshot(approved.result), {
    provider_status: "approved",
    face_match_score: "80.00",
    ocr_payload: {},
    risk_score: 20,
    risk_level: "low",
    auto_status: "approved",
  });
  assert.equal((await call(approved.ref, "rejected")).outcome, "duplicate");
  assert.equal((await snapshot(approved.result)).provider_status, "approved");

  const rejected = await fixture();
  const repeated = await Promise.all([
    call(rejected.ref, "rejected"),
    call(rejected.ref, "rejected"),
  ]);
  assert.deepEqual(repeated.map((r) => r.outcome).sort(), ["applied", "duplicate"]);
  assert.equal((await snapshot(rejected.result)).risk_score, 50);
  assert.equal((await snapshot(rejected.result)).risk_level, "medium");
  assert.equal(
    (
      await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE target_id=$1", [
        rejected.result,
      ])
    ).rows[0].n,
    1
  );
  const critical = await fixture({ risk: 90 });
  await call(critical.ref, "rejected");
  assert.equal((await snapshot(critical.result)).risk_score, 100);
  const manual = await fixture();
  await call(manual.ref, "needs_manual_review", {}, { test: true });
  assert.equal((await snapshot(manual.result)).auto_status, "needs_manual_review");
  assert.deepEqual((await snapshot(manual.result)).ocr_payload, { test: true });

  const decided = await fixture({ stepStatus: "approved" });
  await call(decided.ref, "rejected");
  assert.equal((await snapshot(decided.result)).risk_score, 20);
  assert.equal((await snapshot(decided.result)).auto_status, null);
  // Provider callback arrives after engine persistence but before first step.
  const beforeStep = await fixture();
  await db.query("DELETE FROM verification_steps WHERE user_id=$1", [beforeStep.user]);
  await db.query("DELETE FROM verification_sessions WHERE user_id=$1", [beforeStep.user]);
  await assert.rejects(call(beforeStep.ref, "rejected"), (error) => error.code === "40001");
  assert.equal(
    (
      await db.query("SELECT provider_status FROM kyc_provider_results WHERE id=$1", [
        beforeStep.result,
      ])
    ).rows[0].provider_status,
    "pending",
    "an unpublished first upload remains retryable"
  );
  assert.equal(
    (
      await db.query("SELECT count(*)::int AS n FROM audit_logs WHERE target_id=$1", [
        beforeStep.result,
      ])
    ).rows[0].n,
    0,
    "a retryable callback cannot leave a committed audit"
  );
  await db.query(
    "INSERT INTO verification_steps(user_id,step_type,status,risk_score) VALUES($1,'id_doc','pending',20)",
    [beforeStep.user]
  );
  await db.query("INSERT INTO verification_sessions(user_id,id_artifact_id) VALUES($1,$2)", [
    beforeStep.user,
    beforeStep.artifact,
  ]);
  assert.equal((await call(beforeStep.ref, "rejected")).outcome, "applied");
  assert.equal((await snapshot(beforeStep.result)).risk_score, 50);

  // Replacement step is saved, but canonical session still points to old upload.
  const betweenStepAndSession = await fixture();
  const previousArtifact = uuid();
  await db.query(
    "INSERT INTO kyc_artifacts(id,user_id,step_type,r2_key,content_type,file_size_bytes,status,created_at) VALUES($1,$2,'id_doc','old','image/jpeg',1,'rejected',now()-interval '1 day')",
    [previousArtifact, betweenStepAndSession.user]
  );
  await db.query("UPDATE verification_sessions SET id_artifact_id=$1 WHERE user_id=$2", [
    previousArtifact,
    betweenStepAndSession.user,
  ]);
  await assert.rejects(
    call(betweenStepAndSession.ref, "rejected"),
    (error) => error.code === "40001"
  );
  assert.equal((await snapshot(betweenStepAndSession.result)).provider_status, "pending");
  assert.equal((await snapshot(betweenStepAndSession.result)).risk_score, 20);
  await db.query("UPDATE verification_sessions SET id_artifact_id=$1 WHERE user_id=$2", [
    betweenStepAndSession.artifact,
    betweenStepAndSession.user,
  ]);
  assert.equal((await call(betweenStepAndSession.ref, "rejected")).outcome, "applied");
  assert.equal((await snapshot(betweenStepAndSession.result)).risk_score, 50);

  // A first step without its canonical session publication is also retryable.
  const beforeSession = await fixture();
  await db.query("UPDATE verification_sessions SET id_artifact_id=NULL WHERE user_id=$1", [
    beforeSession.user,
  ]);
  await assert.rejects(call(beforeSession.ref, "approved"), (error) => error.code === "40001");
  assert.equal((await snapshot(beforeSession.result)).provider_status, "pending");
  await db.query("UPDATE verification_sessions SET id_artifact_id=$1 WHERE user_id=$2", [
    beforeSession.artifact,
    beforeSession.user,
  ]);
  assert.equal((await call(beforeSession.ref, "approved")).outcome, "applied");
  const stale = await fixture();
  const newerArtifact = uuid();
  await db.query(
    "INSERT INTO kyc_artifacts(id,user_id,step_type,r2_key,content_type,file_size_bytes,created_at) VALUES ($1,$2,'id_doc','new','image/jpeg',1,now()+interval '1 second')",
    [newerArtifact, stale.user]
  );
  await db.query("UPDATE verification_sessions SET id_artifact_id=$1 WHERE user_id=$2", [
    newerArtifact,
    stale.user,
  ]);
  await call(stale.ref, "rejected");
  assert.equal(
    (await snapshot(stale.result)).risk_score,
    20,
    "Old upload must not decide the replacement"
  );
  const superseded = await fixture();
  await db.query("UPDATE kyc_artifacts SET status='rejected' WHERE id=$1", [superseded.artifact]);
  await db.query("UPDATE verification_sessions SET id_artifact_id=NULL WHERE user_id=$1", [
    superseded.user,
  ]);
  assert.equal((await call(superseded.ref, "rejected")).outcome, "applied");
  assert.equal((await snapshot(superseded.result)).risk_score, 20);
  assert.equal((await snapshot(superseded.result)).auto_status, null);

  const rollback = await fixture();
  await db.exec(`CREATE FUNCTION reject_test_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Simulated write failure'; END $$;
    CREATE TRIGGER reject_test_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_test_audit();`);
  await assert.rejects(call(rollback.ref, "rejected"));
  assert.equal((await snapshot(rollback.result)).provider_status, "pending");
  assert.equal((await snapshot(rollback.result)).risk_score, 20);
  await db.exec("DROP TRIGGER reject_test_audit ON audit_logs");
  assert.equal(
    (await call(rollback.ref, "rejected")).outcome,
    "applied",
    "Failure stays retryable"
  );
  assert.equal((await call("unknown-ref", "approved")).outcome, "unknown");
  await assert.rejects(call(rollback.ref, "invalid"), (error) => error.code === "22023");
  const ambiguous = await fixture({ ref: "ambiguous" });
  await fixture({ ref: ambiguous.ref });
  await assert.rejects(call(ambiguous.ref, "approved"), (error) => error.code === "P0003");
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    try {
      await assert.rejects(call(approved.ref, "approved"), (error) => error.code === "42501");
    } finally {
      await db.exec("RESET ROLE");
    }
  }
  console.log(
    "KYC callback checks passed: schema, atomic rollback/retry, upload publication retries, immediate callbacks, duplicates, risk, stale/decided steps, audit and service-only execution."
  );
} finally {
  await db.close();
}
