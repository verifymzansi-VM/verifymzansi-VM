import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HomeBusinessShowcase } from "./home-business-showcase";
import { createClient } from "@/lib/supabase/server";

const { areaCardSpy } = vi.hoisted(() => ({
  areaCardSpy: vi.fn(),
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

vi.mock("./area-preview-card", () => ({
  AreaPreviewCard: (props: unknown) => {
    areaCardSpy(props);
    return <div data-testid="area-preview-card" />;
  },
}));

function createSupabaseMock(data: unknown[]) {
  const builder = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
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
          location_province: "Gauteng",
          location_city: "Johannesburg",
          description: "Curated local fashion",
          boost_until: null,
          business_type: "standalone_shop",
        },
      ]) as never
    );

    const ui = await HomeBusinessShowcase();
    render(ui);

    expect(screen.getByTestId("area-preview-card")).toBeInTheDocument();
    const props = areaCardSpy.mock.calls[0]?.[0] as {
      href: string;
      imageUrl: string;
      posterUrl: string;
      hasVideo: boolean;
      provinceCode: string;
    };
    expect(props.href).toBe("/mzansi-business/biz-1");
    expect(props.imageUrl).toBe("https://example.com/video.mp4");
    expect(props.posterUrl).toBe("https://example.com/thumb.jpg");
    expect(props.hasVideo).toBe(true);
    expect(props.provinceCode).toBe("GP");
  });

  it("returns null when there are no live businesses", async () => {
    vi.mocked(createClient).mockResolvedValue(createSupabaseMock([]) as never);

    const ui = await HomeBusinessShowcase();
    expect(ui).toBeNull();
  });
});
