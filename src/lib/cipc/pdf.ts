import type { PdfTextItem } from "./parse";

export type PdfStructure = {
  producer: string | null;
  creator: string | null;
  creationDate: string | null;
  modDate: string | null;
  /** Each save appends a cross-reference section; CIPC issues files with one. */
  revisionCount: number;
  pageCount: number;
  hasTextLayer: boolean;
};

export type ExtractedPdf = { items: PdfTextItem[]; structure: PdfStructure };

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) count++;
  return count;
}

function metaString(info: Record<string, unknown>, key: string): string | null {
  const value = info[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Positioned text and file metadata from the first page of a PDF. Returns
 * null when the bytes cannot be opened as a PDF (corrupt or encrypted); the
 * caller records that as a finding rather than rejecting the upload.
 */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf | null> {
  const raw = new TextDecoder("latin1").decode(bytes);
  const revisionCount = Math.max(
    countOccurrences(raw, "startxref"),
    countOccurrences(raw, "%%EOF")
  );

  try {
    const { getDocumentProxy, getMeta } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const meta = await getMeta(pdf);
    const info = (meta.info ?? {}) as Record<string, unknown>;
    const page = await pdf.getPage(1);
    const content = await page.getTextContent();
    const items: PdfTextItem[] = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      items.push({ x: item.transform[4], y: item.transform[5], text: item.str });
    }
    return {
      items,
      structure: {
        producer: metaString(info, "Producer"),
        creator: metaString(info, "Creator"),
        creationDate: metaString(info, "CreationDate"),
        modDate: metaString(info, "ModDate"),
        revisionCount,
        pageCount: pdf.numPages,
        hasTextLayer: items.length > 0,
      },
    };
  } catch {
    return null;
  }
}
