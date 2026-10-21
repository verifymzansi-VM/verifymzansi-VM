import assert from "node:assert/strict";

/** Owner's own unreviewed legal-name claim, required before any identity
 * submission. Uses the real owner command; it never writes a verified name. */
export async function claimFixtureLegalName(rpc, owner) {
  const current = await rpc("get_my_profile", {}, owner.token);
  assert.equal(current.status, 200, "fixture profile read");
  if (current.data.legal_name_locked || current.data.legal_first_name) return current.data;
  const saved = await rpc(
    "save_my_legal_name",
    {
      p_expected_revision: current.data.revision,
      p_first_name: "Synthetic",
      p_last_name: "Fixture",
    },
    owner.token
  );
  assert.equal(saved.status, 200, "fixture legal name claim");
  return saved.data;
}
