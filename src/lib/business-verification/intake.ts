import crypto from "crypto";

import { parseRegisteredOffice, type RegisteredOffice } from "@/lib/cipc/address";
import { parseCipcText, type ParsedCipcDocument } from "@/lib/cipc/parse";
import { extractPdf, type PdfStructure } from "@/lib/cipc/pdf";
import { getIdNumberHmacSecret, hmacIdNumber } from "@/lib/services/id-number-hmac";
import {
  stripExifFromJpeg,
  stripMetadataFromPng,
  stripMetadataFromWebp,
} from "@/lib/utils/exif-strip";
import { validateBufferIntegrity } from "@/lib/utils/file-validation";
import { createLogger } from "@/lib/utils/logger";
import { scanForMalware } from "@/lib/utils/malware-scan";

const log = createLogger("CipcIntake");

const CIPC_ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const CIPC_MAX_FILE_BYTES = 5 * 1024 * 1024;

/** SA ID numbers (13 digits, optionally spaced 6-4-3) are never stored as text. */
export function maskIdNumbers(text: string): string {
  return text.replace(/(?<!\d)\d{6}\s?\d{4}\s?\d{3}(?!\d)/g, "[ID number]");
}

/** A director as stored: never the raw ID number, only its HMAC. */
export type StoredDirector = {
  name: string;
  role: string | null;
  appointedOn: string | null;
  hasSaId: boolean;
  idHmac: string | null;
};

/** Parsed document safe to persist (no raw ID numbers). */
export type StoredParse = Omit<ParsedCipcDocument, "directors"> & { directors: StoredDirector[] };

export type CipcFile = {
  bytes: Uint8Array;
  contentType: string;
  sizeBytes: number;
  sha256: string;
  isPdf: boolean;
  activeContent: string | null;
  structure: PdfStructure | null;
  parsed: ParsedCipcDocument | null;
  stored: StoredParse | null;
  directorIdHmacs: string[];
  directorsWithoutSaId: number;
  office: RegisteredOffice | null;
  /** Plain text for staff when the file is quarantined. */
  extractedText: string | null;
};

export type IntakeError = { error: string; code: string; status: number };

export function isIntakeError(value: CipcFile | IntakeError): value is IntakeError {
  return "error" in value;
}

function stripImageMetadata(bytes: Uint8Array, mime: string): Uint8Array {
  if (mime === "image/jpeg") return stripExifFromJpeg(bytes);
  if (mime === "image/png") return stripMetadataFromPng(bytes);
  if (mime === "image/webp") return stripMetadataFromWebp(bytes);
  return bytes;
}

function storedParse(parsed: ParsedCipcDocument, secret: string | null): StoredParse {
  return {
    ...parsed,
    directors: parsed.directors.map((d) => ({
      name: d.name,
      role: d.role,
      appointedOn: d.appointedOn,
      hasSaId: d.idNumber !== null,
      idHmac: d.idNumber && secret ? hmacIdNumber(d.idNumber, secret) : null,
    })),
  };
}

/**
 * Reads an uploaded CIPC document. Size and file-type limits are upload
 * errors; everything else about the content becomes evidence for staff.
 */
export async function readCipcFile(file: File): Promise<CipcFile | IntakeError> {
  if (file.size <= 0) return { error: "The file is empty.", code: "empty_file", status: 400 };
  if (file.size > CIPC_MAX_FILE_BYTES) {
    return { error: "Files can be up to 5 MB.", code: "file_too_large", status: 413 };
  }

  const raw = new Uint8Array(await file.arrayBuffer());
  const integrity = validateBufferIntegrity(raw, file.type);
  const mime = integrity.detectedMime;
  if (!mime || !CIPC_ACCEPTED_TYPES.includes(mime)) {
    return {
      error: "Upload a PDF or a photo (JPEG, PNG or WebP).",
      code: "unsupported_file",
      status: 400,
    };
  }

  const isPdf = mime === "application/pdf";
  const scan = scanForMalware(raw, mime);
  const activeContent = scan.safe ? null : (scan.threat ?? "unknown");
  const bytes = isPdf ? raw : stripImageMetadata(raw, mime);

  const extracted = isPdf ? await extractPdf(raw) : null;
  const parsed = extracted?.structure.hasTextLayer ? parseCipcText(extracted.items) : null;

  const secret = getIdNumberHmacSecret();
  if (!secret && parsed?.directors.length) {
    log.error("HMAC_SECRET unavailable — director ID matching disabled for this upload");
  }
  const stored = parsed ? storedParse(parsed, secret) : null;

  return {
    bytes,
    contentType: mime,
    sizeBytes: bytes.length,
    sha256: crypto.createHash("sha256").update(raw).digest("hex"),
    isPdf,
    activeContent,
    structure: extracted?.structure ?? null,
    parsed,
    stored,
    directorIdHmacs: stored?.directors.flatMap((d) => (d.idHmac ? [d.idHmac] : [])) ?? [],
    directorsWithoutSaId: stored?.directors.filter((d) => !d.hasSaId).length ?? 0,
    office: parsed?.registeredOfficeLines.length
      ? parseRegisteredOffice(parsed.registeredOfficeLines)
      : null,
    extractedText:
      activeContent && extracted
        ? maskIdNumbers(extracted.items.map((i) => i.text).join("\n")).slice(0, 20000)
        : null,
  };
}
