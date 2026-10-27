import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { createPostingVerifier } from "./lib/foundation-trusted-posting-fixture.mjs";
import {
  readFoundationStaffAudit,
  readFoundationStaffDecisions,
} from "../src/lib/foundation/staff-read.ts";

assert.equal(process.argv.length, 2);
const isolation = nativeIsolation();
const release = acquireFixtureOperation(isolation.workdir, "test");
const result = {
  recordedAt: new Date().toISOString(),
  status: "INCOMPLETE",
  scope:
    "Owned local Auth/TOTP and staff read surfaces only; no hosted writes or provider delivery",
  checks: [],
  productionMutations: [],
};
const users = [];
const cases = [];
const clients = [];
let admin,
  sql,
  stage = "preflight";
const record = (name) => result.checks.push(name);
try {
  const status = JSON.parse(
    execFileSync(
      process.execPath,
      [isolation.cliPath, "status", "-o", "json", "--workdir", isolation.workdir],
      { env: isolation.env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
    )
  );
  assert.equal(status.API_URL, "http://127.0.0.1:55441");
  sql = (query) =>
    execFileSync(
      "docker",
      [
        ...isolation.dockerArgs,
        "exec",
        "-i",
        "supabase_db_backend-foundation-impl",
        "psql",
        "-XqAt",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
      ],
      {
        env: isolation.env,
        input: query,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      }
    ).trim();
  assert.equal(sql("select count(*) from auth.users;"), "0");
  result.sourceHash = createHash("sha256")
    .update(readFileSync("docs/backend-foundation/prototypes/staff-read-surfaces.sql"))
    .digest("base64url");
  const options = {
    db: { schema: "api", retry: false },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  };
  admin = createClient(status.API_URL, status.SECRET_KEY, options);
  const anonymous = createClient(status.API_URL, status.PUBLISHABLE_KEY, options);
  const createUser = async (label) => {
    const email = `staff-read-${label}-${randomUUID()}@example.invalid`,
      password = randomBytes(24).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null);
    const id = created.data.user.id;
    assert.match(id, /^[a-f0-9-]{36}$/);
    users.push(id);
    const member = createClient(status.API_URL, status.PUBLISHABLE_KEY, options);
    clients.push(member);
    const login = await member.auth.signInWithPassword({ email, password });
    assert.equal(login.error, null);
    return { id, member, token: login.data.session.access_token };
  };
  const plain = await createUser("member");
  const governor = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId: plain.id,
    role: "governor",
    label: "governor",
  });
  const operator = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId: plain.id,
    role: "admin",
    label: "admin",
  });
  const moderator = await createPostingVerifier({
    createUser,
    sql,
    fixtureAdminId: plain.id,
    role: "moderator",
    label: "moderator",
  });
  const rpc = (user, name, request = {}) => user.member.rpc(name, { p_request: request });
  stage = "role and base-table boundaries";
  for (const name of ["staff_audit_page", "staff_decision_page"]) {
    assert.notEqual((await anonymous.rpc(name, { p_request: {} })).error, null);
    assert.notEqual((await admin.rpc(name, { p_request: {} })).error, null);
    assert.equal((await rpc(plain, name)).error.code, "42501");
    assert.equal((await rpc(moderator, name)).error.code, "42501");
    for (const user of [governor, operator]) {
      const read = await rpc(user, name);
      assert.equal(read.error, null);
      assert.equal(read.data.version, 1);
    }
  }
  assert.equal(
    sql(
      "select count(*) from information_schema.role_table_grants where table_schema='private' and grantee in ('anon','authenticated','service_role');"
    ),
    "0"
  );
  record(
    "anon/service/member/moderator denied; assigned governor/admin with genuine TOTP accepted; no private table grants"
  );
  stage = "audit filtering and exact cursor";
  const first = await rpc(governor, "staff_audit_page", { limit: 1 });
  assert.equal(first.error, null);
  assert.equal(first.data.items.length, 1);
  assert.ok(first.data.next_cursor);
  const typedApi = { rpc: governor.member.rpc.bind(governor.member) };
  assert.equal((await readFoundationStaffAudit(typedApi, { limit: 1 })).items.length, 1);
  const second = await rpc(governor, "staff_audit_page", { limit: 1, ...first.data.next_cursor });
  assert.equal(second.error, null);
  assert.equal(second.data.items.length, 1);
  assert.notEqual(first.data.items[0].id, second.data.items[0].id);
  const granted = await rpc(governor, "staff_audit_page", {
    action: "staff:granted",
    actor: plain.id,
  });
  assert.equal(granted.error, null);
  assert.ok(granted.data.items.length >= 3);
  assert.ok(
    granted.data.items.every((row) => row.actor_id === plain.id && row.action === "staff:granted")
  );
  for (const request of [
    { limit: 0 },
    { limit: 101 },
    { before_at: new Date().toISOString() },
    { actor: null },
    { action: "%" },
    { from: "2026-10-27", to: "2026-10-01" },
    { unknown: "field" },
  ])
    assert.notEqual((await rpc(governor, "staff_audit_page", request)).error, null);
  record("staff audit keyset pagination, actor/action filters and malformed request refusal");
  stage = "proposal read model and two-person hints";
  const id = sql(
    `insert into private.evidence_cases(subject_id,kind) values('${plain.id}','restriction') returning id;`
  );
  assert.match(id, /^[a-f0-9-]{36}$/);
  cases.push(id);
  const proposed = await governor.member.rpc("propose_decision", {
    p_case_id: id,
    p_expected_version: 1,
    p_action: "reject",
    p_payload: { reason: "Synthetic staff-read fixture" },
  });
  assert.equal(proposed.error, null);
  const owned = await rpc(governor, "staff_decision_page", { id: proposed.data.decision_id });
  assert.equal(owned.error, null);
  assert.equal(owned.data.items.length, 1);
  assert.equal(
    (await readFoundationStaffDecisions(typedApi, governor.id, { id: proposed.data.decision_id }))
      .items.length,
    1
  );
  assert.equal(owned.data.caller_id, governor.id);
  assert.equal(owned.data.items[0].can_approve, false);
  assert.equal(owned.data.items[0].can_withdraw, true);
  const peer = await rpc(operator, "staff_decision_page", { id: proposed.data.decision_id });
  assert.equal(peer.error, null);
  assert.equal(peer.data.items[0].can_approve, true);
  for (const row of peer.data.items)
    for (const key of [
      "payload",
      "reviewed_snapshot",
      "object_key",
      "legal_first_name",
      "legal_last_name",
      "artifact_ids",
    ])
      assert.equal(Object.hasOwn(row, key), false);
  assert.equal(
    (await governor.member.rpc("approve_decision", { p_decision_id: proposed.data.decision_id }))
      .error.code,
    "42501"
  );
  for (const request of [
    { limit: 0 },
    { status: "unknown" },
    { action: "unknown" },
    { id: null },
    { before_id: randomUUID() },
    { unknown: true },
  ])
    assert.notEqual((await rpc(governor, "staff_decision_page", request)).error, null);
  record(
    "canonical proposal read, self-approval denied, distinct reviewer hint and no raw evidence/payload fields"
  );
  stage = "sensitive TOTP age and live authority changes";
  const claims = JSON.parse(Buffer.from(governor.token.split(".")[1], "base64url"));
  assert.match(claims.session_id, /^[a-f0-9-]{36}$/);
  sql(
    `update auth.mfa_amr_claims set created_at=clock_timestamp()-interval '20 minutes',updated_at=clock_timestamp()-interval '20 minutes' where session_id='${claims.session_id}' and authentication_method='totp';`
  );
  assert.equal((await governor.member.auth.refreshSession()).error, null);
  assert.equal((await rpc(governor, "staff_audit_page")).error.code, "42501");
  await governor.refresh(true);
  assert.equal((await rpc(governor, "staff_audit_page")).error, null);
  sql(
    `update private.staff_roles set revoked_at=clock_timestamp(),revoked_by='${operator.id}' where user_id='${governor.id}' and revoked_at is null;`
  );
  assert.equal((await rpc(governor, "staff_audit_page")).error.code, "42501");
  const savedToken = (await operator.member.auth.getSession()).data.session.access_token;
  assert.equal((await operator.member.auth.signOut({ scope: "local" })).error, null);
  const revoked = createClient(status.API_URL, status.PUBLISHABLE_KEY, {
    ...options,
    global: { headers: { Authorization: `Bearer ${savedToken}` } },
  });
  assert.equal((await revoked.rpc("staff_audit_page", { p_request: {} })).error.code, "42501");
  record(
    "aged TOTP negative fixture, genuine fresh re-verification, immediate role revocation and logged-out-session denial"
  );
  result.status = "PASS";
} catch (error) {
  result.status = "FAIL";
  result.stage = stage;
  result.errorCode = error?.code ?? "UNCLASSIFIED";
  process.exitCode = 1;
} finally {
  try {
    for (const client of clients) client.auth.stopAutoRefresh();
    if (sql && users.length) {
      const ids = users.map((id) => `'${id}'`).join(",");
      const caseIds = cases.map((id) => `'${id}'`).join(",");
      if (cases.length)
        sql(
          `begin; alter table private.decisions disable trigger decision_binding; delete from private.decisions where case_id in(${caseIds}); alter table private.decisions enable trigger decision_binding; delete from private.evidence_cases where id in(${caseIds}) and subject_id in(${ids}); commit;`
        );
      sql(`delete from private.staff_roles where user_id in(${ids});`);
      for (const id of users) assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
      assert.equal(sql("select count(*) from auth.users;"), "0");
    }
    result.cleanup = "PASS exact owned synthetic roles/cases/Auth removed";
  } catch {
    result.status = "INCOMPLETE";
    result.cleanup = "INCOMPLETE inspect owned staff-read fixtures";
    process.exitCode = 1;
  }
  release();
}
const evidencePath = `docs/backend-foundation/evidence/staff-read-${result.recordedAt.replaceAll(":", "-")}.json`;
writeFileSync(evidencePath, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ ...result, evidencePath }));
