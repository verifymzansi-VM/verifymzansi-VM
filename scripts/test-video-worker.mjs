// Run after pnpm build. Exercises the actual emitted worker, without uploading
// anything or depending on authenticated posting pages. Requires Chromium.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const chunks = process.env.VIDEO_WORKER_CHUNKS || ".next/static/chunks";
let worker;
for (const name of await readdir(chunks)) {
  if (!name.endsWith(".js")) continue;
  const source = await readFile(`${chunks}/${name}`, "utf8");
  if (source.includes("self.createFFmpegCore") && source.includes("self.onmessage")) {
    worker = source;
    break;
  }
}
assert.ok(worker, "Build the app with pnpm build before testing its video worker");
const compressor = await readFile("src/lib/media/video-compressor.ts", "utf8");
const base = compressor.match(/FFMPEG_CORE_BASE_URL = "([^"]+)"/)[1];
const server = createServer((req, res) => {
  res.setHeader("Content-Type", req.url === "/worker.js" ? "text/javascript" : "text/html");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' https://unpkg.com; worker-src 'self'; connect-src 'self' https://unpkg.com"
  );
  res.end(
    req.url === "/worker.js" ? worker : "<!doctype html><title>Video worker regression</title>"
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result = await page.evaluate(
    async (baseURL) => {
      const worker = new Worker("/worker.js");
      let nextId = 0;
      const pending = new Map();
      worker.onmessage = ({ data }) => {
        const request = pending.get(data.id);
        if (!request) return;
        pending.delete(data.id);
        clearTimeout(request.timer);
        if (data.type === "ERROR") request.reject(new Error(data.data));
        else request.resolve(data.data);
      };
      const call = (type, data) =>
        new Promise((resolve, reject) => {
          const id = ++nextId;
          const timer = setTimeout(() => reject(new Error(`${type} timed out`)), 120_000);
          pending.set(id, { resolve, reject, timer });
          worker.postMessage({ id, type, data });
        });
      try {
        await call("LOAD", {
          coreURL: `${baseURL}/ffmpeg-core.js`,
          wasmURL: `${baseURL}/ffmpeg-core.wasm`,
        });
        const generated = await call("EXEC", {
          args: [
            "-f",
            "lavfi",
            "-i",
            "color=c=green:s=160x120:r=30",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-y",
            "input.mov",
          ],
        });
        if (generated !== 0) throw new Error(`Fixture generation failed: ${generated}`);
        const converted = await call("EXEC", {
          args: [
            "-i",
            "input.mov",
            "-map",
            "0:v:0",
            "-map",
            "0:a:0?",
            "-c:v",
            "libx264",
            "-profile:v",
            "baseline",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            "output.mp4",
          ],
        });
        if (converted !== 0) throw new Error(`Conversion failed: ${converted}`);
        const bytes = await call("READ_FILE", { path: "output.mp4" });
        return { bytes: bytes.length, signature: String.fromCharCode(...bytes.slice(4, 8)) };
      } finally {
        for (const request of pending.values()) clearTimeout(request.timer);
        worker.terminate();
      }
    },
    process.argv.includes("--legacy-esm") ? base.replace("/umd", "/esm") : base
  );
  assert.ok(result.bytes > 0);
  assert.equal(result.signature, "ftyp");
  console.log(`PASS: production worker loaded and converted MOV to MP4 (${result.bytes} bytes)`);
} finally {
  await browser?.close();
  server.close();
}
