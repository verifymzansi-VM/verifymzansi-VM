import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
const roots = [
  "src",
  "workers",
  "public",
  "database/foundation",
  "package.json",
  "pnpm-lock.yaml",
  "next.config.js",
  "open-next.config.ts",
  "wrangler.toml",
  "tsconfig.json",
];
/** Source bytes and client-visible build settings determine cached output.
 * Private runtime bindings are deliberately absent from this fingerprint. */
export function cloudflareBuildFingerprint(
  root,
  environment,
  list = () =>
    execFileSync(
      "git",
      ["ls-files", "-z", "--cached", "--others", "--exclude-standard", "--", ...roots],
      { cwd: root, encoding: "utf8", windowsHide: true }
    )
) {
  const base = realpathSync(root),
    hash = createHash("sha256");
  const files = [...new Set(list().split("\0").filter(Boolean))].sort();
  if (!files.length) throw new Error("No build sources found");
  for (const file of files) {
    if (!roots.some((allowed) => file === allowed || file.startsWith(allowed + "/")))
      throw new Error("Unexpected build source");
    const actual = realpathSync(path.resolve(base, file)),
      relative = path.relative(base, actual);
    if (relative.startsWith("..") || path.isAbsolute(relative) || !statSync(actual).isFile())
      throw new Error("Build source escapes the workspace");
    hash.update(file).update("\0").update(readFileSync(actual)).update("\0");
  }
  const client = Object.fromEntries(
    Object.entries(environment)
      .filter(([name]) => name.startsWith("NEXT_PUBLIC_"))
      .sort(([a], [b]) => a.localeCompare(b))
  );
  hash.update(JSON.stringify(client));
  return hash.digest("hex");
}
