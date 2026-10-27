import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FoundationStaffAuditPage } from "./staff-audit-page";
import { FoundationStaffReadError } from "@/lib/foundation/staff-read";
const { read, authorize, session } = vi.hoisted(() => ({
  read: vi.fn(),
  authorize: vi.fn(),
  session: vi.fn(),
}));
vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: authorize }));
vi.mock("@/lib/foundation/server-session", () => ({ readFoundationServerSession: session }));
vi.mock("@/lib/foundation/staff-read", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  readFoundationStaffAudit: read,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT:" + url);
  },
}));
const time = "2026-10-27T00:00:00.123456+00:00";
beforeEach(() => {
  vi.clearAllMocks();
  authorize.mockResolvedValue({});
  session.mockResolvedValue({ api: {} });
  read.mockResolvedValue({
    version: 1,
    items: [
      {
        id: "moderation:7",
        occurred_at: time,
        actor_id: null,
        actor_name: null,
        target_id: null,
        target_type: "post",
        action: "post:approve",
        reason: "<script>private-note</script>",
      },
    ],
    next_cursor: { before_at: time, before_id: "moderation:7" },
  });
});
it("renders native events, safe text and an exact keyset link after staff authorization", async () => {
  const { container } = render(
    await FoundationStaffAuditPage({
      searchParams: Promise.resolve({ action: "post", q: "approved" }),
    })
  );
  expect(authorize).toHaveBeenCalledWith("audit:view");
  expect(read).toHaveBeenCalledWith({}, { limit: 50, action: "post", q: "approved" });
  expect(screen.getByText("<script>private-note</script>")).toBeInTheDocument();
  expect(container.querySelector("script")).toBeNull();
  const older = new URL(
    screen.getByRole("link", { name: "Older events" }).getAttribute("href")!,
    "http://localhost"
  );
  expect(older.searchParams.get("before_at")).toBe(time);
  expect(older.searchParams.get("before_id")).toBe("moderation:7");
});
it("does not read records if staff authorization fails", async () => {
  authorize.mockRejectedValue(new Error("Staff denied"));
  await expect(FoundationStaffAuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    "Staff denied"
  );
  expect(read).not.toHaveBeenCalled();
});
it("requests a fresh authenticator proof for the sensitive audit capability", async () => {
  read.mockRejectedValue(new FoundationStaffReadError(403, true));
  await expect(FoundationStaffAuditPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
    "/staff/two-step?confirm=1&next=%2Fadmin%2Faudit-log"
  );
});
it("shows unavailable or invalid-filter results without inventing an empty audit history", async () => {
  read.mockRejectedValue(new FoundationStaffReadError(503));
  render(await FoundationStaffAuditPage({ searchParams: Promise.resolve({}) }));
  expect(screen.getByRole("alert")).toHaveTextContent("Staff records are temporarily unavailable");
  expect(screen.queryByText("No recorded events match these filters.")).not.toBeInTheDocument();
});
