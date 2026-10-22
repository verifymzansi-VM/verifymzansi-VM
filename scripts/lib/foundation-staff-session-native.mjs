import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPostingVerifier } from "./foundation-trusted-posting-fixture.mjs";

// Synthetic local proof that every staff role needs a verified authenticator
// app and a TOTP verification within 12 hours for any staff action, and within
// 15 minutes for sensitive ones. Clock aging edits only the local Auth AMR
// claim rows of synthetic sessions; no JWT is fabricated.
export async function testStaffSessionPolicy({
  createUser,
  rpc,
  sql,
  record,
  fixtureAdminId,
  stage,
}) {
  stage("staff session policy real TOTP staff");
  const claimsOf = (token) => JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
  const age = async (user, interval) => {
    const session = claimsOf(user.token).session_id;
    assert.match(interval, /^[0-9]+ (?:minutes|hours)$/);
    assert.equal(
      sql(
        "with aged as (update auth.mfa_amr_claims set created_at=clock_timestamp()-interval '" +
          interval +
          "',updated_at=clock_timestamp()-interval '" +
          interval +
          "' where session_id='" +
          session +
          "' and authentication_method='totp' returning 1) select count(*) from aged;"
      ),
      "1"
    );
    const refreshed = await user.member.auth.refreshSession();
    assert.equal(refreshed.error, null);
    user.token = refreshed.data.session.access_token;
    const claims = claimsOf(user.token);
    assert.equal(claims.aal, "aal2");
    assert.equal(claims.session_id, session);
  };
  const staff = {};
  for (const role of ["moderator", "governor", "admin"]) {
    const user = await createPostingVerifier({
      createUser,
      sql,
      fixtureAdminId,
      role,
      label: "session-policy-" + role,
    });
    staff[role] = user;
  }
  // Routine (no recent-MFA flag) and sensitive commands per role. Sensitive
  // probes target a random id: success is a not-found refusal after authority.
  const routine = {
    moderator: () => rpc("my_queue_claims", {}, staff.moderator.token),
    governor: () => rpc("my_queue_claims", {}, staff.governor.token),
    admin: () => rpc("staff_cost_overview", {}, staff.admin.token),
  };
  const sensitive = () =>
    rpc("acknowledge_cost_alarm", { p_alarm_id: randomUUID() }, staff.admin.token);
  for (const role of Object.keys(routine)) assert.equal((await routine[role]()).status, 200, role);
  const fresh = await sensitive();
  assert.notEqual(fresh.status, 403);
  record("native-staff-session-fresh-totp-routine-and-sensitive-authority");

  stage("staff session policy aged TOTP");
  for (const role of Object.keys(routine)) await age(staff[role], "11 hours");
  for (const role of Object.keys(routine)) assert.equal((await routine[role]()).status, 200, role);
  const stale = await sensitive();
  assert.equal(stale.status, 403);
  assert.equal(stale.data.message, "recent second-factor verification required");
  for (const role of Object.keys(routine)) await age(staff[role], "13 hours");
  for (const role of Object.keys(routine)) {
    const expired = await routine[role]();
    assert.equal(expired.status, 403, role);
    assert.equal(expired.data.message, "staff second-factor verification expired", role);
  }
  record("native-staff-session-every-role-totp-expires-after-12-hours-sensitive-after-15-minutes");

  stage("staff session policy authenticator removal");
  // A fresh TOTP verification restores authority without a new sign-in.
  for (const role of Object.keys(routine)) {
    await staff[role].refresh(true);
    assert.equal((await routine[role]()).status, 200, role);
  }
  // A live AAL2 session whose account has no verified TOTP factor (factor
  // unverified, or a non-TOTP factor type) grants nothing.
  const governor = staff.governor;
  const factorRow = (set) =>
    sql(
      "with changed as (update auth.mfa_factors set " +
        set +
        " where user_id='" +
        governor.id +
        "' returning 1) select count(*) from changed;"
    );
  for (const set of ["status='unverified'", "factor_type='phone'"]) {
    assert.equal(factorRow(set), "1");
    try {
      const denied = await rpc("my_queue_claims", {}, governor.token);
      assert.equal(denied.status, 403);
      assert.equal(denied.data.message, "verified authenticator app required");
      assert.equal(claimsOf(governor.token).aal, "aal2");
    } finally {
      assert.equal(factorRow("status='verified',factor_type='totp'"), "1");
    }
  }
  assert.equal((await rpc("my_queue_claims", {}, governor.token)).status, 200);
  // Removing the authenticator through Auth also ends staff authority.
  const moderator = staff.moderator;
  const factors = await moderator.member.auth.mfa.listFactors();
  assert.equal(factors.error, null);
  assert.equal(
    (await moderator.member.auth.mfa.unenroll({ factorId: factors.data.totp[0].id })).error,
    null
  );
  assert.equal(
    sql("select count(*) from auth.mfa_factors where user_id='" + moderator.id + "';"),
    "0"
  );
  assert.equal((await rpc("my_queue_claims", {}, moderator.token)).status, 403);
  record("native-staff-session-aal2-token-without-verified-authenticator-grants-nothing");
}
