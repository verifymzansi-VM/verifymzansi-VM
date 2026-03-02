const sharp = require('sharp');
const fs = require('fs');

async function generateAllIcons() {
  const logoPath = './public/images/logo-transparent.png';
  
  // 1. Extract the actual brand shield from the logo file (the left 144x144 pixels)
  // The original image is 513x144, so left 144px is precisely the shield.
  let shieldBuffer = await sharp(logoPath)
    .extract({ left: 0, top: 0, width: 144, height: 144 })
    .toBuffer();
    
  // 2. Generate the transparent favicon (icon.png) for web browsers
  await sharp(shieldBuffer)
    .resize(32, 32)
    .png()
    .toFile('./src/app/icon.png');
    
  // 3. Generate the background versions for App Icons and Apple Icon
  // Green background definition
  const greenBgSvg = `
  <svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#007749"/>
  </svg>
  `;
  const bgBuffer = Buffer.from(greenBgSvg);

  // Resize the shield to be large but with padding (e.g., 360x360 within the 512x512 box)
  const paddedShield512 = await sharp(shieldBuffer)
    .resize(320, 320, { fit: 'contain', background: { r: 0, g: 0, b:0, alpha: 0 } })
    .toBuffer();

  // Composite the shield exactly on the solid green background for the 512px app icon
  const icon512 = await sharp(bgBuffer)
    .composite([{ input: paddedShield512, gravity: 'center' }])
    .png()
    .toBuffer();

  await sharp(icon512).toFile('./public/icons/icon-512.png');
  
  // Generate 192px app icon
  await sharp(icon512).resize(192, 192).toFile('./public/icons/icon-192.png');
  
  // Generate apple-icon.png for iOS home screen (180x180)
  await sharp(icon512).resize(180, 180).toFile('./src/app/apple-icon.png');
  
  console.log('Successfully generated icon.png, apple-icon.png, and public app icons from the official brand logo shield!');
}

generateAllIcons().catch(console.error);
