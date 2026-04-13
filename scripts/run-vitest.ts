import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";

function runVitest(lane: string) {
  const args = ["exec", "vitest", "run"];
  if (lane === "coverage-core") {
    mkdirSync(path.join(process.cwd(), "coverage", ".tmp"), { recursive: true });
    args.push("--coverage");
  }
  const forwardedArgs = process.argv.slice(3);
  if (forwardedArgs.length > 0) {
    args.push(...forwardedArgs);
  }

  const env = {
    ...process.env,
    VITEST_LANE: lane,
  };

  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec || "cmd.exe", ["/c", "pnpm", ...args], {
          env,
          stdio: "inherit",
        })
      : spawnSync("pnpm", args, {
          env,
          stdio: "inherit",
        });

  if (result.error) {
    console.error(`Failed to run vitest lane "${lane}":`, result.error.message);
    process.exit(1);
  }

  process.exit(result.status ?? 1);
}

runVitest(process.argv[2] ?? "blocking");
