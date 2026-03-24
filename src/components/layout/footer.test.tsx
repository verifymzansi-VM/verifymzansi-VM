import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Footer } from "./footer";

describe("Footer", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders only configured official social links", () => {
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_FACEBOOK_URL", "https://facebook.com/verifymzansi");
    vi.stubEnv(
      "NEXT_PUBLIC_VERIFYMZANSI_LINKEDIN_URL",
      "https://linkedin.com/company/verifymzansi"
    );
    vi.stubEnv("NEXT_PUBLIC_VERIFYMZANSI_X_URL", "");

    render(<Footer />);

    expect(screen.getByRole("link", { name: "Facebook" })).toHaveAttribute(
      "href",
      "https://facebook.com/verifymzansi"
    );
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute(
      "href",
      "https://linkedin.com/company/verifymzansi"
    );
    expect(screen.queryByRole("link", { name: "X" })).not.toBeInTheDocument();
  });
});
