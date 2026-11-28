import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { CategoryPicker } from "./category-picker";
import type { ListingCategory } from "@/types/enums";

function Picker({
  initial = "",
  attributes: start = {},
}: {
  initial?: ListingCategory | "";
  attributes?: Record<string, string | boolean | string[]>;
}) {
  const [value, setValue] = useState<ListingCategory | "">(initial);
  const [attributes, setAttributes] = useState(start);
  return (
    <CategoryPicker
      value={value}
      onChange={setValue}
      attributes={attributes}
      onAttributeChange={(name, next) => setAttributes((prev) => ({ ...prev, [name]: next }))}
    />
  );
}

describe("CategoryPicker", () => {
  it("confirms the chosen category on its card and by name", () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    render(<Picker />);
    expect(screen.queryByText("Selected")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clothing & Accessories" }));
    expect(screen.getByRole("button", { name: "Clothing & Accessories" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    expect(screen.getByText("Selected")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Category: Clothing & Accessories");
    // One line under the title is enough: no extra category help or legend.
    expect(screen.queryByText("Help me choose")).toBeNull();
    expect(screen.queryByText(/Optional fields help your listing stand out/)).toBeNull();
  });

  it("asks clothing size and who it is for and how the buyer gets it, never a power rating", () => {
    render(<Picker initial="clothing_accessories" />);
    expect(screen.getByLabelText(/^Size/)).toHaveAttribute("maxLength", "20");
    expect(screen.getByLabelText(/^For/)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Power Rating/i)).toBeNull();
    const delivery = screen.getByRole("group", { name: "How the buyer gets it" });
    for (const label of ["Collect", "Meet in a public place", "Courier", "I deliver"])
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(delivery).toBeInTheDocument();
    expect(
      screen.getByText(
        "Meet in a busy public place in daylight. Some police stations allow meet-ups; check with yours first."
      )
    ).toBeInTheDocument();
  });

  it("does not ask how the buyer gets it for property or jobs", () => {
    const { unmount } = render(<Picker initial="property" />);
    expect(screen.queryByRole("group", { name: "How the buyer gets it" })).toBeNull();
    unmount();
    render(<Picker initial="jobs_services" />);
    expect(screen.queryByRole("group", { name: "How the buyer gets it" })).toBeNull();
  });

  it("asks property dates, rental terms for rentals, an occupation date for sales and a pets choice", () => {
    render(<Picker initial="property" attributes={{ listing_intent: "rent" }} />);
    expect(screen.getByLabelText(/^Available from/)).toHaveAttribute("type", "date");
    expect(screen.getByLabelText(/^Deposit/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Lease term/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Included in the rent" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^Occupation date/)).toBeNull();
    // Pets is one choice, not a yes/no tick.
    const pets = screen.getByLabelText(/^Pets/);
    expect(
      Array.from((pets as HTMLSelectElement).options).map((option) => option.textContent)
    ).toEqual(["Select pets", "Allowed", "Not allowed", "Ask"]);
    expect(screen.queryByRole("checkbox", { name: "Pets Allowed" })).toBeNull();

    fireEvent.change(screen.getByLabelText(/^For sale or to rent/), {
      target: { value: "sale" },
    });
    expect(screen.getByLabelText(/^Occupation date/)).toHaveAttribute("type", "date");
    expect(screen.queryByLabelText(/^Deposit/)).toBeNull();
  });
});
