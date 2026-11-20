/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import { summarizeVerification } from "@/lib/account/verification-summary";
import {
  accountVerificationStatusFromCase,
  readFoundationAccountVerificationStatus,
} from "./account-verification-status";
import { dashboardVerificationSteps, type FoundationOwnerDashboard } from "./owner-dashboard";
import type { FoundationAuthenticatedApi } from "./authenticated-api";

vi.mock("server-only", () => ({}));

const caseId = "00000000-0000-4000-8000-0000000000c1";
const at = "2026-11-20T08:00:00.000Z";

type Case = Parameters<typeof accountVerificationStatusFromCase>[0];
const base: Case = {
  case_id: caseId,
  version: 2,
  verified: false,
  phone_verified: false,
  locality_confirmed: false,
  submission_pending: false,
  return_reason: null,
};

describe("accountVerificationStatusFromCase", () => {
  it.each([
    ["verified", { verified: true, phone_verified: true, locality_confirmed: true }, null],
    [
      "pending_review",
      { submission_pending: true, phone_verified: true, locality_confirmed: true },
      null,
    ],
    [
      "rejected",
      { return_reason: "document_unreadable", phone_verified: true, locality_confirmed: true },
      "rejected",
    ],
    [
      "incomplete",
      { return_reason: "document_unreadable", phone_verified: true, locality_confirmed: true },
      "needs_resubmission",
    ],
    // A returned case whose decision is not known is never shown as rejected.
    ["incomplete", { return_reason: "document_unreadable" }, null],
    // ID and selfie sent, but the phone or area is still missing.
    ["incomplete", { submission_pending: true, phone_verified: true }, null],
    ["incomplete", { submission_pending: true, locality_confirmed: true }, null],
    // Phone and area done, ID and selfie not sent yet.
    ["incomplete", { phone_verified: true, locality_confirmed: true }, null],
    ["incomplete", { case_id: null, version: null }, null],
  ] as const)("shows %s for %j (decision %s)", (expected, change, decision) => {
    expect(accountVerificationStatusFromCase({ ...base, ...change }, decision)).toBe(expected);
  });

  // Same answer as GET /api/verification/status, which the page asks again in
  // the browser: every combination the live backend can return.
  it("matches the verification status route for every case shape", () => {
    const flags = [false, true];
    let compared = 0;
    for (const phone of flags)
      for (const locality of flags)
        for (const identityAccepted of flags)
          for (const pending of flags)
            for (const decision of [null, "rejected", "needs_resubmission"] as const) {
              // The database's own rules: verified needs an accepted identity,
              // phone and area; an accepted case has no pending or returned
              // submission; a pending submission was not returned.
              const verified = identityAccepted && phone && locality;
              if (identityAccepted && (pending || decision)) continue;
              if (pending && decision) continue;
              const current: Case = {
                ...base,
                verified,
                phone_verified: phone,
                locality_confirmed: locality,
                submission_pending: pending,
                return_reason: decision ? "reason" : null,
              };
              const snapshot = {
                verification: { ...current, ...(decision ? { return_decision: decision } : {}) },
                profile_facts: {
                  phone_verified_at: phone ? at : null,
                  location_confirmed_at: locality ? at : null,
                  identity_reviewed_at: identityAccepted ? at : null,
                  id_document_uploaded_at: at,
                  selfie_uploaded_at: at,
                },
              } as unknown as FoundationOwnerDashboard;
              const route = summarizeVerification(
                verified ? "verified" : "incomplete",
                dashboardVerificationSteps(snapshot)
              ).accountVerificationStatus;
              expect(
                accountVerificationStatusFromCase(current, decision),
                JSON.stringify({ phone, locality, identityAccepted, pending, decision })
              ).toBe(route);
              compared += 1;
            }
    expect(compared).toBeGreaterThan(10);
  });
});

describe("readFoundationAccountVerificationStatus", () => {
  const apiWith = (...answers: Array<{ data: unknown; error: unknown }>) => {
    const rpc = vi.fn();
    for (const answer of answers) rpc.mockResolvedValueOnce(answer);
    return { api: { rpc } as unknown as FoundationAuthenticatedApi, rpc };
  };
  const identity = (decision: string | null, change: Record<string, unknown> = {}) => ({
    account_id: "00000000-0000-4000-8000-000000000001",
    case_id: caseId,
    case_version: 2,
    reason: decision ? "document_unreadable" : null,
    decision,
    identity_reviewed_at: null,
    id_document_uploaded_at: at,
    selfie_uploaded_at: at,
    ...change,
  });

  it("reads only the case when nothing was sent back", async () => {
    const { api, rpc } = apiWith({
      data: { ...base, verified: true, phone_verified: true, locality_confirmed: true },
      error: null,
    });
    await expect(readFoundationAccountVerificationStatus(api)).resolves.toBe("verified");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_my_verification_case", {}, { get: false });
  });

  it.each([
    ["rejected", "rejected"],
    ["needs_resubmission", "incomplete"],
  ] as const)("reads the decision of a returned case (%s)", async (decision, expected) => {
    const { api, rpc } = apiWith(
      { data: { ...base, return_reason: "document_unreadable" }, error: null },
      { data: identity(decision), error: null }
    );
    await expect(readFoundationAccountVerificationStatus(api)).resolves.toBe(expected);
    expect(rpc).toHaveBeenLastCalledWith("get_my_frontend_identity_state", {}, { get: false });
  });

  it.each([
    ["an unavailable case", [{ data: null, error: { code: "PGRST000" } }]],
    ["a malformed case", [{ data: { verified: "yes" }, error: null }]],
    [
      "an unavailable decision",
      [
        { data: { ...base, return_reason: "document_unreadable" }, error: null },
        { data: null, error: { code: "PGRST000" } },
      ],
    ],
    [
      "a decision for another case version",
      [
        { data: { ...base, return_reason: "document_unreadable" }, error: null },
        { data: identity("rejected", { case_version: 3 }), error: null },
      ],
    ],
  ] as const)("throws on %s", async (_name, answers) => {
    const { api } = apiWith(...answers);
    await expect(readFoundationAccountVerificationStatus(api)).rejects.toThrow();
  });
});
