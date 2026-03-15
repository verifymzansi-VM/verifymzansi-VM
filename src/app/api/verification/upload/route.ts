import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadKycDocument, deleteFromR2 } from "@/lib/services/storage";
import { logAuditEvent } from "@/lib/services/audit";
import { fileUploadSchema, validateUploadedFile } from "@/lib/validations/verification";
import { processKycArtifact } from "@/lib/services/kyc-engine";
import { createLogger } from "@/lib/utils/logger";
import { isStrictLocalDevelopmentRequest } from "@/lib/utils/local-dev";
import {
  buildPendingVerificationStep,
  buildVerificationSessionResumePatch,
} from "@/lib/services/verification-state";
import crypto from "crypto";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";

const log = createLogger("VerificationUpload");

function getDefaultDisplayName(user: { email?: string | null; user_metadata?: unknown }): string {
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const displayName = metadata.display_name;
  const fullName = metadata.full_name;

  if (typeof displayName === "string" && displayName.trim().length > 0) {
    return displayName.trim();
  }

  if (typeof fullName === "string" && fullName.trim().length > 0) {
    return fullName.trim();
  }

  if (user.email) {
    return user.email.split("@")[0] || "New Member";
  }

  return "New Member";
}

/**
 * POST /api/verification/upload
 *
 * Upload a KYC document (ID document, selfie, or proof of address).
 * Files are encrypted before storage for POPIA compliance.
 *
 * Accepts multipart/form-data with:
 * - file: the document file (image or PDF, max 5MB)
 * - docType: "id_document" | "selfie" | "proof_of_address"
 * - idNumber: (optional) SA ID number for id_document step
 * - idDocumentType: (optional) "sa_id"
 */
