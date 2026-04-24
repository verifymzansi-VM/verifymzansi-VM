import { describe, expect, it, vi } from "vitest";
import { confirmMediaUploads } from "./confirm-media-uploads";

describe("confirmMediaUploads", () => {
  it("confirms unique saved media URLs for the current user", async () => {
    const inMock = vi.fn().mockResolvedValue({ error: null });
    const eqMock = vi.fn().mockReturnValue({ in: inMock });
    const updateMock = vi.fn().mockReturnValue({ eq: eqMock });
    const supabase = {
      from: vi.fn().mockReturnValue({ update: updateMock }),
    };

    await confirmMediaUploads({
      supabase,
      userId: "user-1",
      contentType: "listing",
      contentId: "listing-1",
      urls: [
        "https://media.verifymzansi.com/a.jpg",
        "https://media.verifymzansi.com/a.jpg",
        null,
        undefined,
        "",
        "https://media.verifymzansi.com/b.mp4",
      ],
    });

    expect(supabase.from).toHaveBeenCalledWith("media_uploads");
    expect(updateMock).toHaveBeenCalledWith({ confirmed_at: expect.any(String) });
    expect(eqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(inMock).toHaveBeenCalledWith("url", [
      "https://media.verifymzansi.com/a.jpg",
      "https://media.verifymzansi.com/b.mp4",
    ]);
  });

  it("does nothing when there are no URLs to confirm", async () => {
    const supabase = { from: vi.fn() };

    await confirmMediaUploads({
      supabase,
      userId: "user-1",
      contentType: "business",
      contentId: "business-1",
      urls: [null, undefined, ""],
    });

    expect(supabase.from).not.toHaveBeenCalled();
  });
});
