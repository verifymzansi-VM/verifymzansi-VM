import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromotionFilterPanel, type PromotionFilterState } from "./promotion-filter-panel";

function renderPanel(filters: PromotionFilterState = {}) {
  const handlers = {
    onQueryChange: vi.fn(),
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
  it("shows promotion type as a vertical filter and calls back when it changes", () => {
    const handlers = renderPanel();

    fireEvent.change(screen.getByLabelText("Promotion type"), { target: { value: "event" } });

    expect(handlers.onTypeChange).toHaveBeenCalledWith("event");
    expect(screen.getByRole("option", { name: "Event" })).toBeInTheDocument();
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
      type: "deal",
      businessId: "business-1",
    });

    expect(screen.getByText("sale")).toBeInTheDocument();
    expect(screen.getByText(/fix fast/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    expect(handlers.onClearAll).toHaveBeenCalled();
  });
});
