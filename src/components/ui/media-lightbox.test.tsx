import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MediaLightbox } from "./media-lightbox";
import { useVideoMuteStore } from "@/stores/video-mute-store";

const items = [
  { url: "https://media.verifymzansi.com/a.jpg", kind: "photo" as const },
  { url: "https://media.verifymzansi.com/clip.mp4", kind: "video" as const },
];

function videoElement() {
  return screen.getByLabelText("Video player") as HTMLVideoElement;
}

describe("MediaLightbox video", () => {
  beforeEach(() => {
    useVideoMuteStore.setState({ isMuted: true });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  });

  it("turns on the sound of the gallery video reached from a photo", () => {
    render(<MediaLightbox items={items} startIndex={0} isOpen onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(videoElement().muted).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /sound on/i }));
    expect(videoElement().muted).toBe(false);
  });

  it("fits the video's box to a portrait video so the controls sit on it", () => {
    render(<MediaLightbox items={items} startIndex={1} isOpen onClose={() => {}} />);
    const box = videoElement().parentElement!;
    expect(box.className).toContain("aspect-video");
    const video = videoElement();
    Object.defineProperty(video, "videoWidth", { value: 720 });
    Object.defineProperty(video, "videoHeight", { value: 1280 });
    fireEvent.loadedMetadata(video);
    expect(box.className).not.toContain("aspect-video");
    expect(box.style.aspectRatio).toMatch(/^0.5625/);
    expect(box).toContainElement(screen.getByRole("button", { name: /^(Pause|Play)$/ }));
  });
});
