// @vitest-environment node
import { Blob } from "node:buffer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  getR2ObjectSize,
  getR2ObjectBytes,
  deleteFromR2,
  deleteManyFromR2,
  uploadToR2,
} from "./storage";

const evidenceKey = () => `evidence/${crypto.randomUUID()}/${crypto.randomUUID()}`;

describe("isolated private storage lifecycle", () => {
  const contextSymbol = Symbol.for("__cloudflare-context__");
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENVIRONMENT", "test");
    vi.stubEnv("VERIFYMZANSI_RUNTIME_MODE", "e2e");
    vi.stubEnv("PLAYWRIGHT_TEST_MODE", "1");
    // The local foundation test copy.
    vi.stubEnv("FOUNDATION_PROJECT_REF", "local-foundation");
    vi.stubEnv("FOUNDATION_SUPABASE_URL", "http://127.0.0.1:55443");
    vi.stubEnv("R2_PRIVATE_BUCKET", "verifymzansi-private");
    vi.stubEnv("R2_PUBLIC_BUCKET", "verifymzansi-public");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (globalThis as Record<PropertyKey, unknown>)[contextSymbol];
  });
  it("writes private bytes, reads them privately and removes only its own fixture file", async () => {
    const bytes = Buffer.from([2, 0, 255, 128, 13, 10]);
    const key = evidenceKey();
    await uploadToR2({
      bucket: "verifymzansi-private",
      key,
      file: new Blob([bytes]) as never,
      contentType: "application/octet-stream",
    });
    const localPath = path.join(process.cwd(), "tmp", "e2e-private-storage", key);
    try {
      expect(await readFile(localPath)).toEqual(bytes);
      expect(await getR2ObjectSize("verifymzansi-private", key)).toBe(bytes.length);
      expect(Buffer.from((await getR2ObjectBytes("verifymzansi-private", key))!.bytes)).toEqual(
        bytes
      );
      expect(await getR2ObjectBytes("verifymzansi-public", key)).toBeNull();
    } finally {
      await deleteFromR2("verifymzansi-private", key);
    }
    expect(await getR2ObjectBytes("verifymzansi-private", key)).toBeNull();
    expect(await getR2ObjectSize("verifymzansi-private", key)).toBeNull();
  });
  it("cannot enable local disk writes in production by setting test flags", async () => {
    vi.stubEnv("ENVIRONMENT", "production");
    const bucket = { put: vi.fn(async () => {}), get: vi.fn(), head: vi.fn(), delete: vi.fn() };
    (globalThis as Record<PropertyKey, unknown>)[contextSymbol] = {
      env: { PRIVATE_BUCKET: bucket },
    };
    const key = evidenceKey();
    await uploadToR2({
      bucket: "verifymzansi-private",
      key,
      file: new Blob(["synthetic"]) as never,
      contentType: "application/octet-stream",
    });
    expect(bucket.put).toHaveBeenCalledOnce();
    await expect(
      readFile(path.join(process.cwd(), "tmp", "e2e-private-storage", key))
    ).rejects.toMatchObject({ code: "ENOENT" });
    await deleteFromR2("verifymzansi-private", key);
    expect(bucket.delete).toHaveBeenCalledWith(key);
  });
  it("batch-deletes local fixture media, counting missing keys as deleted", async () => {
    const key = `media/${crypto.randomUUID()}`;
    const variant = `${key}.w400.webp`;
    for (const name of [key, variant])
      await uploadToR2({
        bucket: "verifymzansi-public",
        key: name,
        file: new Blob(["synthetic"]) as never,
        contentType: "image/webp",
      });
    expect(await getR2ObjectSize("verifymzansi-public", variant)).toBe(9);
    expect(
      await deleteManyFromR2("verifymzansi-public", [key, variant, `${key}.w800.webp`])
    ).toEqual([]);
    expect(await getR2ObjectSize("verifymzansi-public", key)).toBeNull();
    expect(await getR2ObjectSize("verifymzansi-public", variant)).toBeNull();
  });
  it("rejects path traversal and unknown buckets before filesystem or network access", async () => {
    await expect(deleteManyFromR2("verifymzansi-public", ["../../.env.local"])).rejects.toThrow();
    await expect(getR2ObjectBytes("verifymzansi-private", "../../.env.local")).rejects.toThrow();
    await expect(getR2ObjectBytes("unknown", "safe.bin")).rejects.toThrow(
      "Unknown isolated storage bucket"
    );
  });
});
