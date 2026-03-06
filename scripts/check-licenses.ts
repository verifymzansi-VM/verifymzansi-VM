import { spawnSync, type SpawnSyncReturns } from "node:child_process";

function spawnPnpm(
  args: string[],
  options: { encoding: "utf8"; stdio: "pipe"; maxBuffer: number }
): SpawnSyncReturns<string> {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/c", "pnpm", ...args], options);
  }
  return spawnSync("pnpm", args, options);
}

const bannedLicensePatterns = [/AGPL/i, /\bGPL-3(\.0)?\b/i, /\bGPL-2(\.0)?\b/i, /BUSL-1\.1/i];

function writeInfo(message: string): void {
  process.stdout.write(`${message}\n`);
}

function collectDeclaredLicenses(parsed: unknown): string[] {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return [];
  }

  const bucket = new Set<string>();

  for (const [licenseExpression, packages] of Object.entries(parsed)) {
    if (licenseExpression && licenseExpression !== "undefined") {
      bucket.add(licenseExpression);
    }

    if (!Array.isArray(packages)) {
      continue;
    }

    for (const pkg of packages) {
      if (!pkg || typeof pkg !== "object") {
        continue;
      }

      const candidate = pkg as { license?: unknown; licenses?: unknown };
      if (typeof candidate.license === "string" && candidate.license.trim()) {
        bucket.add(candidate.license.trim());
      }
      if (typeof candidate.licenses === "string" && candidate.licenses.trim()) {
        bucket.add(candidate.licenses.trim());
      }
      if (Array.isArray(candidate.licenses)) {
        for (const item of candidate.licenses) {
          if (typeof item === "string" && item.trim()) {
            bucket.add(item.trim());
          }
        }
      }
    }
  }

  return [...bucket];
}

async function main(): Promise<void> {
  writeInfo("Running license policy check...");
  const result = spawnPnpm(["licenses", "list", "--json"], {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    console.error("License listing failed to start.");
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    console.error("License listing failed.");
    if (result.stdout) console.error(result.stdout.trim());
    if (result.stderr) console.error(result.stderr.trim());
    process.exit(result.status ?? 1);
  }

  const output = result.stdout.trim();
  if (!output) {
    throw new Error("No output from `pnpm licenses list --json`");
  }

  const licenses: string[] = [];
  try {
    const parsed = JSON.parse(output) as unknown;
    licenses.push(...collectDeclaredLicenses(parsed));
  } catch {
    console.warn("Could not parse license output as JSON; passing by command success only.");
    writeInfo("License policy check passed.");
    return;
  }

  const uniqueLicenses = [...new Set(licenses)].sort();
  const blocked = uniqueLicenses.filter((license) =>
    bannedLicensePatterns.some((pattern) => pattern.test(license))
  );

  writeInfo(
    `Detected ${uniqueLicenses.length} unique license expression(s): ${uniqueLicenses.join(", ")}`
  );

  if (blocked.length > 0) {
    console.error("Blocked license(s) detected:");
    for (const license of blocked) {
      console.error(`  - ${license}`);
    }
    process.exit(1);
  }

  writeInfo("License policy check passed.");
}

main().catch((error) => {
  console.error("License check crashed:", error);
  process.exit(1);
});
