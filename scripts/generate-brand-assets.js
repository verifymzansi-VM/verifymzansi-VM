const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const SOURCE_LOGO = path.join(__dirname, "..", "public", "images", "logo-transparent.png");
const OUTPUT_DIR = path.join(__dirname, "..", "public", "images");

const HORIZONTAL_WIDTH = 516;
const HORIZONTAL_HEIGHT = 145;
const SHIELD_SIZE = 145;

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildHorizontalOverlay({ inverse = false }) {
  const descriptorColor = inverse ? "rgba(255,248,243,0.74)" : "rgba(76,64,54,0.68)";
  const verifyColor = inverse ? "#fffaf5" : "#1d1712";
  const mzansiColor = inverse ? "#b4e2c0" : "#006b32";
  const dividerColor = inverse ? "rgba(255,255,255,0.18)" : "rgba(61,43,27,0.12)";

  return `
  <svg width="${HORIZONTAL_WIDTH}" height="${HORIZONTAL_HEIGHT}" viewBox="0 0 ${HORIZONTAL_WIDTH} ${HORIZONTAL_HEIGHT}" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="accent-gradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#FFB81C"/>
        <stop offset="72%" stop-color="#00833E"/>
        <stop offset="100%" stop-color="#006B32"/>
      </linearGradient>
    </defs>

    <rect x="166" y="24" width="1.5" height="97" rx="0.75" fill="${dividerColor}" />

    <text
      x="188"
      y="44"
      fill="${descriptorColor}"
      font-family="Aptos, 'Segoe UI', 'Trebuchet MS', sans-serif"
      font-size="12"
      font-weight="600"
      letter-spacing="4.4"
    >
      TRUSTED MARKETPLACE
    </text>

    <text
      x="188"
      y="94"
      fill="${verifyColor}"
      font-family="Aptos Display, Aptos, 'Segoe UI Variable Display', 'Segoe UI', sans-serif"
      font-size="50"
      font-weight="700"
      letter-spacing="-2"
    >
      Verify
      <tspan fill="${mzansiColor}">Mzansi</tspan>
    </text>

    <rect x="190" y="110" width="108" height="4" rx="2" fill="url(#accent-gradient)" />
  </svg>`;
}

function buildSquareInverseOverlay() {
  return `
  <svg width="640" height="640" viewBox="0 0 640 640" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="accent-square-gradient" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="#FFD870"/>
        <stop offset="70%" stop-color="#9FE0B3"/>
        <stop offset="100%" stop-color="#73DEA0"/>
      </linearGradient>
    </defs>

    <text
      x="320"
      y="332"
      text-anchor="middle"
      fill="rgba(255,248,243,0.7)"
      font-family="Aptos, 'Segoe UI', 'Trebuchet MS', sans-serif"
      font-size="22"
      font-weight="600"
      letter-spacing="8.4"
    >
      TRUSTED MARKETPLACE
    </text>

    <text
      x="320"
      y="410"
      text-anchor="middle"
      fill="#fffaf5"
      font-family="Aptos Display, Aptos, 'Segoe UI Variable Display', 'Segoe UI', sans-serif"
      font-size="86"
      font-weight="700"
      letter-spacing="-4"
    >
      Verify<tspan fill="#B4E2C0">Mzansi</tspan>
    </text>

    <rect x="248" y="438" width="144" height="6" rx="3" fill="url(#accent-square-gradient)" />
  </svg>`;
}

async function main() {
  ensureDir(OUTPUT_DIR);

  const shield = await sharp(SOURCE_LOGO)
    .extract({ left: 0, top: 0, width: SHIELD_SIZE, height: SHIELD_SIZE })
    .png()
    .toBuffer();

  const transparentBase = sharp({
    create: {
      width: HORIZONTAL_WIDTH,
      height: HORIZONTAL_HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });

  const darkBase = sharp({
    create: {
      width: HORIZONTAL_WIDTH,
      height: HORIZONTAL_HEIGHT,
      channels: 4,
      background: { r: 250, g: 248, b: 245, alpha: 1 },
    },
  });

  const squareBase = sharp({
    create: {
      width: 640,
      height: 640,
      channels: 4,
      background: { r: 19, g: 16, b: 14, alpha: 1 },
    },
  });

  await transparentBase
    .composite([
      { input: shield, left: 0, top: 0 },
      { input: Buffer.from(buildHorizontalOverlay({ inverse: false })) },
    ])
    .png()
    .toFile(path.join(OUTPUT_DIR, "logo-transparent.png"));

  await darkBase
    .composite([
      { input: shield, left: 0, top: 0 },
      { input: Buffer.from(buildHorizontalOverlay({ inverse: false })) },
    ])
    .png()
    .toFile(path.join(OUTPUT_DIR, "logo.png"));

  const squareShield = await sharp(shield)
    .resize(176, 176, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await squareBase
    .composite([
      { input: squareShield, left: 232, top: 124 },
      { input: Buffer.from(buildSquareInverseOverlay()) },
    ])
    .png()
    .toFile(path.join(OUTPUT_DIR, "logo-white.png"));

  console.log("Brand logo assets regenerated.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});