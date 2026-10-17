import { copyFileSync, existsSync, readdirSync, realpathSync, constants } from "node:fs";
import path from "node:path";
import {
  FIXTURE_MIGRATIONS,
  nativeDigest,
  nativeIsolation,
} from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
import { assertFixturePath, ensureFixtureDirectory } from "./lib/foundation-native-paths.mjs";
let release;
try {
  if (process.argv.length !== 2) throw new Error("No arguments accepted");
  const workdir = path.resolve("tmp/backend-foundation-native");
  ensureFixtureDirectory(process.cwd(), "tmp/backend-foundation-native");
  if (
    path.relative(realpathSync(process.cwd()), realpathSync(workdir)) !==
    path.join("tmp", "backend-foundation-native")
  )
    throw new Error("Unexpected workspace path");
  release = acquireFixtureOperation(workdir, "prepare");
  const supabase = path.join(workdir, "supabase");
  ensureFixtureDirectory(workdir, "supabase");
  for (const dir of [workdir, supabase])
    if (readdirSync(dir).some((name) => /^\.env/i.test(name))) throw new Error("Dotenv prohibited");
  if (existsSync(path.join(supabase, ".temp/project-ref")))
    throw new Error("Linked fixture prohibited");
  const migrations = path.join(supabase, "migrations");
  ensureFixtureDirectory(workdir, "supabase/migrations");
  if (readdirSync(migrations).some((name) => !Object.hasOwn(FIXTURE_MIGRATIONS, name)))
    throw new Error("Unexpected migration");
  const copy = (source, target) => {
    assertFixturePath(workdir, path.relative(workdir, target), {
      allowMissing: true,
      type: "file",
    });
    if (existsSync(target)) {
      if (nativeDigest(source) !== nativeDigest(target))
        throw new Error("Existing fixture file differs; no overwrite permitted");
    } else copyFileSync(source, target, constants.COPYFILE_EXCL);
  };
  copy(
    "docs/backend-foundation/prototypes/native-supabase-config.toml",
    path.join(supabase, "config.toml")
  );
  for (const [name, source] of Object.entries(FIXTURE_MIGRATIONS))
    copy(source, path.join(migrations, name));
  nativeIsolation();
  process.stdout.write(
    "Isolated implementation fixture prepared from recorded config/migration sources; no existing files overwritten.\n"
  );
} catch {
  process.stderr.write(
    "Fixture preparation failed; workspace retained for review, configuration withheld.\n"
  );
  process.exitCode = 1;
} finally {
  try {
    release?.();
  } catch {
    process.stderr.write("Fixture lock release failed; fence retained.\n");
    process.exitCode = 1;
  }
}
