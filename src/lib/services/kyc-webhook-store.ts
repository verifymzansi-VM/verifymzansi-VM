type ProviderResultRow = {
  id: string;
  artifact_id: string;
  user_id: string;
  provider_status: string;
};

type VerificationArtifactRow = {
  step_type: string;
};

type VerificationStepRow = {
  id: string;
  status: string;
  risk_score: number | null;
};

type KycWebhookStoreClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string
      ) => {
        eq?: (
          column: string,
          value: string
        ) => {
          single: () => Promise<{ data: VerificationStepRow | null }>;
        };
        single: () => Promise<{
          data: ProviderResultRow | VerificationArtifactRow | VerificationStepRow | null;
          error?: { code?: string } | null;
        }>;
      };
    };
    update: (value: Record<string, unknown>) => {
      eq: (column: string, value: string) => Promise<{ error?: { message?: string } | null }>;
    };
  };
};

export async function findProviderResultByRef(
  adminClient: KycWebhookStoreClient,
  providerRef: string
): Promise<ProviderResultRow | null> {
  const { data, error } = await adminClient
    .from("kyc_provider_results")
    .select("id, artifact_id, user_id, provider_status")
    .eq("provider_ref", providerRef)
    .single();

  if (error || !data) {
    return null;
  }

  return data as ProviderResultRow;
}

export async function updateProviderResult(
  adminClient: KycWebhookStoreClient,
  providerResultId: string,
  updateData: Record<string, unknown>
): Promise<void> {
  await adminClient.from("kyc_provider_results").update(updateData).eq("id", providerResultId);
}

export async function getArtifactStepType(
  adminClient: KycWebhookStoreClient,
  artifactId: string
): Promise<string | null> {
  const { data } = await adminClient
    .from("kyc_artifacts")
    .select("step_type")
    .eq("id", artifactId)
    .single();

  return (data as VerificationArtifactRow | null)?.step_type ?? null;
}

export async function getVerificationStepForUserAndType(
  adminClient: KycWebhookStoreClient,
  userId: string,
  stepType: string
): Promise<VerificationStepRow | null> {
  const { data } = await adminClient
    .from("verification_steps")
    .select("id, status, risk_score")
    .eq("user_id", userId)
    .eq("step_type", stepType)
    .single();

  return (data as VerificationStepRow | null) ?? null;
}

export async function updateVerificationStepRiskDecision(
  adminClient: KycWebhookStoreClient,
  stepId: string,
  updateData: Record<string, unknown>
): Promise<void> {
  await adminClient.from("verification_steps").update(updateData).eq("id", stepId);
}
