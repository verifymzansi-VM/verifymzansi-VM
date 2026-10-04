import path from "node:path";

/** Invoke Node directly: cmd.exe quoting must not become literal test filters. */
export function domainTestCommand(files: string[]): [string, string[]] {
  return [process.execPath, [path.resolve("node_modules/vitest/vitest.mjs"), "run", ...files]];
}
