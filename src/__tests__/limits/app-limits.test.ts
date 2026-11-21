/** @vitest-environment node */
import { deflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readCipcFile } from "@/lib/business-verification/intake";
import {
  createFoundationCallRecorder,
  lastFoundationFailure,
} from "@/lib/foundation/call-failures";
import { readVideoBlobSeconds } from "@/lib/media/video-length";
import { cacheable, clearCache, getCacheStats } from "@/lib/services/cache";
import { decryptData } from "@/lib/utils/encryption";
import { scanForMalware } from "@/lib/utils/malware-scan";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { validateUploadedFile } from "@/lib/validations/verification";

/**
 * Website and worker limits from docs/testing/limits-register.json that had
 * no test of their own, each checked at and past its bound.
 */

const MB = 1024 * 1024;

afterEach(() => {
  vi.useRealTimers();
  clearCache();
});

describe("limits register: website limits", () => {
  it("LIM-APP-verification-file-size: ID uploads over 5 MB are refused by the server check", () => {
    const file = (size: number) => ({ size, type: "image/jpeg", name: "id.jpg" });
    expect(validateUploadedFile(file(5 * MB + 1))).toEqual({
      valid: false,
      error: "File exceeds maximum size of 5MB",
    });
    const atLimit = validateUploadedFile(file(5 * MB));
    expect(atLimit.valid === false ? atLimit.error : "").not.toMatch(/maximum size/);
  });

  it("LIM-APP-cipc-file-size: CIPC documents over 5 MB are refused before they are read", async () => {
    const big = new File([new Uint8Array(5 * MB + 1)], "cipc.pdf", { type: "application/pdf" });
    await expect(readCipcFile(big, { pdfOnly: true })).resolves.toMatchObject({
      code: "file_too_large",
      status: 413,
    });
    const atLimit = new File([new Uint8Array(5 * MB)], "cipc.pdf", { type: "application/pdf" });
    await expect(readCipcFile(atLimit, { pdfOnly: true })).resolves.not.toMatchObject({
      code: "file_too_large",
    });
  });

  it("LIM-APP-decrypt-size: encrypted data over 100 MB is refused before decryption", async () => {
    await expect(decryptData(Buffer.alloc(100 * MB + 1))).rejects.toThrow(
      /exceeds maximum size: 104857601 bytes \(max 104857600\)/
    );
    await expect(decryptData(Buffer.alloc(100 * MB))).rejects.not.toThrow(/exceeds maximum size/);
  });

  it("LIM-APP-memory-cache-entries: the in-memory cache keeps at most 500 entries", async () => {
    for (let n = 0; n < 501; n += 1) await cacheable(`limits-${n}`, async () => n, 60);
    const { size, keys } = getCacheStats();
    expect(size).toBe(500);
    expect(keys).not.toContain("limits-0");
    expect(keys).toContain("limits-500");
  });

  it("LIM-APP-error-body-read: error replies over 8 KB are not read for a reason code", async () => {
    const reply = (padding: number) =>
      new Response(JSON.stringify({ code: "P0001", pad: "x".repeat(padding) }), { status: 400 });
    const sized = async (bytes: number) => {
      const empty = new TextEncoder().encode(JSON.stringify({ code: "P0001", pad: "" })).length;
      return reply(bytes - empty);
    };
    for (const [bytes, expected] of [
      [8192, "P0001"],
      [8193, undefined],
    ] as const) {
      const response = await sized(bytes);
      const recorder = createFoundationCallRecorder(async () => response);
      const api = recorder.attach({});
      await recorder.fetch("https://db.example/rest/v1/rpc/limits_probe", { method: "POST" });
      expect(lastFoundationFailure(api)?.errorCode, `${bytes} bytes`).toBe(expected);
    }
  });

  it("LIM-APP-pdf-inflate-stream: a PDF object stream inflating past 4 MB is treated as unsafe", () => {
    const pdf = (inflatedBytes: number) => {
      const compressed = deflateSync(Buffer.alloc(inflatedBytes, 0x20));
      const head = Buffer.from(
        `%PDF-1.7\n7 0 obj << /Type /ObjStm /N 1 /First 4 /Filter /FlateDecode /Length ${compressed.length} >>\nstream\n`,
        "latin1"
      );
      const tail = Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1");
      return new Uint8Array(Buffer.concat([head, compressed, tail]));
    };
    expect(scanForMalware(pdf(4 * MB), "application/pdf")).toEqual({ safe: true });
    expect(scanForMalware(pdf(4 * MB + 1), "application/pdf")).toEqual({
      safe: false,
      threat: "pdf-active-content-objstm",
    });
  });

  it("LIM-APP-video-moov-size: an MP4 index box over 32 MB is not read", async () => {
    const reads: number[] = [];
    const blob = (moovBytes: number) => {
      const header = new Uint8Array(8);
      new DataView(header.buffer).setUint32(0, moovBytes);
      header.set(new TextEncoder().encode("moov"), 4);
      return {
        size: moovBytes,
        slice: (start: number, end: number) => ({
          arrayBuffer: async () => {
            reads.push(end - start);
            const bytes = new Uint8Array(Math.max(0, Math.min(end, moovBytes) - start));
            bytes.set(header.subarray(start, Math.min(8, end)).subarray(0, bytes.length));
            return bytes.buffer;
          },
        }),
      } as unknown as Blob;
    };
    await expect(readVideoBlobSeconds(blob(32 * MB + 1))).resolves.toBeNull();
    expect(Math.max(...reads)).toBeLessThanOrEqual(16);
    reads.length = 0;
    await readVideoBlobSeconds(blob(32 * MB));
    expect(Math.max(...reads)).toBe(32 * MB);
  });

  it("LIM-APP-local-limiter: 20 requests a minute per key and action, at most 5,000 keys", () => {
    vi.useFakeTimers();
    const action = "limits-register-probe";
    for (let n = 1; n <= 20; n += 1)
      expect(checkLocalRateLimit("first", action).limited).toBe(false);
    expect(checkLocalRateLimit("first", action)).toMatchObject({ limited: true, retryAfter: 60 });
    vi.advanceTimersByTime(60_000);
    expect(checkLocalRateLimit("first", action).limited).toBe(false);
    for (let n = 2; n <= 20; n += 1) checkLocalRateLimit("first", action);
    expect(checkLocalRateLimit("first", action).limited).toBe(true);
    // 5,000 other keys push the oldest bucket out of memory.
    for (let n = 0; n < 5000; n += 1) checkLocalRateLimit(`other-${n}`, action);
    expect(checkLocalRateLimit("first", action).limited).toBe(false);
  });
});
