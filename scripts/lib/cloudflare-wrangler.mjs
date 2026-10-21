import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execute = promisify(execFile);

/** Keep provider IDs and operator selectors as arguments, never shell text. */
export async function runWranglerJson(commandParts, { workerName, targetEnv } = {}, run = execute) {
  const entry = path.join(
    path.dirname(require.resolve("wrangler/package.json")),
    "bin/wrangler.js"
  );
  const args = [entry, ...commandParts];
  if (workerName) args.push("--name", workerName);
  if (targetEnv) args.push("--env", targetEnv);
  args.push("--json");
  const { stdout } = await run(process.execPath, args, {
    shell: false,
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}
