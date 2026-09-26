import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TrustStrip } from "./trust-strip";

describe("TrustStrip", () => {
  it("labels the band and lists what is checked, without promising safety", () => {
    render(<TrustStrip />);

    expect(screen.getByRole("region", { name: "Why people trust posts here" })).toBeInTheDocument();
    expect(screen.getByText("Phone & ID checked")).toBeInTheDocument();
    expect(screen.getByText("Posts reviewed first")).toBeInTheDocument();
    expect(screen.queryByText(/guarantee/i)).not.toBeInTheDocument();
  });

  it("accepts a context-specific accessible label", () => {
    render(<TrustStrip variant="blue" title="Trusted posting categories" />);

    expect(screen.getByRole("region", { name: "Trusted posting categories" })).toBeInTheDocument();
  });
});
