import { spawn } from "node:child_process";
import path from "node:path";
import { loadWorkspaceEnv } from "./lib/workspace-env";
import {
  assertSourceDatabaseTool,
  isSourceSchemaOperation,
  readLinkedProject,
} from "./lib/source-database-tools.mjs";

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

function validateCredentials(args: string[]): void {
  if (
    args.includes("--help") ||
    args.includes("-h") ||
    args.includes("--version") ||
    args.includes("--local")
  )
    return;
  if (args[0] === "migration" && args[1] === "new") return;
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
  await loadWorkspaceEnv(args.envFile);
  if (isSourceSchemaOperation(args.supabaseArgs)) {
    assertSourceDatabaseTool("Root Supabase CLI schema operation", process.env, [
      ...args.supabaseArgs,
      await readLinkedProject(),
    ]);
  }
  validateCredentials(args.supabaseArgs);

  const child = spawn(
    process.execPath,
    [path.resolve("node_modules/supabase/dist/supabase.js"), ...args.supabaseArgs],
    {
      shell: false,
      stdio: "inherit",
      env: process.env,
    }
  );

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
