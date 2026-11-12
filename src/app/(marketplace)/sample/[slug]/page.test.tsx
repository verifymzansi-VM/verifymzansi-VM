import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedSamplePost } from "@/lib/sample-posts/load";

const { mockFind } = vi.hoisted(() => ({ mockFind: vi.fn() }));

vi.mock("@/lib/sample-posts/load", () => ({ findSamplePost: mockFind }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

import sitemap from "@/app/sitemap";
import SamplePostPage, { generateMetadata } from "./page";

const post: ResolvedSamplePost = {
  slug: "example-cakes",
  area: "business",
  category: "food_dining",
  title: "Celebration cakes baked to order",
  description: "Birthday and wedding cakes, baked fresh to order every week.",
  province: "KwaZulu-Natal",
  city: "Richards Bay",
  videoKey: "media/samples/example-cakes.mp4",
  posterKey: "media/samples/example-cakes.webp",
  businessName: "Example Bakery",
  source: "committed",
  videoUrl: "https://media.verifymzansi.com/media/samples/example-cakes.mp4",
  posterUrl: "https://media.verifymzansi.com/media/samples/example-cakes.webp",
};

const params = (slug: string) => ({ params: Promise.resolve({ slug }) });

describe("sample post page", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows the video, details and label, and no trust badges", async () => {
    mockFind.mockResolvedValue(post);
    const { container } = render(await SamplePostPage(params("example-cakes")));
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(post.title);
    expect(screen.getByText("Sample post · for display only")).toBeInTheDocument();
    expect(screen.getByText(/An example post, shown with the business/)).toBeInTheDocument();
    expect(screen.getByText("Richards Bay, KwaZulu-Natal")).toBeInTheDocument();
    expect(screen.getByText("Example Bakery")).toBeInTheDocument();
    expect(container.querySelector("video")).toHaveAttribute("src", post.videoUrl);
    expect(container.textContent).not.toMatch(/ID reviewed|Phone verified|CIPC|Verified/);
  });

  it("leaves out contact buttons unless the business approved them", async () => {
    mockFind.mockResolvedValue(post);
    render(await SamplePostPage(params("example-cakes")));
    expect(screen.queryByRole("link", { name: /call|whatsapp/i })).not.toBeInTheDocument();
  });

  it("shows the contact the business approved", async () => {
    mockFind.mockResolvedValue({
      ...post,
      contact: { approvedByBusiness: true, phone: "0821234567", whatsapp: "0821234567" },
    });
    render(await SamplePostPage(params("example-cakes")));
    expect(screen.getByRole("link", { name: /call/i })).toHaveAttribute("href", "tel:+27821234567");
    expect(screen.getByRole("link", { name: /whatsapp/i }).getAttribute("href")).toMatch(
      /^https:\/\/wa\.me\/27821234567\?text=/
    );
  });

  it("calls notFound for an unknown slug", async () => {
    mockFind.mockResolvedValue(null);
    await expect(SamplePostPage(params("missing"))).rejects.toThrow("notFound");
  });

  it("is never indexed", async () => {
    mockFind.mockResolvedValue(post);
    expect((await generateMetadata(params("example-cakes"))).robots).toEqual({
      index: false,
      follow: false,
    });
    mockFind.mockResolvedValue(null);
    expect((await generateMetadata(params("missing"))).robots).toEqual({
      index: false,
      follow: false,
    });
  });

  it("is not in the sitemap", () => {
    expect(sitemap().some((entry) => entry.url.includes("/sample"))).toBe(false);
  });
});
