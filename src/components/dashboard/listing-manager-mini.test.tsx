import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ListingManagerMini } from "@/components/dashboard/listing-manager-mini";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <div aria-label={alt} data-src={src} role="img" />
  ),
}));

describe("ListingManagerMini", () => {
  it("shows a zero view count so owners can see posts with no views yet", () => {
    render(
      <ListingManagerMini
        posts={[
          {
            id: "listing-1",
            title: "Starter listing",
            status: "live",
            area: "MZANSI_MARKET",
            photos: [],
            view_count: 0,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]}
      />
    );

    expect(screen.getByText("Starter listing")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
  });
});
