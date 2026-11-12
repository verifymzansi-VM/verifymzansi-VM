// Finds relative links in tracked Markdown files that point at files the
// repository does not track. External links (http, mailto, ...) and pure
// in-page anchors are not checked; this is about moved and deleted documents.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const INLINE_LINK = /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const REFERENCE_LINK = /^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s+.*)?$/gm;
const FENCE = /^(\s*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\S\n]*$/gm;
const INLINE_CODE = /`[^`\n]*`/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** Link targets in one Markdown text, ignoring code blocks and inline code. */
export function linkTargets(markdown) {
  const text = markdown.replace(FENCE, "").replace(INLINE_CODE, "");
  const targets = [];
  for (const pattern of [INLINE_LINK, REFERENCE_LINK])
    for (const match of text.matchAll(pattern)) targets.push(match[1]);
  return targets;
}

/**
 * @param {string[]} trackedFiles repository-relative paths with forward slashes
 * @param {(file: string) => string} read returns a tracked Markdown file's text
 * @returns {{ file: string, target: string }[]}
 */
export function brokenDocLinks(trackedFiles, read) {
  const tracked = new Set(trackedFiles);
  const directories = new Set();
  for (const file of trackedFiles) {
    let dir = path.posix.dirname(file);
    while (dir !== "." && !directories.has(dir)) {
      directories.add(dir);
      dir = path.posix.dirname(dir);
    }
  }
  const broken = [];
  for (const file of trackedFiles.filter((name) => name.endsWith(".md"))) {
    for (const target of linkTargets(read(file))) {
      if (SCHEME.test(target) || target.startsWith("#") || target.startsWith("//")) continue;
      const pathPart = decodeURI(target.split("#")[0].split("?")[0]);
      if (!pathPart) continue;
      const resolved = pathPart.startsWith("/")
        ? path.posix.normalize(pathPart.slice(1))
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), pathPart));
      const clean = resolved.replace(/\/$/, "");
      if (!tracked.has(clean) && !directories.has(clean)) broken.push({ file, target });
    }
  }
  return broken;
}

/** Tracked Markdown outside the ignored scratch folders. */
function trackedRepositoryFiles(cwd = process.cwd()) {
  return execFileSync("git", ["ls-files", "-z"], { cwd, encoding: "utf8" })
    .split("\0")
    .filter((file) => file && !file.startsWith("tmp/"));
}

export function checkRepositoryDocLinks(cwd = process.cwd()) {
  return brokenDocLinks(trackedRepositoryFiles(cwd), (file) =>
    readFileSync(path.join(cwd, file), "utf8")
  );
}
