/* eslint-disable no-console */

import { spawnSync } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import * as prettier from "prettier";

const openApiPath = path.join(process.cwd(), "docs", "openapi.json");
const generatedTypesPath = path.join(process.cwd(), "src", "lib", "api", "v1.d.ts");
const tempDir = path.join(process.cwd(), "tmp", "openapi-drift");
const tempTypesPath = path.join(tempDir, "v1.generated.d.ts");

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, "\n");
}

function runPnpmCommand(args: string[]): void {
  const result =
    process.platform === "win32"
      ? spawnSync(process.env.ComSpec ?? "cmd.exe", ["/c", "pnpm", ...args], {
          stdio: "inherit",
        })
      : spawnSync("pnpm", args, {
          stdio: "inherit",
        });

  if (result.status !== 0) {
    throw new Error(`pnpm ${args.join(" ")} exited with code ${result.status ?? "unknown"}`);
  }
}

function runOpenApiGeneration(): void {
  runPnpmCommand(["exec", "openapi-typescript", openApiPath, "-o", tempTypesPath]);
}

async function main(): Promise<void> {
  await mkdir(tempDir, { recursive: true });

  console.log("Checking OpenAPI type drift...");
  runOpenApiGeneration();

  const [checkedInTypes, generatedTypes] = await Promise.all([
    readFile(generatedTypesPath, "utf8"),
    readFile(tempTypesPath, "utf8"),
  ]);

  const formattedGeneratedTypes = await prettier.format(generatedTypes, {
    filepath: generatedTypesPath,
  });

  if (normalizeLineEndings(checkedInTypes) !== normalizeLineEndings(formattedGeneratedTypes)) {
    console.error("");
    console.error("OpenAPI drift detected: src/lib/api/v1.d.ts is out of date.");
    console.error("Run `pnpm run generate:api-types` and commit the updated generated types.");
    process.exit(1);
  }

  console.log("OpenAPI types are in sync.");
}

main().catch((error) => {
  console.error("OpenAPI drift check failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
