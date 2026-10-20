import assert from "node:assert/strict";

/** Only for a verified isolated fixture's SQL connection and synthetic owner.
 * Preserve the exact session/account values so denial and race probes can
 * restore them even when their assertions fail.
 */
export function captureOwnerRestrictions(sql, owner) {
  const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
  assert.match(owner.id, uuid);
  const claims = JSON.parse(Buffer.from(owner.token.split(".")[1], "base64url"));
  assert.equal(claims.sub, owner.id);
  assert.match(claims.session_id, uuid);
  const sessionWhere = `id='${claims.session_id}' and user_id='${owner.id}'`;
  const accountWhere = `id='${owner.id}'`;
  const prior = sql(
    `select case when not_after is null then 'null' else quote_literal(not_after::text)||'::timestamptz' end from auth.sessions where ${sessionWhere};`
  );
  const banned = sql(
    `select case when banned_until is null then 'null' else quote_literal(banned_until::text)||'::timestamptz' end from auth.users where ${accountWhere};`
  );
  assert.ok(prior);
  assert.ok(banned);
  return {
    expireSession: () =>
      sql(
        `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where ${sessionWhere};`
      ),
    restoreSession: () => sql(`update auth.sessions set not_after=${prior} where ${sessionWhere};`),
    banAccount: () =>
      sql(
        `update auth.users set banned_until=clock_timestamp()+interval '1 hour' where ${accountWhere};`
      ),
    restoreAccount: () =>
      sql(`update auth.users set banned_until=${banned} where ${accountWhere};`),
  };
}
