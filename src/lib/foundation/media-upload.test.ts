/** @vitest-environment node */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { syntheticMp4, syntheticWebm } from "@/test/synthetic-video";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import type { FoundationServiceApi } from "./service-api";
import { IMAGES_ALLOWANCE_EXHAUSTED_MESSAGE, uploadFoundationMedia } from "./media-upload";
import { getR2ObjectSize, putImmutableR2Bytes } from "../services/storage";
import { ImageReencodeError, reencodeImage } from "../utils/image-reencode";
import type * as ImageReencode from "../utils/image-reencode";
import { openImagesAllowance, type ImagesAllowance } from "../media/images-allowance";

vi.mock("server-only", () => ({}));
vi.mock("../services/storage", () => ({
  putImmutableR2Bytes: vi.fn(async (_b, _k, bytes) => bytes),
  getR2ObjectSize: vi.fn(async () => null),
}));
vi.mock("../utils/image-reencode", async (original) => {
  const actual = await original<typeof ImageReencode>();
  return { ...actual, reencodeImage: vi.fn(actual.reencodeImage) };
});
/** The monthly Images count: open (copies allowed) unless a test says otherwise. */
const allowance = { allowsCopies: vi.fn(), add: vi.fn(), save: vi.fn(), markUsedUp: vi.fn() };
vi.mock("../media/images-allowance", () => ({ openImagesAllowance: vi.fn() }));
beforeEach(() => {
  allowance.allowsCopies.mockReset().mockResolvedValue(true);
  allowance.markUsedUp.mockReset().mockResolvedValue(undefined);
  allowance.add.mockReset();
  allowance.save.mockReset().mockResolvedValue(undefined);
  vi.mocked(openImagesAllowance)
    .mockReset()
    .mockResolvedValue(allowance as ImagesAllowance);
  vi.mocked(getR2ObjectSize).mockReset().mockResolvedValue(null);
});
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

it("stores only the 800 px WebP copy of a photo before completing its upload", async () => {
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
  expect(order).toEqual([key, `${key}.w800.webp`, "complete"]);
  // One re-encode and one copy, counted with one write.
  expect(allowance.add.mock.calls).toEqual([[1], [1]]);
  expect(allowance.allowsCopies).toHaveBeenCalledWith(1);
  expect(allowance.save).toHaveBeenCalledTimes(1);
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

it("still re-encodes and stores the photo when the monthly copy budget is reached", async () => {
  vi.mocked(putImmutableR2Bytes).mockClear();
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_bucket, _key, bytes) => bytes);
  vi.mocked(reencodeImage).mockClear();
  allowance.allowsCopies.mockResolvedValue(false);
  const attest = attested();
  await expect(
    uploadFoundationMedia(
      { rpc: imageIntent() } as unknown as FoundationAuthenticatedApi,
      { rpc: attest } as unknown as FoundationServiceApi,
      await detailedJpeg(1200, 900)
    )
  ).resolves.toMatchObject({ object_id: objectId, kind: "image", width: 1200 });
  expect(reencodeImage).toHaveBeenCalledTimes(1);
  expect(vi.mocked(putImmutableR2Bytes).mock.calls.map((call) => call[1])).toEqual([key]);
  expect(allowance.add.mock.calls).toEqual([[1]]);
  expect(allowance.save).toHaveBeenCalledTimes(1);
  expect(attest).toHaveBeenCalledTimes(1);
});

it("does not make the copy again when a retried upload already stored it", async () => {
  vi.mocked(putImmutableR2Bytes).mockClear();
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_bucket, _key, bytes) => bytes);
  vi.mocked(getR2ObjectSize).mockImplementation(async (_bucket, objectKey) =>
    objectKey === `${key}.w800.webp` ? 1234 : null
  );
  await uploadFoundationMedia(
    { rpc: imageIntent() } as unknown as FoundationAuthenticatedApi,
    { rpc: attested() } as unknown as FoundationServiceApi,
    await detailedJpeg(1200, 900)
  );
  expect(getR2ObjectSize).toHaveBeenCalledWith("verifymzansi-public", `${key}.w800.webp`);
  expect(vi.mocked(putImmutableR2Bytes).mock.calls.map((call) => call[1])).toEqual([key]);
  expect(allowance.add.mock.calls).toEqual([[1]]);
});

