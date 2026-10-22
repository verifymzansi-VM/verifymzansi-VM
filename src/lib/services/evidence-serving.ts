import crypto from "crypto";
import { NextResponse } from "next/server";

import { scanForMalware } from "@/lib/utils/malware-scan";

/** Evidence formats accepted at upload, identified by their magic bytes. */
function detectEvidenceContentType(buffer: Buffer): string | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("latin1") === "RIFF" &&
    buffer.subarray(8, 12).toString("latin1") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("latin1") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}

const EVIDENCE_NO_STORE = "no-store, no-cache, must-revalidate";

/**
 * Staff view evidence inline. Inline disposition does not prevent saving or
 * copying the response; authorization and access auditing remain essential.
 * Only bytes we can identify as an image or PDF are served, and PDFs are
 * checked again for active content because files stored before the current
 * upload checks were never scanned for everything we now refuse.
 */
export function evidenceViewResponse(buffer: Buffer): NextResponse {
  const contentType = detectEvidenceContentType(buffer);
  if (!contentType) {
    return NextResponse.json(
      { error: "This file can't be shown safely.", code: "unviewable_evidence" },
      { status: 415, headers: { "Cache-Control": EVIDENCE_NO_STORE } }
    );
  }
  if (contentType === "application/pdf" && !scanForMalware(buffer, contentType).safe) {
    return NextResponse.json(
      {
        error:
          "This PDF contains active content, so it isn't shown. Rely on a copy from the official source.",
        code: "active_pdf",
      },
      { status: 422, headers: { "Cache-Control": EVIDENCE_NO_STORE } }
    );
  }
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": EVIDENCE_NO_STORE,
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; img-src 'self'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
      "Referrer-Policy": "no-referrer",
    },
  });
}

/**
 * Hash an IP address for privacy-compliant logging.
 * Uses HMAC-SHA256 with a secret key to prevent rainbow-table deanonymisation.
 */
export function hashIp(ip: string, secret: string | undefined): string {
  // In production, IP_HASH_SECRET is required (checked earlier in handler).
  // In dev, use a deterministic but non-production-safe fallback.
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("IP_HASH_SECRET is required in production");
  }
  const key = secret || "dev-only-local-not-for-production";
  return crypto.createHmac("sha256", key).update(ip).digest("hex").slice(0, 16);
}
