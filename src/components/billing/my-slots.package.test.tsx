import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MySlots } from "./my-slots";
import type { FoundationMySlotPackage, FoundationMySlots } from "@/lib/foundation/billing-runtime";

vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const uuid = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const now = new Date("2026-11-14T10:00:00Z");
type Slot = FoundationMySlots["slots"][number];
const post = (id: number, title: string, moving = false) => ({
  id: uuid(id),
  kind: "listing" as const,
  area: "market" as const,
  title,
  status: "live" as const,
  deletes_at: null,
  moving,
});
const slotPost = (id: number, title: string) => ({
  id: uuid(id),
  kind: "listing" as const,
  area: "market" as const,
  title,
  status: "live" as const,
  deletes_at: null,
});
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
  renewable: true,
  renew_opens_at: "2026-11-26T10:00:00Z",
  renewed_until: null,
  renewals: [],
  posts: [],
  ...overrides,
});
const individual = {
  verified: true,
  held: 1,
  pending: 0,
  renewed_ahead: 0,
  limit: 4,
  limit_ends_at: null,
};
const grant = uuid(50);
const slotPackage = (overrides: Partial<NonNullable<FoundationMySlotPackage["package"]>> = {}) =>
  ({
    verified: true,
    on_sale: false,
    can_buy: false,
    individual_blocked_until: "2027-01-05T10:00:00Z",
    package: {
      id: uuid(40),
      term_days: 90,
      slots_bought: 25,
      state: "active",
      places: 25,
      starts_at: "2026-11-14T08:00:00Z",
      ends_at: "2027-02-12T08:00:00Z",
      new_posts_limit: 100,
      new_posts_started: 21,
      grants: [grant],
      posts: [post(10, "Demo bakkie 2.4"), post(11, "Test panel van")],
      ...overrides,
    },
  }) satisfies FoundationMySlotPackage;

