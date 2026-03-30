/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...props} />
  ),
}));

import { BusinessHeroIdentity } from "./business-hero-identity";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

function makeBiz(overrides: Partial<BusinessDetailRecord> = {}): BusinessDetailRecord {
  return {
    id: "biz-1",
    business_name: "Elegance Salon",
    business_type: "standalone_shop",
    category: "health_beauty",
    phone: "+27123456789",
    whatsapp: null,
    email: null,
    website: null,
    logo_url: null,
    location_province: "gauteng",
    location_city: "Johannesburg",
    store_number: null,
    social_links: null,
    ...overrides,
  } as unknown as BusinessDetailRecord;
}

describe("BusinessHeroIdentity", () => {
  it("renders business name as h1", () => {
    render(<BusinessHeroIdentity business={makeBiz()} />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Elegance Salon");
  });

  it("renders type and category badges", () => {
    render(<BusinessHeroIdentity business={makeBiz()} />);
    expect(screen.getByText("Standalone Shop")).toBeInTheDocument();
    expect(screen.getByText("Health, Beauty & Wellness")).toBeInTheDocument();
  });

  it("renders location with city and province", () => {
    render(<BusinessHeroIdentity business={makeBiz()} />);
    expect(screen.getByText("Johannesburg, gauteng")).toBeInTheDocument();
  });

  it("renders call CTA by default when phone exists", () => {
    render(<BusinessHeroIdentity business={makeBiz()} />);
    const link = screen.getByRole("link", { name: /Call/i });
    expect(link).toHaveAttribute("href", "tel:+27123456789");
  });

  it("hides call CTA when hideCallCta is true", () => {
    render(<BusinessHeroIdentity business={makeBiz()} hideCallCta />);
    expect(screen.queryByRole("link", { name: /Call/i })).not.toBeInTheDocument();
  });

  it("renders custom CTA label", () => {
    render(<BusinessHeroIdentity business={makeBiz()} primaryCtaLabel="Book Appointment" />);
    expect(screen.getByText("Book Appointment")).toBeInTheDocument();
  });

  it("renders store number when present", () => {
    render(<BusinessHeroIdentity business={makeBiz({ store_number: "42A" })} />);
    expect(screen.getByText("Shop 42A")).toBeInTheDocument();
  });

  it("skips store number when N/A", () => {
    render(<BusinessHeroIdentity business={makeBiz({ store_number: "N/A" })} />);
    expect(screen.queryByText(/Shop N\/A/)).not.toBeInTheDocument();
  });

  it("renders logo when logo_url is provided", () => {
    render(
      <BusinessHeroIdentity business={makeBiz({ logo_url: "https://cdn.example.com/logo.png" })} />
    );
    expect(screen.getByAltText("Elegance Salon Logo")).toBeInTheDocument();
  });
});
