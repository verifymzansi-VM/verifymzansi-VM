import type { SupabaseClient } from "@supabase/supabase-js";

async function getLatestArtifactId(
  adminClient: SupabaseClient,
  userId: string,
  stepType: string,
  artifactKind?: string
): Promise<string | undefined> {
  let query = adminClient
    .from("kyc_artifacts")
    .select("id")
    .eq("user_id", userId)
    .eq("step_type", stepType);

  if (artifactKind) {
    query = query.eq("artifact_kind", artifactKind);
  }

  const { data: artifact, error } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error("Evidence linkage lookup failed");
  return artifact?.id;
}

export async function getLinkedEvidenceArtifactIds(
  adminClient: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data: session, error: sessionError } = await adminClient
    .from("verification_sessions")
    .select("id_artifact_id, selfie_artifact_id, location_submitted_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (sessionError) throw new Error("Evidence session lookup failed");
  if (!session) return [];
  const allowedArtifactIds = new Set<string>();
  // ID/selfie authority is the committed session link, never upload history.
  // Location has no artifact FK; retain its existing committed-submission representation.
  const locationArtifactId = session.location_submitted_at
    ? await getLatestArtifactId(adminClient, userId, "location", "proof_of_address")
    : undefined;

  if (session?.id_artifact_id) {
    allowedArtifactIds.add(session.id_artifact_id);
  }

  if (session?.selfie_artifact_id) {
    allowedArtifactIds.add(session.selfie_artifact_id);
  }

  if (locationArtifactId) allowedArtifactIds.add(locationArtifactId);

  return Array.from(allowedArtifactIds);
}
