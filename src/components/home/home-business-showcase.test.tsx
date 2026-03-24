import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeBusinessShowcase } from "./home-business-showcase";
import { createClient } from "@/lib/supabase/server";

const { businessCardSpy } = vi.hoisted(() => ({
  businessCardSpy: vi.fn(),
}));

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

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({
    get: vi.fn(),
  }),
}));

vi.mock("./auto-scroll-rail", () => ({
  AutoScrollRail: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="auto-scroll-rail">{children}</div>
  ),
}));

vi.mock("./business-preview-card", () => ({
  BusinessPreviewCard: (props: unknown) => {
    businessCardSpy(props);
    return <div data-testid="business-preview-card" />;
  },
}));

function createSupabaseMock(data: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    not: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue({ data }),
  };

  return {
    from: vi.fn().mockReturnValue(builder),
  };
}

describe("HomeBusinessShowcase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers cover video and maps business cards to the mzansi-business route", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock([
        {
          id: "biz-1",
          business_name: "Nomsa Fashion",
          cover_photo: "https://example.com/photo.jpg",
          cover_video: "https://example.com/video.mp4",
          video_thumbnail: "https://example.com/thumb.jpg",
          logo_url: "https://example.com/logo.png",
          location_province: "Gauteng",
          location_city: "Johannesburg",
          boost_until: null,
          business_type: "standalone_shop",
        },
      ]) as never
    );

    const ui = await HomeBusinessShowcase();
    render(ui);

    expect(screen.getByTestId("business-preview-card")).toBeInTheDocument();
    const props = businessCardSpy.mock.calls[0]?.[0] as {
      href: string;
      imageUrl: string;
      posterUrl: string;
      logoUrl: string;
      provinceCode: string;
    };
    expect(props.href).toBe("/mzansi-business/biz-1");
    expect(props.imageUrl).toBe("https://example.com/video.mp4");
    expect(props.posterUrl).toBe("https://example.com/thumb.jpg");
    expect(props.logoUrl).toBe("https://example.com/logo.png");
    expect(props.provinceCode).toBe("GP");
  });

  it("returns null when there are no live businesses", async () => {
    vi.mocked(createClient).mockResolvedValue(createSupabaseMock([]) as never);

    const ui = await HomeBusinessShowcase();
    expect(ui).toBeNull();
  });

  it("renders businesses inside the shared auto-scroll rail", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock([
        {
          id: "biz-2",
          business_name: "Mandla Mechanics",
          cover_photo: "https://example.com/cover.jpg",
          cover_video: null,
          video_thumbnail: null,
          logo_url: null,
          location_province: "KwaZulu-Natal",
          location_city: "Durban",
          boost_until: null,
          business_type: "general_store",
        },
      ]) as never
    );

    const ui = await HomeBusinessShowcase();
    render(ui);

    expect(screen.getByTestId("auto-scroll-rail")).toBeInTheDocument();
  });

  it("filters placeholder businesses before rendering the rail", async () => {
    vi.mocked(createClient).mockResolvedValue(
      createSupabaseMock([
        {
          id: "biz-seed",
          business_name: "Seed Service Hub",
          description: "Demo business",
          cover_photo: "https://example.com/cover.jpg",
          cover_video: null,
          video_thumbnail: null,
          logo_url: null,
          location_province: "KwaZulu-Natal",
          location_city: "Durban",
          boost_until: null,
          business_type: "general_store",
        },
        {
          id: "biz-live",
          business_name: "Mandla Mechanics",
          description: "Trusted mechanic workshop",
          cover_photo: "https://example.com/live-cover.jpg",
          cover_video: null,
          video_thumbnail: null,
          logo_url: null,
          location_province: "KwaZulu-Natal",
          location_city: "Durban",
          boost_until: null,
          business_type: "general_store",
        },
      ]) as never
    );

    const ui = await HomeBusinessShowcase();
    render(ui);

    expect(screen.getByTestId("business-preview-card")).toBeInTheDocument();
    expect(businessCardSpy).toHaveBeenCalledTimes(1);
    const props = businessCardSpy.mock.calls[0]?.[0] as { title: string };
    expect(props.title).toBe("Mandla Mechanics");
  });
});
