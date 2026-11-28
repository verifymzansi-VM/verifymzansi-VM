import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OperatingHoursInput } from "./operating-hours-input";

describe("OperatingHoursInput", () => {
  it("names each day's checkboxes with the day", () => {
    render(
      <>
        {["Monday", "Tuesday"].map((day) => (
          <OperatingHoursInput
            key={day}
            id={day}
            label={day}
            open=""
            close=""
            closed={false}
            onOpenChange={vi.fn()}
            onCloseChange={vi.fn()}
            onClosedChange={vi.fn()}
          />
        ))}
      </>
    );
    expect(screen.getByRole("checkbox", { name: "Monday closed" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Tuesday closed" })).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Tuesday by appointment only" })
    ).toBeInTheDocument();
  });
});
