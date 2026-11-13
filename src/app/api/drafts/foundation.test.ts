/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse, type NextRequest } from "next/server";

const { mockOwnerRoute } = vi.hoisted(() => ({ mockOwnerRoute: vi.fn() }));

vi.mock("@/lib/foundation/owner-route", () => ({ handleFoundationOwnerRoute: mockOwnerRoute }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: vi.fn(() => null) }));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: vi.fn(() => null) }));

import { DELETE, GET, PUT } from "./route";
import { createAdminClient } from "@/lib/supabase/admin";

function createGETRequest(flow?: string): NextRequest {
  const url = new URL("http://localhost:3000/api/drafts");
  if (flow) url.searchParams.set("flow", flow);
  return { method: "GET", url: url.toString(), headers: new Headers(), nextUrl: url } as never;
}

function createPUTRequest(body: unknown, raw = JSON.stringify(body)): NextRequest {
  return {
    method: "PUT",
    url: "http://localhost:3000/api/drafts",
    headers: new Headers({ origin: "http://localhost:3000", "content-type": "application/json" }),
    nextUrl: new URL("http://localhost:3000/api/drafts"),
    text: async () => raw,
  } as never;
}

function createDELETERequest(flow?: string): NextRequest {
  const url = new URL("http://localhost:3000/api/drafts");
  if (flow) url.searchParams.set("flow", flow);
  return {
    method: "DELETE",
    url: url.toString(),
    headers: new Headers({ origin: "http://localhost:3000" }),
    nextUrl: url,
  } as never;
}

/** Runs the command the route handed to the owner route against a fake API. */
async function runCommand(data: unknown) {
  const rpc = vi.fn().mockResolvedValue({ data, error: null });
  const { command } = mockOwnerRoute.mock.calls[0][0];
  const result = await command({ rpc });
  return { rpc, result };
}

const answer = NextResponse.json({ ok: true });

beforeEach(() => {
  vi.clearAllMocks();
  mockOwnerRoute.mockResolvedValue(answer);
});

describe("GET /api/drafts", () => {
  it.each([undefined, "invalid"])("rejects flow %s before the foundation call", async (flow) => {
    const res = await GET(createGETRequest(flow));
    expect(res.status).toBe(400);
    expect(mockOwnerRoute).not.toHaveBeenCalled();
  });

  it("reads the draft through the foundation owner route", async () => {
    expect(await GET(createGETRequest("listing"))).toBe(answer);
    expect(mockOwnerRoute).toHaveBeenCalledWith(
      expect.objectContaining({ action: "drafts:sync", mutate: false })
    );
    const { rpc, result } = await runCommand({ draft: null });
    expect(rpc).toHaveBeenCalledWith(
      "frontend_form_draft",
      { p_flow: "listing", p_action: "read" },
      { get: false }
    );
    expect(result).toEqual({ draft: null });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("PUT /api/drafts", () => {
  it.each([
    ["an invalid flow", { flow: "invalid", step: 1, data: {} }],
    ["a negative step", { flow: "listing", step: -1, data: {} }],
    ["a fractional step", { flow: "listing", step: 0.5, data: {} }],
    [
      "a step beyond the database integer range",
      { flow: "listing", step: 2_147_483_648, data: {} },
    ],
    ["array draft data", { flow: "listing", step: 1, data: [] }],
    ["missing draft data", { flow: "listing", step: 1 }],
  ])("rejects %s before the foundation call", async (_label, body) => {
    const res = await PUT(createPUTRequest(body));
    expect(res.status).toBe(400);
    expect(mockOwnerRoute).not.toHaveBeenCalled();
  });

  it("rejects a multibyte draft exceeding 64 KiB", async () => {
    const res = await PUT(
      createPUTRequest({ flow: "listing", step: 1, data: { title: "é".repeat(33 * 1024) } })
    );
    expect(res.status).toBe(413);
    expect(mockOwnerRoute).not.toHaveBeenCalled();
  });

  it("rejects an oversized raw payload", async () => {
    const res = await PUT(createPUTRequest(null, "x".repeat(65 * 1024)));
    expect(res.status).toBe(413);
    expect(mockOwnerRoute).not.toHaveBeenCalled();
  });

  it("saves the draft through the foundation owner route", async () => {
    const res = await PUT(createPUTRequest({ flow: "listing", step: 2, data: { title: "Test" } }));
    expect(res).toBe(answer);
    const { rpc, result } = await runCommand({ ok: true });
    expect(rpc).toHaveBeenCalledWith(
      "frontend_form_draft",
      { p_flow: "listing", p_action: "save", p_step: 2, p_data: { title: "Test" } },
      { get: false }
    );
    expect(result).toEqual({ ok: true });
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/drafts", () => {
  it("rejects a missing flow before the foundation call", async () => {
    const res = await DELETE(createDELETERequest());
    expect(res.status).toBe(400);
    expect(mockOwnerRoute).not.toHaveBeenCalled();
  });

  it("discards the draft through the foundation owner route", async () => {
    expect(await DELETE(createDELETERequest("business"))).toBe(answer);
    const { rpc } = await runCommand({ ok: true });
    expect(rpc).toHaveBeenCalledWith(
      "frontend_form_draft",
      { p_flow: "business", p_action: "discard" },
      { get: false }
    );
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});
