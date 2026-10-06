import type { getDocumentProxy } from "unpdf";

import type { PdfTextItem } from "./parse";

type PdfDocument = Awaited<ReturnType<typeof getDocumentProxy>>;

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

/** CIPC documents are one or two pages; more is never a real disclosure. */
const MAX_PAGES = 5;

/**
 * Positioned text and file metadata from the first pages of a PDF. Later
 * pages are placed below earlier ones (y keeps falling), so a director list
 * that continues onto page 2 reads as one list. Returns null when the bytes
 * cannot be opened as a PDF (corrupt or encrypted); the caller records that
 * as a finding rather than rejecting the upload.
 */
export async function extractPdf(bytes: Uint8Array): Promise<ExtractedPdf | null> {
  const raw = new TextDecoder("latin1").decode(bytes);
  // Web-optimised (linearized) files carry two xref sections from the start.
  const linearized = /\/Linearized\s/.test(raw.slice(0, 2048));
  const revisionCount = Math.max(
    1,
    Math.max(countOccurrences(raw, "startxref"), countOccurrences(raw, "%%EOF")) -
      (linearized ? 1 : 0)
  );

  let pdf: PdfDocument | null = null;
  try {
    const { getDocumentProxy, getMeta } = await import("unpdf");
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    const meta = await getMeta(pdf);
    const info = (meta.info ?? {}) as Record<string, unknown>;
    const items: PdfTextItem[] = [];
    let offset = 0;
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
      const page = await pdf.getPage(n);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        items.push({ x: item.transform[4], y: item.transform[5] - offset, text: item.str });
      }
      offset += height;
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
  } finally {
    await pdf?.cleanup().catch(() => undefined);
  }
}
