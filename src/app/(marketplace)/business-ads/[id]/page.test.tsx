import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import BusinessAdDetailPage from "./page";
import { notFound } from "next/navigation";

// Mock Next Navigation
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

// Mock Supabase
const mockSingle = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: mockSingle,
    })),
  })),
}));

describe("BusinessAdDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should call notFound when business ad does not exist", async () => {
    mockSingle.mockResolvedValueOnce({ data: null }); // For ad

    await expect(BusinessAdDetailPage({ params: Promise.resolve({ id: "123" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );

    expect(notFound).toHaveBeenCalled();
  });

  it("should correctly render specific areas and external links", async () => {
    const mockAd = {
      id: "123",
      seller_id: "seller-123",
      status: "live",
      business_name: "Test Business",
      about: "A great business",
      service_areas: {
        province: "Gauteng",
        city: "Johannesburg",
        areas: ["Randburg, Sandton", "Rosebank"],
      },
      website: "test.com", // Missing https
      social_links: null, // Note: website should still show even if this is null
      phone: "0112345678",
      cover_photo: "video.mp4?t=123", // Video with query param
    };

    const mockSeller = {
      id: "seller-123",
      display_name: "John Doe",
      seller_verification_status: "verified",
    };

    mockSingle
      .mockResolvedValueOnce({ data: mockAd }) // For ad
      .mockResolvedValueOnce({ data: mockSeller }); // For seller

    // Await the Server Component resolution
    const Page = await BusinessAdDetailPage({ params: Promise.resolve({ id: "123" }) });
    const { container } = render(Page);

    // Verify specific areas are split and rendered correctly
    expect(screen.getByText("Randburg")).toBeInTheDocument();
    expect(screen.getByText("Sandton")).toBeInTheDocument();
    expect(screen.getByText("Rosebank")).toBeInTheDocument();

    // Verify website external link logic fixed with https://
    const link = container.querySelector('a[href="https://test.com"]');
    expect(link).toBeInTheDocument();

    // Verify video extension correctly matched even with query param
    const video = container.querySelector("video");
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute("src", "video.mp4?t=123");

    // Verify Contact button is anchored to #contact-card
    const contactBtn = screen.getByRole("link", { name: /contact/i });
    expect(contactBtn).toHaveAttribute("href", "#contact-card");
  });
});
