/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { GET as read } from "./route";
import { POST as preview } from "./cipc/preview/route";
import { POST as submit } from "./cipc/route";
import { POST as link } from "./link/route";
import { POST as messages } from "./messages/route";
import { PATCH as officeVisibility } from "./office-visibility/route";
import { POST as renew } from "./renew/route";
import { POST as routeSwitch } from "./route-switch/route";
import { POST as seen } from "./seen/route";
import { POST as withdraw } from "./withdraw/route";
import { POST as workEmail } from "./work-email/route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { handleNativeCipcOwnerAction } from "@/lib/foundation/cipc-commands";
import { previewNativeCipc, submitNativeCipc } from "@/lib/foundation/cipc-document-route";
import { sendSeenOwnerMessage } from "@/lib/foundation/seen-media-route";
import { readMyBusinessChecks } from "@/lib/foundation/business-seen";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));
vi.mock("@/lib/foundation/cipc-commands", () => ({ handleNativeCipcOwnerAction: vi.fn() }));
vi.mock("@/lib/foundation/cipc-document-route", () => ({
  previewNativeCipc: vi.fn(),
  submitNativeCipc: vi.fn(),
}));
vi.mock("@/lib/foundation/seen-media-route", () => ({ sendSeenOwnerMessage: vi.fn() }));
vi.mock("@/lib/foundation/business-seen", () => ({ readMyBusinessChecks: vi.fn() }));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];

const id = "00000000-0000-4000-8000-000000000001";
const caseId = "00000000-0000-4000-8000-000000000002";
const answer = NextResponse.json({ ok: true });
const params = { params: Promise.resolve({ id }) };
const rpc = vi.fn();
const api = { rpc } as unknown as Parameters<OwnerRouteOptions["command"]>[0];
const request = (path = "", method = "POST") =>
  new NextRequest(`https://verifymzansi.com/api/businesses/${id}/verification${path}`, {
    method,
  });
const routeOptions = () =>
  vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValue(answer);
  vi.mocked(handleNativeCipcOwnerAction).mockResolvedValue(answer);
  vi.mocked(previewNativeCipc).mockResolvedValue(answer);
  vi.mocked(submitNativeCipc).mockResolvedValue(answer);
  vi.mocked(sendSeenOwnerMessage).mockResolvedValue(answer);
});

// The foundation handlers own CSRF, sign-in, ownership checks, validation and
// rate limits; they are tested in src/lib/foundation.
describe("owner business-verification routes on foundation", () => {
  it("hands CIPC documents and owner messages to the foundation handlers", async () => {
    const previewRequest = request("/cipc/preview");
    expect(await preview(previewRequest, params)).toBe(answer);
    expect(previewNativeCipc).toHaveBeenCalledExactlyOnceWith(previewRequest, id);
    const submitRequest = request("/cipc");
    expect(await submit(submitRequest, params)).toBe(answer);
    expect(submitNativeCipc).toHaveBeenCalledExactlyOnceWith(submitRequest, id);
    const messageRequest = request("/messages");
    expect(await messages(messageRequest, params)).toBe(answer);
    expect(sendSeenOwnerMessage).toHaveBeenCalledExactlyOnceWith(messageRequest, id);
  });

  it.each([
    ["link", link],
    ["renew", renew],
    ["route-switch", routeSwitch],
    ["work-email", workEmail],
    ["office-visibility", officeVisibility],
  ] as const)("sends %s to the CIPC owner action", async (action, route) => {
    const req = request(`/${action}`);
    expect(await route(req, params)).toBe(answer);
    expect(handleNativeCipcOwnerAction).toHaveBeenCalledExactlyOnceWith(req, id, action);
  });

  it("reads the owner's checks for this business", async () => {
    const req = request("", "GET");
    expect(await read(req, params)).toBe(answer);
    const options = routeOptions();
    expect(options).toMatchObject({ request: req, mutate: false });
    vi.mocked(readMyBusinessChecks).mockResolvedValue({ cases: [] } as never);
    await expect(options.command(api, undefined)).resolves.toEqual({ cases: [] });
    expect(readMyBusinessChecks).toHaveBeenCalledExactlyOnceWith(api, id);
  });

  it("asks to be seen, and needs an address only for a visit", async () => {
    await seen(request("/seen"), params);
    const options = routeOptions();
    expect(options).toMatchObject({ mutate: true, successStatus: 201 });
    rpc.mockResolvedValue({ data: { caseId, status: "pending" }, error: null });
    const visit = {
      method: "visit",
      address: "12 Long Street, Cape Town",
      slots: ["Monday morning"],
      consentScreenshots: true,
    };
    await expect(options.command(api, visit)).resolves.toEqual({ caseId, status: "pending" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "request_frontend_business_seen",
      {
        p_business: id,
        p_method: "visit",
        p_slots: ["Monday morning"],
        p_consent: true,
        p_address: "12 Long Street, Cape Town",
      },
      { get: false }
    );
    await expect(options.command(api, { ...visit, address: undefined })).rejects.toThrow();
    await expect(
      options.command(api, { ...visit, method: "video", address: undefined })
    ).resolves.toBeDefined();
    expect(rpc).toHaveBeenLastCalledWith(
      "request_frontend_business_seen",
      { p_business: id, p_method: "video", p_slots: ["Monday morning"], p_consent: true },
      { get: false }
    );
  });

  it("withdraws an open case", async () => {
    await withdraw(request("/withdraw"), params);
    const options = routeOptions();
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(options.command(api, { caseId })).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "withdraw_frontend_business_check",
      { p_business: id, p_case: caseId },
      { get: false }
    );
    await expect(options.command(api, { caseId: "nope" })).rejects.toThrow();
  });
});
