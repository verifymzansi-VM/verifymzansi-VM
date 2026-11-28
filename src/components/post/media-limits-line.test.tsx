import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MediaLimitsLine, mediaLimitsText } from "./media-limits-line";

describe("MediaLimitsLine", () => {
  it("states the photo size, video length and video size", () => {
    expect(mediaLimitsText("other")).toBe("Photos up to 5 MB · Video up to 2 min, up to 300 MB");
    expect(mediaLimitsText("event")).toBe("Photos up to 5 MB · Video up to 1 min, up to 300 MB");
  });
  it("renders the line for an event", () => {
    render(<MediaLimitsLine kind="event" />);
    expect(screen.getByText(/Video up to 1 min/)).toBeInTheDocument();
  });
});
