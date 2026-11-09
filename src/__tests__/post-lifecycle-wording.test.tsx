// Member-facing texts that state the post lifecycle rules decided on
// 9 November 2026 (deleted 3 days after a post ends or is sold, events at their
// end, sold and paused posts keep their slot). The rules themselves are tested
// in scripts/test-foundation-lifecycle-guards.mjs.
import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { ListingManagerMini } from "@/components/dashboard/listing-manager-mini";
import { SlotUsageCard } from "@/components/dashboard/slot-usage-card";
import { ContentLifecycleButton } from "@/components/listings/content-lifecycle-button";
import { BillingFaq } from "@/components/billing/billing-faq";
import { getPlanFeatureItems, PLANS } from "@/lib/constants/pricing";

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next/image", () => ({
  default: ({ alt, src }: { alt: string; src: string }) => (
    <div aria-label={alt} data-src={src} role="img" />
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/hooks/use-post-action-fields", () => ({ usePostActionFields: () => () => ({}) }));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("post lifecycle wording", () => {
  it("shows the deletion date of an ended post on the dashboard home", () => {
    render(
      <ListingManagerMini
        posts={[
          {
            id: "listing-1",
            title: "Sold bicycle",
            status: "sold",
            area: "MZANSI_MARKET",
            photos: [],
            view_count: 3,
            created_at: "2026-11-01T08:00:00.000Z",
            updated_at: "2026-11-09T08:00:00.000Z",
            deletes_at: "2026-11-12T08:00:00.000Z",
          },
          {
            id: "listing-2",
            title: "Live kettle",
            status: "live",
            area: "MZANSI_MARKET",
            photos: [],
            view_count: 0,
            created_at: "2026-11-01T08:00:00.000Z",
            deletes_at: null,
          },
        ]}
      />
    );
    expect(screen.getByText("Will be deleted on 12 November 2026")).toBeInTheDocument();
    expect(screen.getAllByText(/^Will be deleted on/)).toHaveLength(1);
  });

  it("says ended posts are deleted after 3 days when no plan is active", () => {
    render(
      <SlotUsageCard
        entries={[
          {
            id: "slot-1",
            source: "RETAIL_PAID",
            area: "MZANSI_MARKET",
            planName: "30 days",
            status: "expired",
            slotCapacity: 1,
            activeUsage: 0,
            activationCount: 1,
            activationLimitTotal: null,
            activationLimitPerPeriod: 10,
            activationPeriodDays: 30,
            periodActivations: 1,
            startsAt: "2026-10-01T08:00:00.000Z",
            expiresAt: "2026-10-31T08:00:00.000Z",
            autoRenew: false,
            sponsored: false,
          },
        ]}
      />
    );
    expect(
      screen.getByText(/No active plan\. Ended posts are deleted after 3 days/)
    ).toBeInTheDocument();
    expect(screen.queryByText(/Your posts are saved/)).not.toBeInTheDocument();
  });

  it.each([
    [
      "mark_sold",
      "Mark sold",
      "Mark this item as sold? It leaves public view and is deleted in 3 days. Its slot stays in use until then; delete the post to free it sooner. You can undo this within the 3 days.",
    ],
    [
      "deactivate",
      "Deactivate",
      "Take this post offline? It keeps its slot, and its end date does not change.",
    ],
  ] as const)("asks before %s with the rule it triggers", (action, label, question) => {
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    render(
      <ContentLifecycleButton
        contentType="listing"
        id="00000000-0000-4000-8000-000000000001"
        action={action}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: label }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith(question);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("answers the billing questions with the 3-day rules", () => {
    const { container } = render(<BillingFaq />);
    const text = container.textContent ?? "";
    expect(text).toContain(
      "You then have 3 days to buy a plan and reactivate a post; after that it is deleted with its photos and videos."
    );
    expect(text).toContain("A sold post keeps its slot until it is deleted 3 days later");
    expect(text).toContain("A deactivated post keeps its slot");
    expect(text).toContain("A new post in a freed slot runs for the plan's remaining days.");
    // Prices come from RETAIL_OFFERS, the same ladder the database catalogue seeds.
    expect(text).toContain(
      "When the trial ends your post is hidden; reactivate it within 3 days for R50 / 30 days, R140 / 90 days or R250 / 180 days, or it is deleted."
    );
    expect(text).toContain("stay live until the event is over; then they are deleted");
    expect(text).not.toMatch(/30 days before deletion|stays? saved|slot frees up/);
  });

  it("lists slot reuse on deletion in plan features", () => {
    const plan = PLANS.find((candidate) => candidate.slotCapacity === 1)!;
    expect(getPlanFeatureItems(plan).map((item) => item.text)).toContain(
      "1 active posting slot — reuse it once its post is deleted"
    );
  });
});
