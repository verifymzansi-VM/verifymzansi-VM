import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SponsorStripTrack, type StripSponsor } from "./sponsor-strip-track";

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

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock("@/hooks/use-reduced-motion", () => ({ useReducedMotion: () => reduced.value }));

const tracked = vi.hoisted(() => ({ clicks: [] as Array<[string, string]>, impressions: 0 }));
vi.mock("@/lib/analytics/commercial-events", () => ({
  trackSponsorClick: (id: string, surface: string) => tracked.clicks.push([id, surface]),
  trackCommercialEvents: () => {
    tracked.impressions += 1;
  },
}));

const sponsor = (n: number): StripSponsor => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  slug: `partner-${n}`,
  name: `Partner ${n}`,
  logo_url: null,
});

describe("SponsorStripTrack", () => {
  beforeEach(() => {
    reduced.value = false;
    tracked.clicks = [];
  });

  it("links every chip to the sponsor page with an accessible name", () => {
    render(<SponsorStripTrack sponsors={[sponsor(1), sponsor(2), sponsor(3)]} />);
    const link = screen.getByRole("link", { name: "Partner 1 — view supported businesses" });
    expect(link).toHaveAttribute("href", "/organisation/partner-1");
    expect(screen.getByRole("link", { name: /View all partners/ })).toHaveAttribute(
      "href",
      "/sponsors"
    );
    link.click();
    expect(tracked.clicks).toEqual([[sponsor(1).id, "sponsor_strip"]]);
  });

  it("loops with three or more sponsors; the copy is hidden from assistive tech and keyboard", () => {
    const { container } = render(
      <SponsorStripTrack sponsors={[sponsor(1), sponsor(2), sponsor(3)]} />
    );
    const lists = container.querySelectorAll("ul");
    expect(lists).toHaveLength(2);
    expect(lists[1]).toHaveAttribute("aria-hidden", "true");
    for (const link of within(lists[1] as HTMLElement).getAllByRole("link", { hidden: true }))
      expect(link).toHaveAttribute("tabindex", "-1");
    // Only the real chips are reachable by name.
    expect(screen.getAllByRole("link", { name: /Partner 1/ })).toHaveLength(1);
  });

  it("sits still with one or two sponsors", () => {
    const { container } = render(<SponsorStripTrack sponsors={[sponsor(1), sponsor(2)]} />);
    expect(container.querySelectorAll("ul")).toHaveLength(1);
  });

  it("becomes a static row under reduced motion", () => {
    reduced.value = true;
    const { container } = render(
      <SponsorStripTrack sponsors={[sponsor(1), sponsor(2), sponsor(3), sponsor(4)]} />
    );
    expect(container.querySelectorAll("ul")).toHaveLength(1);
  });
});
