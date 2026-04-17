import { mkdir, readdir, readFile, rm, stat, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import Jimp from "jimp";

const rootDir = process.cwd();
const outputPlaywrightDir = path.join(rootDir, "output", "playwright");
const publicDir = path.join(rootDir, "public");
const promoDir = path.join(publicDir, "images", "promo");
const socialDir = path.join(publicDir, "social");
const fallbacksDir = path.join(publicDir, "images", "fallbacks");
const e2eMediaDir = path.join(publicDir, "e2e-media");

async function findLatestCaptureDir() {
  const pointerPath = path.join(outputPlaywrightDir, "latest-live-site.txt");

  try {
    const pointed = (await readFile(pointerPath, "utf8")).trim();
    if (pointed) {
      return pointed;
    }
  } catch {
    // fall through
  }

  const entries = await readdir(outputPlaywrightDir, { withFileTypes: true });
  const captureDirs = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("live-site-"))
    .map((entry) => path.join(outputPlaywrightDir, entry.name));

  if (captureDirs.length === 0) {
    throw new Error("No live-site capture directory found. Run pnpm capture:live-site first.");
  }

  const dirsWithMtime = await Promise.all(
    captureDirs.map(async (dir) => ({
      dir,
      mtimeMs: (await stat(dir)).mtimeMs,
    }))
  );

  dirsWithMtime.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return dirsWithMtime[0].dir;
}

async function ensureDir(dir: string) {
  await mkdir(dir, { recursive: true });
}

async function purgeDirectoryContents(dir: string) {
  await rm(dir, { recursive: true, force: true });
  await ensureDir(dir);
}

function capturePath(baseDir: string, ...segments: string[]) {
  return path.join(baseDir, ...segments);
}

async function copyCapture(source: string, destination: string) {
  await ensureDir(path.dirname(destination));
  await copyFile(source, destination);
}

async function generateSocialWatermarks() {
  const icon512Path = path.join(publicDir, "icons", "icon-512.png");
  const icon = await Jimp.read(icon512Path);

  const base512 = icon.clone().contain(512, 512);
  await base512.writeAsync(path.join(socialDir, "youtube-watermark-shield-512.png"));

  const base150 = icon.clone().contain(150, 150);
  await base150.writeAsync(path.join(socialDir, "youtube-watermark-shield-150.png"));
  await base150
    .clone()
    .writeAsync(path.join(socialDir, "youtube-watermark-shield-150-outline.png"));
  await base150
    .clone()
    .writeAsync(path.join(socialDir, "youtube-watermark-shield-150-clean-badge.png"));
  await base150.clone().writeAsync(path.join(socialDir, "youtube-watermark-shield-150-badge.png"));
}

