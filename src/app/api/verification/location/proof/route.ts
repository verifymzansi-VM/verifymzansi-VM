/**
 * POST /api/verification/location/proof
 * Upload route for proof-of-address when GPS is denied or low confidence.
 */

import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { deleteFromR2, uploadKycDocument } from "@/lib/services/storage";
import { processKycArtifact } from "@/lib/services/kyc-engine";
import { logAuditEvent } from "@/lib/services/audit";
import { validateUploadedFile } from "@/lib/validations/verification";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("ProofUpload");
import { validateBufferIntegrity } from "@/lib/utils/file-validation";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { MAX_FILE_SIZE_BYTES } from "@/lib/constants/verification";
import { getProvinceNames } from "@/lib/constants/sa-provinces";
import { isStrictLocalDevelopmentRequest } from "@/lib/utils/local-dev";
import {
  buildPendingVerificationStep,
  buildVerificationSessionResumePatch,
} from "@/lib/services/verification-state";

export async function POST(request: NextRequest) {
  try {
    const allowDevFallback = isStrictLocalDevelopmentRequest(request);
    const hasStorageSecrets = Boolean(
      process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    );

    if (process.env.NODE_ENV === "production" && !hasStorageSecrets) {
      return NextResponse.json({ error: "Proof upload temporarily unavailable" }, { status: 503 });
    }

    // Auth check
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Feature flag check
    const gpsEnabled = await isFeatureEnabled("kyc_gps_location");
    if (!gpsEnabled) {
      return NextResponse.json(
        { error: "GPS location verification is not yet enabled" },
        { status: 404 }
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const province = formData.get("province") as string | null;
    const city = formData.get("city") as string | null;

    if (!file) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    if (!province || !city) {
      return NextResponse.json({ error: "Province and city are required" }, { status: 400 });
    }

    // Validate province
    const validProvinces = getProvinceNames();
    if (!validProvinces.includes(province)) {
      return NextResponse.json(
        { error: `Invalid province. Must be one of: ${validProvinces.join(", ")}` },
        { status: 400 }
      );
    }

    // Validate file (images + PDF allowed for proof of address)
    const fileValidation = validateUploadedFile(file, { allowPdf: true });
    if (!fileValidation.valid) {
      return NextResponse.json({ error: fileValidation.error }, { status: 400 });
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: "File size exceeds 5 MB limit" }, { status: 400 });
    }

    // Magic byte validation
    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const integrity = validateBufferIntegrity(fileBuffer, file.type);
    if (integrity.mismatch) {
      return NextResponse.json(
        {
          error: "File content does not match declared file type",
          detected: integrity.detectedMime,
          declared: file.type,
        },
        { status: 400 }
      );
    }

    const adminClient = createAdminClient();

    // Check seller profile exists
    const { data: profile } = await adminClient
      .from("seller_profiles")
      .select("id")
      .eq("user_id", user.id)
      .single();

    if (!profile) {
      return NextResponse.json({ error: "Seller profile not found" }, { status: 404 });
    }

    // Upload encrypted file to R2
    let uploadResult: { url: string; key: string };
    let uploadedToR2 = false;
    try {
      uploadResult = await uploadKycDocument(file, user.id, "proof_of_address");
      uploadedToR2 = true;
    } catch (uploadErr) {
      if (!allowDevFallback) {
        log.error("R2 upload failed", {
          error: uploadErr instanceof Error ? uploadErr.message : "unknown error",
        });
        return NextResponse.json({ error: "Failed to upload proof document" }, { status: 500 });
      }

      const devKey = `dev://kyc/proof_of_address/${user.id}/${Date.now()}.bin`;
      uploadResult = { url: devKey, key: devKey };
    }

    // Insert artifact record
    const { data: artifact, error: artifactErr } = await adminClient
      .from("kyc_artifacts")
      .insert({
        user_id: user.id,
        step_type: "location",
        artifact_kind: "proof_of_address",
        r2_key: uploadResult.key,
        content_type: file.type,
        file_size_bytes: file.size,
        status: "pending",
      })
      .select("id")
      .single();

    if (artifactErr || !artifact) {
      log.error("Failed to insert artifact", { error: artifactErr?.message ?? "unknown" });

      if (uploadedToR2) {
        try {
          const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
          await deleteFromR2(privateBucket, uploadResult.key);
        } catch (cleanupErr) {
          log.error("Failed to roll back orphaned proof artifact", {
            error: cleanupErr instanceof Error ? cleanupErr.message : "unknown error",
          });
        }
      }

      return NextResponse.json({ error: "Failed to record artifact" }, { status: 500 });
    }

    const { error: supersedeError } = await adminClient
      .from("kyc_artifacts")
      .update({ status: "rejected" })
      .eq("user_id", user.id)
      .eq("step_type", "location")
      .neq("id", artifact.id)
      .in("status", ["pending", "needs_resubmission"]);

    if (supersedeError) {
      log.warn("Failed to supersede prior proof-of-address artifacts", {
        error: supersedeError.message,
        userId: user.id,
      });
    }

    // Run risk engine (SHA-256 dedup, velocity checks)
    let riskScore = 0;
    let riskLevel: "low" | "medium" | "high" | "critical" = "low";

    try {
      const engineResult = await processKycArtifact({
        artifactId: artifact.id,
        userId: user.id,
        stepType: "location",
        fileBuffer,
        r2Key: uploadResult.key,
        adminClient,
      });

      riskScore = engineResult.riskScore;
      riskLevel = engineResult.riskLevel;

      // Patch artifact with SHA-256
      await adminClient
        .from("kyc_artifacts")
        .update({
          sha256: engineResult.sha256,
          provider_ref: engineResult.providerRef,
        })
        .eq("id", artifact.id);
    } catch (engineErr) {
      log.error("Risk engine error", {
        error: engineErr instanceof Error ? engineErr.message : "unknown error",
      });
      // Continue — don't block upload on engine failure
    }

    // Upsert verification step
    const { data: step, error: stepErr } = await adminClient
      .from("verification_steps")
      .upsert(
        buildPendingVerificationStep({
          user_id: user.id,
          step_type: "location",
          location_method: "proof_of_address",
          location_province: province,
          location_city: city,
          risk_score: riskScore,
          risk_level: riskLevel,
          auto_status: "needs_manual_review",
          submitted_at: new Date().toISOString(),
        }),
        { onConflict: "user_id,step_type" }
      )
      .select("id")
      .single();

    if (stepErr || !step) {
      log.error("Failed to upsert step", { error: stepErr?.message ?? "unknown" });
      return NextResponse.json({ error: "Failed to save verification step" }, { status: 500 });
    }

    // Update verification session
    await adminClient.from("verification_sessions").upsert(
      buildVerificationSessionResumePatch(user.id, {
        location_submitted_at: new Date().toISOString(),
      }),
      { onConflict: "user_id" }
    );

    // Update seller profile
    await adminClient
      .from("seller_profiles")
      .update({
        location_province: province,
        location_city: city,
      })
      .eq("user_id", user.id);

    await adminClient
      .from("seller_profiles")
      .update({ seller_verification_status: "pending_review" })
      .eq("user_id", user.id)
      .in("seller_verification_status", ["incomplete", "rejected"]);

    // Audit log
    await logAuditEvent({
      actorId: user.id,
      actorRole: "seller",
      action: "kyc_proof_uploaded",
      targetType: "verification_step",
      targetId: step.id,
      metadata: {
        artifact_id: artifact.id,
        province,
        city,
        file_size: file.size,
        content_type: file.type,
        risk_score: riskScore,
        risk_level: riskLevel,
      },
    });

    return NextResponse.json({
      success: true,
      artifactId: artifact.id,
      stepId: step.id,
      riskScore,
      riskLevel,
    });
  } catch (err) {
    log.error("Unexpected error", { error: err instanceof Error ? err.message : "unknown error" });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