it("makes no copy when storage cannot say whether it exists", async () => {
  vi.mocked(putImmutableR2Bytes).mockClear();
  vi.mocked(putImmutableR2Bytes).mockImplementation(async (_bucket, _key, bytes) => bytes);
  vi.mocked(getR2ObjectSize).mockRejectedValue(new Error("storage busy"));
  await expect(
    uploadFoundationMedia(
      { rpc: imageIntent() } as unknown as FoundationAuthenticatedApi,
      { rpc: attested() } as unknown as FoundationServiceApi,
      await detailedJpeg(1200, 900)
    )
  ).resolves.toMatchObject({ kind: "image" });
  expect(vi.mocked(putImmutableR2Bytes).mock.calls.map((call) => call[1])).toEqual([key]);
});

it("refuses a photo with a clear reason, storing nothing, when the Images allowance is used up", async () => {
  vi.mocked(putImmutableR2Bytes).mockClear();
  vi.mocked(reencodeImage).mockRejectedValueOnce(
    new ImageReencodeError("exhausted", "Images allowance used up: 9422")
  );
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const rpc = imageIntent();
  const attest = attested();
  const write = vi.fn();
  try {
    await expect(
      uploadFoundationMedia(
        { rpc } as unknown as FoundationAuthenticatedApi,
        { rpc: attest } as unknown as FoundationServiceApi,
        await detailedJpeg(1200, 900),
        write
      )
    ).rejects.toMatchObject({ status: 503, reason: "images_allowance_exhausted" });
    expect(errors.mock.calls.flat().join(" ")).toContain("images_allowance_exhausted");
  } finally {
    errors.mockRestore();
  }
  expect(rpc).not.toHaveBeenCalled();
  expect(attest).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(putImmutableR2Bytes).not.toHaveBeenCalled();
  expect(allowance.add).not.toHaveBeenCalled();
  expect(allowance.markUsedUp).toHaveBeenCalledTimes(1);
  expect(IMAGES_ALLOWANCE_EXHAUSTED_MESSAGE).toMatch(/paused/);
});

describe("video length and stored size at upload (M4.4)", () => {
  const videoIntent = () =>
    vi.fn(async (_name: string, args: { p_bytes: number }) => ({
      data: {
        object_id: objectId,
        object_key: key,
        max_bytes: args.p_bytes,
        state: "intent",
        kind: "video",
        width: null,
        height: null,
        sha256: null,
        size_bytes: null,
        mime: null,
      },
      error: null,
    }));
  const send = (bytes: Uint8Array, rpc: ReturnType<typeof videoIntent>, type = "video/mp4") =>
    uploadFoundationMedia(
      { rpc } as unknown as FoundationAuthenticatedApi,
      { rpc: attested() } as unknown as FoundationServiceApi,
      new File([bytes.slice().buffer], type === "video/mp4" ? "clip.mp4" : "clip.webm", { type }),
      vi.fn(async (input: { key: string }) => ({
        key: input.key,
        url: `https://media.verifymzansi.com/${input.key}`,
      }))
    );

  it("refuses a 121 s video before reserving storage, with the real length", async () => {
    const rpc = videoIntent();
    await expect(send(syntheticMp4(121), rpc)).rejects.toMatchObject({
      status: 400,
      reason: "video_length",
      detail: "Your video is 2 min 1 s; the limit is 2 minutes",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("stores a 119 s video", async () => {
    const rpc = videoIntent();
    await expect(send(syntheticMp4(119), rpc)).resolves.toMatchObject({ kind: "video" });
    expect(rpc).toHaveBeenCalledWith(
      "reserve_frontend_media_upload",
      expect.objectContaining({ p_kind: "video" })
    );
  });

  it("refuses a video whose length cannot be read (no movie header; WebM without duration)", async () => {
    const rpc = videoIntent();
    const noHeader = syntheticMp4(30).slice(0, 80);
    await expect(send(noHeader, rpc)).rejects.toMatchObject({
      reason: "video_length",
      detail: "We couldn't read this video's length; please export it as MP4",
    });
    await expect(send(syntheticWebm(null), rpc, "video/webm")).rejects.toMatchObject({
      reason: "video_length",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a converted file over 50 MB before reserving storage", async () => {
    const rpc = videoIntent();
    const oversized = syntheticMp4(60, { padding: 50 * 1024 * 1024 });
    await expect(send(oversized, rpc)).rejects.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });
});

it("passes other re-encode failures on unchanged", async () => {
  const failure = new ImageReencodeError("unavailable", "outage");
  vi.mocked(reencodeImage).mockRejectedValueOnce(failure);
  await expect(
    uploadFoundationMedia(
      { rpc: imageIntent() } as unknown as FoundationAuthenticatedApi,
      { rpc: attested() } as unknown as FoundationServiceApi,
      await detailedJpeg(1200, 900)
    )
  ).rejects.toBe(failure);
});
