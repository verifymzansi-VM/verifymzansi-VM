import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PromotionFilterPanel, type PromotionFilterState } from "./promotion-filter-panel";

function renderPanel(
  filters: PromotionFilterState = {},
  activeTab: "tourism" | "events" = "tourism"
) {
  const handlers = {
    onTypeChange: vi.fn(),
    onCategoryChange: vi.fn(),
    onSubcategoryChange: vi.fn(),
    onEventTypeChange: vi.fn(),
    onProvinceChange: vi.fn(),
    onCityChange: vi.fn(),
    onEventStateChange: vi.fn(),
    onClearQuery: vi.fn(),
    onClearAll: vi.fn(),
  };

  render(
    <PromotionFilterPanel
      filters={filters}
      activeTab={activeTab}
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

  it("reveals event-state filtering when the tab is events", () => {
    const handlers = renderPanel({ type: "event", eventState: "upcoming" }, "events");

    expect(screen.getByLabelText("Event state")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Event state"), { target: { value: "ended" } });
    expect(handlers.onEventStateChange).toHaveBeenCalledWith("ended");
  });

  it("renders active chips and clears all when filters are present", () => {
    const handlers = renderPanel(
      {
        query: "sale",
        type: "event",
        businessId: "business-1",
      },
      "events"
    );

    expect(screen.getByText("sale")).toBeInTheDocument();
    // type=event is implied by the Events tab, so it is not a removable chip there.
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
    expect(screen.getByText(/fix fast/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /clear all/i }));
    expect(handlers.onClearAll).toHaveBeenCalled();
  });

  it("does not show filters as active on a fresh Events tab", () => {
    renderPanel({ type: "event" }, "events");

    expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
  });

  it("shows the type chip outside the Events tab", () => {
    const handlers = renderPanel({ type: "event" }, "tourism");

    fireEvent.click(screen.getByRole("button", { name: /remove promotion type filter/i }));
    expect(handlers.onTypeChange).toHaveBeenCalledWith(undefined);
  });

  it("shows subcategory dropdown on tourism tab", () => {
    renderPanel({}, "tourism");

    expect(screen.getByLabelText("Subcategory")).toBeInTheDocument();
    expect(screen.queryByLabelText("Event type")).not.toBeInTheDocument();
  });

  it("shows event type dropdown on events tab", () => {
    renderPanel({}, "events");

    expect(screen.getByLabelText("Event type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Subcategory")).not.toBeInTheDocument();
  });
});
