/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { NextResponse } from "next/server";
import {
  attachNativeCipcReplyFile,
  attachNativeOfficialCipc,
  previewNativeCipc,
  submitNativeCipc,
} from "./cipc-document-route";
import { currentBusinessClaim, readMyBusinessChecks } from "./business-seen";
import { storeBusinessEvidence } from "./business-evidence-route";
import { createFoundationRouteContext } from "./request-route";
import { createFoundationServiceApi } from "./service-api";
import { FoundationStaffCommandError } from "./staff-command";
import { readCipcFile, type CipcFile } from "../business-verification/intake";
import { checkRateLimit } from "../utils/rate-limit";

vi.mock("./runtime-connection", () => ({ readFoundationRuntimeConnection: vi.fn(() => ({})) }));
vi.mock("./request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("./service-api", () => ({ createFoundationServiceApi: vi.fn() }));
vi.mock("./business-seen", () => ({
  currentBusinessClaim: vi.fn(),
  readMyBusinessChecks: vi.fn(),
}));
vi.mock("./business-evidence-route", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  storeBusinessEvidence: vi.fn(),
}));
vi.mock("../business-verification/intake", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readCipcFile: vi.fn(),
}));
vi.mock("../utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: vi.fn(() => ({ key: "client" })),
}));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const [account, session, business, caseId, artifact, other] = [1, 2, 3, 4, 5, 6].map(uuid);
const csrf = "c".repeat(64);
const [hmacA, hmacB] = ["a".repeat(64), "b".repeat(64)];
const bytes = new TextEncoder().encode("%PDF-1.4 synthetic certificate");
const sha = createHash("sha256").update(bytes).digest("hex");
const fingerprint = (hex: string) => Buffer.from(hex, "hex").toString("base64url");
const api = { rpc: vi.fn() };
const service = { rpc: vi.fn() };
const ok = (data: unknown) => ({ data, error: null });
const file = (over: Partial<CipcFile> = {}) =>
  ({
    bytes,
    isPdf: true,
    activeContent: null,
    structure: null,
    office: null,
    directorIdHmacs: [hmacA, hmacB],
    stored: {
      docType: "registration_certificate",
      registrationNumber: "2020/123456/07",
      registeredName: "Example Trading (Pty) Ltd",
      enterpriseStatus: "In Business",
      issuedOn: null,
      registeredOfficeLines: [],
      directors: [
        { name: "A Director", role: "Director", hasSaId: true, idHmac: hmacA },
        { name: "B Secretary", role: "Secretary", hasSaId: true, idHmac: hmacB },
      ],
    },
    ...over,
  }) as CipcFile;
