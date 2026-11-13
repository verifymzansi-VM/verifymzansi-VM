// @vitest-environment node
import { describe, expect, it } from "vitest";

import { extractPdf } from "./pdf";
import { pdfWithPages } from "./pdf-fixtures";

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
