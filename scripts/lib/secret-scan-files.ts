import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname } from "node:path";
import { SECRET_SCAN_RULES, shouldIgnoreSecretFinding } from "../../src/lib/security/secret-scan";
const BINARY = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".woff",
  ".woff2",
  ".ttf",
  ".wasm",
  ".mp4",
  ".mp3",
  ".exe",
  ".dll",
]);
const WINDOW = 64 * 1024;
/** Fixed-size windows scan even one-line bundles without unbounded line buffering. */
export async function scanFile(file: string): Promise<{ findings: string[]; skipped: boolean }> {
  const info = await stat(file); // Read/stat failures are explicit failures, not ignored files.
  if (!info.isFile()) throw new Error(`Not a regular file: ${file}`);
  if (BINARY.has(extname(file).toLowerCase())) return { findings: [], skipped: true };
  if (info.size === 0) return { findings: [], skipped: false };
  const findings = new Set<string>();
  let pending = "";
  let line = 1;
  function scan(value: string, at: number) {
    for (const rule of SECRET_SCAN_RULES) {
      rule.pattern.lastIndex = 0;
      if (
        rule.pattern.test(value) &&
        !shouldIgnoreSecretFinding({ filePath: file, line: value, ruleName: rule.name })
      )
        findings.add(`${file}:${at} [${rule.name}]`);
      rule.pattern.lastIndex = 0;
    }
  }
  // Snapshot the observed length: an active dev trace must not extend this scan indefinitely.
  for await (const chunk of createReadStream(file, {
    encoding: "utf8",
    highWaterMark: WINDOW,
    end: info.size - 1,
  })) {
    pending += chunk;
    let end: number;
    while ((end = pending.indexOf("\n")) >= 0) {
      scan(pending.slice(0, end), line++);
      pending = pending.slice(end + 1);
    }
    while (pending.length > WINDOW) {
      scan(pending.slice(0, WINDOW), line);
      pending = pending.slice(WINDOW - 1024);
    }
  }
  if (pending) scan(pending, line);
  return { findings: [...findings], skipped: false };
}
