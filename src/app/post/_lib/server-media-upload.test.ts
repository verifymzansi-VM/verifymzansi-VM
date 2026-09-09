import { beforeEach, expect, it, vi } from "vitest";
import { uploadMediaViaServer } from "./server-media-upload";
import { MAX_VIDEO_UPLOAD_BYTES, videoUploadTimeoutMs } from "@/lib/media/upload-policy";
const fetchRetry = vi.hoisted(() => vi.fn());
vi.mock("@/lib/utils/fetch-retry", () => ({ fetchWithRetry: fetchRetry }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: () => ({}) }));
beforeEach(() => {
  fetchRetry.mockReset();
  fetchRetry.mockResolvedValue({
    ok: true,
    json: async () => ({ urls: ["https://media.example.com/video.mp4"] }),
  });
});
it.each(["listing", "business_cover", "promotion"] as const)(
  "allows a maximum-size video on a slow connection in %s",
  async (area) => {
    const file = new File(["video"], "clip.mp4", { type: "video/mp4" });
    Object.defineProperty(file, "size", { value: MAX_VIDEO_UPLOAD_BYTES });
    await uploadMediaViaServer({ files: [file], area, fallbackMessage: "failed" });
    const timeout = fetchRetry.mock.calls[0][3];
    expect(timeout).toBe(videoUploadTimeoutMs(MAX_VIDEO_UPLOAD_BYTES));
    expect(timeout).toBeGreaterThan((MAX_VIDEO_UPLOAD_BYTES / 62_500) * 1000);
    expect(timeout).toBeLessThanOrEqual(15 * 60_000);
  }
);
it("allows slow image uploads enough time to transfer", async () => {
  await uploadMediaViaServer({
    files: [new File(["image"], "photo.jpg", { type: "image/jpeg" })],
    area: "listing",
    fallbackMessage: "failed",
  });
  expect(fetchRetry.mock.calls[0][3]).toBeGreaterThanOrEqual(120_000);
});

it("budgets the timeout for the complete photo batch", async () => {
  const files = Array.from({ length: 5 }, (_, i) => {
    const file = new File(["photo"], `photo-${i}.jpg`, { type: "image/jpeg" });
    Object.defineProperty(file, "size", { value: 5 * 1024 * 1024 });
    return file;
  });
  fetchRetry.mockResolvedValue({
    ok: true,
    json: async () => ({ urls: files.map((f) => `https://media.example.com/${f.name}`) }),
  });
  await uploadMediaViaServer({ files, area: "listing", fallbackMessage: "failed" });
  expect(fetchRetry.mock.calls[0][3]).toBeGreaterThan(((25 * 1024 * 1024) / 62_500) * 1000);
});

it.each([
  { urls: ["https://media.example.com/photo.jpg"], errors: ["second photo rejected"] },
  { urls: ["https://media.example.com/photo.jpg"] },
  { urls: [] },
])("rejects partial or empty upload responses: %j", async (payload) => {
  fetchRetry.mockResolvedValue({ ok: true, json: async () => payload });
  await expect(
    uploadMediaViaServer({
      files: [new File(["a"], "a.jpg"), new File(["b"], "b.jpg")],
      area: "listing",
      fallbackMessage: "Some images failed",
    })
  ).rejects.toThrow("Some images failed");
});
