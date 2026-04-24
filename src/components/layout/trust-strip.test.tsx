import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrustStrip } from "./trust-strip";

describe("TrustStrip", () => {
  it("keeps the market label as the default", () => {
    render(<TrustStrip />);

    expect(screen.getByRole("heading", { name: "Latest on Mzansi Market" })).toBeInTheDocument();
  });

  it("renders context-specific marketplace labels", () => {
    render(<TrustStrip variant="blue" title="Latest Mzansi Businesses" />);

    expect(screen.getByRole("heading", { name: "Latest Mzansi Businesses" })).toBeInTheDocument();
  });
});
