/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { FoundationStaffCommandError } from "./staff-command";
import { readFrontendSupportInbox, readFrontendSupportMetrics } from "./support-inbox";

const staff = "11111111-1111-4111-8111-111111111111";
const ticket = "22222222-2222-4222-8222-222222222222";
const rpc = vi.fn();
const api = { rpc } as unknown as FoundationAuthenticatedApi;

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: "Thando Dlamini",
    email: "thando@example.invalid",
    message: "Please help me with my listing.",
    status: "new",
    revision: 1,
    created_at: "2026-11-10T08:00:00Z",
    emailActivity: [
      { template: "support_acknowledgement", accepted: true, created_at: "2026-11-10T08:00:05Z" },
    ],
    ...overrides,
  };
}
function inbox(items: unknown[], total: number, overrides: Record<string, unknown> = {}) {
  return {
    actor_id: staff,
    total,
    new_count: 1,
    oldest_new_at: "2026-11-10T08:00:00Z",
    can_update: true,
    items,
    ...overrides,
  };
}
function uuid(i: number) {
  return `33333333-3333-4333-8333-${String(i).padStart(12, "0")}`;
}

beforeEach(() => vi.clearAllMocks());

describe("readFrontendSupportMetrics", () => {
  it("reads the staff member's own counts through one command", async () => {
    rpc.mockResolvedValue({
      data: { actor_id: staff, new: 2, oldest_at: "2026-11-10T08:00:00Z" },
      error: null,
    });
    await expect(readFrontendSupportMetrics(api, staff)).resolves.toEqual({
      actor_id: staff,
      new: 2,
      oldest_at: "2026-11-10T08:00:00Z",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_frontend_support_metrics", {}, { get: false });
  });

  it("refuses counts answered for another account", async () => {
    rpc.mockResolvedValue({
      data: { actor_id: ticket, new: 2, oldest_at: null },
      error: null,
    });
    await expect(readFrontendSupportMetrics(api, staff)).rejects.toMatchObject({ status: 503 });
  });

  it("refuses negative or extra fields instead of showing them", async () => {
    for (const data of [
      { actor_id: staff, new: -1, oldest_at: null },
      { actor_id: staff, new: 1, oldest_at: null, email: "x@example.invalid" },
    ]) {
      rpc.mockResolvedValueOnce({ data, error: null });
      await expect(readFrontendSupportMetrics(api, staff)).rejects.toBeInstanceOf(
        FoundationStaffCommandError
      );
    }
  });
});

describe("readFrontendSupportInbox", () => {
  it("reads a page and passes no ticket when none is selected", async () => {
    rpc.mockResolvedValue({ data: inbox([row(ticket)], 1), error: null });
    const result = await readFrontendSupportInbox(api, staff, 1);
    expect(result.items).toHaveLength(1);
    expect(result.can_update).toBe(true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "get_frontend_support_inbox",
      { p_page: 1 },
      { get: false }
    );
  });

  it("asks for one ticket and accepts only that ticket", async () => {
    rpc.mockResolvedValueOnce({ data: inbox([row(ticket)], 1), error: null });
    await expect(readFrontendSupportInbox(api, staff, 1, ticket)).resolves.toMatchObject({
      items: [{ id: ticket }],
    });
    expect(rpc).toHaveBeenCalledWith(
      "get_frontend_support_inbox",
      { p_page: 1, p_ticket: ticket },
      { get: false }
    );

    rpc.mockResolvedValueOnce({ data: inbox([row(uuid(1))], 1), error: null });
    await expect(readFrontendSupportInbox(api, staff, 1, ticket)).rejects.toMatchObject({
      status: 503,
    });
  });

  it("requires the page to hold exactly the rows the total implies", async () => {
    const fifty = Array.from({ length: 50 }, (_, i) => row(uuid(i)));
    rpc.mockResolvedValueOnce({ data: inbox(fifty, 120), error: null });
    await expect(readFrontendSupportInbox(api, staff, 2)).resolves.toMatchObject({ total: 120 });

    // Page 3 of 120 holds 20 rows; 50 is wrong, and so is a short first page.
    rpc.mockResolvedValueOnce({ data: inbox(fifty, 120), error: null });
    await expect(readFrontendSupportInbox(api, staff, 3)).rejects.toMatchObject({ status: 503 });
    rpc.mockResolvedValueOnce({ data: inbox(fifty.slice(0, 10), 120), error: null });
    await expect(readFrontendSupportInbox(api, staff, 1)).rejects.toMatchObject({ status: 503 });

    // A page past the end is empty.
    rpc.mockResolvedValueOnce({ data: inbox([], 120), error: null });
    await expect(readFrontendSupportInbox(api, staff, 4)).resolves.toMatchObject({ items: [] });
  });

  it("refuses an inbox answered for another account", async () => {
    rpc.mockResolvedValue({ data: inbox([], 0, { actor_id: ticket }), error: null });
    await expect(readFrontendSupportInbox(api, staff, 1)).rejects.toMatchObject({ status: 503 });
  });

  it("refuses rows with unknown statuses, templates, extra fields or bad email", async () => {
    for (const bad of [
      row(ticket, { status: "closed" }),
      row(ticket, {
        emailActivity: [{ template: "other", accepted: true, created_at: "2026-11-10T08:00:05Z" }],
      }),
      row(ticket, { phone: "0820000000" }),
      row(ticket, { email: "not-an-email" }),
    ]) {
      rpc.mockResolvedValueOnce({ data: inbox([bad], 1), error: null });
      await expect(readFrontendSupportInbox(api, staff, 1)).rejects.toMatchObject({
        status: 503,
      });
    }
  });

  it("maps a refused staff session to a second-factor prompt", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "staff second-factor verification expired" },
    });
    await expect(readFrontendSupportInbox(api, staff, 1)).rejects.toMatchObject({
      status: 403,
      mfaRequired: true,
    });
  });
});
