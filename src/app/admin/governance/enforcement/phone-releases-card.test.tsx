import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PhoneReleasesCard } from "./phone-releases-card";
import type { PhoneReleases } from "@/lib/foundation/phone-releases";

const refresh = vi.fn();
const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));
vi.mock("@/lib/utils/csrf", () => ({ withCsrfHeaders: (headers: unknown) => headers }));

const ACTOR = "00000000-0000-4000-8000-000000000002";
const item = {
  reason: "The network re-issued this number",
  proposed_at: "2026-11-25T10:00:00Z",
  expires_at: "2026-12-02T10:00:00Z",
  proposed_by_name: "Thando D.",
  proposed_by_me: false,
  conflicted: false,
};
const data: PhoneReleases = {
  actor_id: ACTOR,
  pending: [
    { ...item, phone: "+27821234567" },
    { ...item, phone: "+27831234567", proposed_by_me: true },
    { ...item, phone: "+27841234567", conflicted: true },
  ],
  released: [
    {
      phone: "+27851234567",
      reason: "Banned by mistake, wrong account",
      proposed_by_name: "Thando D.",
      released_by_name: "Lerato M.",
      released_at: "2026-11-24T09:00:00Z",
    },
  ],
};

let fetch: ReturnType<typeof vi.fn>;
let answer: { ok: boolean; body: Record<string, unknown> };
beforeEach(() => {
  answer = { ok: true, body: { status: "proposed" } };
  fetch = vi.fn(async () => ({ ok: answer.ok, json: async () => answer.body }));
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const sent = () => JSON.parse(fetch.mock.calls.at(-1)![1].body);
const row = (number: string) => screen.getByText(number).closest("li") as HTMLElement;

describe("PhoneReleasesCard", () => {
  it("offers each staff member only what they may do", () => {
    render(<PhoneReleasesCard data={data} />);
    const other = within(row("+27 82 123 4567"));
    expect(other.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(other.getByRole("button", { name: "Reject" })).toBeInTheDocument();
    const mine = within(row("+27 83 123 4567"));
    expect(mine.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(mine.getByText("Waiting for another staff member.")).toBeInTheDocument();
    expect(mine.getByRole("button", { name: "Withdraw" })).toBeInTheDocument();
    const conflicted = within(row("+27 84 123 4567"));
    expect(conflicted.queryByRole("button")).toBeNull();
    expect(conflicted.getByText(/someone else must decide/)).toBeInTheDocument();
    expect(within(row("+27 85 123 4567")).getByText(/approved by Lerato M\./)).toBeInTheDocument();
  });

  it("asks to release a number in the stored form", async () => {
    render(<PhoneReleasesCard data={{ ...data, pending: [], released: [] }} />);
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "082 123 4567" } });
    fireEvent.change(screen.getByLabelText("Why"), {
      target: { value: "The network re-issued this number" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ask to release" }));
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(sent()).toEqual({
      action: "propose",
      phone: "+27821234567",
      reason: "The network re-issued this number",
    });
    expect(screen.getAllByText("None.")).toHaveLength(2);
  });

  it("checks the number and reason before sending", () => {
    render(<PhoneReleasesCard data={data} />);
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "12345" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask to release" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a South African number");
    fireEvent.change(screen.getByLabelText("Phone number"), { target: { value: "0821234567" } });
    fireEvent.click(screen.getByRole("button", { name: "Ask to release" }));
    expect(screen.getByRole("alert")).toHaveTextContent("at least 10 characters");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("approves, and shows the refusal it gets", async () => {
    render(<PhoneReleasesCard data={data} />);
    answer = {
      ok: false,
      body: { error: "A different staff member must approve a release you asked for." },
    };
    fireEvent.click(within(row("+27 82 123 4567")).getByRole("button", { name: "Approve" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A different staff member");
    expect(sent()).toEqual({ action: "approve", phone: "+27821234567" });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sends staff to verify their authenticator again", async () => {
    render(<PhoneReleasesCard data={data} />);
    answer = { ok: false, body: { code: "step_up_required" } };
    fireEvent.click(within(row("+27 83 123 4567")).getByRole("button", { name: "Withdraw" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    expect(sent()).toEqual({ action: "reject", phone: "+27831234567" });
  });

  it("says when the requests could not be loaded", () => {
    render(<PhoneReleasesCard data={null} />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.getByRole("button", { name: "Ask to release" })).toBeInTheDocument();
  });
});
