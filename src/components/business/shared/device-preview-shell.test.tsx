/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DevicePreviewShell } from "./device-preview-shell";

describe("DevicePreviewShell", () => {
  it("defaults to mobile view", () => {
    render(
      <DevicePreviewShell>
        <p>Preview content</p>
      </DevicePreviewShell>
    );
    expect(screen.getByText("Preview content")).toBeInTheDocument();
    // Mobile button should be active (has shadow-md class)
    const mobileBtn = screen.getByRole("button", { name: /Mobile/i });
    expect(mobileBtn.className).toContain("shadow-md");
  });

  it("switches to desktop view on click", async () => {
    const user = userEvent.setup();
    render(
      <DevicePreviewShell>
        <p>Preview content</p>
      </DevicePreviewShell>
    );
    const desktopBtn = screen.getByRole("button", { name: /Desktop/i });
    await user.click(desktopBtn);
    expect(desktopBtn.className).toContain("shadow-md");
    // URL bar is shown in desktop frame
    expect(screen.getByText("verifymzansi.co.za/businesses/preview")).toBeInTheDocument();
  });

  it("renders children in both modes", async () => {
    const user = userEvent.setup();
    render(
      <DevicePreviewShell>
        <p>Hello</p>
      </DevicePreviewShell>
    );
    expect(screen.getByText("Hello")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Desktop/i }));
    expect(screen.getByText("Hello")).toBeInTheDocument();
  });

  it("has accessible device toggle group", () => {
    render(
      <DevicePreviewShell>
        <p>Content</p>
      </DevicePreviewShell>
    );
    expect(screen.getByRole("group", { name: /Preview device/i })).toBeInTheDocument();
  });
});
