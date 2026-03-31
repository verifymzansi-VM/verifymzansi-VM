/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LayoutChooser } from "./layout-chooser";

describe("LayoutChooser", () => {
  it("renders all three layout options", () => {
    render(<LayoutChooser selected="cinematic" onChange={vi.fn()} />);
    expect(screen.getByText("Cinematic")).toBeInTheDocument();
    expect(screen.getByText("Showcase")).toBeInTheDocument();
    expect(screen.getByText("Professional")).toBeInTheDocument();
  });

  it("calls onChange when a layout is clicked", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<LayoutChooser selected="cinematic" onChange={onChange} />);
    await user.click(screen.getByText("Professional"));
    expect(onChange).toHaveBeenCalledWith("professional");
  });

  it("shows recommended badge for the category default", () => {
    render(
      <LayoutChooser selected="professional" onChange={vi.fn()} category="fashion_accessories" />
    );
    expect(screen.getByText("Recommended for your category")).toBeInTheDocument();
  });

  it("does not show recommended badge when no category", () => {
    render(<LayoutChooser selected="cinematic" onChange={vi.fn()} />);
    expect(screen.queryByText("Recommended for your category")).not.toBeInTheDocument();
  });

  it("renders taglines for each layout", () => {
    render(<LayoutChooser selected="showcase" onChange={vi.fn()} />);
    expect(screen.getByText("Video-first, immersive hero")).toBeInTheDocument();
    expect(screen.getByText("Gallery-first, product-focused")).toBeInTheDocument();
    expect(screen.getByText("Clean, organized layout")).toBeInTheDocument();
  });

  it("has an accessible group role", () => {
    render(<LayoutChooser selected="cinematic" onChange={vi.fn()} />);
    expect(screen.getByRole("group", { name: /Layout template/i })).toBeInTheDocument();
  });
});
