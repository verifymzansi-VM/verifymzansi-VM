import type {
  AccountVerificationStatus,
  VerificationStatus,
  VerificationStepType,
} from "@/types/enums";
import { normalizeAccountVerificationStatus } from "@/lib/account/compat";

type VerificationStepRecord = {
  step_type?: string | null;
  status?: string | null;
};

export const REVIEWABLE_VERIFICATION_STEPS: VerificationStepType[] = [
  "phone",
  "id_doc",
  "selfie",
  "location",
];

function normalizeStepStatus(status: string | null | undefined): VerificationStatus | null {
  switch (status) {
    case "approved":
    case "pending":
    case "rejected":
    case "needs_resubmission":
      return status;
    default:
      return null;
  }
}

function normalizeStepType(stepType: string | null | undefined): VerificationStepType | null {
  switch (stepType) {
    case "phone":
    case "id_doc":
    case "selfie":
    case "location":
      return stepType;
    default:
      return null;
  }
}

export interface VerificationSummary {
  accountVerificationStatus: AccountVerificationStatus;
  stepsRemaining: number;
  approvedStepCount: number;
  submittedStepCount: number;
  rejectedStepCount: number;
  needsResubmissionCount: number;
  allStepsApproved: boolean;
  allStepsSubmitted: boolean;
}

export function summarizeVerification(
  profileStatus: string | null | undefined,
  steps: VerificationStepRecord[] | null | undefined
): VerificationSummary {
  const normalizedProfileStatus = normalizeAccountVerificationStatus(profileStatus);
  const stepMap = new Map<VerificationStepType, VerificationStatus>();

  for (const step of steps ?? []) {
    const stepType = normalizeStepType(step.step_type);
    const status = normalizeStepStatus(step.status);

    if (!stepType || !status) {
      continue;
    }

    stepMap.set(stepType, status);
  }

  let approvedStepCount = 0;
  let submittedStepCount = 0;
  let rejectedStepCount = 0;
  let needsResubmissionCount = 0;

  for (const stepType of REVIEWABLE_VERIFICATION_STEPS) {
    const status = stepMap.get(stepType);

    if (status === "approved") {
      approvedStepCount += 1;
      submittedStepCount += 1;
      continue;
    }

    if (status === "pending") {
      submittedStepCount += 1;
      continue;
    }

    if (status === "rejected") {
      rejectedStepCount += 1;
    } else if (status === "needs_resubmission") {
      needsResubmissionCount += 1;
    }
  }

  const allStepsApproved = approvedStepCount === REVIEWABLE_VERIFICATION_STEPS.length;
  const allStepsSubmitted = submittedStepCount === REVIEWABLE_VERIFICATION_STEPS.length;

  let accountVerificationStatus: AccountVerificationStatus;

  if (normalizedProfileStatus === "verified" || allStepsApproved) {
    accountVerificationStatus = "verified";
  } else if (normalizedProfileStatus === "rejected" || rejectedStepCount > 0) {
    // Only hard rejections set the overall status to "rejected"
    // needs_resubmission steps are treated as incomplete — the user can still fix and resubmit
    accountVerificationStatus = "rejected";
  } else if (normalizedProfileStatus === "pending_review" || allStepsSubmitted) {
    accountVerificationStatus = "pending_review";
  } else if (needsResubmissionCount > 0) {
    // Steps need resubmission — treat as incomplete so the user sees actionable UI
    accountVerificationStatus = "incomplete";
  } else {
    accountVerificationStatus = normalizedProfileStatus ?? "incomplete";
  }

  return {
    accountVerificationStatus,
    stepsRemaining: REVIEWABLE_VERIFICATION_STEPS.length - submittedStepCount,
    approvedStepCount,
    submittedStepCount,
    rejectedStepCount,
    needsResubmissionCount,
    allStepsApproved,
    allStepsSubmitted,
  };
}
