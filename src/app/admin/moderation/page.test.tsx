import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";
import { FoundationStaffReadError } from "@/lib/foundation/staff-read";
import AdminModerationPage from "./page";

const { readSession, readQueue, mockRedirect } = vi.hoisted(() => ({
  readSession: vi.fn(),
  readQueue: vi.fn(),
  mockRedirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
}));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: readSession }));
vi.mock("@/lib/foundation/staff-moderation-queue", () => ({
  readStaffModerationQueue: readQueue,
}));
vi.mock("next/navigation", () => ({
  redirect: mockRedirect,
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/admin/moderation/moderation-queue-client", () => ({
  ModerationQueueClient: ({ items }: { items: Array<{ title?: string; itemType: string }> }) => (
    <div>
      <p>queue-size:{items.length}</p>
      {items.map((item, index) => (
        <div key={`${item.itemType}-${index}`}>{`${item.itemType}:${item.title}`}</div>
      ))}
    </div>
  ),
}));

const api = { fixture: "api" };
const queue = (overrides: Record<string, unknown> = {}) => ({
  allItems: [
    { id: "listing-1", itemType: "listing", title: "Used iPhone 15" },
    { id: "business-1", itemType: "business", title: "Nomsa Beauty Studio" },
  ],
  totalWaiting: 2,
  claims: {},
  myClaims: 0,
  failedAreas: [],
  ...overrides,
});

describe("AdminModerationPage", () => {
  beforeEach(() => {
    staffGuard.reset();
    vi.clearAllMocks();
    readSession.mockResolvedValue({ api, user: { id: "staff-1" } });
    readQueue.mockResolvedValue(queue());
  });

  it("shows the waiting items the database returns for this moderator", async () => {
    render(await AdminModerationPage());

    expect(staffGuard.requireStaff).toHaveBeenCalledWith("queue:view");
    expect(readQueue).toHaveBeenCalledWith(api, "staff-1");
    expect(screen.getByText("2 pending")).toBeInTheDocument();
    expect(screen.getByText("queue-size:2")).toBeInTheDocument();
    expect(screen.getByText("listing:Used iPhone 15")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says how many items are not shown and which areas failed to load", async () => {
    readQueue.mockResolvedValue(queue({ totalWaiting: 120, failedAreas: ["Tourism & Events"] }));

    render(await AdminModerationPage());

    expect(screen.getByText("120 pending")).toBeInTheDocument();
    expect(screen.getByText(/Showing 2 of 120 waiting items/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Tourism & Events");
  });

  it("sends staff to the two-step check when the database asks for it", async () => {
    readQueue.mockRejectedValue(new FoundationStaffReadError(403, true));

    await expect(AdminModerationPage()).rejects.toThrow("NEXT_REDIRECT");
    expect(mockRedirect).toHaveBeenCalledWith("/staff/two-step");
  });

  it("refuses to read the queue for a different signed-in account", async () => {
    readSession.mockResolvedValue({ api, user: { id: "someone-else" } });

    await expect(AdminModerationPage()).rejects.toBeInstanceOf(FoundationStaffReadError);
    expect(readQueue).not.toHaveBeenCalled();
  });
});
