const sharp = require("sharp");
const fs = require("node:fs/promises");
const path = require("node:path");
const files = {
  home: ["77d45aef-1554-43f2-b9dc-e7db0d5ca4fa", "8cdfc0df-83ab-4817-8bc2-b48a00eae31a"],
  market: ["76f2ad7b-1a0e-4e7e-a42a-74d96048e539", "f4e717a5-6d08-46e6-95d9-60eb326dabfd"],
  business: ["6eaeea0d-59fc-47a6-bde8-77d0932ddcd0", "18512f31-1bd6-495e-b1f6-ddf1d37c57c4"],
  tourism: ["b835f572-5811-4614-a64e-3d8ffc039fb4", "03dc6ac3-8abc-4baf-bb58-feb09861592d"],
};
async function main() {
  const sourceDir = process.argv[2];
  if (!sourceDir) throw new Error("Pass the directory containing the generated source PNGs.");
  for (const [page, ids] of Object.entries(files)) {
    for (const [index, id] of ids.entries()) {
      const mobile = index === 1;
      const input = path.join(sourceDir, "exec-" + id + ".png");
      const output = path.join(
        "public/images/showrooms",
        page + "-v2-" + (mobile ? "mobile" : "desktop") + ".avif"
      );
      let buffer,
        quality = 48;
      do {
        buffer = await sharp(input)
          .resize(mobile ? 600 : 1152, mobile ? 800 : 648, { fit: "cover" })
          .avif({ quality, effort: 6 })
          .toBuffer();
        if (buffer.length <= (mobile ? 32000 : 40642)) break;
        quality -= 4;
      } while (quality >= 20);
      if (buffer.length > (mobile ? 32000 : 40642)) throw new Error(output + " exceeds budget");
      await fs.writeFile(output, buffer);
      console.log(output, buffer.length, "bytes", "quality", quality);
    }
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
