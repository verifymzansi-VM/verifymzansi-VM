const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await fs.mkdir('output/advert-originals', { recursive: true });
    await fs.mkdir('public/video/advert-originals', { recursive: true });
    for (const [name, route] of [['market', '/mzansi-market'], ['business', '/mzansi-business'], ['tourism', '/tourism-events']]) {
      const page = await browser.newPage({ viewport: { width: 540, height: 960 } });
      await page.goto('https://verifymzansi.com' + route, { waitUntil: 'domcontentloaded', timeout: 60000 });
      const play = page.getByRole('button', { name: 'Play video', exact: true }).first();
      await play.waitFor({ state: 'visible', timeout: 30000 });
      await play.click();
      await page.waitForFunction(() => Array.from(document.querySelectorAll('video')).some(v => !v.paused && v.currentTime > 0.2), undefined, { timeout: 15000 });
      const source = await page.locator('video').evaluateAll(videos => videos.find(v => !v.paused)?.currentSrc);
      if (!source || !source.startsWith('https://')) throw new Error('No public HTTPS video for ' + name);
      const response = await page.request.get(source, { timeout: 60000 });
      if (!response.ok()) throw new Error('Public media unavailable for ' + name);
      const original = 'output/advert-originals/' + name + '.mp4';
      await fs.writeFile(original, await response.body());
      const destination = 'public/video/advert-originals/' + name + '.mp4';
      execFileSync(path.resolve('node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe'), ['-hide_banner', '-loglevel', 'error', '-ss', '0.6', '-i', original, '-t', '4.5', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-y', destination], { stdio: ['ignore', 'ignore', 'pipe'] });
      console.log(name + ': prepared original-quality video excerpt');
      await page.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.message.replace(/https?:\/\/\S+/g, '[media URL]')); process.exit(1); });
