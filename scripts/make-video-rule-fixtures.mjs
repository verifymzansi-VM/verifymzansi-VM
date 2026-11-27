#!/usr/bin/env node
// Makes the real MP4 files that src/lib/media/video-rule.test.ts checks the
// video keep rule against (src/lib/media/__fixtures__/video-rule/). Each is a
// one-second synthetic test pattern and tone, encoded with the site's own
// ffmpeg.wasm (@ffmpeg/core, the build the posting forms ship) inside
// Playwright's Chromium, so no other encoder is needed. Run it again only when
// the fixture set changes:
//
//   pnpm media:video-rule-fixtures
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";

const OUT = path.resolve("src/lib/media/__fixtures__/video-rule");
const CORE = path.resolve("node_modules/@ffmpeg/core/dist/umd");

const pattern = (size, rate = 30) => [
  "-f",
  "lavfi",
  "-i",
  `testsrc2=size=${size}:rate=${rate}:duration=1`,
];
const tone = ["-f", "lavfi", "-i", "sine=frequency=440:duration=1"];
const h264 = (profile, level, preset = "veryfast") => [
  "-c:v",
  "libx264",
  "-profile:v",
  profile,
  "-level",
  level,
  "-pix_fmt",
  "yuv420p",
  "-preset",
  preset,
  "-crf",
  "38",
  "-g",
  "30",
];
const aac = ["-c:a", "aac", "-b:a", "48k"];
const faststart = ["-movflags", "+faststart"];
const out = (...args) => [...args, "-map_metadata", "-1", "-shortest"];

const fixtures = {
  "pass-720x1280-high-30fps-aac.mp4": out(
    ...pattern("720x1280"),
    ...tone,
    ...h264("high", "3.1"),
    ...aac,
    ...faststart
  ),
  "pass-1080x1920-high-30fps-aac.mp4": out(
    ...pattern("1080x1920"),
    ...tone,
    ...h264("high", "4.0"),
    ...aac,
    ...faststart
  ),
  "pass-1280x720-main-60fps-silent.mp4": out(
    ...pattern("1280x720", 60),
    ...h264("main", "3.2"),
    "-an",
    ...faststart
  ),
  // Today's phone conversion settings (src/lib/media/video-compressor.ts).
  "pass-converter-baseline-720p.mp4": out(
    ...pattern("720x1280"),
    ...tone,
    "-c:v",
    "libx264",
    "-profile:v",
    "baseline",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "ultrafast",
    "-b:v",
    "1.5M",
    "-r",
    "30",
    "-g",
    "60",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    ...faststart
  ),
  "pass-1920x1080-29.97fps-aac.mp4": out(
    ...pattern("1920x1080", "30000/1001"),
    ...tone,
    ...h264("high", "4.0"),
    ...aac,
    ...faststart
  ),
  "fail-moov-at-end.mp4": out(...pattern("720x1280"), ...tone, ...h264("high", "3.1"), ...aac),
  "fail-1920x1080-60fps.mp4": out(
    ...pattern("1920x1080", 60),
    ...h264("high", "4.2"),
    "-an",
    ...faststart
  ),
  "fail-2560x1440.mp4": out(...pattern("2560x1440"), ...h264("high", "4.2"), "-an", ...faststart),
  "fail-high-bitrate.mp4": out(
    ...pattern("320x180"),
    "-vf",
    "noise=alls=100:allf=t",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level",
    "3.1",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "ultrafast",
    "-crf",
    "30",
    "-an",
    ...faststart
  ),
  "fail-two-audio-tracks.mp4": out(
    ...pattern("640x360"),
    ...tone,
    "-map",
    "0:v",
    "-map",
    "1:a",
    "-map",
    "1:a",
    ...h264("high", "3.1"),
    ...aac,
    ...faststart
  ),
  "fail-subtitle-track.mp4": out(
    ...pattern("640x360"),
    "-i",
    "subtitle.srt",
    "-map",
    "0:v",
    "-map",
    "1:s",
    ...h264("high", "3.1"),
    "-c:s",
    "mov_text",
    ...faststart
  ),
  "fail-mp3-audio.mp4": out(
    ...pattern("640x360"),
    ...tone,
    ...h264("high", "3.1"),
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    ...faststart
  ),
  "unreadable-fragmented.mp4": out(
    ...pattern("640x360"),
    ...h264("high", "3.1"),
    "-an",
    "-movflags",
    "frag_keyframe+empty_moov"
  ),
};

const files = {
  "/ffmpeg-core.js": ["text/javascript", await readFile(`${CORE}/ffmpeg-core.js`)],
  "/ffmpeg-core.wasm": ["application/wasm", await readFile(`${CORE}/ffmpeg-core.wasm`)],
};
const server = createServer((request, response) => {
  const file = files[request.url];
  if (file) {
    response.setHeader("Content-Type", file[0]);
    return response.end(file[1]);
  }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><script src="/ffmpeg-core.js"></script>');
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async () => {
    window.core = await createFFmpegCore({ locateFile: () => "/ffmpeg-core.wasm" });
    window.logs = [];
    core.setLogger(({ message }) => window.logs.push(message));
    core.FS.writeFile("subtitle.srt", "1\n00:00:00,000 --> 00:00:01,000\nTest\n");
  });
  await mkdir(OUT, { recursive: true });
  const only = process.argv.slice(2);
  for (const [name, args] of Object.entries(fixtures)) {
    if (only.length && !only.includes(name)) continue;
    const result = await page.evaluate(
      ([file, list]) => {
        window.logs = [];
        core.exec(...list, "-y", file);
        const ret = core.ret;
        core.reset();
        if (ret !== 0) return { error: window.logs.slice(-12).join("\n") };
        const bytes = core.FS.readFile(file);
        core.FS.unlink(file);
        return { bytes: Array.from(bytes) };
      },
      [name, args]
    );
    if (result.error) throw new Error(`${name} failed:\n${result.error}`);
    await writeFile(path.join(OUT, name), Buffer.from(result.bytes));
    console.log(name, result.bytes.length, "bytes");
  }
} finally {
  await browser.close();
  server.close();
}
