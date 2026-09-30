type WorkflowRun = {
  head_sha?: string;
  head_branch?: string;
  event?: string;
  status?: string;
  conclusion?: string | null;
  head_repository?: { full_name?: string };
};

export async function requireSuccessfulDeploymentCi(
  repository: string,
  sha: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^[a-f0-9]{40}$/i.test(sha) || !token) {
    throw new Error("Repository, target commit and GitHub token are required for deployment CI");
  }
  const url = new URL(`https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs`);
  url.searchParams.set("head_sha", sha);
  url.searchParams.set("branch", "main");
  url.searchParams.set("event", "push");
  url.searchParams.set("per_page", "100");
  const response = await fetchImpl(url, {
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2026-03-10",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Deployment CI lookup failed (HTTP ${response.status})`);
  const body = (await response.json()) as { workflow_runs?: WorkflowRun[] };
  // Check the newest attempt, so a failed/cancelled rerun cannot be hidden by
  // an older green result for the same commit. GitHub returns newest runs first.
  const latest = body.workflow_runs?.find(
    (run) =>
      run.head_sha === sha &&
      run.head_branch === "main" &&
      run.event === "push" &&
      run.head_repository?.full_name === repository
  );
  if (latest?.status !== "completed" || latest.conclusion !== "success") {
    throw new Error("Deployment requires successful main-push CI for this exact commit");
  }
}
