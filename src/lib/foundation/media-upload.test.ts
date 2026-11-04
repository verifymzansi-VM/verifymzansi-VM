/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { uploadFoundationMedia } from "./media-upload";
import { putImmutableR2Bytes } from "../services/storage";

vi.mock("server-only", () => ({}));
vi.mock("../services/storage", () => ({
  putImmutableR2Bytes: vi.fn(async (_b, _k, bytes) => bytes),
}));
const objectId = "00000000-0000-4000-8000-000000000001";
const key = "media/00000000-0000-4000-8000-000000000002";
function fixture() {
  const camera = readFileSync("src/lib/utils/__fixtures__/chrome-vp9.webm");
  const segment = camera.indexOf(Buffer.from([0x18, 0x53, 0x80, 0x67]));
  camera.fill(255, segment + 5, segment + 12);
  const metadata = Buffer.from("PRIVATE GPS=-33.9,18.4");
  return new Uint8Array([...camera, 0x12, 0x54, 0xc3, 0x67, 0x80 | metadata.length, ...metadata]);
}
it("stores and attests scrubbed bytes, rather than the original WebM metadata", async () => {
  const bytes = fixture();
  const rpc = vi.fn().mockResolvedValue({
    data: {
      object_id: objectId,
      object_key: key,
      max_bytes: 52_428_800,
      state: "intent",
      kind: "video",
      width: null,
      height: null,
      sha256: null,
      size_bytes: null,
      mime: null,
    },
    error: null,
  });
  const attest = vi.fn().mockResolvedValue({
    data: { object_id: objectId, state: "ready" },
    error: null,
  });
  let stored = new Uint8Array();
  const write = vi.fn(async (input: { key: string; file: File | Blob }) => {
    stored = new Uint8Array(await input.file.arrayBuffer());
    return { key: input.key, url: `https://media.verifymzansi.com/${input.key}` };
  });
  await uploadFoundationMedia(
    { rpc } as unknown as FoundationAuthenticatedApi,
    { rpc: attest } as unknown as FoundationServiceApi,
    new File([bytes], "synthetic.webm", { type: "video/webm" }),
    write
  );
  expect(stored.length).toBe(bytes.length);
  expect(new TextDecoder().decode(stored)).not.toContain("PRIVATE GPS");
  expect(attest).toHaveBeenCalledWith(
    "complete_frontend_media_upload",
    expect.objectContaining({
      p_object_id: objectId,
      p_size: stored.length,
      p_sha256: createHash("sha256").update(stored).digest("hex"),
      p_mime: "video/webm",
    })
  );
});
it("rejects malformed WebM before reserving quota or storing any bytes", async () => {
  const bytes = fixture();
  const tags = Buffer.from(bytes).lastIndexOf(Buffer.from([0x12, 0x54, 0xc3, 0x67]));
  expect(tags).toBeGreaterThan(0);
  bytes[tags + 4] = 0xff; // Unknown-size Tags cannot be safely scrubbed
  const rpc = vi.fn();
  const attest = vi.fn();
  const write = vi.fn();
  await expect(
    uploadFoundationMedia(
      { rpc } as unknown as FoundationAuthenticatedApi,
      { rpc: attest } as unknown as FoundationServiceApi,
      new File([bytes], "malformed.webm", { type: "video/webm" }),
      write
    )
  ).rejects.toMatchObject({ status: 400 });
  expect(rpc).not.toHaveBeenCalled();
  expect(attest).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
});
it("resolves a committed upload after a lost completion reply without writing or attesting twice", async () => {
  vi.mocked(putImmutableR2Bytes).mockClear();
  let committed = false;
  const rpc = vi.fn(async (_name, args) => ({
    data: {
      object_id: objectId,
      object_key: key,
      max_bytes: args.p_bytes,
      state: committed ? "ready" : "intent",
      kind: "video",
      width: null,
      height: null,
      sha256: committed ? args.p_digest : null,
      size_bytes: committed ? args.p_bytes : null,
      mime: committed ? "video/webm" : null,
    },
    error: null,
  }));
  const attest = vi.fn(async () => {
    committed = true;
    throw new Error("completion reply lost");
  });
  const file = new File([fixture()], "fixture.webm", { type: "video/webm" });
  await expect(
    uploadFoundationMedia(
      { rpc } as unknown as FoundationAuthenticatedApi,
      { rpc: attest } as unknown as FoundationServiceApi,
      file
    )
  ).rejects.toThrow("reply lost");
  const retried = await uploadFoundationMedia(
    { rpc } as unknown as FoundationAuthenticatedApi,
    { rpc: attest } as unknown as FoundationServiceApi,
    file
  );
  expect(retried).toMatchObject({
    object_id: objectId,
    url: `https://media.verifymzansi.com/${key}`,
  });
  expect(putImmutableR2Bytes).toHaveBeenCalledTimes(1);
  expect(attest).toHaveBeenCalledTimes(1);
  expect(rpc.mock.calls[0][1].p_digest).toBe(rpc.mock.calls[1][1].p_digest);
});
it("keeps an uncertain transfer reserved instead of rejecting its potentially stored bytes", async () => {
  vi.mocked(putImmutableR2Bytes).mockRejectedValueOnce(new Error("transfer reply lost"));
  const rpc = vi.fn().mockResolvedValue({
    data: {
      object_id: objectId,
      object_key: key,
      max_bytes: 52428800,
      state: "intent",
      kind: "video",
      width: null,
      height: null,
      sha256: null,
      size_bytes: null,
      mime: null,
    },
    error: null,
  });
  const attest = vi.fn();
  await expect(
    uploadFoundationMedia(
      { rpc } as unknown as FoundationAuthenticatedApi,
      { rpc: attest } as unknown as FoundationServiceApi,
      new File([fixture()], "fixture.webm", { type: "video/webm" })
    )
  ).rejects.toMatchObject({ status: 503 });
  expect(attest).not.toHaveBeenCalled();
});
