import assert from "node:assert/strict";

/** Remove only a process created by this rehearsal, including a create whose
 * response was lost. Never reuse, infer ownership of, or delete an existing one.
 */
export function removeOwnedBaselineContainer({
  docker,
  inspect,
  name,
  label,
  nonce,
  ownedId,
  createAttempted,
}) {
  assert.ok(["vm-foundation-baseline-auth", "vm-foundation-baseline-http"].includes(name));
  assert.equal(label, `vm.foundation.${name.endsWith("auth") ? "auth" : "http"}-proof`);
  assert.match(nonce, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  let target = ownedId;
  if (!target && createAttempted && docker(["ps", "-aq", "--filter", `name=^/${name}$`])) {
    const candidate = inspect(name);
    assert.equal(candidate.Config.Labels[label], nonce);
    target = candidate.Id;
  }
  if (!target) return false;
  assert.equal(createAttempted, true);
  assert.match(target, /^[a-f0-9]{64}$/);
  assert.equal(inspect(target).Config.Labels[label], nonce);
  docker(["rm", "--force", target]);
  return true;
}
