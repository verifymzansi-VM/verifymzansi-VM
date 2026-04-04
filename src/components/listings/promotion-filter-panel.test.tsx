import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromotionFilterPanel, type PromotionFilterState } from "./promotion-filter-panel";

function renderPanel(filters: PromotionFilterState = {}) {
  const handlers = {
    onTypeChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onProvinceChange: vi.fn(),
    onCityChange: vi.fn(),
    onEventStateChange: vi.fn(),
    onClearQuery: vi.fn(),
    onClearAll: vi.fn(),
  };

  render(
    <PromotionFilterPanel
      filters={filters}
      cities={filters.province ? ["Johannesburg", "Pretoria"] : []}
      businessMap={new Map([["business-1", "Fix Fast"]])}
      {...handlers}
    />
  );

  return handlers;
}

describe("PromotionFilterPanel", () => {
  it("does not render a search field", () => {
    renderPanel();

    expect(screen.queryByLabelText("Search")).not.toBeInTheDocument();
  });

  it("does not render the promotion type selector in the secondary filter panel", () => {
    renderPanel();

    expect(screen.queryByLabelText("Promotion type")).not.toBeInTheDocument();
  });

  it("reveals event-state filtering when the type is event", () => {
    const handlers = renderPanel({ type: "event", eventState: "upcoming" });

    expect(screen.getByLabelText("Event state")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Event state"), { target: { value: "ended" } });
    expect(handlers.onEventStateChange).toHaveBeenCalledWith("ended");
  });

  it("renders active chips and clears all when filters are present", () => {
    const handlers = renderPanel({
      query: "sale",
      type: "event",
      businessId: "business-1",
    });

    expect(screen.getByText("sale")).toBeInTheDocument();
    expect(screen.getAllByText("Events").length).toBeGreaterThan(0);
    expect(screen.getByText(/fix fast/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    expect(handlers.onClearAll).toHaveBeenCalled();
  });
});
