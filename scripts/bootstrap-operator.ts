/* eslint-disable no-console */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";

type OperatorRole = "admin" | "moderator";

type Args = {
  email: string | null;
  password: string | null;
  displayName: string | null;
  role: OperatorRole;
  envFile: string | null;
  confirmProject: string | null;
};

type ExistingUser = {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
  app_metadata?: Record<string, unknown> | null;
};

function createAdminClient(supabaseUrl: string, serviceRoleKey: string) {
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

type AdminClient = ReturnType<typeof createAdminClient>;

function printUsage(): void {
  console.log("");
  console.log("Bootstrap a live operator account");
  console.log("");
  console.log(
    "Usage: pnpm bootstrap:operator -- --email=<email> --password=<password> --display-name=<name> --role=<admin|moderator> --confirm-project=<project-ref> [--env-file=.env.local]"
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

function parseRole(value: string): OperatorRole {
  if (value === "admin" || value === "moderator") {
    return value;
  }

  throw new Error(`Unsupported operator role: ${value}`);
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    email: null,
    password: null,
    displayName: null,
    role: "admin",
    envFile: null,
    confirmProject: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    }

    if (arg === "--email") {
      args.email = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--email=")) {
      args.email = arg.slice("--email=".length);
      continue;
    }

    if (arg === "--password") {
      args.password = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--password=")) {
      args.password = arg.slice("--password=".length);
      continue;
    }

    if (arg === "--display-name") {
      args.displayName = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--display-name=")) {
      args.displayName = arg.slice("--display-name=".length);
      continue;
    }

    if (arg === "--role") {
      args.role = parseRole(takeOptionValue(argv, index, arg));
      index += 1;
      continue;
    }

    if (arg.startsWith("--role=")) {
      args.role = parseRole(arg.slice("--role=".length));
      continue;
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

    if (arg === "--confirm-project") {
      args.confirmProject = takeOptionValue(argv, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("--confirm-project=")) {
      args.confirmProject = arg.slice("--confirm-project=".length);
      continue;
    }

    throw new Error(`Unsupported argument: ${arg}`);
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

function requireArg(name: string, value: string | null): string {
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required argument: ${name}`);
  }

  return value.trim();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function getProjectRef(supabaseUrl: string): string {
  const host = new URL(supabaseUrl).hostname;
  const [projectRef] = host.split(".");
  if (!projectRef) {
    throw new Error(`Unable to derive project ref from ${supabaseUrl}`);
  }

  return projectRef;
}

async function findUserByEmail(admin: AdminClient, email: string): Promise<ExistingUser | null> {
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) {
      throw error;
    }

    const user = (data.users ?? []).find(
      (candidate) => (candidate.email ?? "").toLowerCase() === email.toLowerCase()
    );

    if (user) {
      return {
        id: user.id,
        email: user.email ?? null,
        user_metadata:
          user.user_metadata && typeof user.user_metadata === "object"
            ? (user.user_metadata as Record<string, unknown>)
            : null,
        app_metadata:
          user.app_metadata && typeof user.app_metadata === "object"
            ? (user.app_metadata as Record<string, unknown>)
            : null,
      };
    }

    if ((data.users ?? []).length < 200) {
      return null;
    }

    page += 1;
  }
}

async function upsertAccountProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  displayName: string
): Promise<void> {
  const { error } = await admin.from("account_profiles").upsert(
    {
      user_id: userId,
      display_name: displayName,
      account_verification_status: "incomplete",
      account_status: "active",
    },
    { onConflict: "user_id" }
  );

  if (error) {
    throw error;
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  await loadEnvFile(args.envFile);

  const email = requireArg("--email", args.email).toLowerCase();
  const password = requireArg("--password", args.password);
  const displayName = requireArg("--display-name", args.displayName);
  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const projectRef = getProjectRef(supabaseUrl);

  if (args.confirmProject !== projectRef) {
    throw new Error(
      `Refusing bootstrap for ${projectRef}. Re-run with --confirm-project=${projectRef}.`
    );
  }

  const admin = createAdminClient(supabaseUrl, serviceRoleKey);

  const existingUser = await findUserByEmail(admin, email);
  const userMetadata = {
    display_name: displayName,
  };
  const appMetadata = {
    role: args.role,
  };

  let userId: string;

  if (existingUser) {
    const { error } = await admin.auth.admin.updateUserById(existingUser.id, {
      email,
      password,
      email_confirm: true,
      user_metadata: {
        ...(existingUser.user_metadata ?? {}),
        ...userMetadata,
      },
      app_metadata: {
        ...(existingUser.app_metadata ?? {}),
        ...appMetadata,
      },
    });

    if (error) {
      throw error;
    }

    userId = existingUser.id;
    console.log(`Updated operator ${email} as ${args.role}.`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: userMetadata,
      app_metadata: appMetadata,
    });

    if (error || !data.user) {
      throw error ?? new Error(`Failed to create operator for ${email}`);
    }

    userId = data.user.id;
    console.log(`Created operator ${email} as ${args.role}.`);
  }

  await upsertAccountProfile(admin, userId, displayName);

  console.log(`Project: ${projectRef}`);
  console.log(`User ID: ${userId}`);
  console.log(`Display name: ${displayName}`);
  console.log(`Role: ${args.role}`);
}

main().catch((error) => {
  console.error("Operator bootstrap failed:");
  console.error(error instanceof Error ? error.message : error);
  printUsage();
  process.exit(1);
});
