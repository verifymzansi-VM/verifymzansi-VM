import { describe, expect, it, vi } from "vitest";
import { confirmMediaUploads, MediaUploadConfirmationError } from "./confirm-media-uploads";

describe("confirmMediaUploads", () => {
  it("confirms unique saved media URLs for the current user", async () => {
    const selectInMock = vi.fn().mockResolvedValue({
      data: [
        { url: "https://media.verifymzansi.com/a.jpg", validated_at: "2026-07-24T00:00:00Z" },
        { url: "https://media.verifymzansi.com/b.mp4", validated_at: "2026-07-24T00:00:00Z" },
      ],
      error: null,
    });
    const selectEqMock = vi.fn().mockReturnValue({ in: selectInMock });
    const selectMock = vi.fn().mockReturnValue({ eq: selectEqMock });
    const updateInMock = vi.fn().mockResolvedValue({ error: null });
    const updateEqMock = vi.fn().mockReturnValue({ in: updateInMock });
    const updateMock = vi.fn().mockReturnValue({ eq: updateEqMock });
    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectMock, update: updateMock }),
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
    expect(selectMock).toHaveBeenCalledWith("url, validated_at");
    expect(selectEqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(selectInMock).toHaveBeenCalledWith("url", [
      "https://media.verifymzansi.com/a.jpg",
      "https://media.verifymzansi.com/b.mp4",
    ]);
    expect(updateMock).toHaveBeenCalledWith({ confirmed_at: expect.any(String) });
    expect(updateEqMock).toHaveBeenCalledWith("user_id", "user-1");
    expect(updateInMock).toHaveBeenCalledWith("url", [
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

  it("rejects URLs that are not saved for the current user", async () => {
    const selectInMock = vi.fn().mockResolvedValue({
      data: [{ url: "https://media.verifymzansi.com/a.jpg", validated_at: "2026-07-24T00:00:00Z" }],
      error: null,
    });
    const selectEqMock = vi.fn().mockReturnValue({ in: selectInMock });
    const selectMock = vi.fn().mockReturnValue({ eq: selectEqMock });
    const updateMock = vi.fn();
    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectMock, update: updateMock }),
    };

    await expect(
      confirmMediaUploads({
        supabase,
        userId: "user-1",
        contentType: "listing",
        contentId: "listing-1",
        urls: [
          "https://media.verifymzansi.com/a.jpg",
          "https://media.verifymzansi.com/missing.jpg",
        ],
      })
    ).rejects.toBeInstanceOf(MediaUploadConfirmationError);

    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects uploads that never passed server-side validation", async () => {
    // Direct-R2 uploads that skipped /api/media/upload-complete have a
    // tracking row but validated_at is NULL — they must not be attachable.
    const selectInMock = vi.fn().mockResolvedValue({
      data: [{ url: "https://media.verifymzansi.com/unvalidated.mp4", validated_at: null }],
      error: null,
    });
    const selectEqMock = vi.fn().mockReturnValue({ in: selectInMock });
    const selectMock = vi.fn().mockReturnValue({ eq: selectEqMock });
    const updateMock = vi.fn();
    const supabase = {
      from: vi.fn().mockReturnValue({ select: selectMock, update: updateMock }),
    };

    await expect(
      confirmMediaUploads({
        supabase,
        userId: "user-1",
        contentType: "listing",
        contentId: "listing-1",
        urls: ["https://media.verifymzansi.com/unvalidated.mp4"],
      })
    ).rejects.toBeInstanceOf(MediaUploadConfirmationError);

    expect(updateMock).not.toHaveBeenCalled();
  });
});
