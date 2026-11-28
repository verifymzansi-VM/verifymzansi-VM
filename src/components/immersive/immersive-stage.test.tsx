import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImmersiveStage } from "./immersive-stage";
import type { FeedSlide } from "@/lib/feed/types";

const slide = {
  key: "listings:one",
  id: "one",
  targetType: "listing",
  shareTitle: "An item",
  media: [
    { kind: "photo", url: "https://media.verifymzansi.com/a.jpg" },
    { kind: "photo", url: "https://media.verifymzansi.com/b.jpg" },
  ],
} as FeedSlide;

describe("ImmersiveStage arrows", () => {
  it("never shows a disabled arrow, even on hover or a touch screen", () => {
    render(
      <ImmersiveStage
        slide={slide}
        active
        mediaIndex={0}
        onMediaIndexChange={vi.fn()}
        onVideoViewRecorded={vi.fn()}
        autoplay={false}
      />
    );
    const previous = screen.getByRole("button", { name: "Previous photo or video" });
    const next = screen.getByRole("button", { name: "Next photo or video" });
    expect(previous).toBeDisabled();
    // `invisible` (visibility) wins over the hover and touch opacity classes.
    expect(previous.className).toContain("disabled:invisible");
    expect(previous.className).not.toContain("disabled:opacity-0");
    expect(next).toBeEnabled();
  });
});
