import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MySlots } from "./my-slots";
import type { FoundationMySlots } from "@/lib/foundation/billing-runtime";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const now = new Date("2026-11-12T10:00:00Z");
type Slot = FoundationMySlots["slots"][number];
const slot = (overrides: Partial<Slot> = {}): Slot => ({
  id: uuid(1),
  source: "retail_paid",
  individual: true,
  label: "Individual slot — 30 days",
  area: null,
  starts_at: "2026-11-10T10:00:00Z",
  ends_at: "2026-12-10T10:00:00Z",
  state: "active",
  places: 1,
  sponsor: null,
  renewable: false,
  renew_opens_at: "2026-11-26T10:00:00Z",
  renewed_until: null,
  renewals: [],
  posts: [],
  ...overrides,
});
const individual = {
  verified: true,
  held: 2,
  pending: 0,
  renewed_ahead: 0,
  limit: 4,
  limit_ends_at: null,
};
const buyHref = `/billing/checkout?plan=${uuid(9)}`;

describe("MySlots", () => {
  it("lists every slot with its post or an empty place, its end date and days left", () => {
    render(
      <MySlots
        now={now}
        buyHref={buyHref}
        individual={individual}
        slots={[
          slot({
            posts: [
              {
                id: uuid(2),
                kind: "listing",
                area: "market",
                title: "Mountain bike",
                status: "live",
                deletes_at: null,
              },
            ],
          }),
          slot({ id: uuid(3), ends_at: "2026-11-13T10:00:00Z" }),
        ]}
      />
    );
    const [first, second] = screen.getAllByTestId("my-slot");
    expect(within(first).getByText("Individual slot")).toBeInTheDocument();
    expect(within(first).getByText("Ends 10 December 2026")).toBeInTheDocument();
    expect(within(first).getByText("28 days left")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: "Mountain bike" })).toHaveAttribute(
      "href",
      `/post/edit-listing/${uuid(2)}`
    );
    expect(within(second).getByText("1 day left")).toBeInTheDocument();
    expect(within(second).getByText("Empty")).toBeInTheDocument();
    expect(within(second).getByRole("link", { name: "Create a post" })).toHaveAttribute(
      "href",
      "/post/create"
    );
    // One buy action for the page; renewing opens 14 days before the end.
    expect(screen.getByRole("link", { name: "Buy a slot" })).toHaveAttribute("href", buyHref);
    expect(screen.queryByRole("link", { name: /Renew/ })).toBeNull();
    expect(within(first).getByText("You can renew from 26 November 2026.")).toBeInTheDocument();
    expect(screen.getByText(/of 4 Individual slots/)).toBeInTheDocument();
  });

  it("shows an ended slot's hidden post until it is deleted", () => {
    render(
      <MySlots
        now={now}
        buyHref={buyHref}
        individual={individual}
        slots={[
          slot({
            state: "ended",
            ends_at: "2026-11-11T10:00:00Z",
            posts: [
              {
                id: uuid(4),
                kind: "business",
                area: "business",
                title: "Sizwe Plumbing",
                status: "expired",
                deletes_at: "2026-11-14T10:00:00Z",
              },
            ],
          }),
        ]}
      />
    );
    const card = screen.getByTestId("my-slot");
    expect(within(card).getByText("Ended")).toBeInTheDocument();
    expect(within(card).getByText("11 November 2026")).toBeInTheDocument();
    expect(within(card).getByText("Hidden; kept until 14 November 2026")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Sizwe Plumbing" })).toHaveAttribute(
      "href",
      `/post/edit-business/${uuid(4)}`
    );
    expect(within(card).queryByText("Empty")).toBeNull();
  });

  it("names sponsored places, the free first post and granted slots", () => {
    render(
      <MySlots
        now={now}
        buyHref={buyHref}
        individual={individual}
        slots={[
          slot({ source: "sponsorship", individual: false, sponsor: "Bay Chamber", label: null }),
          slot({ id: uuid(5), source: "intro_trial", individual: false, label: null }),
          slot({ id: uuid(6), source: "staff_grant", individual: false, label: null, places: 3 }),
        ]}
      />
    );
    expect(screen.getByText("Paid by Bay Chamber")).toBeInTheDocument();
    expect(screen.getByText("Free first post")).toBeInTheDocument();
    expect(screen.getByText("Slot from VerifyMzansi")).toBeInTheDocument();
    expect(screen.getByText("3 places empty")).toBeInTheDocument();
  });

  it("offers no purchase at the limit, and sends a member without an ID review to it", () => {
    const { rerender } = render(
      <MySlots
        now={now}
        buyHref={buyHref}
        individual={{ ...individual, held: 3, pending: 1 }}
        slots={[]}
      />
    );
    expect(screen.queryByRole("link", { name: "Buy a slot" })).toBeNull();
    expect(screen.getByText(/No slots yet/)).toBeInTheDocument();
    rerender(
      <MySlots
        now={now}
        buyHref={buyHref}
        individual={{ ...individual, verified: false, held: 0 }}
        slots={[]}
      />
    );
    expect(screen.queryByRole("link", { name: "Buy a slot" })).toBeNull();
    expect(screen.getByRole("link", { name: "Finish my ID review" })).toHaveAttribute(
      "href",
      "/verification"
    );
  });

  it("offers Renew on each slot that can be renewed, and Renew all for several (P3)", () => {
    render(
      <MySlots
        now={now}
        buyHref={buyHref}
        individual={{ ...individual, renewed_ahead: 1 }}
        slots={[
          slot({ id: uuid(1), ends_at: "2026-11-20T10:00:00Z", renewable: true }),
          slot({
            id: uuid(2),
            ends_at: "2026-11-15T10:00:00Z",
            renewable: true,
            renewed_until: "2026-12-15T10:00:00Z",
            renewals: [
              { id: uuid(7), starts_at: "2026-11-15T10:00:00Z", ends_at: "2026-12-15T10:00:00Z" },
            ],
          }),
          slot({ id: uuid(3), source: "intro_trial", individual: false, renewable: false }),
        ]}
      />
    );
    const [first, second, third] = screen.getAllByTestId("my-slot");
    expect(within(first).getByRole("link", { name: "Renew" })).toHaveAttribute(
      "href",
      `/billing/checkout?renew=${uuid(1)}`
    );
    expect(within(second).getByText("Renewed until 15 December 2026")).toBeInTheDocument();
    expect(within(second).getByRole("link", { name: "Renew" })).toHaveAttribute(
      "href",
      `/billing/checkout?renew=${uuid(2)}`
    );
    // The free first post is not an Individual slot: nothing to renew.
    expect(within(third).queryByRole("link", { name: /Renew/ })).toBeNull();
    expect(within(third).queryByText(/You can renew/)).toBeNull();
    expect(screen.getByRole("link", { name: "Renew all" })).toHaveAttribute(
      "href",
      "/billing/checkout?renew=all"
    );
  });

  it("shows a renewal waiting to start, and no renewing before the ID review", () => {
    const { rerender } = render(
      <MySlots
        now={now}
        buyHref={buyHref}
        individual={individual}
        slots={[
          slot({
            state: "upcoming",
            starts_at: "2026-11-20T10:00:00Z",
            ends_at: "2026-12-20T10:00:00Z",
            renewable: true,
          }),
        ]}
      />
    );
    const card = screen.getByTestId("my-slot");
    expect(within(card).getByText("Starts 20 November 2026")).toBeInTheDocument();
    expect(within(card).getByText("Not started")).toBeInTheDocument();
    expect(within(card).queryByText("Empty")).toBeNull();
    expect(screen.queryByRole("link", { name: "Renew all" })).toBeNull();
    rerender(
      <MySlots
        now={now}
        buyHref={buyHref}
        individual={{ ...individual, verified: false }}
        slots={[slot({ renewable: true }), slot({ id: uuid(2), renewable: true })]}
      />
    );
    expect(screen.queryByRole("link", { name: /Renew/ })).toBeNull();
  });

  it("shows a staff-raised limit with its end date", () => {
    render(
      <MySlots
        now={now}
        buyHref={null}
        individual={{ ...individual, limit: 25, limit_ends_at: "2027-05-31T10:00:00Z" }}
        slots={[]}
      />
    );
    expect(screen.getByText(/of 25 Individual slots until 31 May 2027/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Buy a slot" })).toBeNull();
  });
});
