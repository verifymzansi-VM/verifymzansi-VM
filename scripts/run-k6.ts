/* eslint-disable no-console */

import { spawn } from "node:child_process";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

type Args = {
  baseUrl: string;
  scenarios: string | null;
  summaryExport: string | null;
  dryRun: boolean;
  passthroughArgs: string[];
};

function printUsage(): void {
  console.log("");
  console.log("Run the existing k6 load-test profile against a target environment");
  console.log("");
  console.log(
    "Usage: pnpm test:perf:k6 -- [--base-url=<url>] [--scenarios=smoke,average] [--summary-export=tmp/k6-summary.json] [--dry-run] [-- <extra k6 args>]"
  );
  console.log(
    "Example: pnpm test:perf:k6 -- --base-url=https://staging.verifymzansi.com --scenarios=smoke,average"
  );
  console.log("");
}

function takeOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function resolveBaseUrl(): string {
  return (
    process.env.K6_BASE_URL ||
    process.env.PERF_BASE_URL ||
    process.env.STAGING_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3000"
  );
}

function normalizeScenarioList(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean)
    .join(",");

  return normalized || null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    baseUrl: resolveBaseUrl(),
    scenarios: normalizeScenarioList(process.env.K6_SCENARIOS || null),
    summaryExport: null,
    dryRun: false,
    passthroughArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--") {
      args.passthroughArgs = argv.slice(index + 1);
      break;
    }

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--base-url") {
      args.baseUrl = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--base-url=")) {
      args.baseUrl = arg.slice("--base-url=".length);
      continue;
    }

    if (arg === "--scenarios") {
      args.scenarios = normalizeScenarioList(takeOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith("--scenarios=")) {
      args.scenarios = normalizeScenarioList(arg.slice("--scenarios=".length));
      continue;
    }

    if (arg === "--summary-export") {
      args.summaryExport = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--summary-export=")) {
      args.summaryExport = arg.slice("--summary-export=".length);
      continue;
    }

    throw new Error(`Unknown argument: ${arg}. Use --help for usage.`);
  }

  return args;
}

async function main(): Promise<void> {
  loadEnvConfig(process.cwd());

  const args = parseArgs(process.argv.slice(2));
  const scriptPath = path.join("scripts", "load-test.js");
  const k6Args = ["run", "--env", `BASE_URL=${args.baseUrl}`];

  if (args.scenarios) {
    k6Args.push("--env", `K6_SCENARIOS=${args.scenarios}`);
  }

  if (args.summaryExport) {
    k6Args.push("--summary-export", args.summaryExport);
  }

  k6Args.push(...args.passthroughArgs, scriptPath);

  if (args.dryRun) {
    console.log(`k6 ${k6Args.join(" ")}`);
    return;
  }

  const k6Binary = process.platform === "win32" ? "k6.exe" : "k6";
  const child = spawn(k6Binary, k6Args, {
    stdio: "inherit",
    env: process.env,
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", (error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        reject(
          new Error(
            "k6 is not installed or not on PATH. Install it from https://grafana.com/docs/k6/latest/set-up/install-k6/ or run the CI advisory job."
          )
        );
        return;
      }

      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`k6 exited with code ${code ?? "unknown"}`));
    });
  });
}

main().catch((error) => {
  console.error("k6 wrapper failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
