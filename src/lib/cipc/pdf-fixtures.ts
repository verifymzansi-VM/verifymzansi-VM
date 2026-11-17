/**
 * Small synthetic PDFs for the PDF reader's tests (src/lib/cipc/pdf.test.ts)
 * and the offload Worker's runtime check (scripts/check-offload-runtime.mjs).
 * Every value is fake.
 */
export type PdfOptions = {
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
export function pdfWithPages(lines: string[], options: PdfOptions = {}): Uint8Array {
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