const upload = (fields: Array<[string, string | File]>, withCsrf = true) => {
  const form = new FormData();
  for (const [name, value] of fields) form.append(name, value);
  return new Request("https://verifymzansi.com/api/businesses/x/verification/cipc", {
    method: "POST",
    body: form,
    headers: {
      origin: "https://verifymzansi.com",
      cookie: `vm_csrf=${csrf}`,
      ...(withCsrf ? { "x-csrf-token": csrf } : {}),
    },
  });
};
const pdf = () => new File([bytes], "cor14.pdf", { type: "application/pdf" });
const reserved = { case_id: caseId, artifact_id: artifact, owner_id: account, completed: false };
const parsed = ok({ caseId, status: "pending", updatedAt: "2026-11-11T10:00:00Z" });
const json = async (r: NextResponse) => ({ status: r.status, body: await r.json() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://verifymzansi.com");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false } as never);
  vi.mocked(createFoundationServiceApi).mockReturnValue(service as never);
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticateCaller: vi.fn(async () => ({ api, accountId: account, sessionId: session })),
    respond: vi.fn(async (r: NextResponse) => r),
  } as never);
  vi.mocked(readMyBusinessChecks).mockResolvedValue({ stickers: { idReviewed: true } } as never);
  vi.mocked(currentBusinessClaim).mockResolvedValue({ generation: "4", nonce: uuid(7) });
  vi.mocked(readCipcFile).mockResolvedValue(file());
  api.rpc.mockResolvedValue(ok(reserved));
  service.rpc.mockResolvedValue(parsed);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("submitNativeCipc", () => {
  it("reserves the file by digest, stores it and records only director fingerprints", async () => {
    const response = await submitNativeCipc(
      upload([
        ["file", pdf()],
        ["registrationNumber", "2020-123456-07"],
        ["route", "representative"],
      ]),
      business
    );
    expect(await json(response)).toEqual({ status: 201, body: { caseId, status: "pending" } });
    expect(api.rpc).toHaveBeenCalledWith(
      "reserve_frontend_cipc_document",
      {
        p_business: business,
        p_number: "2020/123456/07",
        p_route: "representative",
        p_office: false,
        p_digest: sha,
      },
      { get: false }
    );
    expect(storeBusinessEvidence).toHaveBeenCalledWith(
      reserved,
      caseId,
      Buffer.from(bytes),
      "registration"
    );
    const record = service.rpc.mock.calls[0][1];
    expect(record.p_directors.map((d: { fingerprint: string }) => d.fingerprint)).toEqual([
      fingerprint(hmacA),
      fingerprint(hmacB),
    ]);
    expect(JSON.stringify(record)).not.toContain(hmacA);
  });

  it.each([
    [
      "an unexpected field",
      [
        ["file", pdf()],
        ["ownerId", other],
      ],
      "Check the CIPC file and request details.",
    ],
    [
      "a repeated file",
      [
        ["file", pdf()],
        ["file", pdf()],
      ],
      "Check the CIPC file and request details.",
    ],
    ["no file", [["route", "director"]], "Choose a CIPC PDF."],
    ["text instead of a file", [["file", "%PDF-1.4"]], "Choose a CIPC PDF."],
  ] as const)("refuses %s before reading or reserving", async (_n, fields, error) => {
    const response = await submitNativeCipc(upload(fields as never), business);
    expect(await json(response)).toEqual({ status: 400, body: { error } });
    expect(readCipcFile).not.toHaveBeenCalled();
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      { error: "Files can be up to 5 MB.", code: "file_too_large", status: 413 },
      413,
      "file_too_large",
    ],
    [{ error: "Upload the PDF", code: "pdf_required", status: 400 }, 400, "pdf_required"],
    [file({ activeContent: "javascript" }), 422, "active_pdf"],
  ])("returns the intake refusal %#", async (intake, status, code) => {
    vi.mocked(readCipcFile).mockResolvedValue(intake as never);
    const response = await submitNativeCipc(upload([["file", pdf()]]), business);
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it.each([
    [
      "a malformed number",
      [["registrationNumber", "12345"]],
      file(),
      "registration_number_invalid",
    ],
    [
      "an unreadable file and no number",
      [],
      file({ stored: null }),
      "registration_number_required",
    ],
  ] as const)("asks for the registration number for %s", async (_n, extra, intake, code) => {
    vi.mocked(readCipcFile).mockResolvedValue(intake);
    const response = await submitNativeCipc(upload([["file", pdf()], ...extra] as never), business);
    expect(await json(response)).toMatchObject({ status: 400, body: { code } });
  });

  it("requires the ID review sticker before reading the upload", async () => {
    vi.mocked(readMyBusinessChecks).mockResolvedValue({ stickers: { idReviewed: false } } as never);
    expect((await submitNativeCipc(upload([["file", pdf()]]), business)).status).toBe(403);
    expect(readCipcFile).not.toHaveBeenCalled();
  });

  it.each([
    ["a malformed business id", "../other", [["file", pdf()]], 400],
    [
      "an unknown route",
      business,
      [
        ["file", pdf()],
        ["route", "staff"],
      ],
      400,
    ],
  ] as const)("refuses %s", async (_n, id, fields, status) => {
    expect((await submitNativeCipc(upload(fields as never), id)).status).toBe(status);
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it("refuses a CSRF-less upload before any business read", async () => {
    expect((await submitNativeCipc(upload([["file", pdf()]], false), business)).status).toBe(403);
    expect(readMyBusinessChecks).not.toHaveBeenCalled();
  });

  it.each([
    ["PT409", 409],
    ["42501", 403],
    ["PT429", 429],
    ["22023", 422],
    ["XX000", 503],
  ])("maps reservation error %s to %i", async (code, status) => {
    api.rpc.mockResolvedValue({ data: null, error: { code, message: `detail ${caseId}` } });
    const response = await submitNativeCipc(upload([["file", pdf()]]), business);
    expect(response.status).toBe(status);
    expect(JSON.stringify(await response.json())).not.toContain(caseId);
    expect(storeBusinessEvidence).not.toHaveBeenCalled();
  });

  it("refuses a reservation owned by another account without storing bytes", async () => {
    api.rpc.mockResolvedValue(ok({ ...reserved, owner_id: other }));
    expect((await submitNativeCipc(upload([["file", pdf()]]), business)).status).toBe(503);
    expect(storeBusinessEvidence).not.toHaveBeenCalled();
  });

  it("does not record the parse twice when the reservation was already completed", async () => {
    api.rpc.mockResolvedValue(ok({ ...reserved, completed: true }));
    expect((await submitNativeCipc(upload([["file", pdf()]]), business)).status).toBe(201);
    expect(storeBusinessEvidence).not.toHaveBeenCalled();
    expect(service.rpc).not.toHaveBeenCalled();
  });

  it("refuses a parse receipt for a different case", async () => {
    service.rpc.mockResolvedValue(
      ok({ caseId: other, status: "pending", updatedAt: "2026-11-11T10:00:00Z" })
    );
    expect((await submitNativeCipc(upload([["file", pdf()]]), business)).status).toBe(503);
  });
});

describe("previewNativeCipc", () => {
  it("names the owner's listing without returning identity digests", async () => {
    service.rpc.mockResolvedValue(ok({ profile_has_address: true, director_index: 1 }));
    const response = await previewNativeCipc(upload([["file", pdf()]]), business);
    const body = await response.json();
    expect(body.preview).toMatchObject({ ownerListedAs: "Secretary", profileHasAddress: true });
    expect(service.rpc.mock.calls[0][1].p_fingerprints).toEqual([
      fingerprint(hmacA),
      fingerprint(hmacB),
    ]);
    expect(JSON.stringify(body)).not.toMatch(/a{64}|b{64}/);
  });

  it.each([
    ["an out-of-range director", { profile_has_address: false, director_index: 9 }],
    ["an unexpected field", { profile_has_address: false, director_index: null, id_number: "x" }],
  ])("refuses a preview context with %s", async (_n, data) => {
    service.rpc.mockResolvedValue(ok(data));
    expect((await previewNativeCipc(upload([["file", pdf()]]), business)).status).toBe(503);
  });
});

describe("attachNativeOfficialCipc", () => {
  const fields = (): Array<[string, string | File]> => [
    ["file", pdf()],
    ["cipcReference", " REF-1 "],
    ["expectedUpdatedAt", "2026-11-11T10:00:00Z"],
  ];
  it("attaches a staff copy under the current claim with its reference", async () => {
    api.rpc.mockResolvedValue(ok({ ...reserved, owner_id: other }));
    expect((await attachNativeOfficialCipc(upload(fields()), caseId)).status).toBe(201);
    expect(api.rpc.mock.calls[0][1]).toMatchObject({
      p_case: caseId,
      p_generation: "4",
      p_digest: sha,
    });
    expect(service.rpc.mock.calls[0][1].p_summary.cipcReference).toBe("REF-1");
  });

  it("refuses staff attaching a copy to their own business case", async () => {
    expect((await attachNativeOfficialCipc(upload(fields()), caseId)).status).toBe(503);
    expect(storeBusinessEvidence).not.toHaveBeenCalled();
  });

  it("refuses without a current claim", async () => {
    vi.mocked(currentBusinessClaim).mockRejectedValue(
      new FoundationStaffCommandError(409, "Claim it.")
    );
    expect(await json(await attachNativeOfficialCipc(upload(fields()), caseId))).toMatchObject({
      status: 409,
      body: { error: "Claim it." },
    });
    expect(readCipcFile).not.toHaveBeenCalled();
  });

  it("refuses an unreadable official copy", async () => {
    vi.mocked(readCipcFile).mockResolvedValue(file({ stored: null }));
    const response = await attachNativeOfficialCipc(upload(fields()), caseId);
    expect(await json(response)).toMatchObject({
      status: 400,
      body: { code: "admin_copy_unreadable" },
    });
  });
});

describe("attachNativeCipcReplyFile", () => {
  const caller = { api: api as never, accountId: account, sessionId: session };
  const current = { id: caseId, registrationNumber: "2020/123456/07", route: "director" as const };

  it("reserves the reply against the existing case and returns its artifact", async () => {
    expect(await attachNativeCipcReplyFile(caller, business, current, pdf())).toBe(artifact);
    expect(api.rpc.mock.calls[0][1]).toMatchObject({
      p_case: caseId,
      p_office: false,
      p_digest: sha,
    });
  });

  it.each([
    ["a case without a number", { ...current, registrationNumber: null }, file(), 409],
    ["an intake refusal", current, { error: "Too big", code: "file_too_large", status: 413 }, 413],
    ["active content", current, file({ activeContent: "launch" }), 422],
  ])("refuses %s", async (_n, state, intake, status) => {
    vi.mocked(readCipcFile).mockResolvedValue(intake as never);
    await expect(attachNativeCipcReplyFile(caller, business, state, pdf())).rejects.toMatchObject({
      status,
    });
    expect(api.rpc).not.toHaveBeenCalled();
  });

  it("refuses a reservation for another case", async () => {
    api.rpc.mockResolvedValue(ok({ ...reserved, case_id: other }));
    await expect(attachNativeCipcReplyFile(caller, business, current, pdf())).rejects.toMatchObject(
      { status: 503 }
    );
    expect(storeBusinessEvidence).not.toHaveBeenCalled();
  });
});
