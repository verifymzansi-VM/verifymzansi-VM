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

  const { data: artifact } = await query
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return artifact?.id;
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
  // Independent lookups share one round-trip window instead of serial waits.
  const [idArtifactId, selfieArtifactId, locationArtifactId] = await Promise.all([
    getLatestArtifactId(adminClient, userId, "id_doc"),
    getLatestArtifactId(adminClient, userId, "selfie"),
    session?.location_submitted_at
      ? getLatestArtifactId(adminClient, userId, "location", "proof_of_address")
      : undefined,
  ]);

  if (session?.id_artifact_id) {
    allowedArtifactIds.add(session.id_artifact_id);
  }

  if (idArtifactId) allowedArtifactIds.add(idArtifactId);

  if (session?.selfie_artifact_id) {
    allowedArtifactIds.add(session.selfie_artifact_id);
  }

  if (selfieArtifactId) allowedArtifactIds.add(selfieArtifactId);
  if (locationArtifactId) allowedArtifactIds.add(locationArtifactId);

  return Array.from(allowedArtifactIds);
}
