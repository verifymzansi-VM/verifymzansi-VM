import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { collectAppRouteBundles, type RouteBundle } from "../src/lib/build/bundle-budget";

type BuildManifest = {
  pages?: Record<string, string[]>;
};

type AppBuildManifest = {
  pages?: Record<string, string[]>;
};

const root = process.cwd();
const nextDir = resolve(root, ".next");
const staticChunksDir = resolve(nextDir, "static", "chunks");
const appChunksDir = resolve(staticChunksDir, "app");

const warnBudgetKb = Number(process.env.BUNDLE_BUDGET_WARN_KB ?? "275");
const failBudgetKb = Number(process.env.BUNDLE_BUDGET_FAIL_KB ?? "325");

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function walkFiles(dirPath: string): string[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath));
      continue;
    }

    if (entry.isFile() && fullPath.endsWith(".js")) {
      files.push(fullPath);
    }
  }

  return files;
}

function getFileSize(filePath: string): number {
  try {
    return statSync(filePath).size;
  } catch {
    return 0;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function formatKb(sizeBytes: number): string {
  return `${Math.round(sizeBytes / 1024)}KB`;
}

function collectRouteBundles(): RouteBundle[] {
  const buildManifest = readJson<BuildManifest>(resolve(nextDir, "build-manifest.json"));
  const appBuildManifest = readJson<AppBuildManifest>(resolve(nextDir, "app-build-manifest.json"));

  const pageEntries = Object.entries(buildManifest?.pages ?? {});
  const appEntries = Object.entries(appBuildManifest?.pages ?? {});

  const allEntries = [...pageEntries, ...appEntries];
  const bundles: RouteBundle[] = [];

  for (const [route, files] of allEntries) {
    const jsFiles = unique((files ?? []).filter((file) => file.endsWith(".js")));
    if (jsFiles.length === 0) {
      continue;
    }

    const sizeBytes = jsFiles.reduce(
      (total, file) => total + getFileSize(resolve(nextDir, file)),
      0
    );

    bundles.push({
      route,
      sizeBytes,
      files: jsFiles,
    });
  }

  return bundles;
}

function fail(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}

function main(): void {
  if (!existsSync(nextDir)) {
    fail("Cannot find .next directory. Run build before bundle budget check.");
  }

  if (!existsSync(staticChunksDir)) {
    fail("Cannot find .next/static/chunks. Build output is incomplete.");
  }

  if (
    !Number.isFinite(warnBudgetKb) ||
    !Number.isFinite(failBudgetKb) ||
    warnBudgetKb <= 0 ||
    failBudgetKb <= 0
  ) {
    fail(
      "Invalid bundle budget values. Ensure BUNDLE_BUDGET_WARN_KB and BUNDLE_BUDGET_FAIL_KB are positive numbers."
    );
  }

  if (warnBudgetKb > failBudgetKb) {
    fail("BUNDLE_BUDGET_WARN_KB cannot exceed BUNDLE_BUDGET_FAIL_KB.");
  }

  console.warn(`Bundle budget (warn/fail): ${warnBudgetKb}KB / ${failBudgetKb}KB`);

  let routeBundles = collectRouteBundles().sort((a, b) => b.sizeBytes - a.sizeBytes);
  if (routeBundles.length === 0 && existsSync(appChunksDir)) {
    routeBundles = collectAppRouteBundles(walkFiles(appChunksDir), appChunksDir, getFileSize).sort(
      (a, b) => b.sizeBytes - a.sizeBytes
    );

    if (routeBundles.length > 0) {
      console.warn("Using Next App Router page chunk budget fallback.");
    }
  }

  if (routeBundles.length === 0) {
    const chunks = walkFiles(staticChunksDir)
      .map((filePath) => ({ filePath, sizeBytes: getFileSize(filePath) }))
      .sort((a, b) => b.sizeBytes - a.sizeBytes);

    if (chunks.length === 0) {
      fail("No JS chunks found in .next/static/chunks.");
    }

    const largest = chunks[0];
    const largestKb = largest.sizeBytes / 1024;
    const fileName = largest.filePath.replace(`${root}\\`, "").replace(/\\/g, "/");
    const topChunks = chunks
      .slice(0, 8)
      .map((chunk) => {
        const name = chunk.filePath.replace(`${root}\\`, "").replace(/\\/g, "/");
        return `${name}=${formatKb(chunk.sizeBytes)}`;
      })
      .join(", ");

    console.warn(`Largest chunk fallback: ${fileName} (${formatKb(largest.sizeBytes)})`);
    console.warn(`Top chunk offenders: ${topChunks}`);

    if (largestKb > failBudgetKb) {
      fail(
        `Largest chunk ${fileName} (${formatKb(largest.sizeBytes)}) exceeds fail budget (${failBudgetKb}KB). Top chunks: ${topChunks}.`
      );
    }

    if (largestKb > warnBudgetKb) {
      console.warn(
        `::warning::Largest chunk ${fileName} (${formatKb(largest.sizeBytes)}) exceeds warn budget (${warnBudgetKb}KB).`
      );
    }

    return;
  }

  const top = routeBundles.slice(0, 8);
  for (const bundle of top) {
    console.warn(`${bundle.route}: ${formatKb(bundle.sizeBytes)}`);
  }

  const overWarn = routeBundles.filter((bundle) => bundle.sizeBytes / 1024 > warnBudgetKb);
  const overFail = routeBundles.filter((bundle) => bundle.sizeBytes / 1024 > failBudgetKb);

  for (const bundle of overWarn) {
    console.warn(
      `::warning::Route ${bundle.route} first-load JS ${formatKb(bundle.sizeBytes)} exceeds warn budget (${warnBudgetKb}KB).`
    );
  }

  if (overFail.length > 0) {
    const topOffenders = overFail
      .slice(0, 5)
      .map((bundle) => `${bundle.route}=${formatKb(bundle.sizeBytes)}`)
      .join(", ");
    fail(`Bundle budget exceeded for ${overFail.length} route(s). Top offenders: ${topOffenders}.`);
  }
}

main();
