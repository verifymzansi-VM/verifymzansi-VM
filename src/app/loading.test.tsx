import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import GlobalLoading from "./loading";

describe("shared route loading fallback", () => {
  it("is announced as a busy status named 'Loading'", () => {
    const { container } = render(<GlobalLoading />);
    const wrapper = container.firstElementChild;

    expect(wrapper).toHaveAttribute("role", "status");
    expect(wrapper).toHaveAttribute("aria-busy", "true");
    expect(wrapper).toHaveAccessibleName("Loading");
    expect(screen.getAllByRole("status", { name: "Loading" })[0]).toBe(wrapper);
  });

  it("keeps exactly one main landmark", () => {
    render(<GlobalLoading />);

    expect(screen.getAllByRole("main")).toHaveLength(1);
  });
});
