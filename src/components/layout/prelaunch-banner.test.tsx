/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockUsePathname } = vi.hoisted(() => ({ mockUsePathname: vi.fn() }));

vi.mock("next/navigation", () => ({ usePathname: mockUsePathname }));

import { PrelaunchBanner } from "./prelaunch-banner";

describe("PrelaunchBanner", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    mockUsePathname.mockReturnValue("/");
  });

  afterEach(() => {
    cleanup();
  });

  it("opens as a pop-up telling visitors the site launches soon", async () => {
    render(<PrelaunchBanner />);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("We're launching soon.");
    expect(dialog).toHaveTextContent("early preview");
  });

  it("closes on Escape and stays closed on a reload in the same tab", async () => {
    render(<PrelaunchBanner />);
    fireEvent.keyDown(await screen.findByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();

    cleanup();
    render(<PrelaunchBanner />);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows again once the tab is closed and the site is opened again", async () => {
    render(<PrelaunchBanner />);
    fireEvent.click(await screen.findByRole("button", { name: "Explore the site" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    // A new tab or browser window starts with empty tab storage.
    cleanup();
    window.sessionStorage.clear();
    render(<PrelaunchBanner />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("stays out of the full-screen video viewer", async () => {
    mockUsePathname.mockReturnValue("/video-mode");
    render(<PrelaunchBanner />);
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
