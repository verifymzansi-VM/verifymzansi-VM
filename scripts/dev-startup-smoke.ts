import { spawn } from "node:child_process";

if (process.argv.length > 2) throw new Error("test:dev-startup accepts no flags");

const port = Number(process.env.DEV_SMOKE_PORT || "3000");
const startupTimeoutMs = Number(process.env.DEV_SMOKE_TIMEOUT_MS || "45000");
if (
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535 ||
  !Number.isInteger(startupTimeoutMs) ||
  startupTimeoutMs < 1 ||
  startupTimeoutMs > 600000
)
  throw new Error("Invalid dev startup port or timeout");
const warningPattern = /next-image-missing-loader-width|does not implement width/i;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttpOk(url: string, attempts = 30, delayMs = 500): Promise<void> {
  let lastStatus = "unreachable";

  for (let i = 0; i < attempts; i += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(5000), redirect: "error" });
      lastStatus = String(response.status);
      if (response.ok) {
        return;
      }
    } catch {
      // Retry until attempts are exhausted.
    }
    await sleep(delayMs);
  }

  throw new Error(`Endpoint did not return 200 OK: ${url} (last status: ${lastStatus})`);
}

async function stopProcessTree(child: ReturnType<typeof spawn>): Promise<void> {
  if (!child.pid) return;

  if (process.platform === "win32") {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
        stdio: "ignore",
      });
      killer.on("close", () => resolve());
      killer.on("error", () => resolve());
    });
    return;
  }

  child.kill("SIGTERM");
}

async function run(): Promise<void> {
  const pnpmCmd = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(`${pnpmCmd} exec next dev --port ${port}`, {
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let sawReady = false;
  let sawLoaderWarning = false;
  let startupOutput = "";

  const onData = (chunk: Buffer) => {
    const text = chunk.toString();
    startupOutput += text;
    if (/ready in/i.test(text)) {
      sawReady = true;
    }
    if (warningPattern.test(text)) {
      sawLoaderWarning = true;
    }
    process.stdout.write(text);
  };

  child.stdout?.on("data", onData);
  child.stderr?.on("data", onData);

  try {
    const startupStart = Date.now();
    while (!sawReady && Date.now() - startupStart < startupTimeoutMs) {
      await sleep(200);
    }

    if (!sawReady) {
      throw new Error(
        `Dev server did not become ready within ${startupTimeoutMs}ms.\n${startupOutput}`
      );
    }

    await waitForHttpOk(`http://127.0.0.1:${port}/`);
    await waitForHttpOk(`http://127.0.0.1:${port}/api/health`);

    if (sawLoaderWarning) {
      throw new Error("Detected Next image loader width warning in dev output.");
    }

    process.stdout.write("DEV_STARTUP_SMOKE:PASS\n");
  } finally {
    await stopProcessTree(child);
  }
}

run().catch((error) => {
  console.error("DEV_STARTUP_SMOKE:FAIL", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
