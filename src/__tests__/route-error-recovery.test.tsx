import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/components/layout/header", () => ({ Header: () => null }));
vi.mock("@/components/layout/footer", () => ({ Footer: () => null }));

type BoundaryModule = {
  default: React.ComponentType<{
    error: Error;
    reset: () => void;
    retry: () => void;
  }>;
};
const boundaries = import.meta.glob("../app/**/error.tsx") as Record<
  string,
  () => Promise<BoundaryModule>
>;
boundaries["../app/global-error.tsx"] = () => import("@/app/global-error");

describe("Next.js route error recovery", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it.each(Object.entries(boundaries))(
    "%s requests fresh server data on Try again",
    async (_path, load) => {
      const { default: Boundary } = await load();
      const retry = vi.fn();
      const reset = vi.fn();
      render(<Boundary error={new Error("Temporary server outage")} reset={reset} retry={retry} />);
      fireEvent.click(screen.getByRole("button", { name: /try again/i }));
      expect(retry).toHaveBeenCalledTimes(1);
      expect(reset).not.toHaveBeenCalled();
    }
  );
});
