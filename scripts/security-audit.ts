import { spawnSync, type SpawnSyncReturns } from "node:child_process";

type AuditOutput = {
  auditReportVersion?: number;
  vulnerabilities?: Record<string, unknown>;
  metadata?: {
    vulnerabilities?: {
      high?: number;
      critical?: number;
    };
  };
  error?: {
    code?: string;
    summary?: string;
    detail?: string;
  };
};

function spawnCommand(
  command: string,
  args: string[],
  options: { encoding: "utf8"; stdio: "pipe"; maxBuffer: number }
): SpawnSyncReturns<string> {
  if (process.platform === "win32") {
    return spawnSync(process.env.ComSpec ?? "cmd.exe", ["/c", command, ...args], options);
  }
  return spawnSync(command, args, options);
}

async function main(): Promise<void> {
  process.stdout.write("Running dependency vulnerability audit...\n");

  const auditArgs = ["audit", "--json", "--omit=dev", "--audit-level=high", "--no-package-lock"];
  const result = spawnCommand("npm", auditArgs, {
    encoding: "utf8",
    stdio: "pipe",
    maxBuffer: 20 * 1024 * 1024,
  });

  if (result.error) {
    console.error("Dependency audit failed to start.");
    console.error(result.error.message);
    process.exit(1);
  }

  const combinedOutput = `${result.stdout}\n${result.stderr}`;
  const hasNetworkError =
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|network timeout/i.test(combinedOutput);
  let parsedOutput: AuditOutput | null = null;

  if (result.stdout.trim().length > 0) {
    try {
      parsedOutput = JSON.parse(result.stdout) as AuditOutput;
    } catch {
      parsedOutput = null;
    }
  }

  if (hasNetworkError && process.env.ALLOW_NETWORKLESS_SECURITY_AUDIT === "true") {
    console.warn(
      "Dependency audit skipped due to network error and ALLOW_NETWORKLESS_SECURITY_AUDIT=true."
    );
    return;
  }

  if (result.status === 0) {
    process.stdout.write(
      "Dependency audit passed (no high/critical production vulnerabilities).\n"
    );
    return;
  }

  if (
    parsedOutput?.auditReportVersion &&
    typeof parsedOutput.metadata?.vulnerabilities?.high === "number" &&
    typeof parsedOutput.metadata?.vulnerabilities?.critical === "number"
  ) {
    console.error("Dependency audit failed.");
    console.error(result.stdout.trim());
    process.exit(result.status ?? 1);
  }

  console.error("Dependency audit failed.");
  if (parsedOutput?.error) {
    console.error(
      JSON.stringify(
        {
          error: parsedOutput.error,
        },
        null,
        2
      )
    );
  }
  if (result.stdout) console.error(result.stdout.trim());
  if (result.stderr) console.error(result.stderr.trim());
  process.exit(result.status ?? 1);
}

main().catch((error) => {
  console.error("Dependency audit crashed:", error);
  process.exit(1);
});
