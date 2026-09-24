const sharp = require("sharp");
const fs = require("fs/promises");
const path = require("path");
const pngToIco = require("png-to-ico").default;
const root = path.join(__dirname, "..");
const source = path.join(root, "public/images/brand-shield.png");
const output = (file) => path.join(root, file);

async function generateAllIcons() {
  await fs.mkdir(output("public/icons"), { recursive: true });
  const master = await sharp(source).png().toBuffer();
  for (const size of [16, 32, 192, 256, 512, 1024]) {
    await sharp(master)
      .resize(size, size)
      .png()
      .toFile(output(`public/icons/icon-${size}.png`));
  }
  await sharp(master).resize(64, 64).png().toFile(output("src/app/icon.png"));
  await sharp(master).resize(96, 96).png().toFile(output("public/images/brand-shield-small.png"));
  const favicon = await pngToIco(
    await Promise.all([16, 32, 48].map((size) => sharp(master).resize(size, size).png().toBuffer()))
  );
  await fs.writeFile(output("src/app/favicon.ico"), favicon);
  await fs.writeFile(output("public/favicon.ico"), favicon);
  await sharp(master)
    .resize(180, 180)
    .flatten({ background: "#faf8f5" })
    .png()
    .toFile(output("src/app/apple-icon.png"));
  // A 70% canvas fits the entire square artwork in the circular maskable safe zone.
  const maskable = await sharp({
    create: { width: 1024, height: 1024, channels: 4, background: "#faf8f5" },
  })
    .composite([{ input: await sharp(master).resize(716, 716).toBuffer(), gravity: "center" }])
    .png()
    .toBuffer();
  for (const size of [192, 512]) {
    await sharp(maskable)
      .resize(size, size)
      .toFile(output(`public/icons/icon-maskable-${size}.png`));
  }
  await fs.mkdir(output("public/social"), { recursive: true });
  for (const suffix of ["512", "150", "150-outline", "150-clean-badge", "150-badge"]) {
    const size = suffix === "512" ? 512 : 150;
    await sharp(master)
      .resize(size, size)
      .toFile(output(`public/social/youtube-watermark-shield-${suffix}.png`));
  }
  // Embed a small PNG in the social card, avoiding runtime network or filesystem dependencies.
  const og = await sharp(master).resize(160, 160).png().toBuffer();
  await fs.writeFile(
    output("src/lib/brand-shield-data.json"),
    JSON.stringify(`data:image/png;base64,${og.toString("base64")}`) + "\n"
  );
  console.log("Brand browser, app, Apple, maskable and social icons regenerated.");
}

generateAllIcons().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
