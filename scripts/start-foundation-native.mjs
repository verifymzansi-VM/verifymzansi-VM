import { spawn } from "node:child_process";
import { nativeIsolation } from "./lib/foundation-native-isolation.mjs";
import { acquireFixtureOperation } from "./lib/foundation-native-lock.mjs";

try {
  const { workdir, env, cliPath } = nativeIsolation();
  const release = acquireFixtureOperation(workdir, "start");
  const child = spawn(
    process.execPath,
    [
      cliPath,
      "start",
      "--workdir",
      workdir,
      "--exclude",
      "realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor",
    ],
    { env, cwd: workdir, stdio: ["ignore", "pipe", "pipe"] }
  );
  // CLI success output contains local credentials. Consume it without printing or saving.
  child.stdout.resume();
  child.stderr.resume();
  child.on("error", () => {
    try {
      release();
    } catch {
      /* Retain the fence if release cannot be verified. */
    }
    process.stderr.write("Unable to launch local fixture stack\n");
    process.exitCode = 1;
  });
  child.on("exit", (code) => {
    try {
      release();
    } catch {
      code = 1;
    }
    process.stdout.write(
      code === 0
        ? "Local BF-04 stack started: dedicated Auth/PostgREST/PostgreSQL; credentials withheld.\n"
        : "Local BF-04 startup failed; inspect local Docker health before retrying. Credentials withheld.\n"
    );
    process.exitCode = code ?? 1;
  });
} catch {
  process.stderr.write("Local fixture preflight failed; configuration and CLI details withheld.\n");
  process.exitCode = 1;
}
