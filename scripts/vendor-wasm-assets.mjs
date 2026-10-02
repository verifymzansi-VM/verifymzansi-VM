// Copies the client-side WASM runtimes (FFmpeg video compression, MediaPipe
// face liveness) from lockfile-pinned node_modules into public/vendor so they
// are served from our own origin instead of a public CDN. This keeps the CSP
// free of third-party script hosts such as unpkg.com and jsdelivr.
//
// ffmpeg-core.wasm (~32 MB) exceeds Cloudflare Workers' 25 MiB per-asset
// limit, so it is shipped gzipped and decompressed in the browser
// (see src/lib/media/video-compressor.ts).
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { createGzip, constants } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outRoot = path.join(root, "public", "vendor");
const MAX_ASSET_BYTES = 25 * 1024 * 1024;

function packageDir(name) {
  // @ffmpeg/core does not export ./package.json, so resolve by path
  // (.npmrc uses the hoisted node linker).
  return path.join(root, "node_modules", ...name.split("/"));
}

async function copyChecked(from, to) {
  await copyFile(from, to);
  const { size } = await stat(to);
  if (size > MAX_ASSET_BYTES) throw new Error(`${to} is ${size} bytes (over 25 MiB asset limit)`);
}

await rm(outRoot, { recursive: true, force: true });

const ffmpegSrc = path.join(packageDir("@ffmpeg/core"), "dist", "umd");
const ffmpegOut = path.join(outRoot, "ffmpeg-core");
await mkdir(ffmpegOut, { recursive: true });
await copyChecked(path.join(ffmpegSrc, "ffmpeg-core.js"), path.join(ffmpegOut, "ffmpeg-core.js"));
const gzPath = path.join(ffmpegOut, "ffmpeg-core.wasm.gz");
await pipeline(
  createReadStream(path.join(ffmpegSrc, "ffmpeg-core.wasm")),
  createGzip({ level: constants.Z_BEST_COMPRESSION }),
  createWriteStream(gzPath)
);
if ((await stat(gzPath)).size > MAX_ASSET_BYTES) throw new Error(`${gzPath} exceeds 25 MiB`);

const mediapipeSrc = path.join(packageDir("@mediapipe/tasks-vision"), "wasm");
const mediapipeOut = path.join(outRoot, "mediapipe");
await mkdir(mediapipeOut, { recursive: true });
// FilesetResolver.forVisionTasks picks the SIMD or no-SIMD classic build.
for (const name of [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
]) {
  await copyChecked(path.join(mediapipeSrc, name), path.join(mediapipeOut, name));
}

console.log("Vendored WASM runtimes into public/vendor");
