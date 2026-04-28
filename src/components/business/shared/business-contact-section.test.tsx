/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { BusinessContactSection } from "./business-contact-section";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

function makeBiz(overrides: Partial<BusinessDetailRecord> = {}): BusinessDetailRecord {
  return {
    id: "biz-1",
    business_name: "Test Biz",
    phone: null,
    whatsapp: null,
    email: null,
    website: null,
    social_links: null,
    ...overrides,
  } as unknown as BusinessDetailRecord;
}

describe("BusinessContactSection", () => {
  it("renders Contact Representative heading", () => {
    render(<BusinessContactSection business={makeBiz()} />);
    expect(screen.getByText("Contact Representative")).toBeInTheDocument();
  });

  it("renders phone link when phone is provided", () => {
    render(<BusinessContactSection business={makeBiz({ phone: "+27123456789" })} />);
    expect(screen.getByText("+27123456789")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /\+27123456789/i })).toHaveAttribute(
      "href",
      "tel:+27123456789"
    );
  });

  it("renders whatsapp link", () => {
    render(<BusinessContactSection business={makeBiz({ whatsapp: "+27987654321" })} />);
    expect(screen.getByText("+27987654321")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /\+27987654321/i });
    expect(link).toHaveAttribute("href", "https://wa.me/27987654321");
  });

  it("renders email link", () => {
    render(<BusinessContactSection business={makeBiz({ email: "hello@test.co.za" })} />);
    expect(screen.getByText("hello@test.co.za")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /hello@test.co.za/i })).toHaveAttribute(
      "href",
      "mailto:hello@test.co.za"
    );
  });

  it("renders social links when not compact", () => {
    render(
      <BusinessContactSection
        business={makeBiz({
          social_links: { facebook: "https://fb.com/test", instagram: "https://ig.com/test" },
          website: "https://test.co.za",
        })}
      />
    );
    expect(screen.getByText("Connect Online")).toBeInTheDocument();
    expect(screen.getByTitle("Facebook")).toHaveAttribute("href", "https://fb.com/test");
    expect(screen.getByTitle("Instagram")).toHaveAttribute("href", "https://ig.com/test");
    expect(screen.getByTitle("Website")).toHaveAttribute("href", "https://test.co.za");
  });

  it("hides social links when compact", () => {
    render(
      <BusinessContactSection
        business={makeBiz({
          social_links: { facebook: "https://fb.com/test" },
        })}
        compact
      />
    );
    expect(screen.queryByText("Connect Online")).not.toBeInTheDocument();
  });

  it("renders platform fallback when no direct contact info", () => {
    render(<BusinessContactSection business={makeBiz()} />);
    expect(screen.getByText("Send Message via Platform")).toBeInTheDocument();
  });
});
