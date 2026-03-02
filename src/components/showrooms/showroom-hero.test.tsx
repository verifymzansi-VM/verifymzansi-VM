import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ShowroomHero } from "./showroom-hero";

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: unknown;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

describe("ShowroomHero", () => {
  it("uses /listing/:id for listing CTA links", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "listing-1",
            type: "listing",
            title: "Verified Phone",
            description: "Great condition",
            location: "Cape Town",
            mediaUrl: "https://example.com/photo.jpg",
          },
        ]}
      />
    );

    await waitFor(() => {
      const ctas = screen.getAllByRole("link", { name: /view listing/i });
      expect(ctas.some((link) => link.getAttribute("href") === "/listing/listing-1")).toBe(true);
    });
  });

  it("routes storefront type to /mzansi-business/", async () => {
    render(
      <ShowroomHero
        slides={[
          {
            id: "store-1",
            type: "storefront",
            title: "Mall Store",
            description: "New arrivals",
            location: "Sandton",
            mediaUrl: "https://example.com/store.jpg",
          },
        ]}
      />
    );

    await waitFor(() => {
      const ctas = screen.getAllByRole("link", { name: /visit shop/i });
      expect(ctas.some((link) => link.getAttribute("href") === "/mzansi-business/store-1")).toBe(true);
    });
  });

  it("renders placeholder content when slides are empty", async () => {
    render(<ShowroomHero slides={[]} />);

    await waitFor(() => {
      expect(screen.getAllByText("Welcome to VerifyMzansi Showroom").length).toBeGreaterThan(0);
    });
  });
});
