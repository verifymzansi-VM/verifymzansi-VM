import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dependencyAuditVerdict } from "../dependency-audit-policy";
export const BRACES_ADVISORY = "GHSA-vfj7-8cjw-p6xm";
const UPSTREAM_COMMIT = "28d440b5dd449dbf1fe6f3506cf94ecca4d02660";
const PATCH_HASH = "uSLl0knP5Xd1WxK7l1lVB5PxpFE3x40onWfWl856DUU";
const SOURCE_HASHES: Record<string, string> = {
  "lib/constants.js": "-ftoiVkjLu4-ateQalsOMjSBXbSe6Ffvhpg9ZbkX3Hw",
  "lib/parse.js": "sb92b7pqYgNfeOy9qKX9lOkhqhwewM3z9GfpyDar7VU",
  "lib/compile.js": "tlH3cV5tuJQs5h0zlDV7TYHI7OiCQKoxpFjqEWXt0ZU",
  "lib/expand.js": "fqPhTCsrJW7yRP09g7j8qiCqIjK05tdow7tqtWf2bPU",
  "lib/stringify.js": "Sdwti6-nTzRxWhioRby4LOZsqvO6tM8ReZjgax-aUKk",
  "index.js": "My6gfHsAY2Gq0SqplMp13B246DgriEkJ4vOPELhciKQ",
  "lib/utils.js": "tadZaqZ3MEErPAKe8J6E5rZ7jkRc_9NdHSlVSciQZsc",
};
const digest = (source: string) =>
  createHash("sha256").update(source.replace(/\r\n/g, "\n")).digest("base64url");
/** Only actual, hash-verified installed fixes can satisfy a registry finding.
 * Enumerate nested module trees too: a patched hoisted copy is insufficient. */
export async function verifyBracesBackport(root = process.cwd()) {
  const instances: string[] = [];
  const visited = new Set<string>();
  async function modules(directory: string) {
    let resolved: string;
    try {
      resolved = await realpath(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (visited.has(resolved)) return;
    visited.add(resolved);
    const entries = await readdir(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".") || (!entry.isDirectory() && !entry.isSymbolicLink())) continue;
      const entryPath = path.join(resolved, entry.name);
      if (entry.name.startsWith("@")) {
        await modules(entryPath);
        continue;
      }
      if (entry.name === "braces") instances.push(await realpath(entryPath));
      await modules(path.join(entryPath, "node_modules"));
    }
  }
  try {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const review = JSON.parse(
      await readFile(path.join(root, "patches/braces@3.0.3.review.json"), "utf8")
    );
    if (
      pkg.pnpm?.patchedDependencies?.["braces@3.0.3"] !== "patches/braces@3.0.3.patch" ||
      review.schemaVersion !== 1 ||
      review.advisory !== BRACES_ADVISORY ||
      review.upstreamCommit !== UPSTREAM_COMMIT ||
      review.version !== "3.0.3" ||
      review.patchPath !== "patches/braces@3.0.3.patch" ||
      review.patchSha256 !== PATCH_HASH ||
      digest(await readFile(path.join(root, review.patchPath), "utf8")) !== review.patchSha256
    )
      throw new Error("Missing or changed patch registration/provenance");
    await modules(path.join(root, "node_modules"));
    if (!instances.length) throw new Error("Installed braces not found");
    for (const instance of new Set(instances)) {
      const installed = JSON.parse(await readFile(path.join(instance, "package.json"), "utf8"));
      if (
        installed.version !== "3.0.3" ||
        installed.main !== "index.js" ||
        installed.exports !== undefined
      )
        throw new Error("Unreviewed braces version/entrypoint");
      for (const file of [
        "index.js",
        "lib/constants.js",
        "lib/parse.js",
        "lib/compile.js",
        "lib/expand.js",
        "lib/stringify.js",
        "lib/utils.js",
      ])
        if (
          (SOURCE_HASHES[file] && review.fileHashes?.[file] !== SOURCE_HASHES[file]) ||
          digest(await readFile(path.join(instance, file), "utf8")) !== review.fileHashes?.[file]
        )
          throw new Error("Installed backport differs from reviewed source");
      const require = createRequire(path.join(instance, "package.json"));
      // eslint-disable-next-line security/detect-non-literal-require -- hash-verified local install
      const braces = require(instance);
      for (const name of ["parse", "compile", "expand", "stringify"]) {
        let rejected = false;
        try {
          braces[name]("{".repeat(101) + "a,b" + "}".repeat(101), { maxDepth: 10000 });
        } catch (error) {
          rejected = /exceeds max depth/.test(String(error));
        }
        if (!rejected) throw new Error("Installed depth guard failed");
      }
    }
    return {
      verified: true,
      instances: new Set(instances).size,
      upstreamCommit: UPSTREAM_COMMIT,
      patchSha256: review.patchSha256,
    };
  } catch {
    return {
      verified: false,
      instances: instances.length,
      reason:
        "Backport missing, malformed, unregistered or modified; registry finding remains blocking",
    };
  }
}
/** Preserve the raw report. An effective count is adjusted only for this exact
 * advisory/version and a separately verified installed fix; all others block. */
export function assessPatchedAudit(
  status: number | null,
  report: unknown,
  proof: { verified: boolean }
) {
  const raw = dependencyAuditVerdict(status, report);
  if (raw === "INVALID" || proof.verified !== true)
    return { assessment: raw, mitigated: [] as string[] };
  const data = report as {
    advisories?: Record<
      string,
      {
        github_advisory_id?: string;
        module_name?: string;
        severity?: string;
        findings?: Array<{ version?: string }>;
      }
    >;
    metadata: { vulnerabilities: Record<string, number> };
  };
  const counts = { ...data.metadata.vulnerabilities };
  const mitigated: string[] = [];
  if (data.advisories === undefined) return { assessment: raw, mitigated };
  if (!data.advisories || typeof data.advisories !== "object" || Array.isArray(data.advisories))
    return { assessment: "INVALID", mitigated };
  const observed: Record<string, number> = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  for (const row of Object.values(data.advisories)) {
    if (!row || typeof row.severity !== "string" || !Object.hasOwn(observed, row.severity))
      return { assessment: "INVALID", mitigated };
    observed[row.severity]++;
  }
  if (Object.entries(observed).some(([key, count]) => counts[key] !== count))
    return { assessment: "INVALID", mitigated };
  for (const advisory of Object.values(data.advisories ?? {})) {
    if (
      advisory?.github_advisory_id !== BRACES_ADVISORY ||
      advisory.module_name !== "braces" ||
      advisory.severity !== "high" ||
      !Array.isArray(advisory.findings) ||
      !advisory.findings.length ||
      advisory.findings.some((finding) => finding?.version !== "3.0.3")
    )
      continue;
    if (!Number.isSafeInteger(counts.high) || counts.high < 1)
      return { assessment: "INVALID", mitigated: [] };
    counts.high--;
    mitigated.push(BRACES_ADVISORY);
  }
  const effective = dependencyAuditVerdict(status, {
    ...data,
    metadata: { ...data.metadata, vulnerabilities: counts },
  });
  return {
    assessment: effective === "PASS" && mitigated.length ? "WARN" : effective,
    mitigated,
    effectiveVulnerabilityCounts: counts,
  };
}
