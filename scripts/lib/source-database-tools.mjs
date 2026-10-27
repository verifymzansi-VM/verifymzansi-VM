import { readFile } from "node:fs/promises";
import path from "node:path";

const foundationProject = "gntzjtuncsyefujajmjy";

/** Root migrations and the legacy operator/export tools belong to the source schema. */
export function assertSourceDatabaseTool(tool, env = process.env, targets = []) {
  const references = [
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_URL,
    env.SUPABASE_PROJECT_REF,
    env.FOUNDATION_PROJECT_REF,
    env.FOUNDATION_SUPABASE_URL,
    ...targets,
  ];
  if (
    env.NEXT_PUBLIC_DATA_BACKEND === "foundation" ||
    references.some((value) => typeof value === "string" && value.includes(foundationProject))
  ) {
    throw new Error(
      `${tool} uses the retired source schema and cannot run against the foundation project. Use the reviewed foundation migrations and owner bootstrap procedure in database/foundation/README.md. For backups, use the Database Backup workflow.`
    );
  }
}

export async function readLinkedProject(root = process.cwd()) {
  try {
    return (await readFile(path.join(root, "supabase", ".temp", "project-ref"), "utf8")).trim();
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

/** Help and inspection do not replay the root schema. All other db/migration
 * operations are refused in foundation mode, including unknown future commands. */
export function isSourceSchemaOperation(args) {
  if (args.includes("--help") || args.includes("-h") || args.includes("--version")) return false;
  const db = args.indexOf("db");
  if (db >= 0) return !["dump", "lint", "advisors"].includes(args[db + 1]);
  const migration = args.indexOf("migration");
  if (migration >= 0) return args[migration + 1] !== "list";
  return args.includes("seed");
}
