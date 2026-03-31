/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";

/* ── Mocks ── */
vi.mock("@/components/business/layouts/unified-layout", () => ({
  UnifiedLayout: (props: Record<string, unknown>) => (
    <div data-testid="unified-layout" data-delivery={String(props.deliveryAvailable)} />
  ),
}));

import { BusinessLayoutRouter } from "./business-layout-router";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

function makeBusiness(overrides: Partial<BusinessDetailRecord> = {}): BusinessDetailRecord {
  return {
    id: "biz-1",
    user_id: "user-1",
    business_name: "Test Biz",
    business_type: "standalone_shop",
    category: "fashion_accessories",
    status: "active",
    phone: "+27123456789",
    whatsapp: null,
    email: null,
    website: null,
    description: "desc",
    location_province: "gauteng",
    location_city: "Johannesburg",
    address: null,
    operating_hours: null,
    gallery_photos: null,
    cover_photo: null,
    cover_video: null,
    video_thumbnail: null,
    logo_url: null,
    social_links: null,
    payment_methods_accepted: null,
    delivery_options: null,
    services_offered: null,
    service_areas: null,
    store_number: null,
    business_details: null,
    layout_template: null,
    trust_level: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    view_count: 0,
    is_featured: false,
    is_boosted: false,
    boosted_until: null,
    mall_id: null,
    ...overrides,
  } as unknown as BusinessDetailRecord;
}

describe("BusinessLayoutRouter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("always renders the unified layout regardless of category", () => {
    render(
      <BusinessLayoutRouter
        business={makeBusiness({ category: "fashion_accessories" })}
        trustLevel={null}
        ownerProfile={null}
      />
    );
    expect(screen.getByTestId("unified-layout")).toBeInTheDocument();
  });

  it("renders unified layout for any category", () => {
    render(
      <BusinessLayoutRouter
        business={makeBusiness({ category: "professional_services" })}
        trustLevel={null}
        ownerProfile={null}
      />
    );
    expect(screen.getByTestId("unified-layout")).toBeInTheDocument();
  });

  it("ignores layout_template — always renders unified", () => {
    render(
      <BusinessLayoutRouter
        business={makeBusiness({
          category: "fashion_accessories",
          layout_template: "professional",
        })}
        trustLevel={null}
        ownerProfile={null}
      />
    );
    expect(screen.getByTestId("unified-layout")).toBeInTheDocument();
  });

  it("computes deliveryAvailable from delivery_options", () => {
    render(
      <BusinessLayoutRouter
        business={makeBusiness({ delivery_options: ["delivery"] })}
        trustLevel={null}
        ownerProfile={null}
      />
    );
    const el = screen.getByTestId("unified-layout");
    expect(el).toHaveAttribute("data-delivery", "true");
  });

  it("passes deliveryAvailable=false when no delivery options", () => {
    render(
      <BusinessLayoutRouter
        business={makeBusiness({ delivery_options: [] })}
        trustLevel={null}
        ownerProfile={null}
      />
    );
    const el = screen.getByTestId("unified-layout");
    expect(el).toHaveAttribute("data-delivery", "false");
  });
});
