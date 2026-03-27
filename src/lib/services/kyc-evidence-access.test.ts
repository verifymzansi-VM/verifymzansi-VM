import { describe, expect, it, vi } from "vitest";
import { getLinkedEvidenceArtifactIds } from "./kyc-evidence-access";

function createQueryBuilder(result: unknown) {
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: result, error: null }),
  };
}

describe("getLinkedEvidenceArtifactIds", () => {
  it("returns linked session artifacts when present", async () => {
    const sessionBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id_artifact_id: "id-linked",
          selfie_artifact_id: "selfie-linked",
          location_submitted_at: null,
        },
        error: null,
      }),
    };

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "verification_sessions") {
          return sessionBuilder;
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      }),
    };

    const result = await getLinkedEvidenceArtifactIds(adminClient as never, "user-1");

    expect(result).toEqual(["id-linked", "selfie-linked"]);
  });

  it("falls back to latest id and selfie artifacts when session links are missing", async () => {
    const sessionBuilder = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id_artifact_id: null,
          selfie_artifact_id: null,
          location_submitted_at: null,
        },
        error: null,
      }),
    };
    const idArtifactBuilder = createQueryBuilder({ id: "id-fallback" });
    const selfieArtifactBuilder = createQueryBuilder({ id: "selfie-fallback" });

    const adminClient = {
      from: vi.fn((table: string) => {
        if (table === "verification_sessions") {
          return sessionBuilder;
        }

        if (table === "kyc_artifacts") {
          if (
            adminClient.from.mock.calls.filter(([name]) => name === "kyc_artifacts").length === 1
          ) {
            return idArtifactBuilder;
          }
          return selfieArtifactBuilder;
        }

        throw new Error(`Unexpected table lookup: ${table}`);
      }),
    };

    const result = await getLinkedEvidenceArtifactIds(adminClient as never, "user-1");

    expect(result).toEqual(["id-fallback", "selfie-fallback"]);
    expect(idArtifactBuilder.eq).toHaveBeenCalledWith("step_type", "id_doc");
    expect(selfieArtifactBuilder.eq).toHaveBeenCalledWith("step_type", "selfie");
  });
});
