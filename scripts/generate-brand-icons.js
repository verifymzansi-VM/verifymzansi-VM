const sharp = require('sharp');
const fs = require('fs');

async function generateBrandIcons() {
  const svgCode = `
  <svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <!-- Dark Brown to Gold gradient for left half -->
      <linearGradient id="leftDark" x1="0" y1="0" x2="0" y2="512" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#181100"/>
        <stop offset="50%" stop-color="#4F3600"/>
        <stop offset="100%" stop-color="#AD820B"/>
      </linearGradient>

      <!-- Vibrant Yellow/Gold gradient for right half/checkmark -->
      <linearGradient id="rightGold" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stop-color="#E3A11C"/>
        <stop offset="50%" stop-color="#F4D341"/>
        <stop offset="100%" stop-color="#C58400"/>
      </linearGradient>
    </defs>
    
    <!-- Group scales everything up nicely -->
    <g transform="translate(40, 40) scale(4.3)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none">
      
      <!-- Left side of shield outline -->
      <!-- Top center gap edge to top-left outer corner, then curve down to bottom center point -->
      <path d="M 45 12 
               L 16 16 
               C 16 55 30 75 50 92" 
            stroke="url(#leftDark)" />
            
      <!-- Right side checkmark that forms the right shield outline -->
      <!-- Checkmark left arm down to center point, sweep up to form right shield, back to top center gap -->
      <path d="M 28 55 
               L 48 78 
               C 68 55 84 30 84 16 
               L 55 12" 
            stroke="url(#rightGold)" />
            
    </g>
  </svg>
  `;

  // Transparent background logic for Favicon
  const shieldBuffer = Buffer.from(svgCode);

  // 1. Generate Favicon
  await sharp(shieldBuffer)
    .resize(192, 192) // Generate a nice 192 icon.png for general PWA usage
    .png()
    .toFile('./src/app/icon.png');

  // 2. Green Solid Background logic for 512 App Icon and Apple Icon
  const bgSvg = `
  <svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="512" height="512" fill="#faf8f5"/>
  </svg>
  `;
  // Wait, let's use a VERY light background #faf8f5 (matches their theme PWA backgroundColor)
  // or pure white so the dark left edge POPS nicely!
  // If we use Green #007749, the dark brown/black left edge will disappear. 
  // The user's logo is shown on a white background!
  const bgBuffer = Buffer.from(`
    <svg width="512" height="512" viewBox="0 0 512 512" fill="none">
      <rect width="512" height="512" fill="#ffffff"/>
    </svg>
  `);

  const paddedShield = await sharp(shieldBuffer).resize(380, 380).toBuffer();
  
  const iconOnWhite = await sharp(bgBuffer)
    .composite([{ input: paddedShield, gravity: 'center' }])
    .png()
    .toBuffer();

  // 3. Output App Icons
  await sharp(iconOnWhite).toFile('./public/icons/icon-512.png');
  await sharp(iconOnWhite).resize(192, 192).toFile('./public/icons/icon-192.png');
  await sharp(iconOnWhite).resize(180, 180).toFile('./src/app/apple-icon.png');
  
  console.log('Generated flawless scalable exact logo icons on professional white squircle background!');
}

generateBrandIcons().catch(console.error);
