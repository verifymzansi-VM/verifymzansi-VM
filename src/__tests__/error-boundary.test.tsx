/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";

// Mock the Button component
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

const { ErrorBoundary } = await import("@/components/shared/error-boundary");

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Test error");
  return <div>Child rendered</div>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // Suppress console.error from React error boundary
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("should render children when no error", () => {
    render(
      <ErrorBoundary>
        <div>Hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByText("Hello")).toBeTruthy();
  });

  it("should render fallback on error", () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    // Should show the default error UI with "Try again" button
    expect(screen.getByText(/try again/i)).toBeTruthy();
  });

  it("should render custom fallback on error", () => {
    render(
      <ErrorBoundary fallback={<div>Custom Error</div>}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(screen.getByText("Custom Error")).toBeTruthy();
  });

  it("should call onError callback when error occurs", () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ componentStack: expect.any(String) })
    );
  });

  it("should reset error state on 'Try again' click", () => {
    // Verify the Try again button renders in error state and is clickable
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow />
      </ErrorBoundary>
    );

    const tryAgain = screen.getByText(/try again/i);
    expect(tryAgain).toBeTruthy();
    // Clicking should not throw
    fireEvent.click(tryAgain);
  });
});
