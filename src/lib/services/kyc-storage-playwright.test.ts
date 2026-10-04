// @vitest-environment node
import { Blob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  uploadKycDocument,
  downloadKycDocument,
  getR2ObjectSize,
  getR2ObjectBytes,
  deleteFromR2,
} from "./storage";

vi.mock("@/lib/config/env", () => ({
  env: (key: string) => (key === "KYC_ENCRYPTION_KEY" ? "0123456789abcdef".repeat(4) : undefined),
}));
describe("isolated KYC encrypted storage lifecycle", () => {
  const contextSymbol = Symbol.for("__cloudflare-context__");
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVIRONMENT", "test");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
    vi.stubEnv("PLAYWRIGHT_SUPABASE_MODE", "stub");
    vi.stubEnv("R2_PRIVATE_BUCKET", "verifymzansi-private");
    vi.stubEnv("R2_PUBLIC_BUCKET", "verifymzansi-public");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<PropertyKey, unknown>)[contextSymbol];
  });
  it("writes encrypted bytes, reads privately and removes only its own fixture file", async () => {
    const bytes = Buffer.from([0, 255, 128, 13, 10]);
    const upload = await uploadKycDocument(
      new Blob([bytes]) as never,
      crypto.randomUUID(),
      "id_document"
    );
    const localPath = path.join(process.cwd(), "tmp", "e2e-private-storage", upload.key);
    try {
      const ciphertext = await readFile(localPath);
      expect(ciphertext).not.toEqual(bytes);
      expect(ciphertext[0]).toBe(2);
      expect(await getR2ObjectSize("verifymzansi-private", upload.key)).toBe(ciphertext.length);
      expect(await downloadKycDocument(upload.key)).toEqual(bytes);
      expect(await getR2ObjectBytes("verifymzansi-public", upload.key)).toBeNull();
    } finally {
      await deleteFromR2("verifymzansi-private", upload.key);
    }
    expect(await getR2ObjectBytes("verifymzansi-private", upload.key)).toBeNull();
    expect(await getR2ObjectSize("verifymzansi-private", upload.key)).toBeNull();
  });
  it("cannot enable local disk writes in production by setting test flags", async () => {
    vi.stubEnv("ENVIRONMENT", "production");
    const bucket = { put: vi.fn(async () => {}), get: vi.fn(), delete: vi.fn() };
    (globalThis as Record<PropertyKey, unknown>)[contextSymbol] = {
      env: { PRIVATE_BUCKET: bucket },
    };
    const upload = await uploadKycDocument(
      new Blob(["synthetic"]) as never,
      crypto.randomUUID(),
      "id_document"
    );
    expect(bucket.put).toHaveBeenCalledOnce();
    await expect(
      readFile(path.join(process.cwd(), "tmp", "e2e-private-storage", upload.key))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await deleteFromR2("verifymzansi-private", upload.key);
    expect(bucket.delete).toHaveBeenCalledWith(upload.key);
  });
  it("rejects path traversal and unknown buckets before filesystem or network access", async () => {
    await expect(getR2ObjectBytes("verifymzansi-private", "../../.env.local")).rejects.toThrow();
    await expect(getR2ObjectBytes("unknown", "safe.bin")).rejects.toThrow(
      "Unknown isolated storage bucket"
    );
  });
});
