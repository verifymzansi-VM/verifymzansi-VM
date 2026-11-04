import { fetchStaffEvidence } from "./staff-evidence-fetch";
import { withCsrfHeaders } from "../utils/csrf";

/** The selected source workflow may replace a stale artifact once. Native
 * evidence remains subject to the returned scope and actor checks. */
export async function fetchLatestKycArtifact<T extends { step_type: string; created_at: string }>(
  userId: string,
  stepType: string,
  signal: AbortSignal
): Promise<T | undefined> {
  const response = await fetchStaffEvidence("/api/admin/verification/evidence/metadata", {
    method: "POST",
    signal,
    headers: withCsrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ userId }),
  });
  if (!response.ok) return;
  const metadata = await response.json();
  if (!Array.isArray(metadata.artifacts)) return;
  return (metadata.artifacts as T[])
    .filter((a) => a.step_type === stepType)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
}
