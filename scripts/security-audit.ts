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

async function main(): Promise<void> {
  console.log("Running dependency vulnerability audit...");

  const result = spawnPnpm(["audit", "--audit-level", "high", "--prod", "--json"], {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    console.error("Dependency audit failed to start.");
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status === 0) {
    console.log("Dependency audit passed (no high/critical production vulnerabilities).");
    return;
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const hasNetworkError = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN/i.test(combinedOutput);

  if (hasNetworkError && process.env.ALLOW_NETWORKLESS_SECURITY_AUDIT === "true") {
    console.warn(
      "Dependency audit skipped due to network error and ALLOW_NETWORKLESS_SECURITY_AUDIT=true."
    );
    return;
  }

  console.error("Dependency audit failed.");
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error("Dependency audit crashed:", error);
  process.exit(1);
});
