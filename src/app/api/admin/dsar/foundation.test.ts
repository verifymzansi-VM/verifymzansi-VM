/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { POST as caseAction } from "./case/route";
import { POST as complete } from "./complete/route";
import { POST as decide } from "./decide/route";
import { POST as intake } from "./intake/route";
import {
  handlePrivacyStaffRoute,
  processFrontendPrivacyRequest,
} from "@/lib/foundation/privacy-requests";

vi.mock("@/lib/foundation/privacy-requests", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handlePrivacyStaffRoute: vi.fn(),
  processFrontendPrivacyRequest: vi.fn(),
}));

type Command = Parameters<typeof handlePrivacyStaffRoute>[3];

const requestId = "00000000-0000-4000-8000-000000000001";
const answer = NextResponse.json({ ok: true });
const rpc = vi.fn();
const api = { rpc } as unknown as Parameters<Command>[0];
const post = (path: string) =>
  new Request(`https://verifymzansi.com/api/admin/dsar/${path}`, { method: "POST" });

/** Calls the route and returns the operation and command it gave the privacy handler. */
async function commandFor(route: (request: Request) => Promise<Response>, path: string) {
  const request = post(path);
  expect(await route(request)).toBe(answer);
  const [forwarded, , operation, command] = vi.mocked(handlePrivacyStaffRoute).mock.calls[0];
  expect(forwarded).toBe(request);
  return { operation, command };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handlePrivacyStaffRoute).mockResolvedValue(answer);
  vi.mocked(processFrontendPrivacyRequest).mockResolvedValue({ status: "in_progress" });
});

// handlePrivacyStaffRoute (src/lib/foundation/privacy-requests.ts) owns CSRF,
// sign-in and body limits; these cases cover what each route sends it.
describe("staff data-request routes on foundation", () => {
  it("decides a request with its revision", async () => {
    const { operation, command } = await commandFor(decide, "decide");
    expect(operation).toBe("decide");
    await command(api, {
      requestId,
      decision: "reject",
      notes: "Not the account holder",
      revision: 2,
    });
    expect(processFrontendPrivacyRequest).toHaveBeenCalledExactlyOnceWith(api, {
      requestId,
      decision: "reject",
      notes: "Not the account holder",
      revision: 2,
      action: "reject",
      note: "Not the account holder",
    });
    expect(() => command(api, { requestId, decision: "approve" })).toThrow();
  });

  it("completes a request with the operator's attestation", async () => {
    const { operation, command } = await commandFor(complete, "complete");
    expect(operation).toBe("complete");
    await command(api, { requestId, revision: 4, deletionAttestation: "Deleted by hand" });
    expect(processFrontendPrivacyRequest).toHaveBeenCalledExactlyOnceWith(
      api,
      expect.objectContaining({
        action: "complete",
        revision: 4,
        attestation: "Deleted by hand",
      })
    );
    expect(() => command(api, { requestId, revision: 4, extra: true })).toThrow();
  });

  it("extends or assigns a case", async () => {
    const { operation, command } = await commandFor(caseAction, "case");
    expect(operation).toBe("case");
    await command(api, {
      action: "extend",
      requestId,
      revision: 1,
      reason: "Records are held offsite.",
    });
    expect(processFrontendPrivacyRequest).toHaveBeenLastCalledWith(api, {
      action: "extend",
      requestId,
      revision: 1,
      reason: "Records are held offsite.",
      note: "Records are held offsite.",
    });
    await command(api, { action: "assign", requestId, revision: 2, assigneeId: null });
    expect(processFrontendPrivacyRequest).toHaveBeenLastCalledWith(api, {
      action: "assign",
      requestId,
      revision: 2,
      assigneeId: null,
    });
    expect(() => command(api, { action: "extend", requestId, reason: "short" })).toThrow();
  });

  it("records a request made outside the website", async () => {
    const { operation, command } = await commandFor(intake, "intake");
    expect(operation).toBe("intake");
    rpc.mockResolvedValue({ data: { id: requestId, due_by: "2026-12-11T08:00:00Z" }, error: null });
    await expect(
      command(api, {
        type: "access",
        requesterEmail: " Person@Example.com ",
        description: "Wants a copy of their data.",
        intakeNote: "Arrived by post; ID checked at the office.",
      })
    ).resolves.toEqual({
      status: "created",
      requestId,
      reference: "DSAR-00000000",
      dueBy: "2026-12-11T08:00:00Z",
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "record_frontend_privacy_intake",
      {
        p_type: "access",
        p_email: "person@example.com",
        p_phone: null,
        p_description: "Wants a copy of their data.",
        p_note: "Arrived by post; ID checked at the office.",
      },
      { get: false }
    );
  });
});
