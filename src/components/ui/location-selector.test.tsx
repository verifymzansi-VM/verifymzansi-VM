import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LocationSelector, type LocationValue } from "./location-selector";

let frames: FrameRequestCallback[];
beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
});
afterEach(() => vi.unstubAllGlobals());

function Form({ initial }: { initial: LocationValue }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <LocationSelector value={value} onChange={setValue} showAddress />
      <textarea aria-label="Private note" />
    </>
  );
}
function flushFocus() {
  act(() => frames.splice(0).forEach((callback) => callback(performance.now())));
}

it.each([
  { label: "Province", initial: { province: "KwaZulu-Natal", city: "Durban" }, next: "Gauteng" },
  {
    label: "City or town",
    initial: { province: "Gauteng", city: "Johannesburg" },
    next: "Pretoria",
  },
])(
  "does not steal private address focus after changing $label",
  async ({ label, initial, next }) => {
    render(<Form initial={initial} />);
    const select = screen.getByLabelText(label, { exact: true });
    select.focus();
    fireEvent.change(select, { target: { value: next } });
    // Selecting a province clears city, disabling the detailed-address field;
    // another enabled field still must retain focus when the user moves there.
    const address = screen.getByLabelText(
      label === "Province" ? "Private note" : "Detailed address",
      { exact: true }
    );
    address.focus();
    flushFocus();
    expect(address).toHaveFocus();
    await userEvent.keyboard("PRIVATE TEST ADDRESS 42");
    expect(address).toHaveValue("PRIVATE TEST ADDRESS 42");
    expect(screen.getByPlaceholderText(/Enter your town or suburb|Select city first/)).toHaveValue(
      ""
    );
  }
);

it("advances keyboard focus while the changed city select still has focus", () => {
  render(<Form initial={{ province: "Gauteng", city: "Johannesburg" }} />);
  const select = screen.getByLabelText("City or town", { exact: true });
  select.focus();
  fireEvent.change(select, { target: { value: "Pretoria" } });
  flushFocus();
  expect(screen.getByPlaceholderText("Enter your town or suburb")).toHaveFocus();
});
