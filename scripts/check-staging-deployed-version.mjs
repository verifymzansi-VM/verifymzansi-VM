import { pathToFileURL } from "node:url";
import { activeVersionIds } from "./lib/cloudflare-deployment-bindings.mjs";
import { runWranglerJson } from "./lib/cloudflare-wrangler.mjs";

// Staging copy (M0.15b): after the deploy, the staging Worker must serve this
// exact commit. Every staging deploy is tagged with the commit SHA
// (`--tag "$DEPLOY_TARGET_SHA"`); this reads the active deployment and fails
// unless all its traffic goes to one version carrying that tag.

/** Returns a problem description, or null when the staging Worker runs `sha`. */
export function deployedVersionProblem(versionIds, versions, sha) {
  if (versionIds.length !== 1) return `staging traffic is split over ${versionIds.length} versions`;
  const tag = versions[0]?.annotations?.["workers/tag"];
  return tag === sha
    ? null
    : `the active staging version is tagged "${tag ?? "(none)"}", not ${sha}`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const sha = process.env.DEPLOY_TARGET_SHA ?? "";
  if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error("DEPLOY_TARGET_SHA must be a commit SHA");
  const selectors = { targetEnv: "staging" };
  const versionIds = activeVersionIds(await runWranglerJson(["deployments", "list"], selectors));
  const versions = [];
  for (const id of versionIds)
    versions.push(await runWranglerJson(["versions", "view", id], selectors));
  const problem = deployedVersionProblem(versionIds, versions, sha);
  if (problem) {
    console.error(`::error::${problem}`);
    process.exit(1);
  }
  console.log(`The staging Worker serves ${sha} (version ${versionIds[0]}).`);
}
