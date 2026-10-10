import { describe, expect, it, vi } from "vitest";
import { getLinkedEvidenceArtifactIds } from "./kyc-evidence-access";
const query = (data: unknown, error: unknown = null) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  maybeSingle: vi.fn().mockResolvedValue({ data, error }),
});
describe("committed evidence links", () => {
  it("uses committed ID/selfie references without adding upload-history candidates", async () => {
    const from = vi.fn(() =>
      query({
        id_artifact_id: "id-linked",
        selfie_artifact_id: "selfie-linked",
        location_submitted_at: null,
      })
    );
    expect(await getLinkedEvidenceArtifactIds({ from } as never, "user-1")).toEqual([
      "id-linked",
      "selfie-linked",
    ]);
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith("verification_sessions");
  });
  it.each([null, { id_artifact_id: null, selfie_artifact_id: null, location_submitted_at: null }])(
    "does not substitute old files for missing/revoked links %s",
    async (session) => {
      const from = vi.fn(() => query(session));
      expect(await getLinkedEvidenceArtifactIds({ from } as never, "user-1")).toEqual([]);
      expect(from).toHaveBeenCalledTimes(1);
    }
  );
  it("fails closed when the authoritative session cannot be read", async () => {
    await expect(
      getLinkedEvidenceArtifactIds(
        { from: () => query(null, { message: "offline" }) } as never,
        "user-1"
      )
    ).rejects.toThrow("Evidence session lookup failed");
  });
  it("keeps the existing committed proof-of-address representation scoped to its owner and kind", async () => {
    const artifact = query({ id: "proof" });
    const from = vi.fn((table) =>
      table === "verification_sessions"
        ? query({ id_artifact_id: "id", location_submitted_at: "2026-10-01" })
        : artifact
    );
    expect(await getLinkedEvidenceArtifactIds({ from } as never, "user-1")).toEqual([
      "id",
      "proof",
    ]);
    expect(artifact.eq).toHaveBeenCalledWith("user_id", "user-1");
    expect(artifact.eq).toHaveBeenCalledWith("step_type", "location");
    expect(artifact.eq).toHaveBeenCalledWith("artifact_kind", "proof_of_address");
  });
  it("rejects an unreadable location lookup rather than treating it as missing", async () => {
    const from = vi.fn((table) =>
      table === "verification_sessions"
        ? query({ location_submitted_at: "2026-10-01" })
        : query(null, { message: "offline" })
    );
    await expect(getLinkedEvidenceArtifactIds({ from } as never, "user-1")).rejects.toThrow(
      "Evidence linkage lookup failed"
    );
  });
  it("deduplicates references retained across review resubmission", async () => {
    expect(
      await getLinkedEvidenceArtifactIds(
        {
          from: () => query({ id_artifact_id: "retained", selfie_artifact_id: "retained" }),
        } as never,
        "user-1"
      )
    ).toEqual(["retained"]);
  });
});
