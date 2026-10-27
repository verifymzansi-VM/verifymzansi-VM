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

/** Validate additive secrets planned for the same atomic deploy. Return only
 * binding metadata: never retain values in diagnostics or provider reports.
 * @param {Array<{name: string, type: string}>} bindings
 * @param {unknown} pending
 */
export function withPendingSecretBindings(bindings, pending) {
  if (!Array.isArray(bindings) || !pending || typeof pending !== "object" || Array.isArray(pending))
    throw new Error("Invalid pending secret bindings");
  const entries = Object.entries(pending);
  if (
    !entries.length ||
    entries.some(
      ([name, value]) =>
        !/^[A-Z][A-Z0-9_]{0,127}$/.test(name) ||
        typeof value !== "string" ||
        value.length < 20 ||
        value !== value.trim()
    )
  )
    throw new Error("Invalid pending secret bindings");
  const names = new Set(entries.map(([name]) => name));
  return [
    ...bindings.filter((binding) => !names.has(binding.name)),
    ...entries.map(([name]) => ({ name, type: "secret_text" })),
  ];
}

/** Compare public configuration only. Return names, never supplied values/keys.
 * Secret bindings are write-only; their presence cannot prove value equality. */
export function inspectPublicBindings(bindings, expected) {
  if (!Array.isArray(bindings)) throw new Error("Missing deployed version bindings");
  const invalid = [];
  for (const [name, value] of Object.entries(expected)) {
    const matches = bindings.filter((binding) => binding.name === name);
    if (
      typeof value !== "string" ||
      !value ||
      matches.length !== 1 ||
      matches[0].type !== "plain_text" ||
      matches[0].text !== value
    )
      invalid.push(name);
  }
  return invalid;
}
