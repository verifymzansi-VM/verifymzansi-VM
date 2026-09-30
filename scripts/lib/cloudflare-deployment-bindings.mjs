/** @param {Array<{created_on: string, versions: Array<{version_id: string, percentage: number}>}>} deployments */
export function activeVersionIds(deployments) {
  if (!Array.isArray(deployments) || deployments.length === 0) {
    throw new Error("No deployments found for worker");
  }
  const current = [...deployments].sort(
    (a, b) => Date.parse(b.created_on) - Date.parse(a.created_on)
  )[0];
  const versions = current?.versions;
  if (
    !Array.isArray(versions) ||
    versions.length === 0 ||
    versions.some(
      (v) =>
        typeof v.version_id !== "string" ||
        !v.version_id ||
        !Number.isFinite(v.percentage) ||
        v.percentage < 0 ||
        v.percentage > 100
    ) ||
    Math.abs(versions.reduce((sum, v) => sum + v.percentage, 0) - 100) > 0.001
  ) {
    throw new Error("Invalid active deployment traffic allocation");
  }
  return [...new Set(versions.filter((v) => v.percentage > 0).map((v) => v.version_id))];
}

/**
 * @param {Array<{name: string, type: string}>} bindings
 * @param {string[]} required
 * @param {string[]} forbidden
 */
export function inspectSecretBindings(bindings, required, forbidden) {
  if (!Array.isArray(bindings)) throw new Error("Missing deployed version bindings");
  const names = new Set(bindings.map((binding) => binding.name));
  const secrets = new Set(
    bindings.filter((binding) => binding.type === "secret_text").map((binding) => binding.name)
  );
  return {
    missing: required.filter((name) => !names.has(name)),
    unsafe: required.filter((name) => names.has(name) && !secrets.has(name)),
    forbidden: forbidden.filter((name) => names.has(name)),
  };
}
