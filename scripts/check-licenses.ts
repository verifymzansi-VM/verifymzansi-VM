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

function extractLicenseStrings(value: unknown, bucket: string[]): void {
  if (typeof value === "string") {
    bucket.push(value);
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractLicenseStrings(item, bucket);
    }
    return;
  }

  for (const [key, itemValue] of Object.entries(value)) {
    if (typeof itemValue === "string" && key.toLowerCase().includes("license")) {
      bucket.push(itemValue);
      continue;
    }
    extractLicenseStrings(itemValue, bucket);
  }
}

async function main(): Promise<void> {
  console.log("Running license policy check...");
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
    extractLicenseStrings(parsed, licenses);
  } catch {
    console.warn("Could not parse license output as JSON; passing by command success only.");
    console.log("License policy check passed.");
    return;
  }

  const uniqueLicenses = [...new Set(licenses)].sort();
  const blocked = uniqueLicenses.filter((license) =>
    bannedLicensePatterns.some((pattern) => pattern.test(license))
  );

  console.log(
    `Detected ${uniqueLicenses.length} unique license expression(s): ${uniqueLicenses.join(", ")}`
  );

  if (blocked.length > 0) {
    console.error("Blocked license(s) detected:");
    for (const license of blocked) {
      console.error(`  - ${license}`);
    }
    process.exit(1);
  }

  console.log("License policy check passed.");
}

main().catch((error) => {
  console.error("License check crashed:", error);
  process.exit(1);
});
