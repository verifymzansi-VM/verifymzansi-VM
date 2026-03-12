const sharp = require('sharp');
const fs = require('fs/promises');
const pngToIco = require('png-to-ico').default;

async function generateAllIcons() {
  const logoPath = './public/images/logo-transparent.png';
  const { height } = await sharp(logoPath).metadata();
  const shieldSize = height || 145;
  
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

  // 3. Generate transparent app and Apple icons with breathing room around the shield.
  const paddedShield512 = await sharp(shieldBuffer)
    .resize(320, 320, { fit: 'contain', background: { r: 0, g: 0, b:0, alpha: 0 } })
    .toBuffer();

  const icon512 = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: paddedShield512, gravity: 'center' }])
    .png()
    .toBuffer();

  await sharp(icon512).toFile('./public/icons/icon-512.png');
  
  // Generate 192px app icon
  await sharp(icon512).resize(192, 192).toFile('./public/icons/icon-192.png');
  
  // Generate apple-icon.png for iOS home screen (180x180)
  await sharp(icon512).resize(180, 180).toFile('./src/app/apple-icon.png');
  
  console.log('Successfully generated transparent favicon, browser, app, and Apple icons from the official brand logo shield!');
}

generateAllIcons().catch(console.error);
