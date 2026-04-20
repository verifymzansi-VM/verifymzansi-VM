/* eslint-disable no-console */

import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";

type Args = {
  envFile: string | null;
  supabaseArgs: string[];
};

function printUsage(): void {
  console.log("");
  console.log("Run Supabase CLI with env loaded from the workspace");
  console.log("");
  console.log("Usage: pnpm supabase:cli -- [--env-file=.env.local] <supabase args...>");
  console.log("Example: pnpm supabase:cli -- migration list");
  console.log("");
}

function takeOptionValue(argv: string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }

  return value;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    envFile: null,
    supabaseArgs: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--env-file") {
      args.envFile = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--env-file=")) {
      args.envFile = arg.slice("--env-file=".length);
      continue;
    }

    args.supabaseArgs = argv.slice(index);
    break;
  }

  if (args.supabaseArgs.length === 0) {
    throw new Error("Missing Supabase CLI arguments. Use --help for usage.");
  }

  return args;
}

async function loadEnvFile(envFile: string | null): Promise<void> {
  loadEnvConfig(process.cwd());

  if (!envFile) {
    return;
  }

  const resolvedPath = path.isAbsolute(envFile) ? envFile : path.join(process.cwd(), envFile);
  const content = await readFile(resolvedPath, "utf8");

  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex < 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    process.env[key] = value;
  }
}

function validateCredentials(args: string[]): void {
  const requiresRemoteAuth = args.some((arg) =>
    ["migration", "db", "link", "push", "pull", "repair"].includes(arg)
  );

  if (!requiresRemoteAuth) {
    return;
  }

  const missing: string[] = [];
  if (!process.env.SUPABASE_ACCESS_TOKEN) {
    missing.push("SUPABASE_ACCESS_TOKEN");
  }
  if (!process.env.SUPABASE_DB_PASSWORD) {
    missing.push("SUPABASE_DB_PASSWORD");
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables for remote Supabase CLI commands: ${missing.join(", ")}`
    );
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(args.envFile);
  validateCredentials(args.supabaseArgs);

  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const command = `${pnpmCmd} exec supabase ${args.supabaseArgs.join(" ")}`;
  const child = spawn(command, {
    shell: true,
    stdio: "inherit",
    env: process.env,
  });

  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Supabase CLI exited with code ${code ?? "unknown"}`));
    });
  });
}

main().catch((error) => {
  console.error("Supabase CLI wrapper failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
