type PendingVerificationStepFields = {
  user_id: string;
  step_type: string;
  status?: string;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  reason_code?: string | null;
  reason_note?: string | null;
  override_reason_code?: string | null;
  submitted_at?: string;
};

export function buildPendingVerificationStep<T extends PendingVerificationStepFields>(
  step: T
): T & {
  status: "pending";
  reviewed_by: null;
  reviewed_at: null;
  reason_code: null;
  reason_note: null;
  override_reason_code: null;
} & Record<string, unknown> {
  return {
    ...step,
    status: "pending",
    reviewed_by: null,
    reviewed_at: null,
    reason_code: null,
    reason_note: null,
    override_reason_code: null,
  };
}

export function buildVerificationSessionResumePatch<T extends Record<string, unknown>>(
  userId: string,
  patch: T
): T & { user_id: string; finalized_at: null } {
  // Spread patch first; trusted fields after to prevent caller override (#49)
  return {
    ...patch,
    user_id: userId,
    finalized_at: null,
  };
}
