import type {
  AccountVerificationStatus,
  VerificationStatus,
  VerificationStepType,
} from "@/types/enums";
import { normalizeAccountVerificationStatus } from "@/lib/account/compat";

type VerificationStepRecord = {
  step_type?: string | null;
  status?: string | null;
  reviewed_at?: string | null;
};

const REVIEWABLE_VERIFICATION_STEPS: VerificationStepType[] = [
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

function mergeStepStatus(
  current: VerificationStatus | undefined,
  next: VerificationStatus
): VerificationStatus {
  const priority: Record<VerificationStatus, number> = {
    rejected: 4,
    needs_resubmission: 3,
    pending: 2,
    approved: 1,
  };

  return !current || priority[next] > priority[current] ? next : current;
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

    stepMap.set(stepType, mergeStepStatus(stepMap.get(stepType), status));
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
  const adminReviewedIdentitySteps = ["id_doc", "selfie"].every((stepType) =>
    (steps ?? []).some(
      (step) =>
        step.step_type === stepType &&
        step.status === "approved" &&
        typeof step.reviewed_at === "string" &&
        step.reviewed_at.trim().length > 0
    )
  );

  let accountVerificationStatus: AccountVerificationStatus;

  if (normalizedProfileStatus === "rejected" || rejectedStepCount > 0) {
    // Only hard rejections set the overall status to "rejected"
    // needs_resubmission steps are treated as incomplete — the user can still fix and resubmit
    accountVerificationStatus = "rejected";
  } else if (needsResubmissionCount > 0) {
    // Actionable resubmission steps must win over stale profile state so users see the fix path.
    accountVerificationStatus = "incomplete";
  } else if (
    normalizedProfileStatus === "verified" ||
    (allStepsApproved && adminReviewedIdentitySteps)
  ) {
    accountVerificationStatus = "verified";
  } else if (allStepsSubmitted) {
    accountVerificationStatus = "pending_review";
  } else {
    accountVerificationStatus =
      normalizedProfileStatus === "pending_review"
        ? "incomplete"
        : (normalizedProfileStatus ?? "incomplete");
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
