// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FieldHelp } from "./field-help";

describe("FieldHelp", () => {
  it("opens in place without selecting or submitting and exposes its state", () => {
    const submit = vi.fn();
    render(
      <form onSubmit={submit}>
        <input aria-label="Business name" defaultValue="Nomsa" />
        <FieldHelp label="category">A salon is a beauty business.</FieldHelp>
      </form>
    );
    const button = screen.getByRole("button", { name: "Help with category" });
    expect(button).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("A salon is a beauty business.")).toBeVisible();
    expect(screen.getByLabelText("Business name")).toHaveValue("Nomsa");
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(screen.getByText("A salon is a beauty business.")).not.toBeVisible();
  });
});