describe("MySlots with a Multi-listing package (P4a)", () => {
  it("shows the package as one group with its slots in use, end date and posts", () => {
    render(
      <MySlots
        now={now}
        buyHref="/billing/checkout?plan=x"
        individual={individual}
        slotPackage={slotPackage()}
        slots={[
          slot({
            id: grant,
            individual: false,
            places: 25,
            label: "Multi-listing package — 90 days",
          }),
        ]}
      />
    );
    expect(screen.getByText("Multi-listing package")).toBeInTheDocument();
    expect(screen.getByText(/of 25 slots in use/)).toBeInTheDocument();
    expect(screen.getByTestId("slot-package-ends")).toHaveTextContent(
      "Ends 12 February 2027 · 90 days left"
    );
    expect(screen.getByRole("progressbar", { name: "Slots in use" })).toHaveAttribute(
      "aria-valuenow",
      "2"
    );
    expect(screen.getAllByTestId("package-post").map((item) => item.textContent)).toEqual([
      "Demo bakkie 2.4",
      "Test panel van",
    ]);
    expect(screen.getByText("23 empty")).toBeInTheDocument();
    expect(screen.getByText("21 of 100 new posts used in the last 30 days")).toBeInTheDocument();
    // The package's grant is not listed again as a slot.
    expect(screen.queryAllByTestId("my-slot")).toHaveLength(0);
  });

  it("offers 'Add slots' only while packages are on sale and 7 or more whole days are left (P4b)", () => {
    const { unmount } = render(
      <MySlots
        now={now}
        buyHref={null}
        individual={individual}
        slotPackage={slotPackage()}
        slots={[]}
      />
    );
    // Off sale (the owner's switch): no button.
    expect(screen.queryByTestId("slot-package-add")).toBeNull();
    unmount();
    const onSale = (endsAt: string) => ({
      ...slotPackage({ ends_at: endsAt }),
      on_sale: true,
    });
    const first = render(
      <MySlots
        now={now}
        buyHref={null}
        individual={individual}
        slotPackage={onSale("2027-02-12T08:00:00Z")}
        slots={[]}
      />
    );
    expect(screen.getByRole("link", { name: "Add slots" })).toHaveAttribute(
      "href",
      "/billing/package/add"
    );
    first.unmount();
    // Exactly 7 whole days left: still open.
    const second = render(
      <MySlots
        now={now}
        buyHref={null}
        individual={individual}
        slotPackage={onSale("2026-11-21T10:00:00Z")}
        slots={[]}
      />
    );
    expect(screen.getByTestId("slot-package-add")).toBeInTheDocument();
    second.unmount();
    // A moment less than 7 days: closed.
    render(
      <MySlots
        now={now}
        buyHref={null}
        individual={individual}
        slotPackage={onSale("2026-11-21T09:59:00Z")}
        slots={[]}
      />
    );
    expect(screen.queryByTestId("slot-package-add")).toBeNull();
  });

  it("keeps Individual slots beside it closed: no buying or renewing, and says where their posts go", () => {
    render(
      <MySlots
        now={now}
        buyHref="/billing/checkout?plan=x"
        individual={individual}
        slotPackage={slotPackage()}
        slots={[
          slot({ id: grant, individual: false, places: 25 }),
          slot({ posts: [slotPost(12, "Sample 4x4")] }),
        ]}
      />
    );
    expect(screen.getByRole("heading", { name: "Individual slots" })).toBeInTheDocument();
    const card = screen.getByTestId("my-slot");
    expect(within(card).getByText("Moves to a free package slot when it ends")).toBeInTheDocument();
    expect(within(card).queryByRole("link", { name: "Renew" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Buy a slot" })).toBeNull();
    expect(screen.getByText(/New ones can.t be bought while your/)).toBeInTheDocument();
  });

  it("shows a post moving in from an ended Individual slot, without a renewed date", () => {
    render(
      <MySlots
        now={now}
        buyHref={null}
        individual={individual}
        slotPackage={slotPackage({
          posts: [post(10, "Demo bakkie 2.4"), post(12, "Sample 4x4", true)],
        })}
        slots={[
          slot({ id: grant, individual: false, places: 25 }),
          slot({
            state: "ended",
            ends_at: "2026-11-14T09:00:00Z",
            renewable: false,
            // The package's end, read through the slot's run: not a renewal.
            renewed_until: "2027-02-12T08:00:00Z",
            posts: [slotPost(12, "Sample 4x4")],
          }),
        ]}
      />
    );
    const card = screen.getByTestId("my-slot");
    expect(within(card).getByText("Moving into your package")).toBeInTheDocument();
    expect(within(card).queryByText(/Renewed until/)).toBeNull();
    expect(screen.getByText("Moved in from an Individual slot")).toBeInTheDocument();
  });

  it("opens Individual slots again in the package's last 7 days", () => {
    render(
      <MySlots
        now={now}
        buyHref="/billing/checkout?plan=x"
        individual={individual}
        slotPackage={{ ...slotPackage(), individual_blocked_until: null }}
        slots={[slot({ id: grant, individual: false, places: 25 }), slot()]}
      />
    );
    expect(screen.getByRole("link", { name: "Buy a slot" })).toBeInTheDocument();
    expect(
      within(screen.getByTestId("my-slot")).getByRole("link", { name: "Renew" })
    ).toBeInTheDocument();
  });

  it("shows an ended package with the posts it keeps for 3 days", () => {
    render(
      <MySlots
        now={now}
        buyHref={null}
        individual={{ ...individual, held: 0 }}
        slotPackage={{
          ...slotPackage({
            state: "ended",
            places: 0,
            ends_at: "2026-11-13T08:00:00Z",
            posts: [
              {
                ...post(10, "Demo bakkie 2.4"),
                status: "expired",
                deletes_at: "2026-11-16T08:00:00Z",
              },
            ],
          }),
          individual_blocked_until: null,
        }}
        slots={[]}
      />
    );
    expect(screen.getByText("Ended")).toBeInTheDocument();
    expect(screen.getByTestId("slot-package-ends")).toHaveTextContent("Ended 13 November 2026");
    expect(screen.getByText("Hidden; kept until 16 November 2026")).toBeInTheDocument();
    expect(screen.queryByText(/No slots yet/)).toBeNull();
  });
});
