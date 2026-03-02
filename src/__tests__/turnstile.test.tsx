/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "@testing-library/react";

// Mock the Turnstile script loading
vi.stubGlobal("turnstile", {
  render: vi.fn(() => "widget-id"),
  reset: vi.fn(),
  remove: vi.fn(),
});

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

const { TurnstileWidget } = await import("@/components/ui/turnstile-widget");

describe("TurnstileWidget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
  });

  it("should render without crashing", () => {
    const { container } = render(<TurnstileWidget onSuccess={vi.fn()} />);
    expect(container).toBeTruthy();
  });

  it("should not auto-bypass in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const onSuccess = vi.fn();

    render(<TurnstileWidget onSuccess={onSuccess} />);

    // Should NOT auto-call onSuccess (bypass removed)
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
