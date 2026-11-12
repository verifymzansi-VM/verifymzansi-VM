import "server-only";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { handleFoundationOwnerRoute } from "./owner-route";
import {
  settleStaffCommand,
  staffCommandRefusal,
  FoundationStaffCommandError,
} from "./staff-command";
import { readFoundationReviewContext, FoundationVerificationError } from "./verification-runtime";
import { createFoundationServiceApi } from "./service-api";
import { foundationEvidenceMetadataSchema } from "./evidence-metadata";
import { nativeIdentityScopeSchema } from "../admin/native-identity-review";
import { createLogger } from "../utils/logger";
import { frontendIdentityContextSchema } from "./identity-review-contract";
import { foundationSelfieCaptureSchema, selfieCaptureSignals } from "./selfie-capture";
const log = createLogger("NativeIdentityMetadata");
const requestBody = z
  .strictObject({ stepId: z.uuid().optional(), userId: z.uuid().optional() })
  .refine((v) => Boolean(v.stepId || v.userId));
export function handleRestoredIdentityMetadata(request: NextRequest) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "admin:evidence:metadata",
    mutate: true,
    signInMessage: "Sign in to review evidence",
    unavailableMessage: "Evidence metadata is unavailable. Reload the queue before continuing.",
    responseHeaders: (data: { account_id: string }) => ({
      "X-VerifyMzansi-Actor": data.account_id,
    }),
    refusal: (error) =>
      error instanceof FoundationVerificationError
        ? { status: error.status, error: error.message, reason: "identity_context_changed" }
        : staffCommandRefusal(error),
    command: async (api, input) => {
      const query = requestBody.parse(input);
      const resolved = await settleStaffCommand(
        api.rpc(
          "get_frontend_staff_identity_context",
          {
            ...(query.userId ? { p_owner: query.userId } : {}),
            ...(query.stepId ? { p_artifact: query.stepId } : {}),
          },
          { get: false }
        ),
        frontendIdentityContextSchema
      );
      if (
        (query.userId && query.userId !== resolved.owner_id) ||
        (query.stepId &&
          ![resolved.id_artifact_id, resolved.selfie_artifact_id].includes(query.stepId))
      )
        throw new FoundationStaffCommandError(
          409,
          "The identity submission changed. Reload the queue."
        );
      const fence = {
        case_id: resolved.case_id,
        claim_generation: resolved.claim_generation,
        claim_nonce: resolved.claim_nonce,
        expected_case_version: resolved.case_version,
        expected_submission_id: resolved.submission_id,
      };
      const context = await readFoundationReviewContext(api, createFoundationServiceApi(), fence);
      const metadata = await settleStaffCommand(
        api.rpc(
          "staff_evidence_metadata",
          {
            p_case_id: fence.case_id,
            p_claim_generation: fence.claim_generation,
            p_claim_nonce: fence.claim_nonce,
            p_purpose: "routine_review",
          },
          { get: false }
        ),
        foundationEvidenceMetadataSchema
      );
      if (metadata.case_id !== resolved.case_id || metadata.version !== context.case_version)
        throw new FoundationStaffCommandError(409, "The evidence changed. Reload the queue.");
      // How the member's browser says the selfie was taken (review context,
      // not proof), for the viewer's existing liveness signals.
      const capture = await settleStaffCommand(
        api.rpc(
          "get_frontend_staff_selfie_capture",
          {
            p_case_id: fence.case_id,
            p_claim_generation: fence.claim_generation,
            p_claim_nonce: fence.claim_nonce,
          },
          { get: false }
        ),
        foundationSelfieCaptureSchema
      );
      if (
        capture.case_id !== context.case_id ||
        capture.case_version !== context.case_version ||
        capture.submission_id !== context.submission_id ||
        capture.selfie_artifact_id !== context.selfie_artifact_id
      )
        throw new FoundationStaffCommandError(409, "The evidence changed. Reload the queue.");
      const foundation = nativeIdentityScopeSchema.parse({
        caseId: context.case_id,
        caseVersion: context.case_version,
        submissionId: context.submission_id,
        claimGeneration: fence.claim_generation,
        claimNonce: fence.claim_nonce,
      });
      const label = `${context.claimed_names.first_name} ${context.claimed_names.last_name} · ID ${context.claimed_number}`;
      const artifacts = [context.id_artifact_id, context.selfie_artifact_id].map((id) => {
        const info = metadata.artifacts.find((a) => a.artifact_id === id);
        if (!info || info.purpose !== (id === context.id_artifact_id ? "id_front" : "selfie"))
          throw new FoundationStaffCommandError(
            503,
            "The evidence context could not be confirmed."
          );
        return {
          id,
          step_type: info.purpose === "id_front" ? "id_doc" : "selfie",
          artifact_kind: info.purpose,
          r2_key: null,
          content_type: "application/octet-stream",
          file_size_bytes: null,
          status: "clean",
          created_at: info.uploaded_at,
          purge_after: null,
          sha256: null,
          foundation,
          review_subject_label: label,
          review_risk_score: context.risk_score,
          review_risk_level: context.risk_score > 50 ? ("high" as const) : ("low" as const),
        };
      });
      return {
        account_id: resolved.reviewer_id,
        foundation,
        review_subject_label: label,
        artifacts,
        providerResults: [],
        riskSignals: [
          {
            id: context.submission_id,
            user_id: resolved.owner_id,
            artifact_id: null,
            signal_code: "manual_review_only",
            severity: "info",
            value_json: { recipe: context.recipe, risk_score: context.risk_score },
            created_at: artifacts[0].created_at,
          },
          ...selfieCaptureSignals(capture, resolved.owner_id, artifacts[1].created_at),
        ],
        accessLog: resolved.access_log,
        accountProfile: resolved.owner_profile
          ? {
              ...resolved.owner_profile,
              display_name:
                resolved.owner_profile.display_name ??
                `${context.claimed_names.first_name} ${context.claimed_names.last_name}`,
            }
          : null,
        sellerProfile: null,
        steps: artifacts.map((a) => ({
          id: a.id,
          user_id: resolved.owner_id,
          claim_case_id: foundation.caseId,
          step_type: a.step_type,
          status: "pending",
          risk_level: context.risk_score > 50 ? "high" : "low",
          risk_score: context.risk_score,
          auto_status: "manual_review",
          reason_code: null,
          reviewed_by: null,
          reviewed_at: null,
          created_at: a.created_at,
          updated_at: a.created_at,
          metadata: { submitted_id_number: context.claimed_number },
          first_name: context.claimed_names.first_name,
          last_name: context.claimed_names.last_name,
          foundation,
          review_subject_label: label,
          location_method: null,
          location_province: null,
          location_city: null,
          location_address_line: null,
          gps_lat: null,
          gps_lon: null,
        })),
      };
    },
  });
}
