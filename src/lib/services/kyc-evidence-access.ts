interface VerificationSessionRecord {
  id_artifact_id: string | null;
  selfie_artifact_id: string | null;
  location_submitted_at: string | null;
}

interface VerificationSessionQuery {
  eq(
    column: string,
    value: string
  ): {
    single(): Promise<{ data: VerificationSessionRecord | null }>;
  };
}

interface LocationArtifactRecord {
  id: string;
}

interface LocationArtifactQuery {
  eq(column: string, value: string): LocationArtifactQuery;
  order(
    column: string,
    options: { ascending: boolean }
  ): {
    limit(count: number): Promise<{ data: LocationArtifactRecord[] | null }>;
  };
}

interface AdminClientLike {
  from(table: "verification_sessions"): {
    select(columns: string): VerificationSessionQuery;
  };
  from(table: "kyc_artifacts"): {
    select(columns: string): LocationArtifactQuery;
  };
}

export async function getLinkedEvidenceArtifactIds(
  adminClient: AdminClientLike,
  userId: string
): Promise<string[]> {
  const { data: session } = await adminClient
    .from("verification_sessions")
    .select("id_artifact_id, selfie_artifact_id, location_submitted_at")
    .eq("user_id", userId)
    .single();

  const allowedArtifactIds = new Set<string>();

  if (session?.id_artifact_id) {
    allowedArtifactIds.add(session.id_artifact_id);
  }
  if (session?.selfie_artifact_id) {
    allowedArtifactIds.add(session.selfie_artifact_id);
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
