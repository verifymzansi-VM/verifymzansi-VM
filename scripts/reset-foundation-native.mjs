import { execFileSync } from "node:child_process";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
let release;
try {
  const { workdir, env, cliPath, dockerArgs, config } = nativeIsolation();
  release = acquireFixtureOperation(workdir, "reset");
  // Destructive replay is permitted only while the owned fixture has no Auth users.
  const users = execFileSync(
    "docker",
    [
      ...dockerArgs,
      "exec",
      `supabase_db_${config.project_id}`,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-Atc",
      "select count(*) from auth.users;",
    ],
    { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
  ).trim();
  if (users !== "0") throw new Error("Fixture users must be reconciled before replay");
  execFileSync(
    process.execPath,
    [cliPath, "db", "reset", "--local", "--no-seed", "--workdir", workdir],
    { cwd: workdir, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  process.stdout.write(
    "Empty isolated fixture replayed from its allowlisted candidate migrations. Credentials withheld.\n"
  );
} catch {
  process.stderr.write("Local fixture replay failed or preflight denied; CLI details withheld.\n");
  process.exitCode = 1;
} finally {
  try {
    release?.();
  } catch {
    process.stderr.write("Fixture lock release failed; fence retained.\n");
    process.exitCode = 1;
  }
}
