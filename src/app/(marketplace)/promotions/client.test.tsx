/**
 * @vitest-environment jsdom
 */
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { PromotionsExplorer } from "./client";

const { replaceMock, usePathnameMock, useRouterMock, useSearchParamsMock, fetchMock } = vi.hoisted(
  () => ({
    replaceMock: vi.fn(),
    usePathnameMock: vi.fn(),
    useRouterMock: vi.fn(),
    useSearchParamsMock: vi.fn(),
    fetchMock: vi.fn(),
  })
);

vi.mock("next/navigation", () => ({
  usePathname: usePathnameMock,
  useRouter: useRouterMock,
  useSearchParams: useSearchParamsMock,
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

vi.mock("next/image", () => ({
  default: ({
    src,
    alt,
    fill: _fill,
    sizes: _sizes,
    priority: _priority,
    ...props
  }: Record<string, unknown> & { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} {...props} />
  ),
}));

vi.mock("@/components/layout", () => ({
  PageHeader: ({
    title,
    description,
    children,
  }: {
    title: string;
    description?: string;
    children?: React.ReactNode;
  }) => (
    <div>
      <h1>{title}</h1>
      {description ? <p>{description}</p> : null}
      {children}
    </div>
  ),
}));

vi.mock("@/components/listings/promotion-filter-panel", () => ({
  PromotionFilterPanel: () => <div data-testid="promotion-filter-panel" />,
}));

vi.mock("@/components/listings/promotion-filter-drawer", () => ({
  PromotionFilterDrawer: () => <div data-testid="promotion-filter-drawer" />,
}));

vi.mock("@/components/listings/promotion-card", () => ({
  PromotionCard: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    asChild,
    children,
    ...props
  }: {
    asChild?: boolean;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => {
    if (asChild && React.isValidElement(children)) {
      return React.cloneElement(children, props);
    }

    return <button {...props}>{children}</button>;
  },
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <div {...props}>{children}</div>
  ),
  CardContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode; [key: string]: unknown }) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock("@/components/ui/video-card-player", () => ({
  VideoCardPlayer: ({ src }: { src: string }) => <div>{src}</div>,
}));

vi.mock("@/components/listings/business-card", () => ({
  BusinessCard: ({ name }: { name: string }) => <div>{name}</div>,
}));

describe("PromotionsExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    usePathnameMock.mockReturnValue("/tourism-events");
    useRouterMock.mockReturnValue({ replace: replaceMock });
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams() as ReturnType<typeof useSearchParamsMock>
    );
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        promotions: [],
        accountProfiles: [],
        sellers: [],
        businesses: [],
        total: 0,
        page: 1,
        limit: 24,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders Tourism and Events tabs", async () => {
    render(<PromotionsExplorer />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const tablist = screen.getByRole("tablist");
    const tabs = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent?.trim());

    expect(tabs).toEqual(expect.arrayContaining(["Tourism", "Events"]));
  });

  it("highlights the Events tab as a visible discovery option when Tourism is selected", async () => {
    render(<PromotionsExplorer />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const eventsTab = screen.getByRole("tab", { name: /Events/i });

    expect(eventsTab).toHaveClass("border-amber-300");
    expect(eventsTab).toHaveClass("bg-amber-50");
    expect(eventsTab).toHaveClass("text-amber-800");
  });

  it("switches to Events tab and updates the query string", async () => {
    render(<PromotionsExplorer />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    fireEvent.click(screen.getByRole("tab", { name: /Events/i }));

    expect(replaceMock).toHaveBeenCalledWith(
      expect.stringContaining("tab=events"),
      expect.anything()
    );
  });

  it("exposes canonical tourism creation links on the tourism tab", async () => {
    render(<PromotionsExplorer />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });

    const links = screen.getAllByRole("link", { name: /List Tourism Business/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/post/create-tourism");
    }
  });

  it("exposes canonical event creation links on the events tab", async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams("tab=events") as ReturnType<typeof useSearchParamsMock>
    );

    render(<PromotionsExplorer />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/promotions?page=1&limit=24&type=event"),
        expect.anything()
      );
    });

    const links = screen.getAllByRole("link", { name: /Create Event/i });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/post/create-tourism?type=event");
    }
  });

  it("treats the legacy type=event URL as the events tab", async () => {
    useSearchParamsMock.mockReturnValue(
      new URLSearchParams("type=event") as ReturnType<typeof useSearchParamsMock>
    );

    render(<PromotionsExplorer />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/promotions?page=1&limit=24&type=event"),
        expect.anything()
      );
    });

    expect(screen.getAllByRole("link", { name: /Create Event/i }).length).toBeGreaterThan(0);
  });
});
