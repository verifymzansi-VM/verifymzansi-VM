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
  /** "1.7" from the %PDF- header. */
  pdfVersion: string | null;
  /** Cross-reference and object streams: written by newer tools, never by CIPC. */
  xrefStreams: number;
  objectStreams: number;
  /** XMP metadata: added by Acrobat, Word and most editors on save. */
  hasXmp: boolean;
  /** Comments, stamps and typewriter text boxes sit on top of the page. */
  hasAnnotations: boolean;
  hasAcroForm: boolean;
  /** Embedded font names without the subset prefix ("AAAAAB+Arial" → "Arial"). */
  fonts: string[];
  imageCount: number;
  /** Text items printed at the same spot: the trace of whiting out and retyping. */
  overlappingText: number;
};

export type ExtractedPdf = { items: PdfTextItem[]; structure: PdfStructure };

function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) count++;
  return count;
}

function countMatches(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0;
}

/**
 * Strings read from an uploaded file end up in findings staff read and in the
 * database, so they are bounded however the file was crafted.
 */
const MAX_META_CHARS = 120;
const MAX_FONT_NAMES = 20;
const MAX_FONT_CHARS = 64;

function metaString(info: Record<string, unknown>, key: string): string | null {
  const value = info[key];
  return typeof value === "string" && value.trim() ? value.trim().slice(0, MAX_META_CHARS) : null;
}

function fontNames(raw: string): string[] {
  const names = new Set<string>();
  for (const m of raw.matchAll(/\/BaseFont\s*\/([^\s/<>[\]()]+)/g)) {
    names.add(m[1].replace(/^[A-Z]{6}\+/, "").slice(0, MAX_FONT_CHARS));
    if (names.size >= MAX_FONT_NAMES) break;
  }
  return [...names].sort();
}

const OVERLAP_PT = 2;
/** Enough for any real CIPC document; keeps the pairwise check cheap. */
const MAX_OVERLAP_ITEMS = 2000;

function countOverlaps(items: PdfTextItem[]): number {
  const list = items.slice(0, MAX_OVERLAP_ITEMS);
  let count = 0;
  for (let a = 0; a < list.length; a++) {
    for (let b = a + 1; b < list.length; b++) {
      if (
        Math.abs(list[a].x - list[b].x) < OVERLAP_PT &&
        Math.abs(list[a].y - list[b].y) < OVERLAP_PT
      ) {
        count++;
      }
    }
  }
  return count;
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
    let annotationCount = 0;
    let offset = 0;
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PAGES); n++) {
      const page = await pdf.getPage(n);
      const height = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        items.push({ x: item.transform[4], y: item.transform[5] - offset, text: item.str });
      }
      annotationCount += (await page.getAnnotations().catch(() => [])).length;
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
        pdfVersion: raw.match(/^%PDF-(\d\.\d)/)?.[1] ?? null,
        xrefStreams: countMatches(raw, /\/Type\s*\/XRef\b/g),
        objectStreams: countMatches(raw, /\/Type\s*\/ObjStm\b/g),
        hasXmp: /\/Type\s*\/Metadata\b/.test(raw) || raw.includes("<x:xmpmeta"),
        hasAnnotations: annotationCount > 0 || /\/Annots\b/.test(raw),
        hasAcroForm: /\/AcroForm\b/.test(raw),
        fonts: fontNames(raw),
        imageCount: countMatches(raw, /\/Subtype\s*\/Image\b/g),
        overlappingText: countOverlaps(items),
      },
    };
  } catch {
    return null;
  } finally {
    await pdf?.cleanup().catch(() => undefined);
  }
}
