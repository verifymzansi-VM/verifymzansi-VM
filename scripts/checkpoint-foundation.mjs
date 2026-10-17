import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  lstatSync,
  copyFileSync,
  readdirSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";

// A local recovery copy of changed, non-ignored files. Never includes dotenv or Git internals.
if (process.argv.length !== 2) throw new Error("Checkpoint accepts no arguments");
const root = process.cwd();
const git = (args) =>
  execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trimEnd();
if (path.resolve(git(["rev-parse", "--show-toplevel"])) !== path.resolve(root))
  throw new Error("Run at repository root");
const changed = () =>
  [
    ...new Set(
      [
        ...git(["diff", "--name-only", "-z", "HEAD"]).split("\0"),
        ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0"),
      ].filter(Boolean)
    ),
  ].sort();
// Private reports stay outside Git, but remain in local recovery copies.
const privatePackFiles = [];
const collectPrivatePack = (relative) => {
  const absolute = path.resolve(root, relative);
  if (!absolute.startsWith(root + path.sep)) throw new Error("Unsafe private checkpoint path");
  if (!existsSync(absolute)) return;
  const info = lstatSync(absolute);
  if (info.isSymbolicLink()) throw new Error("Private checkpoint reparse path prohibited");
  if (info.isDirectory()) {
    for (const child of readdirSync(absolute)) collectPrivatePack(path.join(relative, child));
  } else if (info.isFile()) privatePackFiles.push(relative.split(path.sep).join("/"));
};
collectPrivatePack("docs/backend-foundation");
const files = [
  ...new Set([
    ...changed(),
    ...privatePackFiles,
    ...(existsSync("AGENTS.md") ? ["AGENTS.md"] : []),
  ]),
].sort();
const stamp = new Date().toISOString();
const base = path.resolve(
  root,
  "tmp/backend-foundation-checkpoints",
  `${stamp.replace(/:/g, "-")}-${randomUUID().slice(0, 8)}`
);
mkdirSync(base, { recursive: true });
const hash = (bytes) => createHash("sha256").update(bytes).digest("base64url");
const records = [];
for (const file of files) {
  const source = path.resolve(root, file),
    target = path.resolve(base, "files", file);
  if (
    !source.startsWith(root + path.sep) ||
    !target.startsWith(base + path.sep) ||
    file
      .split(/[\\/]/)
      .some((part) => (/^\.env/i.test(part) && file !== ".env.example") || part === ".git")
  )
    throw new Error("Unsafe checkpoint path");
  if (!existsSync(source)) {
    records.push({ file, deleted: true });
    continue;
  }
  if (!lstatSync(source).isFile()) throw new Error("Checkpoint requires ordinary files");
  const before = readFileSync(source);
  if (file === ".env.example") {
    // Preserve an unchanged tracked public template, including harmless EOL drift.
    // A populated/edited dotenv file never enters this checkpoint.
    const normalize = (bytes) => Buffer.from(bytes).toString("utf8").replaceAll("\r\n", "\n");
    const tracked = execFileSync("git", ["show", "HEAD:.env.example"], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (normalize(before) !== normalize(tracked))
      throw new Error(
        "Edited environment template excluded; preserve separately after secret review"
      );
  }
  mkdirSync(path.dirname(target), { recursive: true });
  copyFileSync(source, target);
  if (hash(before) !== hash(readFileSync(target)) || hash(before) !== hash(readFileSync(source)))
    throw new Error("File changed during checkpoint");
  records.push({ file, sha256Base64url: hash(before), bytes: before.length });
}
privatePackFiles.length = 0;
collectPrivatePack("docs/backend-foundation");
if (
  JSON.stringify(
    [
      ...new Set([
        ...changed(),
        ...privatePackFiles,
        ...(existsSync("AGENTS.md") ? ["AGENTS.md"] : []),
      ]),
    ].sort()
  ) !== JSON.stringify(files)
)
  throw new Error("Changed file set drifted during checkpoint");
const result = {
  schemaVersion: 1,
  recordedAt: stamp,
  sourceRoot: root,
  sourceCommit: git(["rev-parse", "HEAD"]),
  sourceBranch: git(["branch", "--show-current"]),
  status: "PASS",
  checkpoint: path.relative(root, base).replaceAll("\\", "/"),
  scope:
    "Changed tracked/nonignored files plus local private foundation pack and AGENTS guidance; unchanged tracked public environment template permitted; credentials excluded; reconstruct unchanged files from sourceCommit; ignored fixtures regenerate from sources",
  files: records,
};
writeFileSync(path.join(base, "manifest.json"), JSON.stringify(result, null, 2) + "\n", {
  flag: "wx",
});
writeFileSync(
  "docs/backend-foundation/evidence/checkpoint-latest.json",
  JSON.stringify(
    {
      recordedAt: stamp,
      status: "PASS",
      sourceCommit: result.sourceCommit,
      checkpoint: result.checkpoint,
      files: records.length,
      manifestHash: hash(readFileSync(path.join(base, "manifest.json"))),
    },
    null,
    2
  ) + "\n"
);
process.stdout.write(
  JSON.stringify({ checkpoint: result.checkpoint, files: records.length, status: "PASS" }) + "\n"
);
