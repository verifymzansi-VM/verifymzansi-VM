// Runs the offload Worker (wrangler.offload.toml) in workerd and proves the
// work it took over from the website still gives the same answers:
// - every PDF fixture reads exactly as src/lib/cipc/pdf.ts reads it in Node;
// - link-preview cards come back as 1200 x 630 PNGs;
// - malformed, oversized and unknown requests are refused.
// Isolated root, synthetic inputs only; no Cloudflare account or network.
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { createTestHarness } from "wrangler";
import { extractPdf } from "../src/lib/cipc/pdf";
import { pdfWithPages } from "../src/lib/cipc/pdf-fixtures";
import {
  OFFLOAD_MAX_PDF_BYTES,
  OFFLOAD_ORIGIN,
  OFFLOAD_PDF_PATH,
  OFFLOAD_SHARE_CARD_PATH,
} from "../src/lib/offload/protocol";
import { prepareOffloadOg } from "./prepare-offload-worker.mjs";

assert.equal(process.argv.length, 2, "check-offload-runtime takes no arguments");

/** [name, options, page lines]: the cases src/lib/cipc/pdf.test.ts reads. */
const PDF_FIXTURES = [
  ["two pages", {}, ["DIRECTORS PAGE ONE", "DIRECTORS PAGE TWO"]],
  ["web-optimised", { linearized: true }, ["ONE"]],
  ["plain", { version: "1.7", font: "AAAAAB+Arial" }, ["ONE"]],
  ["resaved", { resaved: true }, ["ONE"]],
  ["retyped", { retype: true }, ["ONE"]],
  [
    "edited",
    {
      font: "BCDEFG+Calibri",
      catalog: "/AcroForm << /Fields [] >> /Metadata 6 0 R",
      page: "/Annots [7 0 R]",
      extra: [
        "<< /Type /Metadata /Subtype /XML /Length 0 >>\nstream\n\nendstream",
        "<< /Type /Annot /Subtype /FreeText /Rect [72 690 200 710] /Contents (NEW TEXT) >>",
      ],
    },
    ["ONE"],
  ],
  [
    "crafted fonts",
    {
      extra: Array.from(
        { length: 30 },
        (_, i) => `<< /Type /Font /Subtype /Type1 /BaseFont /${"Z".repeat(100)}${i} >>`
      ),
    },
    ["ONE"],
  ],
];

const CARD = {
  title: "Garden cottage in Richards Bay",
  section: "Mzansi Market",
  price: "R850",
  location: "Richards Bay, KwaZulu-Natal",
  hasVideo: true,
};

const config = parse(await readFile("wrangler.offload.toml", "utf8"));
assert.equal(config.name, "verifymzansi-offload");
assert.equal(config.workers_dev, false, "the offload Worker has no public address");
assert.equal(config.preview_urls, false);
assert.equal(config.routes, undefined);
assert.equal(config.services, undefined);

prepareOffloadOg();
const sandbox = await mkdtemp(path.join(tmpdir(), "vm-offload-runtime-"));
const server = createTestHarness({
  root: sandbox,
  workers: [
    {
      config: {
        name: "vm-offload-check",
        main: path.resolve(config.main),
        compatibility_date: config.compatibility_date,
        compatibility_flags: config.compatibility_flags,
        alias: Object.fromEntries(
          Object.entries(config.alias).map(([from, to]) => [from, path.resolve(to)])
        ),
      },
    },
  ],
});
try {
  await server.listen();
  const worker = server.getWorker("vm-offload-check");
  const post = (pathname, body, type) =>
    worker.fetch(OFFLOAD_ORIGIN + pathname, {
      method: "POST",
      headers: { "Content-Type": type },
      body,
    });

  for (const [name, options, lines] of PDF_FIXTURES) {
    const bytes = pdfWithPages(lines, options);
    const response = await post(OFFLOAD_PDF_PATH, bytes, "application/pdf");
    assert.equal(response.status, 200, name);
    const { result } = await response.json();
    // Same answer as the website's own reader, after the JSON round trip.
    const expected = JSON.parse(JSON.stringify(await extractPdf(bytes)));
    assert.notEqual(expected, null, name);
    assert.deepEqual(result, expected, `${name}: offload reads the PDF as Node does`);
  }
  const notPdf = await post(OFFLOAD_PDF_PATH, new TextEncoder().encode("not a pdf"), "x/y");
  assert.deepEqual(await notPdf.json(), { result: null });
  const huge = await post(OFFLOAD_PDF_PATH, new Uint8Array(OFFLOAD_MAX_PDF_BYTES + 1), "x/y");
  assert.equal(huge.status, 413);

  for (const input of [CARD, { ...CARD, hasVideo: false, price: "" }]) {
    const response = await post(OFFLOAD_SHARE_CARD_PATH, JSON.stringify(input), "application/json");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Content-Type"), "image/png");
    const png = Buffer.from(await response.arrayBuffer());
    assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
  }
  for (const bad of ["{", JSON.stringify({ ...CARD, hasVideo: "yes" }), JSON.stringify([])]) {
    const response = await post(OFFLOAD_SHARE_CARD_PATH, bad, "application/json");
    assert.equal(response.status, 400);
  }
  const poster = JSON.stringify({ ...CARD, poster: "file:///etc/passwd" });
  assert.equal((await post(OFFLOAD_SHARE_CARD_PATH, poster, "application/json")).status, 400);
  assert.equal((await worker.fetch(OFFLOAD_ORIGIN + OFFLOAD_SHARE_CARD_PATH)).status, 405);
  assert.equal((await worker.fetch(OFFLOAD_ORIGIN + "/")).status, 404);
  console.log(
    `Offload Worker: ${PDF_FIXTURES.length} PDF fixtures read as in Node; share cards are 1200x630 PNGs; bad requests refused.`
  );
} finally {
  await server.close();
  assert.equal(path.dirname(path.resolve(sandbox)), path.resolve(tmpdir()));
  assert.ok(path.basename(sandbox).startsWith("vm-offload-runtime-"));
  await rm(sandbox, { recursive: true });
}
