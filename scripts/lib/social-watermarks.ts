import sharp from "sharp";

/** Generate local PNG watermarks without Jimp's vulnerable file-type parser. */
export async function socialWatermarks(icon: Buffer): Promise<Map<string, Buffer>> {
  const resize = (size: number) =>
    sharp(icon, { limitInputPixels: 32_000_000 })
      .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
  const large = await resize(512);
  const small = await resize(150);
  return new Map([
    ["youtube-watermark-shield-512.png", large],
    ...["150", "150-outline", "150-clean-badge", "150-badge"].map(
      (name) => [`youtube-watermark-shield-${name}.png`, small] as [string, Buffer]
    ),
  ]);
}
