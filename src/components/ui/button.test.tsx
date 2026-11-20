import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

function classOf(props: Parameters<typeof Button>[0]) {
  render(<Button {...props}>Action</Button>);
  return screen.getByRole("button", { name: "Action" }).className;
}

// Group 66 (owner-approved button hierarchy): one filled primary per screen.
describe("Button variants", () => {
  it("draws default and trust-verified as the same filled brand-green primary", () => {
    const fallback = classOf({});
    document.body.innerHTML = "";
    const primary = classOf({ variant: "default" });
    document.body.innerHTML = "";
    const verified = classOf({ variant: "trust-verified" });
    expect(primary).toBe(fallback);
    expect(verified).toBe(primary);
    expect(primary).toMatch(/\bbg-brand-green-600\b/);
    expect(primary).toMatch(/\btext-white\b/);
  });

  it("has a quieter light-green tinted pill that is not filled green", () => {
    const tinted = classOf({ variant: "tinted" });
    expect(tinted).toMatch(/\bbg-brand-green-100\b/);
    expect(tinted).toMatch(/\btext-brand-green-800\b/);
    expect(tinted).not.toMatch(/\bbg-brand-green-600\b/);
    expect(tinted).not.toMatch(/\btext-white\b/);
  });

  it("no longer offers the black 'ink' variant", () => {
    // @ts-expect-error "ink" was retired: use default, trust-gold, outline or link.
    const ink = classOf({ variant: "ink" });
    expect(ink).not.toMatch(/\bbg-foreground\b/);
  });

  it("lets a caller's colour classes win over the primary's in dark mode too", () => {
    const gold = classOf({
      variant: "trust-gold",
      className: "bg-brand-gold-300 dark:bg-brand-gold-300",
    });
    expect(gold).toMatch(/\bbg-brand-gold-300\b/);
    expect(gold).not.toMatch(/\bbg-brand-green/);
  });
});
