import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parse } from "smol-toml";
import { assertFixturePath } from "./foundation-native-paths.mjs";

export const FIXTURE_MIGRATION = "20261013164726_transport_prototype.sql";
export const NATIVE_FIXTURE_ID = "backend-foundation-impl";
export const NATIVE_API_PORT = 55441;
export const NATIVE_DB_PORT = 55442;
export const FIXTURE_MIGRATIONS = {
  [FIXTURE_MIGRATION]: "docs/backend-foundation/prototypes/transport.sql",
  "20261013172810_listing_price_draft_prototype.sql":
    "docs/backend-foundation/prototypes/listing-price-drafts.sql",
  "20261013233854_post_integrity_prototype.sql":
    "docs/backend-foundation/prototypes/post-integrity.sql",
  "20261014003046_core_listing_terms.sql":
    "docs/backend-foundation/prototypes/core-listing-terms.sql",
  "20261014040000_taxonomy_reference.sql":
    "docs/backend-foundation/prototypes/taxonomy-reference.sql",
  "20261014040100_taxonomy_reference_seed.sql":
    "docs/backend-foundation/prototypes/taxonomy-reference-seed.sql",
  "20261014040200_post_search.sql": "docs/backend-foundation/prototypes/post-search.sql",
  "20261014050000_entitlements.sql": "docs/backend-foundation/prototypes/entitlements.sql",
  "20261014060000_trust_governance.sql": "docs/backend-foundation/prototypes/trust-governance.sql",
  "20261014070000_publication.sql": "docs/backend-foundation/prototypes/publication.sql",
  "20261014075000_moderation_queues.sql":
    "docs/backend-foundation/prototypes/moderation-queues.sql",
  "20261014080000_operations_costs.sql": "docs/backend-foundation/prototypes/operations-costs.sql",
  "20261014054125_listing_attributes.sql":
    "docs/backend-foundation/prototypes/listing-attributes.sql",
  "20261015193151_identity_verification.sql":
    "docs/backend-foundation/prototypes/identity-verification.sql",
  "20261015193200_fixture_core_drivers.sql":
    "docs/backend-foundation/prototypes/fixture-core-drivers.sql",
  "20261016064034_public_price_negotiable.sql":
    "docs/backend-foundation/prototypes/public-price-negotiable.sql",
  "20261016143838_owner_listing_editor.sql":
    "docs/backend-foundation/prototypes/owner-listing-editor.sql",
  "20261017233333_core_activity_create.sql":
    "docs/backend-foundation/prototypes/core-activity-create.sql",
  "20261018045731_owner_business_event_editor.sql":
    "docs/backend-foundation/prototypes/owner-business-event-editor.sql",
  "20261018054629_business_event_context.sql":
    "docs/backend-foundation/prototypes/business-event-context.sql",
  "20261018114134_public_event_window.sql":
    "docs/backend-foundation/prototypes/public-event-window.sql",
  "20261018130855_event_duplicate_admission.sql":
    "docs/backend-foundation/prototypes/event-duplicate-admission.sql",
  "20261018170804_staff_event_duplicate_flags.sql":
    "docs/backend-foundation/prototypes/staff-event-duplicate-flags.sql",
  "20261018215443_post_contact_preferences.sql":
    "docs/backend-foundation/prototypes/post-contact-preferences.sql",
  "20261019133858_publication_verification_readiness.sql":
    "docs/backend-foundation/prototypes/publication-verification-readiness.sql",
};
export const nativeDigest = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("base64url");
export function nativeIsolation() {
  const workdir = path.resolve("tmp/backend-foundation-native");
  assertFixturePath(process.cwd(), "tmp/backend-foundation-native", { type: "directory" });
  assertFixturePath(workdir, "supabase", { type: "directory" });
  assertFixturePath(workdir, "supabase/config.toml", { type: "file" });
  assertFixturePath(workdir, "supabase/migrations", { type: "directory" });
  if (existsSync(path.join(workdir, "supabase/.temp")))
    assertFixturePath(workdir, "supabase/.temp", { type: "directory" });
  const configPath = path.join(workdir, "supabase/config.toml");
  if (
    nativeDigest(configPath) !==
    nativeDigest("docs/backend-foundation/prototypes/native-supabase-config.toml")
  )
    throw new Error("Native fixture configuration differs from reviewed template");
  const config = parse(readFileSync(configPath, "utf8"));
  if (
    config.project_id !== NATIVE_FIXTURE_ID ||
    config.api.port !== NATIVE_API_PORT ||
    config.db.port !== NATIVE_DB_PORT ||
    JSON.stringify(config.api.schemas) !== JSON.stringify(["api"])
  )
    throw new Error("Unexpected native fixture identity");
  for (const directory of [workdir, path.join(workdir, "supabase")]) {
    if (readdirSync(directory).some((name) => /^\.env/i.test(name)))
      throw new Error("Fixture dotenv files prohibited");
  }
  if (existsSync(path.join(workdir, "supabase/.temp/project-ref")))
    throw new Error("Linked workspace prohibited");
  const migrations = path.join(workdir, "supabase/migrations");
  if (
    JSON.stringify(readdirSync(migrations).sort()) !==
    JSON.stringify(Object.keys(FIXTURE_MIGRATIONS).sort())
  )
    throw new Error("Unexpected fixture migration");
  for (const [filename, source] of Object.entries(FIXTURE_MIGRATIONS)) {
    assertFixturePath(workdir, `supabase/migrations/${filename}`, { type: "file" });
    if (nativeDigest(path.join(migrations, filename)) !== nativeDigest(source))
      throw new Error("Native fixture SQL drift");
  }
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|DOCKER_)/i.test(key))
  );
  const endpoint = execFileSync(
    "docker",
    ["context", "inspect", "desktop-linux", "--format", "{{.Endpoints.docker.Host}}"],
    { encoding: "utf8", env, stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
  if (endpoint !== "npipe:////./pipe/dockerDesktopLinuxEngine")
    throw new Error("Non-local Docker endpoint prohibited");
  env.DOCKER_CONTEXT = "desktop-linux";
  return {
    workdir,
    config,
    env,
    cliPath: path.resolve("node_modules/supabase/dist/supabase.js"),
    dockerArgs: ["--context", "desktop-linux"],
  };
}
