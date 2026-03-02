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

/** Only allow these roles to be synced from user_metadata → app_metadata */
const ALLOWED_ROLES = new Set(["user", "agent", "admin"]);

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
      const role = user.user_metadata?.role;

      // Guard: skip invalid / disallowed roles
      if (!role || typeof role !== "string" || !ALLOWED_ROLES.has(role)) {
        if (role && !ALLOWED_ROLES.has(role)) {
          console.warn(`  ⚠ Skipping ${user.email}: disallowed role "${role}"`);
        }
        continue;
      }

      if (user.app_metadata?.role !== role) {
        console.log(`Fixing user ${user.email} (role: ${role})...`);
        const { error: updateError } = await supabase.auth.admin.updateUserById(user.id, {
          app_metadata: { ...user.app_metadata, role },
        });
        if (updateError) {
          console.error(`  ✗ Failed to update ${user.email}`, updateError);
        } else {
          console.log(`  ✓ Updated ${user.email}`);
          totalFixed++;
        }
      }
    }

    // If we got fewer than perPage, we've reached the last page
    if (users.length < perPage) {
      break;
    }
    page++;
  }

  console.log(`Done. Fixed ${totalFixed} user(s).`);
}

main().catch((err) => {
  console.error("Unhandled error in fix-roles script:", err);
  process.exit(1);
});
