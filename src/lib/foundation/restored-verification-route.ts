import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import {
  readFoundationOwnerDashboard,
  dashboardVerificationSteps,
  type FoundationOwnerDashboard,
} from "./owner-dashboard";
import { resolveRestoredLocality, LocalityInputError } from "./restored-locality";
import { summarizeVerification } from "../account/verification-summary";
import { createLogger } from "../utils/logger";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { enforceMutationRequest } from "../utils/mutation-guard";
import { REQUIRED_VERIFICATION_STEPS } from "../constants/verification";
const log = createLogger("RestoredVerification");
const location = z.strictObject({
  province: z.string().min(1).max(100),
  city: z.string().min(1).max(100),
});
const acknowledged = z.strictObject({
  status: z.literal("approved"),
  assurance: z.literal("self_declared"),
  province_id: z.string(),
  city_id: z.string(),
  reused: z.boolean().optional(),
});
class VerificationRefusal extends Error {
  override name = "VerificationRefusal";
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}
const uploadRows = z
  .array(
    z.strictObject({
      artifact_id: z.uuid(),
      case_id: z.uuid(),
      purpose: z.enum(["id_front", "selfie"]),
      submitted_at: z.iso.datetime({ offset: true }),
      expires_at: z.iso.datetime({ offset: true }),
    })
  )
  .max(2);
async function readFrontendVerificationUploads(api: FoundationAuthenticatedApi) {
  const result = await api.rpc("get_my_frontend_verification_uploads", {}, { get: false });
  if (result.error) throw new Error("Verification uploads unavailable");
  return uploadRows.parse(result.data);
}
function presentedVerification(
  value: FoundationOwnerDashboard,
  uploads: z.infer<typeof uploadRows> = []
) {
  const steps = dashboardVerificationSteps(value).map((step) => ({
    ...step,
    ...(step.step_type === "location"
      ? {
          location_province: value.profile_facts.location_province,
          location_city: value.profile_facts.location_city,
          location_method: "manual",
          metadata: { location_assurance: "self_declared" },
        }
      : {}),
    ...(["needs_resubmission", "rejected"].includes(step.status)
      ? { rejection_reason: value.verification.return_reason }
      : {}),
  }));
  if (!value.verification.verified && !value.verification.return_reason) {
    for (const upload of uploads) {
      const step_type = upload.purpose === "id_front" ? "id_doc" : "selfie";
      if (
        upload.case_id === value.verification.case_id &&
        !steps.some((step) => step.step_type === step_type)
      )
        steps.push({
          step_type,
          status: "pending",
          reviewed_at: null,
          submitted_at: upload.submitted_at,
          artifact_id: upload.artifact_id,
        } as (typeof steps)[number]);
    }
  }
  const summary = summarizeVerification(
    value.verification.verified ? "verified" : "incomplete",
    steps
  );
  return {
    accountVerificationStatus: summary.accountVerificationStatus,
    overallStatus: summary.accountVerificationStatus,
    steps,
  };
}
export function handleRestoredVerification(request: NextRequest, mutate = false) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: mutate ? "verification:manual-location" : "verification:status",
    mutate,
    unavailableMessage: "Verification is temporarily unavailable",
    signInMessage: "Sign in to manage verification",
    command: async (api, input) => {
      let pair: ReturnType<typeof resolveRestoredLocality> | undefined;
      if (mutate) {
        const parsed = location.safeParse(input);
        if (!parsed.success) throw new VerificationRefusal(400, "Select a province and city");
        pair = resolveRestoredLocality(parsed.data.province, parsed.data.city);
      }
      const account = await readFoundationAccountContext(api);
      if (pair) {
        const { data, error } = await api.rpc("confirm_verification_locality", pair, {
          get: false,
        });
        if (error) {
          if (error.code === "42501") throw new FoundationAccountContextError("forbidden");
          if (error.code === "PT409")
            throw new VerificationRefusal(
              403,
              "Your confirmed location requires a verification review before it can change"
            );
          if (error.code === "22023")
            throw new VerificationRefusal(400, "Select a valid province and city");
          throw new Error("Location confirmation unavailable");
        }
        const result = acknowledged.parse(data);
        if (result.province_id !== pair.p_province || result.city_id !== pair.p_city)
          throw new Error("Location response changed");
      }
      const snapshot = await readFoundationOwnerDashboard(api, account.account_id);
      const uploads = await readFrontendVerificationUploads(api);
      return { ...(mutate ? { success: true } : {}), ...presentedVerification(snapshot, uploads) };
    },
    refusal: (error) =>
      error instanceof VerificationRefusal
        ? { status: error.status, error: error.message, reason: "verification_refused" }
        : error instanceof LocalityInputError
          ? { status: 400, error: error.message, reason: "location_invalid" }
          : error instanceof FoundationAccountContextError && error.reason === "forbidden"
            ? {
                status: 403,
                error: "Account access is unavailable",
                reason: "account_access_unavailable",
              }
            : null,
  });
}
export function handleRestoredVerificationSession(request: NextRequest) {
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return Promise.resolve(blocked);
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "verification:session-start",
    mutate: false,
    unavailableMessage: "Verification is temporarily unavailable",
    signInMessage: "Sign in to manage verification",
    command: async (api) => {
      const account = await readFoundationAccountContext(api);
      const opened = await api.rpc("open_verification_case", {}, { get: false });
      if (opened.error) throw new Error("Verification case unavailable");
      const current = z
        .object({ case_id: z.uuid(), version: z.number().int().positive(), read_only: z.boolean() })
        .parse(opened.data);
      const snapshot = await readFoundationOwnerDashboard(api, account.account_id);
      const uploads = await readFrontendVerificationUploads(api);
      const presented = presentedVerification(snapshot, uploads);
      return {
        sessionId: current.case_id,
        requiredSteps: REQUIRED_VERIFICATION_STEPS,
        completedSteps: presented.steps
          .filter((s) => s.status === "approved")
          .map((s) => s.step_type),
        pendingSteps: presented.steps.filter((s) => s.status === "pending").map((s) => s.step_type),
        rejectedSteps: presented.steps
          .filter((s) => ["needs_resubmission", "rejected"].includes(s.status))
          .map((s) => s.step_type),
        expiresAt: uploads.map((u) => u.expires_at).sort()[0] ?? null,
        phoneVerifiedAt: snapshot.profile_facts.phone_verified_at,
        idArtifactId: uploads.find((u) => u.purpose === "id_front")?.artifact_id ?? null,
        selfieArtifactId: uploads.find((u) => u.purpose === "selfie")?.artifact_id ?? null,
        locationSubmittedAt: snapshot.profile_facts.location_confirmed_at,
        finalizedAt: snapshot.verification.verified
          ? snapshot.profile_facts.identity_reviewed_at
          : null,
      };
    },
    refusal: () => null,
  });
}
