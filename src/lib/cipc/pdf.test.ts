// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractPdf } from "./pdf";

/** A small valid PDF with one line of text per page. */
function pdfWithPages(lines: string[], { linearized = false } = {}): Uint8Array {
  const pageIds = lines.map((_, i) => 4 + i * 2);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${lines.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  lines.forEach((line, i) => {
    const stream = `BT /F1 12 Tf 72 700 Td (${line}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`,
      `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`
    );
  });
  let out = linearized ? "%PDF-1.4\n1 0 obj << /Linearized 1 >> endobj\n" : "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  if (linearized) out += `\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(out);
}

describe("extractPdf", () => {
  it("reads every page, placing later pages below earlier ones", async () => {
    const extracted = await extractPdf(pdfWithPages(["DIRECTORS PAGE ONE", "DIRECTORS PAGE TWO"]));
    expect(extracted).not.toBeNull();
    const one = extracted!.items.find((i) => i.text === "DIRECTORS PAGE ONE");
    const two = extracted!.items.find((i) => i.text === "DIRECTORS PAGE TWO");
    expect(one && two).toBeTruthy();
    expect(two!.y).toBeLessThan(one!.y);
    expect(extracted!.structure.pageCount).toBe(2);
  });

  it("does not count a web-optimised file as edited", async () => {
    const extracted = await extractPdf(pdfWithPages(["ONE"], { linearized: true }));
    expect(extracted!.structure.revisionCount).toBe(1);
  });

  it("returns null for bytes that are not a PDF", async () => {
    expect(await extractPdf(new TextEncoder().encode("not a pdf"))).toBeNull();
  });
});
