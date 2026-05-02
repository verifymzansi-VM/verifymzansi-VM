import { createClient } from "@supabase/supabase-js";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing env vars: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function readRole(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const role = (metadata as Record<string, unknown>).role;
  return typeof role === "string" && role.trim() ? role.trim().toLowerCase() : null;
}

async function main() {
  let page = 1;
  const perPage = 50;
  let totalFixed = 0;

  // Paginate through all users
  while (true) {
    const {
      data: { users },
      error,
    } = await supabase.auth.admin.listUsers({
      page,
      perPage,
    });

    if (error) {
      console.error("Failed to list users", error);
      return;
    }

    if (!users || users.length === 0) {
      break;
    }

    for (const user of users) {
      const appRole = readRole(user.app_metadata);
      const legacyUserRole = readRole(user.user_metadata);

      if (!legacyUserRole || appRole === legacyUserRole) {
        continue;
      }

      console.warn(
        `Skipping ${user.email ?? user.id}: refusing to sync user_metadata.role="${legacyUserRole}" into app_metadata`
      );
    }

    // If we got fewer than perPage, we've reached the last page
    if (users.length < perPage) {
      break;
    }
    page++;
  }

  process.stdout.write(`Done. Fixed ${totalFixed} user(s).\n`);
}

main().catch((err) => {
  console.error("Unhandled error in fix-roles script:", err);
  process.exit(1);
});
