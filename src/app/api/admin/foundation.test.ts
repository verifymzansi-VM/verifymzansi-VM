/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as decideContent } from "./content/decide/route";
import { POST as decideContentEdit } from "./content-edits/decide/route";
import { POST as flaggingAction } from "./flagging/action/route";
import { POST as governanceDecide } from "./governance/decide/route";
import { POST as queueAction } from "./queue/route";
import { POST as supportUpdate } from "./support/update/route";
import { POST as verificationDecide } from "./verification/decide/route";
import { GET as evidenceGet, POST as evidencePost } from "./verification/evidence/route";
import { GET as metadataGet, POST as metadataPost } from "./verification/evidence/metadata/route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { handleRestoredModerationDecision } from "@/lib/foundation/restored-moderation-route";
import { handleRestoredReportAction } from "@/lib/foundation/restored-report-action-route";
import { handleRestoredGovernanceDecision } from "@/lib/foundation/restored-governance-route";
import { handleRestoredQueueAction } from "@/lib/foundation/restored-queue-route";
import { handleRestoredIdentityDecision } from "@/lib/foundation/restored-identity-decision-route";
import { handleFoundationEvidenceRead } from "@/lib/foundation/evidence-route";
import { handleRestoredIdentityMetadata } from "@/lib/foundation/restored-identity-metadata-route";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));
vi.mock("@/lib/foundation/restored-moderation-route", () => ({
  handleRestoredModerationDecision: vi.fn(),
}));
vi.mock("@/lib/foundation/restored-report-action-route", () => ({
  handleRestoredReportAction: vi.fn(),
}));
vi.mock("@/lib/foundation/restored-governance-route", () => ({
  handleRestoredGovernanceDecision: vi.fn(),
}));
vi.mock("@/lib/foundation/restored-queue-route", () => ({ handleRestoredQueueAction: vi.fn() }));
vi.mock("@/lib/foundation/restored-identity-decision-route", () => ({
  handleRestoredIdentityDecision: vi.fn(),
}));
vi.mock("@/lib/foundation/evidence-route", () => ({ handleFoundationEvidenceRead: vi.fn() }));
vi.mock("@/lib/foundation/restored-identity-metadata-route", () => ({
  handleRestoredIdentityMetadata: vi.fn(),
}));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];

const id = "00000000-0000-4000-8000-000000000001";
const answer = NextResponse.json({ ok: true });
const post = (path: string) =>
  new Request(`https://verifymzansi.com/api/admin/${path}`, {
    method: "POST",
    headers: { "x-csrf-token": "token" },
  });

beforeEach(() => {
  vi.clearAllMocks();
  for (const handler of [
    handleFoundationOwnerRoute,
    handleRestoredModerationDecision,
    handleRestoredReportAction,
    handleRestoredGovernanceDecision,
    handleRestoredQueueAction,
    handleRestoredIdentityDecision,
    handleFoundationEvidenceRead,
    handleRestoredIdentityMetadata,
  ])
    vi.mocked(handler).mockResolvedValue(answer);
});

// The restored handlers own CSRF, sign-in, validation and rate limits; they
// are tested in src/lib/foundation. Staff commands check the two-step policy
// in the database (internal.staff_actor).
describe("back-office routes on foundation", () => {
  it.each([
    ["content/decide", decideContent, false],
    ["content-edits/decide", decideContentEdit, true],
  ] as const)(
    "POST /api/admin/%s hands the decision to restored moderation",
    async (path, route, edit) => {
      const request = post(path);
      expect(await route(request)).toBe(answer);
      const [forwarded, isEdit] = vi.mocked(handleRestoredModerationDecision).mock.calls[0];
      expect(forwarded).toBeInstanceOf(NextRequest);
      expect(forwarded.url).toBe(request.url);
      expect(forwarded.headers.get("x-csrf-token")).toBe("token");
      expect(isEdit).toBe(edit);
    }
  );

  it("forwards report, governance, queue and identity decisions", async () => {
    const report = post("flagging/action");
    expect(await flaggingAction(report)).toBe(answer);
    expect(handleRestoredReportAction).toHaveBeenCalledExactlyOnceWith(report);

    const governance = post("governance/decide");
    expect(await governanceDecide(governance)).toBe(answer);
    expect(handleRestoredGovernanceDecision).toHaveBeenCalledExactlyOnceWith(governance);

    expect(await queueAction(post("queue"))).toBe(answer);
    expect(vi.mocked(handleRestoredQueueAction).mock.calls[0][0]).toBeInstanceOf(NextRequest);

    expect(await verificationDecide(post("verification/decide"))).toBe(answer);
    const [identity] = vi.mocked(handleRestoredIdentityDecision).mock.calls[0];
    expect(identity).toBeInstanceOf(NextRequest);
    expect(identity.url).toBe("https://verifymzansi.com/api/admin/verification/decide");
  });

  it("reads evidence and metadata only through the protected POST requests", async () => {
    for (const read of [evidenceGet, metadataGet]) {
      const refused = await read();
      expect(refused.status).toBe(405);
      expect(refused.headers.get("Cache-Control")).toContain("no-store");
    }
    const evidence = new NextRequest("https://verifymzansi.com/api/admin/verification/evidence", {
      method: "POST",
    });
    expect(await evidencePost(evidence)).toBe(answer);
    expect(handleFoundationEvidenceRead).toHaveBeenCalledExactlyOnceWith(evidence, "restored");

    const metadata = new NextRequest(
      "https://verifymzansi.com/api/admin/verification/evidence/metadata",
      { method: "POST" }
    );
    expect(await metadataPost(metadata)).toBe(answer);
    expect(handleRestoredIdentityMetadata).toHaveBeenCalledExactlyOnceWith(metadata);
  });

  it("updates a support request status against its revision", async () => {
    expect(await supportUpdate(post("support/update"))).toBe(answer);
    const options = vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
    expect(options).toMatchObject({ action: "admin:support:update", mutate: true });
    const rpc = vi
      .fn()
      .mockResolvedValue({ data: { id, status: "resolved", revision: 3 }, error: null });
    const api = { rpc } as unknown as Parameters<OwnerRouteOptions["command"]>[0];
    await expect(
      options.command(api, { submissionId: id, status: "resolved", revision: 2 })
    ).resolves.toEqual({ status: "ok" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "update_frontend_support_status",
      { p_ticket: id, p_revision: 2, p_status: "resolved" },
      { get: false }
    );
    rpc.mockResolvedValueOnce({ data: { id, status: "resolved", revision: 5 }, error: null });
    await expect(
      options.command(api, { submissionId: id, status: "resolved", revision: 2 })
    ).rejects.toMatchObject({ status: 503 });
    await expect(options.command(api, { submissionId: id, status: "resolved" })).rejects.toThrow();
  });
});
