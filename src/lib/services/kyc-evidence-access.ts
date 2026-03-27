import type { SupabaseClient } from "@supabase/supabase-js";

async function addLatestArtifactId(
  adminClient: SupabaseClient,
  allowedArtifactIds: Set<string>,
  userId: string,
  stepType: string,
  artifactKind?: string
): Promise<void> {
  let query = adminClient
    .from("kyc_artifacts")
    .select("id")
    .eq("user_id", userId)
    .eq("step_type", stepType);

  if (artifactKind) {
    query = query.eq("artifact_kind", artifactKind);
  }

  const { data: artifact } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (artifact?.id) {
    allowedArtifactIds.add(artifact.id);
  }
}

export async function getLinkedEvidenceArtifactIds(
  adminClient: SupabaseClient,
  userId: string
): Promise<string[]> {
  const { data: session } = await adminClient
    .from("verification_sessions")
    .select("id_artifact_id, selfie_artifact_id, location_submitted_at")
    .eq("user_id", userId)
    .maybeSingle();

  const allowedArtifactIds = new Set<string>();

  if (session?.id_artifact_id) {
    allowedArtifactIds.add(session.id_artifact_id);
  }

  await addLatestArtifactId(adminClient, allowedArtifactIds, userId, "id_doc");

  if (session?.selfie_artifact_id) {
    allowedArtifactIds.add(session.selfie_artifact_id);
  }

  await addLatestArtifactId(adminClient, allowedArtifactIds, userId, "selfie");

  if (session?.location_submitted_at) {
    await addLatestArtifactId(
      adminClient,
      allowedArtifactIds,
      userId,
      "location",
      "proof_of_address"
    );
  }

  return Array.from(allowedArtifactIds);
}
