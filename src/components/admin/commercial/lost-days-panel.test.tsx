import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LostDaysPanel } from "./lost-days-panel";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

const SLOT = "6f1d3c1e-8a2b-4c3d-9e4f-5a6b7c8d9e0f";
const PACKAGE = "7a2e4d2f-9b3c-4d4e-8f5a-6b7c8d9e0f1a";
let fetch: ReturnType<typeof vi.fn>;
let previewItems: unknown[];
let failAdd: Record<string, unknown> | null;
beforeEach(() => {
  previewItems = [
    { kind: "individual", id: SLOT, slots: 1, renewals: 1, endsAt: "2026-12-22T08:00:00.000Z" },
    { kind: "package", id: PACKAGE, slots: 12, renewals: 0, endsAt: "2027-01-10T08:00:00.000Z" },
  ];
  failAdd = null;
  fetch = vi.fn(async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body);
    if (body.action === "slots.lost_days_preview")
      return { ok: true, json: async () => ({ success: true, data: { items: previewItems } }) };
    if (failAdd) return { ok: false, json: async () => failAdd };
    return {
      ok: true,
      json: async () => ({
        success: true,
        data: {
          days: body.days,
          repeated: false,
          items: [
            {
              kind: "individual",
              id: SLOT,
              slots: 1,
              renewals: 1,
              endsBefore: "2026-12-22T08:00:00.000Z",
              endsAfter: "2026-12-29T08:00:00.000Z",
            },
          ],
        },
      }),
    };
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const sent = (call = 0) => JSON.parse(fetch.mock.calls[call][1].body);

async function check(email = "thandi@example.test") {
  render(<LostDaysPanel />);
  fireEvent.click(screen.getByRole("button", { name: "Add lost days" }));
  const form = screen.getByRole("form", { name: "Check a member's slots" });
  fireEvent.change(within(form).getByLabelText("Member's account email"), {
    target: { value: email },
  });
  fireEvent.submit(form);
  await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
}

describe("Add lost days", () => {
  it("starts closed, with what it is for", () => {
    render(<LostDaysPanel />);
    expect(screen.getByRole("heading", { name: "Add lost days" })).toBeInTheDocument();
    expect(screen.getByText(/An ended slot gets a refund instead/)).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("checks the member's slots, shows the new ends and adds the days once", async () => {
    await check();
    expect(sent(0)).toEqual({
      action: "slots.lost_days_preview",
      accountEmail: "thandi@example.test",
    });
    const form = await screen.findByRole("form", { name: "Add lost days" });
    const list = within(form).getByRole("list", { name: "Running paid slots" });
    expect(within(list).getByText("Individual slot (renewal queued)")).toBeInTheDocument();
    expect(within(list).getByText("Package of 12 slots")).toBeInTheDocument();
    expect(within(list).getByText("Ends 22 December 2026")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Days"), { target: { value: "7" } });
    expect(within(list).getByText("Ends 22 December 2026 → 29 December 2026")).toBeInTheDocument();
    expect(within(list).getByText("Ends 10 January 2027 → 17 January 2027")).toBeInTheDocument();
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "Site down 3 to 5 December" },
    });
    fireEvent.click(within(form).getByRole("button", { name: "Add 7 days" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    const body = sent(1);
    expect(body).toMatchObject({
      action: "slots.add_lost_days",
      accountEmail: "thandi@example.test",
      days: 7,
      reason: "Site down 3 to 5 December",
    });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Added 7 days to thandi@example.test."
    );
    const moved = screen.getByRole("list", { name: "Slots with days added" });
    expect(within(moved).getByText("22 December 2026 → 29 December 2026")).toBeInTheDocument();
    expect(screen.queryByRole("form")).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });

  it("keeps the same request id when staff retry after a refusal", async () => {
    failAdd = { error: "The member's slots changed just now. Check them again, then retry." };
    await check();
    const form = await screen.findByRole("form", { name: "Add lost days" });
    fireEvent.change(within(form).getByLabelText("Days"), { target: { value: "3" } });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "Wrongly rejected post" },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent(/changed just now/);
    failAdd = null;
    fireEvent.submit(form);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(sent(2).requestId).toBe(sent(1).requestId);
  });

  it("says so when nothing is running, and sends nothing more", async () => {
    previewItems = [];
    await check();
    expect(await screen.findByText(/no running paid slot or package/)).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Add lost days" })).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("checks days and reason before sending", async () => {
    await check();
    const form = await screen.findByRole("form", { name: "Add lost days" });
    fireEvent.change(within(form).getByLabelText("Days"), { target: { value: "31" } });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "Site down" },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose 1 to 30 days.");
    fireEvent.change(within(form).getByLabelText("Days"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "abcd" },
    });
    fireEvent.submit(form);
    expect(await screen.findByRole("alert")).toHaveTextContent(/5 to 500 characters/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("sends staff to verify their authenticator again", async () => {
    await check();
    failAdd = { error: "Verify", code: "step_up_required", redirectUrl: "/staff/two-step" };
    const form = await screen.findByRole("form", { name: "Add lost days" });
    fireEvent.change(within(form).getByLabelText("Days"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("Reason (audited)"), {
      target: { value: "Site down" },
    });
    fireEvent.submit(form);
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(push.mock.calls[0][0]).toContain("/staff/two-step");
  });

  it("changing the email clears the checked slots", async () => {
    await check();
    await screen.findByRole("form", { name: "Add lost days" });
    fireEvent.change(screen.getByLabelText("Member's account email"), {
      target: { value: "other@example.test" },
    });
    expect(screen.queryByRole("form", { name: "Add lost days" })).toBeNull();
    expect(screen.getByRole("button", { name: "Check slots" })).toBeInTheDocument();
  });
});
