import assert from "node:assert/strict";
import { createPostingVerifier } from "./foundation-trusted-posting-fixture.mjs";

/** Real local JWT/PostgREST proof. No hosted project, email or role bootstrap. */
export async function testAccountContext({ createUser, rpc, sql, record, fixtureAdminId, stage }) {
  stage("account context member ownership and metadata isolation");
  const owner = await createUser("account-context-owner", { postingTerms: false });
  const other = await createUser("account-context-other", { postingTerms: false });
  const read = async (user) => {
    const result = await rpc("get_my_account_context", {}, user.token);
    assert.equal(result.status, 200, "current account context must be available");
    return result.data;
  };
  const initial = await read(owner);
  assert.deepEqual(
    Object.keys(initial).sort(),
    ["version", "account_id", "email", "phone", "profile", "totp_enrolled", "staff"].sort()
  );
  assert.equal(initial.version, 1);
  assert.equal(initial.account_id, owner.id);
  assert.ok(initial.email.startsWith("foundation-account-context-owner-"));
  assert.equal(initial.phone, null);
  assert.equal(initial.staff, null);
  assert.equal(initial.totp_enrolled, false);
  assert.equal(initial.profile.identity_verified, false);
  const otherContext = await read(other);
  assert.equal(otherContext.account_id, other.id);
  assert.ok(otherContext.email.startsWith("foundation-account-context-other-"));
  const changed = await owner.member.auth.updateUser({
    data: { role: "admin", staff_role: "governor", account_id: other.id },
  });
  assert.equal(changed.error, null);
  const refreshed = await owner.member.auth.refreshSession();
  assert.equal(refreshed.error, null);
  owner.token = refreshed.data.session.access_token;
  assert.equal(
    JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url").toString()).user_metadata.role,
    "admin"
  );
  const poisoned = await read(owner);
  assert.equal(poisoned.account_id, owner.id);
  assert.equal(poisoned.staff, null);
  assert.equal(poisoned.profile.identity_verified, false);
  record("native-account-context-is-own-profile-and-ignores-user-editable-authority");
  assert.ok([401, 403].includes((await rpc("get_my_account_context", {}, null)).status));
  const extra = await rpc("get_my_account_context", { p_user_id: other.id }, owner.token);
  assert.ok([400, 404].includes(extra.status), "caller-selected account ids are refused");
  assert.equal(
    sql(
      "select has_function_privilege('anon','api.get_my_account_context()','execute')::text||'|'||has_function_privilege('service_role','api.get_my_account_context()','execute')::text;"
    ),
    "false|false"
  );
  record("native-account-context-no-anon-service-or-caller-selected-subject");

  stage("account context canonical staff second-factor gate");
  for (const role of ["moderator", "governor", "admin"]) {
    const staff = await createPostingVerifier({
      createUser,
      sql,
      fixtureAdminId,
      role,
      label: "account-context-" + role,
    });
    const context = await read(staff);
    assert.equal(context.staff.role, role);
    assert.equal(context.staff.can_access, true);
    assert.equal(context.totp_enrolled, true);
    assert.ok(context.staff.assigned_capabilities.includes("queue:view"));
    const session = JSON.parse(
      Buffer.from(staff.token.split(".")[1], "base64url").toString()
    ).session_id;
    assert.match(session, /^[0-9a-f-]{36}$/);
    sql(
      "update auth.mfa_amr_claims set created_at=clock_timestamp()-interval '13 hours',updated_at=clock_timestamp()-interval '13 hours' where session_id='" +
        session +
        "' and authentication_method='totp';"
    );
    const rotated = await staff.member.auth.refreshSession();
    assert.equal(rotated.error, null);
    staff.token = rotated.data.session.access_token;
    const expired = await read(staff);
    assert.equal(expired.staff.role, role);
    assert.equal(expired.staff.can_access, false);
    assert.equal(expired.totp_enrolled, true);
  }
  record("native-account-context-all-staff-roles-reuse-live-totp-freshness-policy");
}
