import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { EventDateFields } from "./event-date-fields";

describe("EventDateFields", () => {
  it("shows an end date picked on the same day as the start", () => {
    render(
      <EventDateFields
        start="2027-03-06T10:00"
        end="2027-03-06T16:00"
        onStart={vi.fn()}
        onEnd={vi.fn()}
      />
    );
    expect(screen.getByLabelText("End date (Optional)")).toHaveValue("2027-03-06");
    expect(screen.getByText(/Leave the end date blank for a single-day event/)).toBeInTheDocument();
  });
});
