const sharp = require('sharp');
const fs = require('fs/promises');
const pngToIco = require('png-to-ico').default;

async function generateAllIcons() {
  const logoPath = './public/images/logo-transparent.png';
  const { height } = await sharp(logoPath).metadata();
  const shieldSize = height || 145;
  const appIconCanvasSize = 1024;
  const shieldRenderSize = 800;
  
  // 1. Extract the actual brand shield from the logo file.
  let shieldBuffer = await sharp(logoPath)
    .extract({ left: 0, top: 0, width: shieldSize, height: shieldSize })
    .toBuffer();
    
  // 2. Generate transparent browser icons directly from the preserved shield.
  await sharp(shieldBuffer)
    .resize(16, 16)
    .png()
    .toFile('./public/icons/icon-16.png');

  await sharp(shieldBuffer)
    .resize(32, 32)
    .png()
    .toFile('./public/icons/icon-32.png');

  await sharp(shieldBuffer)
    .resize(32, 32)
    .png()
    .toFile('./src/app/icon.png');

  const faviconPngBuffer = await sharp(shieldBuffer)
    .resize(32, 32)
    .png()
    .toBuffer();

  const faviconIcoBuffer = await pngToIco([faviconPngBuffer]);
  await fs.writeFile('./src/app/favicon.ico', faviconIcoBuffer);

  // 3. Generate transparent app and Apple icons with a larger shield so installs stay legible.
  const paddedShieldMaster = await sharp(shieldBuffer)
    .resize(shieldRenderSize, shieldRenderSize, { fit: 'contain', background: { r: 0, g: 0, b:0, alpha: 0 } })
    .toBuffer();

  const iconMaster = await sharp({
    create: {
      width: appIconCanvasSize,
      height: appIconCanvasSize,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: paddedShieldMaster, gravity: 'center' }])
    .png()
    .toBuffer();

  await sharp(iconMaster).toFile('./public/icons/icon-1024.png');
  await sharp(iconMaster).resize(512, 512).toFile('./public/icons/icon-512.png');
  await sharp(iconMaster).resize(256, 256).toFile('./public/icons/icon-256.png');
  await sharp(iconMaster).resize(192, 192).toFile('./public/icons/icon-192.png');
  
  // Generate apple-icon.png for iOS home screen (180x180) from the high-resolution master.
  await sharp(iconMaster).resize(180, 180).toFile('./src/app/apple-icon.png');
  
  console.log('Successfully generated transparent favicon, browser, app, and Apple icons from the official brand logo shield!');
}

generateAllIcons().catch(console.error);
