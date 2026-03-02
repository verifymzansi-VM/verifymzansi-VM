const sharp = require('sharp');

const svgCode = `
<svg width="512" height="512" viewBox="0 0 512 512" fill="none" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#007749"/>
      <stop offset="100%" stop-color="#005a36"/>
    </linearGradient>
    <linearGradient id="3dGold" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#D19E2B"/>
      <stop offset="50%" stop-color="#754800"/>
      <stop offset="50%" stop-color="#FFE066"/>
      <stop offset="100%" stop-color="#B87300"/>
    </linearGradient>
  </defs>
  
  <rect width="512" height="512" fill="url(#bg)"/>
  
  <g transform="translate(100, 100) scale(3.1)">
    <path d="M 50 13 L 15 9 C 15 49 28 77 50 92 C 72 77 85 49 85 9 Z" 
          stroke="url(#3dGold)" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <path d="M 28 47 L 50 69 L 75 32" 
          stroke="url(#3dGold)" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  </g>
</svg>
`;

const buffer = Buffer.from(svgCode);

Promise.all([
  sharp(buffer).png().toFile('./public/icons/icon-512.png'),
  sharp(buffer).resize(192, 192).png().toFile('./public/icons/icon-192.png')
]).then(() => {
  console.log('App icons successfully regenerated without white corners!');
}).catch(err => {
  console.error('Error generating icons:', err);
});
