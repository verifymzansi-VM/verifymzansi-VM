import assert from "node:assert/strict";

/** Uses the caller's real synthetic sponsorship and real PostgREST request.
 * The competing connection retains its post lock until the refusal and all
 * unchanged state have been observed; no timer decides the interleaving.
 */
export async function testSponsorshipBusy({
  sql,
  sqlFails,
  controlledSql,
  rpc,
  postId,
  sponsorshipId,
  token,
  record,
}) {
  for (const field of ["starts_at", "ends_at"])
    sqlFails(
      `update private.organisation_sponsorships set ${field}=null where id='${sponsorshipId}';`,
      "23514"
    );
  record("native-sponsorship-active-period-rejects-either-null-boundary");

  assert.equal(typeof controlledSql, "function");
  const state = () =>
    sql(
      `select jsonb_build_object('post',to_jsonb(p),'sponsorship',to_jsonb(s),'entitlement',to_jsonb(e))::text ` +
        `from private.organisation_sponsorships s join private.entitlements e on e.id=s.entitlement_id ` +
        `join private.posts p on p.id=s.post_id where s.id='${sponsorshipId}';`
    );
  const before = state();
  const holder = controlledSql(
    `begin; select id from private.posts where id='${postId}' for update; select 'EVIDENCE_LOCK_HELD:'||pg_backend_pid();`,
    { hold: true }
  );
  try {
    await holder.barrier;
    const response = await rpc(
      "end_sponsorship",
      { p_sponsorship: sponsorshipId, p_reason: "Synthetic busy post retirement" },
      token
    );
    assert.equal(response.status, 409);
    assert.equal(response.data.details, "sponsorship_busy");
    assert.equal(state(), before);
    record("native-sponsorship-busy-funded-post-refuses-without-partial-retirement");
  } finally {
    holder.close();
    assert.equal(await holder.done, 0);
  }
}
