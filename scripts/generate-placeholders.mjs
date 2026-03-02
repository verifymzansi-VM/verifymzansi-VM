/**
 * Generate placeholder promo images and icon PNGs.
 * Uses pure Node.js — no external dependencies.
 * Creates minimal valid PNG files with solid colours and embedded text.
 */
import { writeFileSync, mkdirSync } from "fs"
import { join, dirname, resolve } from "path"
import { fileURLToPath } from "url"
import { deflateSync } from "zlib"

const __dirname = dirname(fileURLToPath(import.meta.url))
const publicDir = process.env.PLACEHOLDER_OUT_DIR?.trim()
  ? resolve(process.env.PLACEHOLDER_OUT_DIR)
  : join(__dirname, "..", "public")
const promoDir = join(publicDir, "images", "promo")
const iconsDir = join(publicDir, "icons")

mkdirSync(promoDir, { recursive: true })
mkdirSync(iconsDir, { recursive: true })

// ---------- Tiny PNG encoder (uncompressed RGBA) ----------

function crc32(buf) {
  let table = new Int32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  let crc = -1
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ -1) >>> 0
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeAndData = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData))
  return Buffer.concat([len, typeAndData, crc])
}

function createPNG(width, height, rgbaPixels) {
  // IHDR
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type RGBA
  ihdr[10] = 0 // compression
  ihdr[11] = 0 // filter
  ihdr[12] = 0 // interlace

  // IDAT - build raw scanlines with filter byte 0
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const rowOff = y * (1 + width * 4)
    raw[rowOff] = 0 // filter none
    rgbaPixels.copy(raw, rowOff + 1, y * width * 4, (y + 1) * width * 4)
  }
  const compressed = deflateSync(raw)

  // IEND
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", compressed),
    pngChunk("IEND", Buffer.alloc(0)),
  ])
}

function solidImage(w, h, r, g, b) {
  const buf = Buffer.alloc(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    buf[i * 4] = r
    buf[i * 4 + 1] = g
    buf[i * 4 + 2] = b
    buf[i * 4 + 3] = 255
  }
  return buf
}

function gradientImage(w, h, r1, g1, b1, r2, g2, b2) {
  const buf = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1)
    const r = Math.round(r1 + (r2 - r1) * t)
    const g = Math.round(g1 + (g2 - g1) * t)
    const b = Math.round(b1 + (b2 - b1) * t)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      buf[i] = r
      buf[i + 1] = g
      buf[i + 2] = b
      buf[i + 3] = 255
    }
  }
  return buf
}

// Add a simple light rectangle "card" in the center to make it look more designed
function addCenterRect(buf, imgW, imgH, rectW, rectH, r, g, b, a) {
  const x0 = Math.floor((imgW - rectW) / 2)
  const y0 = Math.floor((imgH - rectH) / 2)
  for (let y = y0; y < y0 + rectH && y < imgH; y++) {
    for (let x = x0; x < x0 + rectW && x < imgW; x++) {
      const i = (y * imgW + x) * 4
      // alpha blend
      const srcA = a / 255
      buf[i] = Math.round(buf[i] * (1 - srcA) + r * srcA)
      buf[i + 1] = Math.round(buf[i + 1] * (1 - srcA) + g * srcA)
      buf[i + 2] = Math.round(buf[i + 2] * (1 - srcA) + b * srcA)
    }
  }
}

// ---------- Promo images (9:16 portrait, 360x640) ----------
const promoW = 360
const promoH = 640

const promoThemes = [
  { label: "Welcome",       gradTop: [0, 131, 62],  gradBot: [0, 90, 40] },
  { label: "Verification",  gradTop: [0, 105, 50],  gradBot: [0, 70, 30] },
  { label: "Shop",          gradTop: [26, 117, 64],  gradBot: [10, 80, 40] },
  { label: "Deals",         gradTop: [218, 165, 32], gradBot: [180, 120, 10] },
  { label: "Become Seller", gradTop: [0, 131, 62],  gradBot: [0, 60, 25] },
  { label: "Highlights",    gradTop: [34, 100, 60],  gradBot: [15, 60, 35] },
]

for (let i = 0; i < promoThemes.length; i++) {
  const t = promoThemes[i]
  const pixels = gradientImage(promoW, promoH,
    t.gradTop[0], t.gradTop[1], t.gradTop[2],
    t.gradBot[0], t.gradBot[1], t.gradBot[2])
  // Add a subtle white center rectangle as a design element
  addCenterRect(pixels, promoW, promoH, 200, 200, 255, 255, 255, 50)
  // Add a small shield-like shape (circle) in center
  addCenterRect(pixels, promoW, promoH, 60, 60, 255, 255, 255, 90)

  const png = createPNG(promoW, promoH, pixels)
  const outPath = join(promoDir, `promo-${i + 1}.png`)
  writeFileSync(outPath, png)
  console.log(`Created ${outPath}`)
}

// ---------- Icons ----------
// 192x192 icon
{
  const sz = 192
  const pixels = solidImage(sz, sz, 0, 131, 62) // VerifyMzansi green
  // White check-circle hint
  addCenterRect(pixels, sz, sz, 80, 80, 255, 255, 255, 200)
  addCenterRect(pixels, sz, sz, 60, 60, 0, 131, 62, 255)
  addCenterRect(pixels, sz, sz, 30, 8, 255, 255, 255, 220) // small check hint
  const png = createPNG(sz, sz, pixels)
  writeFileSync(join(iconsDir, "icon-192.png"), png)
  console.log("Created icon-192.png")
}

// 512x512 icon
{
  const sz = 512
  const pixels = solidImage(sz, sz, 0, 131, 62)
  addCenterRect(pixels, sz, sz, 220, 220, 255, 255, 255, 200)
  addCenterRect(pixels, sz, sz, 160, 160, 0, 131, 62, 255)
  addCenterRect(pixels, sz, sz, 80, 20, 255, 255, 255, 220)
  const png = createPNG(sz, sz, pixels)
  writeFileSync(join(iconsDir, "icon-512.png"), png)
  console.log("Created icon-512.png")
}

console.log("\nAll placeholder images generated!")
