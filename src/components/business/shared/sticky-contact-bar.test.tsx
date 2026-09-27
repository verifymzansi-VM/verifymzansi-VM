/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { StickyContactBar } from "./sticky-contact-bar";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";

function makeBiz(overrides: Partial<BusinessDetailRecord> = {}): BusinessDetailRecord {
  return {
    id: "biz-1",
    business_name: "Test",
    phone: null,
    whatsapp: null,
    ...overrides,
  } as unknown as BusinessDetailRecord;
}

describe("StickyContactBar", () => {
  it("renders nothing when no phone and no whatsapp", () => {
    const { container } = render(<StickyContactBar business={makeBiz()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders call button when phone is provided", () => {
    render(<StickyContactBar business={makeBiz({ phone: "+27821234567" })} />);
    expect(screen.getByText("Call Now")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Call Now/i })).toHaveAttribute(
      "href",
      "tel:+27821234567"
    );
  });

  it("renders whatsapp button when whatsapp is provided", () => {
    render(<StickyContactBar business={makeBiz({ whatsapp: "+27787654321" })} />);
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /WhatsApp/i })).toHaveAttribute(
      "href",
      "https://wa.me/27787654321"
    );
  });

  it("normalises local-format numbers into working tel and wa.me links", () => {
    render(
      <StickyContactBar business={makeBiz({ phone: "082 123 4567", whatsapp: "0821234567" })} />
    );
    expect(screen.getByRole("link", { name: /Call Now/i })).toHaveAttribute(
      "href",
      "tel:+27821234567"
    );
    expect(screen.getByRole("link", { name: /WhatsApp/i })).toHaveAttribute(
      "href",
      "https://wa.me/27821234567"
    );
  });

  it("renders nothing when the stored numbers are not valid SA mobiles", () => {
    const { container } = render(
      <StickyContactBar business={makeBiz({ phone: "12345", whatsapp: "abc" })} />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders both buttons when both contacts exist", () => {
    render(
      <StickyContactBar business={makeBiz({ phone: "+27611111111", whatsapp: "+27722222222" })} />
    );
    expect(screen.getByText("Call Now")).toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
  });

  it("uses custom CTA label", () => {
    render(
      <StickyContactBar business={makeBiz({ phone: "+27611111111" })} ctaLabel="Book Appointment" />
    );
    expect(screen.getByText("Book Appointment")).toBeInTheDocument();
  });
});
