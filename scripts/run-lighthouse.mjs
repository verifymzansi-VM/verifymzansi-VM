import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const require = createRequire(import.meta.url);

export async function assertPortAvailable(hostname, port) {
  await new Promise((resolveReady, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(port, hostname, () => probe.close(resolveReady));
  });
}

export function evaluateScores(report, thresholds) {
  if (report.runtimeError) throw new Error(report.runtimeError.message);
  return Object.entries(thresholds).map(([category, minimum]) => {
    const score = report.categories?.[category]?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) {
      throw new Error(`Lighthouse did not produce a score for ${category}.`);
    }
    return { category, score, minimum, status: score >= minimum ? "PASS" : "WARN" };
  });
}

export async function auditPages(config, baseUrl, outputDir = "tmp/lighthouse") {
  await mkdir(outputDir, { recursive: true });
  const summary = [];
  for (const [index, pagePath] of config.paths.entries()) {
    const url = new URL(pagePath, baseUrl).href;
    const prefix = resolve(outputDir, `page-${index + 1}`);
    const result = spawnSync(
      process.execPath,
      [
        require.resolve("lighthouse/cli/index.js"),
        url,
        "--quiet",
        "--output=json",
        "--output=html",
        `--output-path=${prefix}`,
        `--chrome-flags=${config.chromeFlags}`,
      ],
      { stdio: "inherit", timeout: 180000 }
    );
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Lighthouse failed for ${url}.`);
    const report = JSON.parse(await readFile(`${prefix}.report.json`, "utf8"));
    const scores = evaluateScores(report, config.thresholds);
    summary.push({ url, scores, json: `${prefix}.report.json`, html: `${prefix}.report.html` });
    // Preserve the previous advisory score thresholds, while runtime failures fail the command.
    for (const score of scores) {
      const message = `${url} ${score.category}: ${score.score} (minimum ${score.minimum})`;
      console.log(score.status === "WARN" ? `::warning::${message}` : message);
    }
    await writeFile(resolve(outputDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
  }
  return summary;
}

async function main() {
  const config = JSON.parse(await readFile("lighthouse.config.json", "utf8"));
  const baseUrl = process.env.LIGHTHOUSE_BASE_URL || `http://${config.hostname}:${config.port}`;
  let server;
  let serverError;
  try {
    if (!process.env.LIGHTHOUSE_BASE_URL) {
      // Avoid auditing another app that already owns this address.
      await assertPortAvailable(config.hostname, config.port);
      // Start the built app directly so cleanup owns the server process on Windows and Linux.
      server = spawn(
        process.execPath,
        [
          resolve("node_modules/next/dist/bin/next"),
          "start",
          "--port",
          String(config.port),
          "--hostname",
          config.hostname,
        ],
        { stdio: "inherit" }
      );
      server.on("error", (error) => {
        serverError = error;
      });
      const deadline = Date.now() + config.serverReadyTimeoutMs;
      while (true) {
        if (serverError) throw serverError;
        if (server.exitCode !== null || server.signalCode !== null) {
          throw new Error("The production server exited before it was ready.");
        }
        try {
          const response = await fetch(baseUrl, { signal: AbortSignal.timeout(3000) });
          await response.body?.cancel();
          if (response.ok) break;
        } catch {
          /* Keep waiting for startup until the deadline. */
        }
        if (Date.now() >= deadline) throw new Error("Timed out waiting for the production server.");
        await delay(500);
      }
    }
    await auditPages(config, baseUrl);
  } finally {
    server?.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
