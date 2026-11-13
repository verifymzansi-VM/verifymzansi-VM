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

function imageIntent() {
  return vi.fn().mockResolvedValue({
    data: {
      object_id: objectId,
      object_key: key,
      max_bytes: 5_242_880,
      state: "intent",
      kind: "image",
      width: null,
      height: null,
      sha256: null,
      size_bytes: null,
      mime: null,
    },
    error: null,
  });
}
async function detailedJpeg(width: number, height: number) {
  const { default: sharp } = await import("sharp");
  const noise = Buffer.alloc(width * height * 3);
  for (let index = 0; index < noise.length; index++) noise[index] = (index * 7919) % 251;
  const bytes = await sharp(noise, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 90 })
    .toBuffer();
  return new File([new Uint8Array(bytes)], "photo.jpg", { type: "image/jpeg" });
}
const attested = () =>
  vi.fn().mockResolvedValue({ data: { object_id: objectId, state: "ready" }, error: null });

it("stores 400, 800 and 1600 px WebP copies of a photo before completing its upload", async () => {
  vi.mocked(putImmutableR2Bytes).mockClear();
  const order: string[] = [];
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_bucket, objectKey, bytes) => {
    order.push(objectKey);
    return bytes;
  });
  const attest = vi.fn(async () => {
    order.push("complete");
    return { data: { object_id: objectId, state: "ready" }, error: null };
  });
  const uploaded = await uploadFoundationMedia(
    { rpc: imageIntent() } as unknown as FoundationAuthenticatedApi,
    { rpc: attest } as unknown as FoundationServiceApi,
    await detailedJpeg(2000, 1500)
  );
  expect(uploaded).toMatchObject({ kind: "image", width: 2000, height: 1500 });
  expect(order[0]).toBe(key);
  expect(order.slice(1, 4).sort()).toEqual(
    [`${key}.w1600.webp`, `${key}.w400.webp`, `${key}.w800.webp`].sort()
  );
  expect(order[4]).toBe("complete");
  for (const call of vi.mocked(putImmutableR2Bytes).mock.calls.slice(1))
    expect(call[3]).toEqual({
      contentType: "image/webp",
      cacheControl: "public, max-age=31536000, immutable",
    });
});

it("completes a photo upload when its copies cannot be stored", async () => {
  vi.mocked(putImmutableR2Bytes).mockClear();
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_bucket, objectKey, bytes) => {
    if (objectKey.endsWith(".webp")) throw new Error("storage busy");
    return bytes;
  });
  const attest = attested();
  await expect(
    uploadFoundationMedia(
      { rpc: imageIntent() } as unknown as FoundationAuthenticatedApi,
      { rpc: attest } as unknown as FoundationServiceApi,
      await detailedJpeg(1200, 900)
    )
  ).resolves.toMatchObject({ object_id: objectId, kind: "image" });
  expect(attest).toHaveBeenCalledTimes(1);
});

it("stores only the original when MEDIA_PHOTO_VARIANTS is off", async () => {
  vi.mocked(putImmutableR2Bytes).mockClear();
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_bucket, _key, bytes) => bytes);
  await uploadFoundationMedia(
    { rpc: imageIntent() } as unknown as FoundationAuthenticatedApi,
    { rpc: attested() } as unknown as FoundationServiceApi,
    await detailedJpeg(1200, 900),
    undefined,
    { MEDIA_PHOTO_VARIANTS: "off" } as unknown as NodeJS.ProcessEnv
  );
  expect(vi.mocked(putImmutableR2Bytes).mock.calls.map((call) => call[1])).toEqual([key]);
});
