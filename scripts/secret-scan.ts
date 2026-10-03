import { spawnSync } from "node:child_process";
import { scanFile } from "./lib/secret-scan-files";
const artifactDirs = [".open-next", ".next", "out", "build", "dist"];
function enumerate(ignored = false): string[] {
  const args = ignored
    ? ["ls-files", "-z", "--others", "--ignored", "--exclude-standard", "--", ...artifactDirs]
    : ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  const result = spawnSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.status !== 0)
    throw new Error(`File enumeration failed: ${result.error?.message || result.stderr}`);
  return result.stdout.split("\0").filter(Boolean);
}
async function main() {
  if (process.argv.slice(2).some((arg) => !["--", "--strict"].includes(arg)))
    throw new Error("Unsupported secret scan argument");
  const strict = process.argv.includes("--strict") || process.env.SECRET_SCAN_STRICT === "1";
  const files = new Set([...enumerate(), ...(strict ? enumerate(true) : [])]);
  if (!files.size) throw new Error("No files enumerated; scan incomplete");
  const findings: string[] = [];
  const failures: string[] = [];
  let scanned = 0;
  let skipped = 0;
  let compilerCaches = 0;
  for (const file of files) {
    if (/^\.next\/(?:dev\/)?cache\//.test(file.replace(/\\/g, "/"))) {
      compilerCaches++;
      continue;
    }
    try {
      const result = await scanFile(file);
      findings.push(...result.findings);
      if (result.skipped) skipped++;
      else scanned++;
    } catch (error) {
      failures.push(`${file}: ${String(error)}`);
    }
  }
  process.stdout.write(
    `Secret scan: ${scanned} text files, ${skipped} binary exclusions, ${compilerCaches} compiler-cache exclusions, ${failures.length} read failures.\n`
  );
  if (findings.length || failures.length) throw new Error([...findings, ...failures].join("\n"));
  process.stdout.write("Secret scan passed.\n");
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
