// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractPdf } from "./pdf";

type PdfOptions = {
  linearized?: boolean;
  version?: string;
  font?: string;
  /** Extra entries for the catalog, e.g. "/AcroForm << /Fields [] >>". */
  catalog?: string;
  /** Extra entries for every page, e.g. "/Annots [...]". */
  page?: string;
  /** Draw each line a second time at the same spot (whiteout and retype). */
  retype?: boolean;
  /** Extra objects appended after the page objects. */
  extra?: string[];
  /** Append an incremental update, as an editor's "Save" does. */
  resaved?: boolean;
};

/** A small valid PDF with one line of text per page. */
function pdfWithPages(lines: string[], options: PdfOptions = {}): Uint8Array {
  const { linearized = false, version = "1.4", font = "Helvetica" } = options;
  const pageIds = lines.map((_, i) => 4 + i * 2);
  const objects: string[] = [
    `<< /Type /Catalog /Pages 2 0 R ${options.catalog ?? ""}>>`,
    `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${lines.length} >>`,
    `<< /Type /Font /Subtype /Type1 /BaseFont /${font} >>`,
  ];
  lines.forEach((line, i) => {
    const draw = `BT /F1 12 Tf 72 700 Td (${line}) Tj ET`;
    const stream = options.retype ? `${draw} ${draw}` : draw;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> ${options.page ?? ""}>>`,
      `<< /Length ${stream.length} >>
stream
${stream}
endstream`
    );
  });
  objects.push(...(options.extra ?? []));
  let out = linearized
    ? `%PDF-${version}
1 0 obj << /Linearized 1 >> endobj
`
    : `%PDF-${version}
`;
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj
${body}
endobj
`;
  });
  const xref = out.length;
  out += `xref
0 ${objects.length + 1}
0000000000 65535 f\x20
`;
  out += offsets
    .map(
      (o) => `${String(o).padStart(10, "0")} 00000 n\x20
`
    )
    .join("");
  out += `trailer
<< /Size ${objects.length + 1} /Root 1 0 R >>
startxref
${xref}
%%EOF`;
  if (linearized)
    out += `
startxref
${xref}
%%EOF`;
  if (options.resaved) {
    const info = out.length + 1;
    out += `
${objects.length + 1} 0 obj
<< /Producer (Some Editor) >>
endobj
`;
    const xref2 = out.length;
    out += `xref
${objects.length + 1} 1
${String(info).padStart(10, "0")} 00000 n\x20
`;
    out += `trailer
<< /Size ${objects.length + 2} /Root 1 0 R /Prev ${xref} /Info ${objects.length + 1} 0 R >>
startxref
${xref2}
%%EOF`;
  }
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

  it("describes a plain file without edit traces", async () => {
    const s = (await extractPdf(pdfWithPages(["ONE"], { version: "1.7", font: "AAAAAB+Arial" })))!
      .structure;
    expect(s).toMatchObject({
      pdfVersion: "1.7",
      revisionCount: 1,
      xrefStreams: 0,
      objectStreams: 0,
      hasXmp: false,
      hasAnnotations: false,
      hasAcroForm: false,
      fonts: ["Arial"],
      imageCount: 0,
      overlappingText: 0,
    });
  });

  it("counts an editor's incremental save", async () => {
    const s = (await extractPdf(pdfWithPages(["ONE"], { resaved: true })))!.structure;
    expect(s.revisionCount).toBe(2);
  });

  it("sees text retyped over the original", async () => {
    const s = (await extractPdf(pdfWithPages(["ONE"], { retype: true })))!.structure;
    expect(s.overlappingText).toBe(1);
  });

  it("sees comments, form fields, XMP and foreign fonts", async () => {
    const s = (await extractPdf(
      pdfWithPages(["ONE"], {
        font: "BCDEFG+Calibri",
        catalog: "/AcroForm << /Fields [] >> /Metadata 6 0 R",
        page: "/Annots [7 0 R]",
        extra: [
          "<< /Type /Metadata /Subtype /XML /Length 0 >>\nstream\n\nendstream",
          "<< /Type /Annot /Subtype /FreeText /Rect [72 690 200 710] /Contents (NEW TEXT) >>",
        ],
      })
    ))!.structure;
    expect(s).toMatchObject({
      hasAnnotations: true,
      hasAcroForm: true,
      hasXmp: true,
      fonts: ["Calibri"],
    });
  });

  it("bounds font names from a crafted file", async () => {
    const extra = Array.from(
      { length: 30 },
      (_, i) => `<< /Type /Font /Subtype /Type1 /BaseFont /${"Z".repeat(100)}${i} >>`
    );
    const s = (await extractPdf(pdfWithPages(["ONE"], { extra })))!.structure;
    expect(s.fonts.length).toBeLessThanOrEqual(20);
    expect(Math.max(...s.fonts.map((f) => f.length))).toBeLessThanOrEqual(64);
  });

  it("returns null for bytes that are not a PDF", async () => {
    expect(await extractPdf(new TextEncoder().encode("not a pdf"))).toBeNull();
  });
});
