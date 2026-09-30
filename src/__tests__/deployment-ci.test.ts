import { describe, expect, it, vi } from "vitest";
import { requireSuccessfulDeploymentCi } from "../../scripts/lib/deployment-ci";

const repository = "owner/platform";
const sha = "a".repeat(40);
const success = {
  head_sha: sha,
  head_branch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  head_repository: { full_name: repository },
};

describe("deployment CI enforcement", () => {
  it("accepts successful main-push CI for the exact commit", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ workflow_runs: [success] }));
    await expect(
      requireSuccessfulDeploymentCi(repository, sha, "fixture", fetchImpl)
    ).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.objectContaining({ hostname: "api.github.com" }),
      expect.objectContaining({ redirect: "error", signal: expect.any(AbortSignal) })
    );
  });

  it.each([
    [],
    [{ ...success, head_sha: "b".repeat(40) }],
    [{ ...success, head_branch: "feature" }],
    [{ ...success, event: "pull_request" }],
    [{ ...success, head_repository: { full_name: "other/platform" } }],
    [{ ...success, conclusion: "failure" }],
    [{ ...success, status: "in_progress", conclusion: null }],
    [{ ...success, conclusion: "cancelled" }, success],
  ])("rejects missing, unrelated or unsuccessful latest CI: %j", async (...runs) => {
    const fetchImpl = vi.fn().mockResolvedValue(Response.json({ workflow_runs: runs }));
    await expect(
      requireSuccessfulDeploymentCi(repository, sha, "fixture", fetchImpl)
    ).rejects.toThrow("successful main-push CI");
  });

  it("fails closed on GitHub API errors", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(
      requireSuccessfulDeploymentCi(repository, sha, "fixture", fetchImpl)
    ).rejects.toThrow("HTTP 403");
  });
});