function buildFallbackSvg({
  title,
  eyebrow,
  accent,
  label,
}: {
  title: string;
  eyebrow: string;
  accent: string;
  label: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="900" viewBox="0 0 1200 900" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="900" rx="56" fill="#F9F7F1"/>
  <rect width="1200" height="900" rx="56" fill="url(#mesh)"/>
  <g opacity="0.9">
    <rect x="92" y="84" width="1016" height="84" rx="30" fill="white" fill-opacity="0.88"/>
    <rect x="120" y="112" width="228" height="28" rx="14" fill="${accent}" fill-opacity="0.18"/>
    <rect x="860" y="106" width="112" height="40" rx="20" fill="white"/>
    <rect x="986" y="106" width="92" height="40" rx="20" fill="${accent}"/>
  </g>
  <g filter="url(#shadow)">
    <rect x="156" y="214" width="888" height="448" rx="48" fill="white" fill-opacity="0.8"/>
    <rect x="192" y="252" width="520" height="372" rx="40" fill="url(#cardbg)"/>
    <rect x="742" y="254" width="264" height="184" rx="32" fill="#FFFFFF" fill-opacity="0.9"/>
    <rect x="742" y="458" width="264" height="142" rx="32" fill="#FFFFFF" fill-opacity="0.92"/>
    <rect x="212" y="274" width="224" height="20" rx="10" fill="white" fill-opacity="0.82"/>
    <rect x="212" y="306" width="310" height="58" rx="18" fill="white" fill-opacity="0.96"/>
    <rect x="212" y="388" width="388" height="18" rx="9" fill="white" fill-opacity="0.74"/>
    <rect x="212" y="420" width="276" height="18" rx="9" fill="white" fill-opacity="0.58"/>
    <rect x="212" y="498" width="188" height="54" rx="27" fill="${accent}"/>
    <rect x="212" y="578" width="420" height="12" rx="6" fill="${accent}" fill-opacity="0.5"/>
    <rect x="770" y="282" width="208" height="22" rx="11" fill="${accent}" fill-opacity="0.18"/>
    <rect x="770" y="322" width="166" height="48" rx="16" fill="${accent}" fill-opacity="0.95"/>
    <rect x="770" y="488" width="164" height="20" rx="10" fill="${accent}" fill-opacity="0.18"/>
    <rect x="770" y="526" width="198" height="16" rx="8" fill="#111827" fill-opacity="0.14"/>
  </g>
  <text x="182" y="730" fill="#111827" font-family="Segoe UI, sans-serif" font-size="30" font-weight="700" letter-spacing="6">${eyebrow}</text>
  <text x="182" y="784" fill="#0F172A" font-family="Segoe UI, sans-serif" font-size="60" font-weight="800">${title}</text>
  <text x="182" y="830" fill="#334155" font-family="Segoe UI, sans-serif" font-size="30">${label}</text>
  <defs>
    <linearGradient id="mesh" x1="0" y1="0" x2="1200" y2="900" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F7F3E8"/>
      <stop offset="0.56" stop-color="#F6FBF8"/>
      <stop offset="1" stop-color="#F4F0E8"/>
    </linearGradient>
    <linearGradient id="cardbg" x1="192" y1="252" x2="712" y2="624" gradientUnits="userSpaceOnUse">
      <stop stop-color="#DFF8EB"/>
      <stop offset="1" stop-color="#F6F8FB"/>
    </linearGradient>
    <filter id="shadow" x="116" y="190" width="968" height="512" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feFlood flood-opacity="0" result="BackgroundImageFix"/>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
      <feOffset dy="18"/>
      <feGaussianBlur stdDeviation="20"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.0588 0 0 0 0 0.0941 0 0 0 0 0.1608 0 0 0 0.18 0"/>
      <feBlend mode="normal" in2="BackgroundImageFix" result="effect1_dropShadow_1_1"/>
      <feBlend mode="normal" in="SourceGraphic" in2="effect1_dropShadow_1_1" result="shape"/>
    </filter>
  </defs>
</svg>`;
}

async function writeFallbackAssets() {
  const entries = [
    {
      filename: "hero-business.svg",
      title: "Verified local businesses",
      eyebrow: "MZANSI BUSINESS",
      accent: "#002395",
      label: "Live-inspired fallback for the current business surface",
    },
    {
      filename: "hero-listing.svg",
      title: "Products with real visibility",
      eyebrow: "MZANSI MARKET",
      accent: "#00833E",
      label: "Live-inspired fallback for current listing discovery",
    },
    {
      filename: "hero-shop.svg",
      title: "Tourism and campaigns that convert",
      eyebrow: "TOURISM & EVENTS",
      accent: "#0EA5A4",
      label: "Live-inspired fallback for current promotions surfaces",
    },
    {
      filename: "side-card-list-business.svg",
      title: "List your business",
      eyebrow: "ADVERTISE",
      accent: "#002395",
      label: "Derived from the live advertise flow",
    },
    {
      filename: "side-card-promote-event.svg",
      title: "Promote an event",
      eyebrow: "EVENTS",
      accent: "#0EA5A4",
      label: "Derived from the live promotions entry point",
    },
    {
      filename: "side-card-sell-market.svg",
      title: "Sell on market",
      eyebrow: "MARKET",
      accent: "#00833E",
      label: "Derived from the live market surface",
    },
    {
      filename: "side-card-trusted-marketplace.svg",
      title: "Trusted marketplace",
      eyebrow: "VERIFYMZANSI",
      accent: "#FFB81C",
      label: "Aligned to the current homepage visual system",
    },
  ];

  for (const entry of entries) {
    await writeFile(path.join(fallbacksDir, entry.filename), buildFallbackSvg(entry), "utf8");
  }
}

async function main() {
  const captureDir = process.env.LIVE_CAPTURE_DIR || (await findLatestCaptureDir());

  await Promise.all([ensureDir(promoDir), ensureDir(socialDir), ensureDir(fallbacksDir)]);

  await purgeDirectoryContents(promoDir);

  const socialFiles = await readdir(socialDir);
  await Promise.all(
    socialFiles
      .filter((file) => file.endsWith(".png"))
      .map((file) => rm(path.join(socialDir, file), { force: true }))
  );

  const promoCopies: Array<[string, string]> = [
    [capturePath(captureDir, "mobile", "home-viewport.png"), path.join(promoDir, "promo-1.png")],
    [
      capturePath(captureDir, "desktop", "pricing-viewport.png"),
      path.join(promoDir, "promo-2.png"),
    ],
    [
      capturePath(captureDir, "mobile", "advertise-viewport.png"),
      path.join(promoDir, "promo-3.png"),
    ],
    [
      capturePath(captureDir, "desktop", "register-viewport.png"),
      path.join(promoDir, "promo-4.png"),
    ],
    [
      capturePath(captureDir, "desktop", "mzansi-business-viewport.png"),
      path.join(promoDir, "promo-5.png"),
    ],
    [
      capturePath(captureDir, "desktop", "mzansi-market-viewport.png"),
      path.join(promoDir, "promo-6.png"),
    ],
    [
      capturePath(captureDir, "manifest", "home-wide.png"),
      path.join(promoDir, "screenshot-wide.png"),
    ],
    [
      capturePath(captureDir, "manifest", "home-narrow.png"),
      path.join(promoDir, "screenshot-narrow.png"),
    ],
    [
      capturePath(captureDir, "journeys", "advertiser-desktop.webm"),
      path.join(promoDir, "advertiser-desktop.webm"),
    ],
    [
      capturePath(captureDir, "journeys", "advertiser-mobile.webm"),
      path.join(promoDir, "advertiser-mobile.webm"),
    ],
  ];

  for (const [source, destination] of promoCopies) {
    await copyCapture(source, destination);
  }

  const socialCopies: Array<[string, string]> = [
    [
      capturePath(captureDir, "social", "pricing-banner.png"),
      path.join(socialDir, "youtube-banner-2048x1152-v2.png"),
    ],
    [
      capturePath(captureDir, "social", "advertise-banner.png"),
      path.join(socialDir, "youtube-banner-2048x1152-v5-attractive.png"),
    ],
    [
      capturePath(captureDir, "social", "home-banner.png"),
      path.join(socialDir, "youtube-banner-2048x1152.png"),
    ],
  ];

  for (const [source, destination] of socialCopies) {
    await copyCapture(source, destination);
  }

  await generateSocialWatermarks();
  await writeFallbackAssets();

  await rm(e2eMediaDir, { recursive: true, force: true });
  await ensureDir(e2eMediaDir);
  await writeFile(path.join(e2eMediaDir, ".gitkeep"), "", "utf8");

  process.stdout.write(`Live-derived assets generated from ${captureDir}\n`);
}

main().catch((error) => {
  console.error("Asset refresh failed:", error);
  process.exit(1);
});
