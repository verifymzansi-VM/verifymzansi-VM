import { describe, expect, it } from "vitest";
import { publicPageMetadata } from "./page-metadata";

describe("public profile share previews", () => {
  it("provides a post thumbnail and image fallback, without sharing a video file", () => {
    const meta = publicPageMetadata({
      title: "A lodge",
      path: "/tourism-events/one",
      previewType: "business",
      video: "https://media.verifymzansi.com/media/a.mp4",
      image: "https://media.verifymzansi.com/media/a.webp",
      width: 1080,
      height: 1920,
    });
    const graph = meta.openGraph as {
      url: string;
      videos: { url: string; type: string }[];
      images: { url: string }[];
    };
    expect(graph.url).toMatch(/\/tourism-events\/one$/);
    expect(graph.images[0].url).toContain("/media/a.webp");
    expect(graph.images[1].url).toMatch(/\/api\/share-preview\/business\/one$/);
    expect(meta.openGraph).not.toHaveProperty("videos");
    expect(JSON.stringify(meta)).not.toContain("media/a.mp4");
    expect(meta.twitter).toMatchObject({ card: "summary_large_image" });
  });
  it("uses event and market-specific previews and omits nonexistent video", () => {
    for (const [path, kind] of [
      ["/listing/one", "listing"],
      ["/tourism-events/one", "promotion"],
    ]) {
      const meta = publicPageMetadata({ title: "Profile", path });
      expect(JSON.stringify(meta.openGraph)).toContain(`/api/share-preview/${kind}/one`);
      expect(meta.openGraph).not.toHaveProperty("videos");
    }
  });
});
