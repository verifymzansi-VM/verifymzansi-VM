import { readFile } from "node:fs/promises";
import path from "node:path";
import { parseEnv } from "node:util";
import { loadEnvConfig } from "@next/env";

/** Preserve Next's default precedence; an explicit file is an intentional
 * override. Node's parser handles quoted values, comments and embedded '='. */
export async function loadWorkspaceEnv(envFile: string | null): Promise<void> {
  loadEnvConfig(process.cwd());
  if (!envFile) return;
  const filename = path.resolve(process.cwd(), envFile);
  Object.assign(process.env, parseEnv(await readFile(filename, "utf8")));
}

export function requireWorkspaceEnv(name: string, trim = false): string {
  const value = trim ? process.env[name]?.trim() : process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function resolveWorkspaceProjectRef(explicitRef: string | null): string {
  if (explicitRef) return explicitRef;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || process.env.SUPABASE_URL?.trim();
  if (!url)
    throw new Error(
      "Missing Supabase project reference. Set NEXT_PUBLIC_SUPABASE_URL or pass --project-ref=<ref>."
    );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be a valid http(s) URL.");
  }
  const ref = parsed.hostname.split(".")[0]?.trim();
  if (!ref) throw new Error("Could not derive project ref from NEXT_PUBLIC_SUPABASE_URL.");
  return ref;
}
