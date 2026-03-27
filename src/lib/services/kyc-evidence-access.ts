import type { SupabaseClient } from "@supabase/supabase-js";

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
  } else {
    const { data: idArtifact } = await adminClient
      .from("kyc_artifacts")
      .select("id")
      .eq("user_id", userId)
      .eq("step_type", "id_doc")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (idArtifact?.id) {
      allowedArtifactIds.add(idArtifact.id);
    }
  }
  if (session?.selfie_artifact_id) {
    allowedArtifactIds.add(session.selfie_artifact_id);
  } else {
    const { data: selfieArtifact } = await adminClient
      .from("kyc_artifacts")
      .select("id")
      .eq("user_id", userId)
      .eq("step_type", "selfie")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (selfieArtifact?.id) {
      allowedArtifactIds.add(selfieArtifact.id);
    }
  }

  if (session?.location_submitted_at) {
    const { data: locationArtifacts } = await adminClient
      .from("kyc_artifacts")
      .select("id")
      .eq("user_id", userId)
      .eq("step_type", "location")
      .eq("artifact_kind", "proof_of_address")
      .order("created_at", { ascending: false })
      .limit(1);

    const latestLocationArtifactId = Array.isArray(locationArtifacts)
      ? locationArtifacts[0]?.id
      : undefined;
    if (latestLocationArtifactId) {
      allowedArtifactIds.add(latestLocationArtifactId);
    }
  }

  return Array.from(allowedArtifactIds);
}
