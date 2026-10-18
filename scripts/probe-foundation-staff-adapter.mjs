import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHmac, randomBytes, randomUUID, createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { assertFixturePath } from "./lib/foundation-native-paths.mjs";
import { createFoundationAuthenticatedApi } from "../src/lib/foundation/authenticated-api.ts";
import {
  readFoundationListingDraft,
  saveFoundationListingTerms,
} from "../src/lib/foundation/owner-listing.ts";
import { testPublicNegotiable } from "./lib/foundation-negotiable-native.mjs";
import { readStaffIdentityHistory } from "../src/lib/foundation/staff-identity.ts";

// Bounded real Auth/SQL/SDK denial proof. No accepted-identity or physical bytes
// are fabricated. The only private history read has an empty subject history.
const negotiable = process.argv.length === 3 && process.argv[2] === "--negotiable";
assert.ok(process.argv.length === 2 || negotiable);
const { env, dockerArgs, workdir, cliPath } = nativeIsolation();
const release = acquireFixtureOperation(workdir, "test");
const recordedAt = new Date().toISOString();
const result = { recordedAt, status: "INCOMPLETE", productionMutations: [] };
let admin,
  stage = "preflight",
  sql;
const users = [];
try {
  const status = JSON.parse(
    execFileSync(process.execPath, [cliPath, "status", "-o", "json", "--workdir", workdir], {
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    })
  );
  assert.equal(status.API_URL, "http://127.0.0.1:55441");
  sql = (query) =>
    execFileSync(
      "docker",
      [
        ...dockerArgs,
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
        "-v",
        "VERBOSITY=verbose",
      ],
      { env, input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
    ).trim();
  assert.equal(sql("select count(*) from auth.users;"), "0");
  const options = {
    db: { schema: "api" },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  };
  admin = createClient(status.API_URL, status.SECRET_KEY, options);
  const reviewer = createClient(status.API_URL, status.PUBLISHABLE_KEY, options);
  const credentials = [];
  stage = "synthetic accounts";
  for (let n = 0; n < 3; n++) {
    const email = `foundation-adapter-probe-${randomUUID()}@example.invalid`,
      password = randomBytes(24).toString("base64url");
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.equal(created.error, null);
    const id = created.data.user.id;
    assert.match(id, /^[a-f0-9-]{36}$/);
    users.push(id);
    credentials.push({ email, password });
  }
  stage = "real reviewer TOTP";
  assert.equal((await reviewer.auth.signInWithPassword(credentials[0])).error, null);
  const enrolled = await reviewer.auth.mfa.enroll({ factorType: "totp" });
  assert.equal(enrolled.error, null);
  const challenge = await reviewer.auth.mfa.challenge({ factorId: enrolled.data.id });
  assert.equal(challenge.error, null);
  let bits = "";
  for (const ch of enrolled.data.totp.secret.replace(/=+$/, "").toUpperCase())
    bits += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(ch).toString(2).padStart(5, "0");
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const mac = createHmac("sha1", Buffer.from(bytes)).update(counter).digest(),
    offset = mac[mac.length - 1] & 15;
  const code = String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, "0");
  assert.equal(
    (
      await reviewer.auth.mfa.verify({
        factorId: enrolled.data.id,
        challengeId: challenge.data.id,
        code,
      })
    ).error,
    null
  );
  const token = (await reviewer.auth.getSession()).data.session.access_token;
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
  assert.equal(claims.aal, "aal2");
  assert.equal(claims.sub, users[0]);
  assert.match(claims.session_id, /^[a-f0-9-]{36}$/);
  stage = "exact synthetic roles";
  const roleId = sql(
    `insert into private.staff_roles(user_id,role) values('${users[0]}','governor') returning id;`
  );
  assert.match(roleId, /^[a-f0-9-]{36}$/);
  sql(`insert into private.staff_roles(user_id,role) values('${users[2]}','admin');`);
  const api = createFoundationAuthenticatedApi(
    {
      url: status.API_URL,
      expectedProjectRef: "local-foundation",
      publishableKey: status.PUBLISHABLE_KEY,
    },
    token
  );
  const read = () => readStaffIdentityHistory(api, { owner_id: users[1] });
  stage = "actual caller SDK history";
  const history = await read();
  assert.deepEqual(history.identities, []);
  assert.equal(history.next_cursor, null);
  const auditCount = sql(
    `select count(*) from private.evidence_access_log where staff_id='${users[0]}';`
  );
  assert.equal(auditCount, "1");
  stage = "complete revoked-role tuple denial";
  try {
    sql(
      `update private.staff_roles set revoked_at=clock_timestamp(),revoked_by='${users[2]}' where id='${roleId}' and user_id='${users[0]}';`
    );
    await assert.rejects(read, /^Error: Foundation identity history unavailable$/);
  } finally {
    sql(
      `update private.staff_roles set revoked_at=null,revoked_by=null where id='${roleId}' and user_id='${users[0]}';`
    );
  }
  stage = "expired real session denial";
  const prior = sql(
    `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='${claims.session_id}';`
  );
  try {
    sql(
      `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${claims.session_id}' and user_id='${users[0]}';`
    );
    await assert.rejects(read, /^Error: Foundation identity history unavailable$/);
  } finally {
    sql(
      `update auth.sessions set not_after=${prior} where id='${claims.session_id}' and user_id='${users[0]}';`
    );
  }
  assert.equal(
    sql(`select count(*) from private.evidence_access_log where staff_id='${users[0]}';`),
    auditCount
  );
  result.status = "PASS targeted real Auth/AAL2/current-role/session-expiry SDK denial proof";
  result.denials = ["revoked complete role tuple", "expired actual Auth session"];
  result.noAuditOnDeniedCalls = true;
  if (negotiable) {
    const checks = [];
    await testPublicNegotiable({
      rpc: async (name, body, callerToken, service = false) => {
        const response = await fetch(`${status.API_URL}/rest/v1/rpc/${name}`, {
          method: "POST",
          headers: {
            apikey: service ? status.SECRET_KEY : status.PUBLISHABLE_KEY,
            "Content-Type": "application/json",
            "Content-Profile": "api",
            ...(callerToken ? { Authorization: `Bearer ${callerToken}` } : {}),
          },
          body: JSON.stringify(body),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        });
        return { status: response.status, data: await response.json() };
      },
      sql,
      sqlFails: (query, code) => {
        let failure;
        try {
          sql(query);
        } catch (error) {
          failure = error;
        }
        assert.ok(failure);
        assert.ok(String(failure.stderr ?? "").includes(code));
      },
      createUser: async () => {
        const email = `foundation-price-probe-${randomUUID()}@example.invalid`,
          password = randomBytes(24).toString("base64url");
        const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        assert.equal(created.error, null);
        const id = created.data.user.id;
        assert.match(id, /^[a-f0-9-]{36}$/);
        users.push(id);
        const member = createClient(status.API_URL, status.PUBLISHABLE_KEY, options);
        const login = await member.auth.signInWithPassword({ email, password });
        assert.equal(login.error, null);
        return { id, member, token: login.data.session.access_token };
      },
      createReviewer: async () => ({ id: users[0], member: reviewer, token }),
      staff: { admin: { id: users[2] } },
      connection: {
        url: status.API_URL,
        expectedProjectRef: "local-foundation",
        publishableKey: status.PUBLISHABLE_KEY,
      },
      stage: (value) => {
        stage = value;
      },
      record: (id) => checks.push({ id, status: "PASS" }),
    });
    stage = "owner listing actual caller price form roundtrip";
    const member = createClient(status.API_URL, status.PUBLISHABLE_KEY, options);
    const login = await member.auth.signInWithPassword(credentials[1]);
    assert.equal(login.error, null);
    const ownerToken = login.data.session.access_token;
    const ownerClaims = JSON.parse(Buffer.from(ownerToken.split(".")[1], "base64url"));
    assert.equal(ownerClaims.sub, users[1]);
    const ownerApi = createFoundationAuthenticatedApi(
      {
        url: status.API_URL,
        expectedProjectRef: "local-foundation",
        publishableKey: status.PUBLISHABLE_KEY,
      },
      ownerToken
    );
    const created = await ownerApi.rpc("create_core_draft", {
      p_kind: "listing",
      p_area: "market",
      p_category_key: "electronics",
      p_detail: {},
    });
    assert.equal(created.error, null);
    const id = created.data.id;
    assert.match(id, /^[a-f0-9-]{36}$/);
    let draft = await readFoundationListingDraft(ownerApi, { id });
    assert.deepEqual(draft.form, { mode: "", amount: "", negotiable: false });
    for (const form of [
      { mode: "on_request", amount: "", negotiable: true },
      { mode: "free", amount: "", negotiable: false },
      { mode: "amount", amount: "100.01", negotiable: true },
      { mode: "on_request", amount: "", negotiable: true },
    ]) {
      draft = await saveFoundationListingTerms(ownerApi, { ...draft, form });
      assert.deepEqual(draft.form, form);
      assert.deepEqual(await readFoundationListingDraft(ownerApi, { id }), draft);
    }
    assert.equal(draft.expected_revision, 5);
    assert.equal(await readFoundationListingDraft(api, { id }), null);
    await assert.rejects(
      () => saveFoundationListingTerms(ownerApi, { ...draft, expected_revision: 1 }),
      /^Error: Foundation listing draft changed; reload before saving$/
    );
    await assert.rejects(
      () => saveFoundationListingTerms(api, draft),
      /^Error: Foundation listing draft changed; reload before saving$/
    );
    assert.deepEqual(await readFoundationListingDraft(ownerApi, { id }), draft);
    stage = "owner listing expired actual session denial";
    assert.match(ownerClaims.session_id, /^[a-f0-9-]{36}$/);
    const deadline = sql(
      `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where id='${ownerClaims.session_id}' and user_id='${users[1]}';`
    );
    assert.ok(deadline);
    try {
      sql(
        `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${ownerClaims.session_id}' and user_id='${users[1]}';`
      );
      await assert.rejects(
        () => readFoundationListingDraft(ownerApi, { id }),
        /^Error: Foundation listing draft unavailable$/
      );
      await assert.rejects(
        () => saveFoundationListingTerms(ownerApi, draft),
        /^Error: Foundation listing terms unavailable$/
      );
    } finally {
      sql(
        `update auth.sessions set not_after=${deadline} where id='${ownerClaims.session_id}' and user_id='${users[1]}';`
      );
    }
    assert.deepEqual(await readFoundationListingDraft(ownerApi, { id }), draft);
    result.ownerListingAdapter =
      "PASS explicit unset/request/free/amount terms, exact revision, foreign owner, stale revision and expired live session; no retry";
    result.negotiableChecks = checks;
    result.status = "PASS targeted real Auth/denials and public negotiable publication/edit proof";
  }
  result.provenance = Object.fromEntries(
    [
      "scripts/probe-foundation-staff-adapter.mjs",
      "scripts/lib/foundation-negotiable-native.mjs",
      "scripts/lib/foundation-activity-native.mjs",
      "docs/backend-foundation/prototypes/core-activity-create.sql",
      "src/lib/foundation/post-draft.ts",
      "scripts/lib/foundation-business-event-editor-native.mjs",
      "docs/backend-foundation/prototypes/owner-business-event-editor.sql",
      "src/lib/foundation/owner-business-event-editor.ts",
      "src/lib/foundation/owner-editor-media.ts",
      "scripts/lib/foundation-owner-editor-native.mjs",
      "docs/backend-foundation/prototypes/owner-listing-editor.sql",
      "src/lib/foundation/owner-listing-editor.ts",
      "src/lib/foundation/post-content.ts",
      "src/lib/domains/taxonomy/attributes.ts",
      "src/lib/domains/taxonomy/reference.json",
      "src/lib/foundation/public-api.ts",
      "src/lib/foundation/post-search.ts",
      "src/lib/foundation/owner-listing.ts",
      "src/lib/domains/posts/identity.ts",
      "src/lib/domains/posts/listing-draft.ts",
      "src/lib/domains/listings/price.ts",
      "src/lib/domains/listings/price-terms.ts",
      "src/lib/domains/listings/price-form.ts",
      "src/types/enums.ts",
      "src/lib/foundation/public-post-contract.ts",
      "src/lib/foundation/public-post.ts",
      "src/lib/foundation/reference-catalogue.ts",
      "docs/backend-foundation/prototypes/public-price-negotiable.sql",
      "src/lib/foundation/connection.ts",
      "src/lib/foundation/authenticated-api.ts",
      "src/lib/foundation/staff-identity.ts",
      "src/lib/supabase/fetch-with-timeout.ts",
    ].map((file) => [file, createHash("sha256").update(readFileSync(file)).digest("base64url")])
  );
} catch (error) {
  result.status = "FAIL";
  result.stage = stage;
  result.sqlState = String(error.stderr ?? "").match(/SQLSTATE\s+([A-Z0-9]{5})/)?.[1] ?? null;
  process.exitCode = 1;
} finally {
  try {
    if (users.length) {
      const ids = users.map((id) => `'${id}'`).join(",");
      sql(`begin;
        alter table private.evidence_access_log disable trigger evidence_access_log_append_only;
        alter table private.moderation_log disable trigger moderation_log_append_only;
        alter table private.queue_claim_events disable trigger queue_claim_events_append_only;
        delete from private.evidence_access_log where staff_id in(${ids});
        delete from private.moderation_log where staff_id in(${ids}) or post_id in(select id from private.posts where owner_id in(${ids}));
        delete from private.queue_claim_events where actor_id in(${ids}) or from_staff in(${ids}) or to_staff in(${ids});
        alter table private.evidence_access_log enable trigger evidence_access_log_append_only;
        alter table private.moderation_log enable trigger moderation_log_append_only;
        alter table private.queue_claim_events enable trigger queue_claim_events_append_only;
        delete from private.outbox_events where owner_id in(${ids});
        delete from private.queue_claims where post_id in(select id from private.posts where owner_id in(${ids}));
        delete from private.post_activations where owner_id in(${ids});
        delete from private.posts where owner_id in(${ids});
        delete from private.media_objects where owner_id in(${ids});
        delete from private.entitlements where owner_id in(${ids});
        delete from private.evidence_cases where subject_id in(${ids});
        delete from private.staff_roles where user_id in(${ids}); commit;`);
      for (const id of users) assert.equal((await admin.auth.admin.deleteUser(id)).error, null);
    }
    result.cleanup = "PASS exact synthetic cases/audit/roles/Auth removed; audit guard restored";
  } catch {
    result.cleanup = "INCOMPLETE";
    result.status = "INCOMPLETE";
    process.exitCode = 1;
  }
  release();
}
const path = `docs/backend-foundation/evidence/staff-adapter-probe-${recordedAt.replaceAll(":", "-")}.json`;
assertFixturePath(process.cwd(), path, { allowMissing: true, type: "file" });
writeFileSync(path, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
process.stdout.write(JSON.stringify({ ...result, evidencePath: path }) + "\n");
