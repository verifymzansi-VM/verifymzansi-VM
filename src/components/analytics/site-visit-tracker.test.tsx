import { beforeEach, expect, it, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { SiteVisitTracker } from "./site-visit-tracker";
const state = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => state.path }));
const beacon = vi.fn(() => true);
beforeEach(() => {
  cleanup();
  beacon.mockClear();
  state.path = "/";
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beacon });
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "0" });
});
it.each(["/verification", "/dashboard", "/billing", "/dsar", "/login", "/post/create", "/admin"])(
  "does not send private route %s",
  (path) => {
    state.path = path;
    render(<SiteVisitTracker />);
    expect(beacon).not.toHaveBeenCalled();
  }
);
it("honors DNT before sending", () => {
  Object.defineProperty(navigator, "doNotTrack", { configurable: true, value: "1" });
  render(<SiteVisitTracker />);
  expect(beacon).not.toHaveBeenCalled();
});
it("records return navigation in a long-lived tab, leaving dedupe to the server", () => {
  const view = render(<SiteVisitTracker />);
  state.path = "/pricing";
  view.rerender(<SiteVisitTracker />);
  state.path = "/";
  view.rerender(<SiteVisitTracker />);
  expect(beacon).toHaveBeenCalledTimes(3);
});
