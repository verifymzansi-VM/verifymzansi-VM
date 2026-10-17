import { execFileSync } from "node:child_process";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";
let release;
try {
  const { workdir, env, cliPath, config } = nativeIsolation();
  release = acquireFixtureOperation(workdir, "stop");
  execFileSync(
    process.execPath,
    [cliPath, "stop", "--workdir", workdir, "--project-id", config.project_id],
    { cwd: workdir, env, stdio: ["ignore", "pipe", "pipe"] }
  );
  process.stdout.write(
    "Dedicated local foundation stack stopped; volumes retained. Other stacks unchanged.\n"
  );
} catch {
  process.stderr.write("Local fixture stop failed; credentials and configuration withheld.\n");
  process.exitCode = 1;
} finally {
  try {
    release?.();
  } catch {
    process.stderr.write("Fixture lock release failed; fence retained.\n");
    process.exitCode = 1;
  }
}
