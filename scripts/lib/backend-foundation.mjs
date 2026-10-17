/** Offline foundation checks. No environment loading, credentials, HTTP, or mutations. */
export const RESOURCE_KEYS = [
  "supabaseProject",
  "authProject",
  "publicStorage",
  "privateStorage",
  "temporaryStorage",
  "backupStorage",
  "limiter",
  "queue",
  "cache",
  "worker",
  "hostname",
  "credentialSet",
];

const identifier = (value) =>
  typeof value === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{1,199}$/.test(value);
const resourceIdentifier = (key, value) => {
  if (typeof value !== "string" || value !== value.toLowerCase()) return false;
  if (["supabaseProject", "authProject"].includes(key))
    return /^[a-z]{20}$|^local:[a-z0-9-]+$/.test(value);
  if (key.endsWith("Storage"))
    return /^(r2|supabase-storage|local):[a-z0-9][a-z0-9._:-]{1,199}$/.test(value);
  if (["limiter", "queue", "cache"].includes(key))
    return /^(kv|d1|queue|r2|local):[a-z0-9][a-z0-9._:-]{1,199}$/.test(value);
  if (key === "credentialSet") return /^secret-set:[a-z0-9][a-z0-9._-]{1,199}$/.test(value);
  if (key === "hostname")
    return (
      value.length <= 253 &&
      /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/.test(
        value
      )
    );
  return /^[a-z0-9][a-z0-9.-]{1,199}$/.test(value);
};
const safeLabel = (value) =>
  identifier(value) &&
  !/(sb_(secret|publishable)_|github_pat_|gh[pousr]_|sk[-_]|^eyJ|AKIA)/i.test(value);

/** Compares declared identities only. Passing is not proof of deployed bindings or key provenance. */
export function checkIsolation(manifest, environment) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push("Unsupported manifest version");
  if (!["local", "benchmark", "staging", "target"].includes(environment)) {
    return { status: "FAIL", errors: ["Only non-production fixture environments may be checked"] };
  }
  const resources = manifest?.environments ?? {};
  if (
    Object.keys(resources).some(
      (name) => !["production", "local", "benchmark", "staging", "target"].includes(name)
    )
  ) {
    return { status: "FAIL", errors: ["Unknown environment name in manifest"] };
  }
  const selected = resources[environment];
  if (!selected) return { status: "INCOMPLETE", errors: ["Environment is not configured"] };
  if (
    !resources.production ||
    typeof resources.production !== "object" ||
    Array.isArray(resources.production)
  ) {
    errors.push("Production resource baseline missing or malformed");
  }
  for (const key of RESOURCE_KEYS) {
    if (!resourceIdentifier(key, resources.production?.[key]))
      errors.push(`Production baseline missing or invalid ${key}`);
  }
  const protectedEnvironments = Object.entries(resources).filter(([name]) => name !== environment);
  const protectedIds = new Set(
    protectedEnvironments.flatMap(([, entry]) =>
      RESOURCE_KEYS.map((key) => entry?.[key])
        .filter(identifier)
        .map((value) => value.toLowerCase())
    )
  );
  for (const [name, entry] of protectedEnvironments) {
    if (entry === null) continue; // Explicitly uncreated; not an observed resource.
    for (const key of RESOURCE_KEYS) {
      if (!resourceIdentifier(key, entry?.[key]))
        errors.push(`Protected baseline ${name} missing or invalid ${key}`);
    }
  }
  for (const key of RESOURCE_KEYS) {
    if (!resourceIdentifier(key, selected[key])) errors.push(`Missing or invalid ${key}`);
    else if (protectedIds.has(selected[key])) errors.push(`Shared resource: ${key}`);
  }
  if (selected.authProject !== selected.supabaseProject)
    errors.push("Auth and database identity differ");
  const storage = ["publicStorage", "privateStorage", "temporaryStorage", "backupStorage"].map(
    (key) => selected[key]
  );
  if (new Set(storage).size !== storage.length) errors.push("Storage purposes share a resource");
  if (selected.fixtureData !== "synthetic-only")
    errors.push("Synthetic fixture declaration missing");
  for (const provider of ["mail", "sms", "payments", "scanner"]) {
    if (selected.providers?.[provider] !== "stub")
      errors.push(`Provider must be stub for this local fixture gate: ${provider}`);
  }
  return {
    status: errors.length ? "FAIL" : "PASS",
    errors,
    scope:
      "Declared fixture identity only; deployed bindings, secret provenance and provider delivery require separate proof",
  };
}

export function quantile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)];
}

/** Summarizes observations without hiding failures or pooling distinct network paths. */
export function summarizeRegionSamples(samples) {
  if (!Array.isArray(samples)) throw new Error("Samples must be an array");
  const groups = new Map();
  const dimensions = [
    "region",
    "city",
    "connection",
    "carrier",
    "probeId",
    "edgeColo",
    "window",
    "path",
    "transport",
    "placement",
    "cacheState",
    "datasetHash",
    "compute",
    "payloadClass",
  ];
  for (const sample of samples) {
    if (
      !sample ||
      !dimensions.every((key) => safeLabel(sample[key])) ||
      !["warm", "cold"].includes(sample.cacheState) ||
      typeof sample.ok !== "boolean" ||
      !(
        (sample.totalMs === null && !sample.ok) ||
        (Number.isFinite(sample.totalMs) && sample.totalMs >= 0)
      ) ||
      !(
        (sample.ttfbMs === null && !sample.ok) ||
        (Number.isFinite(sample.ttfbMs) && sample.ttfbMs >= 0)
      ) ||
      (sample.totalMs !== null && sample.ttfbMs !== null && sample.ttfbMs > sample.totalMs) ||
      !Number.isSafeInteger(sample.queryCount) ||
      sample.queryCount < 0 ||
      (sample.dbMs !== null && (!Number.isFinite(sample.dbMs) || sample.dbMs < 0))
    ) {
      throw new Error("Invalid sample: dimensions, outcome, timings or query count");
    }
    const key = JSON.stringify(dimensions.map((name) => sample[name]));
    const group = groups.get(key) ?? {
      dimensions: Object.fromEntries(dimensions.map((name) => [name, sample[name]])),
      samples: [],
    };
    group.samples.push(sample);
    groups.set(key, group);
  }
  return [...groups.values()].map(({ dimensions: labels, samples: rows }) => {
    const success = rows.filter((row) => row.ok);
    const total = success.map((row) => row.totalMs);
    const ttfb = success.map((row) => row.ttfbMs);
    return {
      ...labels,
      attempted: rows.length,
      succeeded: success.length,
      measuredTotalCount: total.length,
      measuredTtfbCount: ttfb.length,
      measuredDbCount: success.filter((row) => row.dbMs !== null).length,
      failed: rows.length - success.length,
      failureRate: (rows.length - success.length) / rows.length,
      minimumSamplesMet: rows.length >= (labels.cacheState === "warm" ? 100 : 20),
      totalMs: {
        p50: quantile(total, 0.5),
        p95: quantile(total, 0.95),
        p99: quantile(total, 0.99),
      },
      ttfbMs: { p50: quantile(ttfb, 0.5), p95: quantile(ttfb, 0.95), p99: quantile(ttfb, 0.99) },
      minQueryCount: Math.min(...rows.map((row) => row.queryCount)),
      maxQueryCount: Math.max(...rows.map((row) => row.queryCount)),
      queryCountConsistent: new Set(rows.map((row) => row.queryCount)).size === 1,
      dbP95Ms: quantile(
        success.filter((row) => row.dbMs !== null).map((row) => row.dbMs),
        0.95
      ),
    };
  });
}
