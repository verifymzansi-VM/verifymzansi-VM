import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MzansiMarketPage from "./page";
import {
  ShowroomWithData,
  type StreamedShowroomProps,
} from "@/components/showrooms/streamed-showroom";
import type * as StreamedShowroomModule from "@/components/showrooms/streamed-showroom";

const { streamedShowroomSpy } = vi.hoisted(() => ({
  streamedShowroomSpy: vi.fn(),
}));

vi.mock("@/components/showrooms/streamed-showroom", async (importOriginal) => ({
  ...(await importOriginal<typeof StreamedShowroomModule>()),
  StreamedShowroom: (props: StreamedShowroomProps) => {
    streamedShowroomSpy(props);
    return null;
  },
}));

/** Renders the page, then the showroom it streams in after its shell. */
async function renderPage() {
  render(await MzansiMarketPage());
  const [showroomProps] = streamedShowroomSpy.mock.calls.at(-1) as [StreamedShowroomProps];
  render(await ShowroomWithData(showroomProps));
}

const { mockCreateClient } = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
}));

const { carouselSpy, pageHeaderSpy } = vi.hoisted(() => ({
  carouselSpy: vi.fn(),
  pageHeaderSpy: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: mockCreateClient,
}));

vi.mock("@/components/showrooms/showroom-card-carousel", () => ({
  ShowroomCardCarousel: (props: {
    items: Array<{ id: string; type: string }>;
    background?: { src?: string; overlayPreset?: string };
  }) => {
    carouselSpy(props);
    return <div data-testid="showroom-card-carousel" />;
  },
}));

vi.mock("./grid", () => ({
  MzansiMarketGrid: () => <div data-testid="mzansi-market-grid" />,
}));

vi.mock("./url-filter-sync", () => ({
  MarketplaceUrlFilterSync: () => null,
}));

vi.mock("@/components/layout", () => ({
  PageHeader: ({ children, ...props }: { children?: React.ReactNode; title?: string }) => {
    pageHeaderSpy(props);
    return <div>{children}</div>;
  },
}));

vi.mock("@/components/listings/listing-filter-sidebar", () => ({
  ListingFilterSidebar: () => <div />,
}));

vi.mock("@/components/listings/listing-filter-drawer", () => ({
  ListingFilterDrawer: () => <div />,
}));

vi.mock("@/components/listings/listing-grid-header", () => ({
  ListingGridHeader: () => <div />,
}));

vi.mock("@/lib/utils/placeholder-content", () => ({
  isPlaceholderMarketplaceContent: () => false,
}));

vi.mock("@/components/home/playwright-fixture-filter", () => ({
  shouldHidePlaywrightFixtureRowWhenEnabled: () => false,
}));

vi.mock("@/lib/supabase/playwright-visual-fixtures", () => ({
  PLAYWRIGHT_HIDE_FIXTURES_COOKIE: "playwright-hide-fixtures",
  shouldHidePlaywrightFixtures: () => false,
}));

vi.mock("@/lib/utils/request-context", () => ({
  getOptionalCookieStore: vi.fn().mockResolvedValue(undefined),
  readCookieValue: vi.fn().mockReturnValue(undefined),
}));

function createListingsQuery(data: unknown[]) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: { data: unknown[] }) => unknown) => Promise.resolve(resolve({ data })),
  };

  return builder;
}

describe("MzansiMarketPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateClient.mockResolvedValue({
      from: vi.fn(() => createListingsQuery([])),
    });
  });

  it("passes the market decorative background into the showroom", async () => {
    await renderPage();

    expect(carouselSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        background: expect.objectContaining({
          src: "/images/showrooms/market-v2-desktop.avif",
          overlayPreset: "market",
        }),
      })
    );
  });

  it("shows no trust strip under the market showroom", async () => {
    await renderPage();

    expect(screen.queryByText("Phone & ID checked")).not.toBeInTheDocument();
  });

  it("uses Mzansi Market as the primary page heading", async () => {
    await renderPage();

    expect(pageHeaderSpy).toHaveBeenCalledWith(expect.objectContaining({ title: "Mzansi Market" }));
  });
});