export async function POST(request: NextRequest) {
  try {
    const allowDevFallback = isStrictLocalDevelopmentRequest(request);
    const hasStorageSecrets = Boolean(
      process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY
    );

    if (process.env.NODE_ENV === "production" && !hasStorageSecrets) {
      log.error("R2 storage secrets are missing in production", {
        hasAccountId: Boolean(process.env.R2_ACCOUNT_ID),
        hasAccessKey: Boolean(process.env.R2_ACCESS_KEY_ID),
        hasSecretKey: Boolean(process.env.R2_SECRET_ACCESS_KEY),
        nodeEnv: process.env.NODE_ENV,
      });
      return NextResponse.json(
        { error: "Document upload temporarily unavailable", code: "storage_unavailable" },
        { status: 503 }
      );
    }

    // ── Validate encryption keys upfront ─────────────────────
    const kycKey = process.env.KYC_ENCRYPTION_KEY;
    if (!kycKey || kycKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(kycKey)) {
      log.error("KYC_ENCRYPTION_KEY is missing or malformed", {
        present: Boolean(kycKey),
        length: kycKey?.length,
      });
      if (!allowDevFallback) {
        return NextResponse.json(
          {
            error: "Document encryption is not configured. Please contact support.",
            code: "config_missing",
          },
          { status: 503 }
        );
      }
    }
    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // ── Parse multipart form ─────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return NextResponse.json(
        { error: "Invalid form data. Send multipart/form-data." },
        { status: 400 }
      );
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File) || file.size === 0) {
      return NextResponse.json({ error: "File is required" }, { status: 400 });
    }

    // ── Validate metadata fields ─────────────────────────────
    const metaParsed = fileUploadSchema.safeParse({
      docType: formData.get("docType"),
      idNumber: formData.get("idNumber") || undefined,
      idDocumentType: formData.get("idDocumentType") || undefined,
    });

    if (!metaParsed.success) {
      return NextResponse.json({ error: metaParsed.error.issues[0].message }, { status: 400 });
    }

    const { docType, idNumber } = metaParsed.data;

    // ── Validate file type and size ──────────────────────────
    const allowPdf = docType === "id_document" || docType === "proof_of_address";
    const fileValidation = validateUploadedFile(
      { size: file.size, type: file.type, name: file.name },
      { allowPdf }
    );

    if (!fileValidation.valid) {
      return NextResponse.json({ error: fileValidation.error }, { status: 400 });
    }

    // ── Get account profile ──────────────────────────────────
    const admin = createAdminClient();
    let { data: profile } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      const { data: createdProfile, error: createProfileError } = await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .upsert(
          {
            user_id: user.id,
            display_name: getDefaultDisplayName(user),
          },
          { onConflict: "user_id" }
        )
        .select("id")
        .single();

      if (createProfileError || !createdProfile) {
        log.error("Failed to auto-create account profile", {
          error: createProfileError?.message,
        });
        return NextResponse.json(
          { error: "Failed to initialize account profile. Please try again." },
          { status: 500 }
        );
      }

      profile = createdProfile;
    }

    // ── Map docType → verification step_type / artifact_kind ─
    const stepTypeMap: Record<string, string> = {
      id_document: "id_doc",
      selfie: "selfie",
      proof_of_address: "location",
    };
    const artifactKindMap: Record<string, string> = {
      id_document: "document",
      selfie: "selfie",
      proof_of_address: "proof_of_address",
    };
    const stepType = stepTypeMap[docType];
    const artifactKind = artifactKindMap[docType];

    // ── Guard: prevent re-uploading over already-approved steps ──
    const { data: existingStep } = await admin
      .from("verification_steps")
      .select("status")
      .eq("user_id", user.id)
      .eq("step_type", stepType)
      .maybeSingle();

    if (existingStep?.status === "approved") {
      return NextResponse.json(
        {
          error: "This verification step has already been approved.",
          code: "step_already_approved",
        },
        { status: 409 }
      );
    }

    // ── Read file bytes once for SHA-256 and upload ───────────
    const fileBuffer = Buffer.from(await file.arrayBuffer());

    // ── Upload encrypted file to R2 (or local dev fallback) ──
    let uploadResult: { url: string; key: string };
    let uploadedToR2 = false;

    try {
      // Re-wrap buffer as Blob to satisfy uploadKycDocument signature
      const fileBlob = new Blob([fileBuffer], { type: file.type });
      uploadResult = await uploadKycDocument(fileBlob, profile.id, docType);
      uploadedToR2 = true;
    } catch (storageError) {
      const errMsg = storageError instanceof Error ? storageError.message : "Unknown storage error";
      const errStack = storageError instanceof Error ? storageError.stack : undefined;
      const isEncryptionError =
        errMsg.includes("KYC_ENCRYPTION_KEY") || errMsg.includes("encryption");
      const isCredentialError =
        errMsg.includes("R2 credentials") ||
        errMsg.includes("AccessDenied") ||
        errMsg.includes("InvalidAccessKeyId");

      log.error("Failed to upload KYC document to storage", {
        error: errMsg,
        stack: errStack,
        category: isEncryptionError ? "encryption" : isCredentialError ? "credentials" : "storage",
      });

      if (!allowDevFallback) {
        const userMessage = isEncryptionError
          ? "Document encryption failed. Please contact support."
          : "Failed to upload document. Please try again in a moment.";
        const code = isEncryptionError ? "encryption_failed" : "storage_failed";
        return NextResponse.json({ error: userMessage, code }, { status: 500 });
      }

      // Local dev fallback when R2 is not configured/reachable.
      const devKey = `dev/kyc/${docType}/${profile.id}/${Date.now()}-local.bin`;
      uploadResult = {
        url: `dev://${devKey}`,
        key: devKey,
      };
      log.warn("Using local dev upload fallback (no R2 write)", { key: devKey });
    }

    // ── Record artifact in database ──────────────────────────
    const { data: artifact, error: artifactError } = await admin
      .from("kyc_artifacts")
      .insert({
        user_id: user.id,
        step_type: stepType,
        artifact_kind: artifactKind,
        r2_key: uploadResult.key,
        content_type: file.type,
        file_size_bytes: file.size,
        status: "pending",
      })
      .select("id")
      .single();

    if (artifactError || !artifact) {
      log.error("Failed to record artifact", { error: artifactError });

      // Rollback orphaned R2 file only if upload reached R2.
      if (uploadedToR2) {
        try {
          const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
          await deleteFromR2(privateBucket, uploadResult.key);
        } catch (cleanupError) {
          log.error("CRITICAL: Failed to clean up orphaned R2 file:", { error: cleanupError });
        }
      }

      return NextResponse.json(
        { error: "Failed to record upload", code: "artifact_record_failed" },
        { status: 500 }
      );
    }

    const { error: supersedeError } = await admin
      .from("kyc_artifacts")
      .update({ status: "rejected" })
      .eq("user_id", user.id)
      .eq("step_type", stepType)
      .neq("id", artifact.id)
      .in("status", ["pending", "needs_resubmission"]);

    if (supersedeError) {
      log.warn("Failed to supersede prior KYC artifacts", {
        error: supersedeError.message,
        userId: user.id,
        stepType,
      });
    }

    // ── Risk engine: SHA-256, velocity, ID reuse, provider ───
    const engineResult = await processKycArtifact({
      artifactId: artifact.id,
      userId: user.id,
      stepType,
      fileBuffer,
      r2Key: uploadResult.key,
      idNumber,
      adminClient: admin,
    });

    // ── Patch artifact with sha256 and provider_ref ───────────
    await admin
      .from("kyc_artifacts")
      .update({
        sha256: engineResult.sha256,
        provider_ref: engineResult.providerRef ?? null,
      })
      .eq("id", artifact.id);

    // ── Build verification step data ──────────────────────────
    const stepData = buildPendingVerificationStep({
      user_id: user.id,
      step_type: stepType,
      auto_status: engineResult.autoStatus,
      risk_score: engineResult.riskScore,
      risk_level: engineResult.riskLevel,
      submitted_at: new Date().toISOString(),
    });

    if (docType === "id_document" && idNumber) {
      // Encrypt ID number with AES-256-GCM before storage
      const encKey = process.env.ID_ENCRYPTION_KEY; // 32-byte hex key
      if (!encKey) {
        log.error("ID_ENCRYPTION_KEY not set");
        return NextResponse.json(
          { error: "Server configuration error", code: "config_missing" },
          { status: 500 }
        );
      }
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", Buffer.from(encKey, "hex"), iv);
      let encrypted = cipher.update(idNumber, "utf8", "hex");
      encrypted += cipher.final("hex");
      const tag = cipher.getAuthTag().toString("hex");

      stepData.id_number_encrypted = encrypted;
      stepData.id_number_iv = iv.toString("hex");
      stepData.id_number_tag = tag;
      stepData.document_type = "sa_id_card";

      if (engineResult.idNumberHmac) {
        stepData.id_number_hmac = engineResult.idNumberHmac;
      }
    }

    const { error: stepError } = await admin
      .from("verification_steps")
      .upsert(stepData, { onConflict: "user_id,step_type" });

    if (stepError) {
      log.error("Failed to update verification step", { error: stepError });
      // Don't return error — artifact was saved, step can be retried
    }

    // ── Update verification_sessions ──────────────────────────
    const sessionPatch: Record<string, unknown> = {};
    if (docType === "id_document") {
      sessionPatch.id_artifact_id = artifact.id;
    } else if (docType === "selfie") {
      sessionPatch.selfie_artifact_id = artifact.id;
    }

    await admin
      .from("verification_sessions")
      .upsert(buildVerificationSessionResumePatch(user.id, sessionPatch), {
        onConflict: "user_id",
      });

    // ── Finalize session when all artifacts are present ───────
    const { data: currentSession } = await admin
      .from("verification_sessions")
      .select("id_artifact_id, selfie_artifact_id, location_submitted_at, finalized_at")
      .eq("user_id", user.id)
      .single();

    if (
      currentSession &&
      !currentSession.finalized_at &&
      currentSession.id_artifact_id &&
      currentSession.selfie_artifact_id &&
      currentSession.location_submitted_at
    ) {
      await admin
        .from("verification_sessions")
        .update({ finalized_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("finalized_at", null); // CAS guard: prevent double finalization
    }

    // ── Update account verification status to pending_review ─
    const { data: statusUpdated } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .update({
        account_verification_status: "pending_review",
      })
      .eq("id", profile.id)
      .in("account_verification_status", ["incomplete", "rejected"])
      .select("id");

    if (statusUpdated?.length) {
      log.info("Account verification status promoted to pending_review", {
        profileId: profile.id,
      });
    }

    // ── Audit log ────────────────────────────────────────────
    await logAuditEvent({
      actorId: user.id,
      actorRole: "member",
      action: "verification_submitted",
      targetType: "kyc_artifact",
      targetId: artifact.id,
      metadata: {
        docType,
        stepType,
        fileSize: file.size,
        contentType: file.type,
        riskLevel: engineResult.riskLevel,
        riskScore: engineResult.riskScore,
      },
    });

    return NextResponse.json({
      success: true,
      artifactId: artifact.id,
      stepType,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;

    // Categorize the error for structured logging and client error codes
    const isR2Error =
      message.includes("R2") ||
      message.includes("S3") ||
      message.includes("PutObject") ||
      message.includes("AccessDenied") ||
      message.includes("InvalidAccessKeyId") ||
      message.includes("SignatureDoesNotMatch");
    const isEncryptionError =
      message.includes("encryption") || message.includes("KYC_ENCRYPTION_KEY");
    const isConfigError =
      message.includes("not configured") ||
      message.includes("HMAC_SECRET") ||
      message.includes("ID_ENCRYPTION_KEY");

    const errorCategory = isR2Error
      ? "r2_storage"
      : isEncryptionError
        ? "encryption"
        : isConfigError
          ? "config"
          : "unknown";

    log.error("Unexpected error in verification upload", {
      error: message,
      stack,
      category: errorCategory,
    });

    // Return a category-specific code so the client can show a targeted message
    const errorCode = isR2Error
      ? "storage_failed"
      : isEncryptionError
        ? "encryption_failed"
        : isConfigError
          ? "config_missing"
          : "unexpected_error";

    return NextResponse.json(
      {
        error:
          process.env.NODE_ENV === "development"
            ? message
            : "Failed to upload document. Please try again.",
        code: errorCode,
      },
      { status: 500 }
    );
  }
}
