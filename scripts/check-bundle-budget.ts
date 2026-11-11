import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import {
  collectAppRouteBundles,
  routeClientChunkFiles,
  type ClientReferenceManifest,
  type RouteBundle,
} from "../src/lib/build/bundle-budget";

type BuildManifest = {
  pages?: Record<string, string[]>;
  rootMainFiles?: string[];
};

type AppBuildManifest = {
  pages?: Record<string, string[]>;
};

const root = process.cwd();
const nextDir = resolve(root, ".next");
const staticChunksDir = resolve(nextDir, "static", "chunks");
const appChunksDir = resolve(staticChunksDir, "app");

// Route entry chunks (raw). Tightened in roadmap M9.4 from 275/325 KB: the
// largest entry (/post/create-tourism) was 95 KB.
const warnBudgetKb = Number(process.env.BUNDLE_BUDGET_WARN_KB ?? "110");
const failBudgetKb = Number(process.env.BUNDLE_BUDGET_FAIL_KB ?? "130");

/**
 * Start-up JavaScript (gzip) of the three pages phones open most: the root
 * scripts every page loads plus every chunk the route's client reference
 * manifest names. That is an upper bound of the first download (the manifest
 * also names chunks of nearby error and layout files); code fetched later
 * with `import()` is not in it. Set in roadmap M9.4 about 5% above that
 * slice's result. Lower a budget when a page gets lighter; raise one only
 * with a reason in the pull request.
 */
const KEY_ROUTE_BUDGETS = [
  { label: "home (/)", route: "/page", failGzipKb: 350 },
  { label: "post page (/listing/[id])", route: "/listing/[id]/page", failGzipKb: 388 },
  {
    label: "business page (/mzansi-business/[id])",
    route: "/(marketplace)/mzansi-business/[id]/page",
    failGzipKb: 432,
  },
] as const;
/** All global stylesheets together (gzip); render-blocking on every page. */
const STYLESHEET_FAIL_GZIP_KB = 44;

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) {
    return null;
  }

  try {
    const raw = readFileSync(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(`Malformed/unreadable build manifest: ${filePath}`);
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
    throw new Error(`Missing/unreadable referenced bundle: ${filePath}`);
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
    if (!Array.isArray(files) || files.some((file) => typeof file !== "string"))
      throw new Error(`Invalid bundle entry: ${route}`);
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

function gzipKb(filePath: string): number {
  return gzipSync(readFileSync(filePath)).length / 1024;
}

/** Reads one route's entry from a `page_client-reference-manifest.js` without running it. */
function readClientReferenceManifest(route: string): ClientReferenceManifest {
  const file = resolve(nextDir, "server", "app", `.${route}_client-reference-manifest.js`);
  if (!existsSync(file)) fail(`Missing client reference manifest for ${route}: ${file}`);
  const source = readFileSync(file, "utf8");
  const marker = `globalThis.__RSC_MANIFEST[${JSON.stringify(route)}]=`;
  const start = source.indexOf(marker);
  if (start < 0) fail(`Unreadable client reference manifest for ${route}`);
  const json = source
    .slice(start + marker.length)
    .trim()
    .replace(/;$/, "");
  try {
    return JSON.parse(json) as ClientReferenceManifest;
  } catch {
    fail(`Malformed client reference manifest for ${route}`);
  }
}

function checkKeyRouteBudgets(buildManifest: BuildManifest | null): void {
  // Only App Router builds have route manifests (the fixture builds in
  // scripts/checker-fixtures.test.ts do not).
  if (!existsSync(resolve(nextDir, "server", "app"))) return;
  const rootFiles = buildManifest?.rootMainFiles ?? [];
  if (rootFiles.length === 0) fail("build-manifest.json lists no rootMainFiles.");
  const over: string[] = [];
  for (const budget of KEY_ROUTE_BUDGETS) {
    const files = unique([
      ...rootFiles,
      ...routeClientChunkFiles(readClientReferenceManifest(budget.route)),
    ]);
    const total = files.reduce((sum, file) => {
      const filePath = resolve(nextDir, file);
      if (!existsSync(filePath)) fail(`Missing/unreadable referenced bundle: ${filePath}`);
      return sum + gzipKb(filePath);
    }, 0);
    console.warn(
      `Start-up JS ${budget.label}: ${Math.round(total)}KB gzip in ${files.length} files (budget ${budget.failGzipKb}KB)`
    );
    if (total > budget.failGzipKb) over.push(`${budget.label}=${Math.round(total)}KB`);
  }
  const cssDir = resolve(nextDir, "static", "css");
  const stylesheets = existsSync(cssDir)
    ? readdirSync(cssDir).filter((f) => f.endsWith(".css"))
    : [];
  const css = stylesheets.reduce((sum, file) => sum + gzipKb(join(cssDir, file)), 0);
  console.warn(
    `Stylesheets: ${Math.round(css)}KB gzip in ${stylesheets.length} files (budget ${STYLESHEET_FAIL_GZIP_KB}KB)`
  );
  if (css > STYLESHEET_FAIL_GZIP_KB) over.push(`stylesheets=${Math.round(css)}KB`);
  if (over.length > 0) fail(`Key page budget exceeded: ${over.join(", ")}.`);
}

function fail(message: string): never {
  console.error(`::error::${message}`);
  process.exit(1);
}

function main(): void {
  if (process.argv.slice(2).some((arg) => arg !== "--")) fail("Unsupported bundle-budget argument");
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
  checkKeyRouteBudgets(readJson<BuildManifest>(resolve(nextDir, "build-manifest.json")));

  let routeBundles = collectRouteBundles().sort((a, b) => b.sizeBytes - a.sizeBytes);
  let metricLabel = "manifest-listed JS";
  if (routeBundles.length === 0 && existsSync(appChunksDir)) {
    metricLabel = "App Router entry JS (shared/layout dependencies excluded)";
    routeBundles = collectAppRouteBundles(walkFiles(appChunksDir), appChunksDir, getFileSize).sort(
      (a, b) => b.sizeBytes - a.sizeBytes
    );

    if (routeBundles.length > 0) {
      console.warn(
        "Using Next App Router entry chunk budget fallback. This is not a total first-load JS measurement."
      );
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
      `::warning::Entry ${bundle.route} ${metricLabel} ${formatKb(bundle.sizeBytes)} exceeds warn budget (${warnBudgetKb}KB).`
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
