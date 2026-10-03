import { beforeEach, describe, expect, it, vi } from "vitest";
import { shareContent } from "./share-content";

const post = {
  title: "A lodge",
  path: "/tourism-events/one?ctx=private#media",
  targetId: "one",
  targetType: "business" as const,
};
describe("whole-page sharing", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "share", { configurable: true, value: undefined });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ shareCount: 7 })))
    );
  });
  it("copies the complete canonical page and returns the confirmed count", async () => {
    expect(await shareContent(post)).toEqual({ method: "copy", shareCount: 7 });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      `${window.location.origin}/tourism-events/one`
    );
    expect(fetch).toHaveBeenCalledWith(
      "/api/engagement/share",
      expect.objectContaining({ body: JSON.stringify({ targetId: "one", targetType: "business" }) })
    );
  });
  it("never copies or records cancelled native shares", async () => {
    Object.defineProperty(navigator, "share", {
      configurable: true,
      value: vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")),
    });
    expect(await shareContent(post)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  });
  it("native sharing sends only the post title and canonical link, with no attachments", async () => {
    const native = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: native });
    await shareContent({ ...post, recordMetrics: false });
    expect(native).toHaveBeenCalledWith({
      title: "A lodge",
      url: `${window.location.origin}/tourism-events/one`,
    });
    expect(native.mock.calls[0][0]).not.toHaveProperty("files");
  });
  it("keeps a successful share when the count service fails", async () => {
    vi.mocked(fetch).mockRejectedValue(new Error("Offline"));
    expect(await shareContent(post)).toEqual({ method: "copy", shareCount: undefined });
  });
  it("does not record anything when copying fails", async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("Blocked"));
    await expect(shareContent(post)).rejects.toThrow("Blocked");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("design previews do not write engagement", async () => {
    await shareContent({ ...post, recordMetrics: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
