import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { uploadKycDocument, deleteFromR2, hasR2WriteAccess } from "@/lib/services/storage";
import { logAuditEvent } from "@/lib/services/audit";
import { fileUploadSchema, validateUploadedFile } from "@/lib/validations/verification";
import { processKycArtifact } from "@/lib/services/kyc-engine";
import { createLogger } from "@/lib/utils/logger";
import { isStrictLocalDevelopmentRequest } from "@/lib/utils/local-dev";
import { stripExifFromJpeg, stripMetadataFromPng } from "@/lib/utils/exif-strip";
import { inspectJpegExif, type ExifSignals } from "@/lib/utils/exif-inspect";
import { getImageDimensions } from "@/lib/utils/image-dimensions";
import { decodeImageToPixels, computeLaplacianVariance } from "@/lib/utils/blur-detection";
import { scanForMalware } from "@/lib/utils/malware-scan";
import { MIN_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION } from "@/lib/constants/verification";
import { validateBufferIntegrity } from "@/lib/utils/file-validation";
import {
  buildPendingVerificationStep,
  buildVerificationStep,
  buildVerificationSessionResumePatch,
} from "@/lib/services/verification-state";
import crypto from "crypto";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { parseAndValidateFormData } from "@/lib/utils/api";
import { buildVerificationEmailConfirmationRequiredPayload } from "@/lib/constants/verification-email-confirmation";

const log = createLogger("VerificationUpload");

// Re-exported from shared module
import { getDefaultDisplayName } from "@/lib/account/ensure-profile";

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
  const requestId = crypto.randomUUID();
  const jsonError = (
    body: Record<string, unknown>,
    init: ResponseInit & { headers?: HeadersInit } = {}
  ) => {
    const headers = new Headers(init.headers);
    headers.set("X-Request-Id", requestId);

    return NextResponse.json(
      {
        ...body,
        requestId,
      },
      {
        ...init,
        headers,
      }
    );
  };

  try {
    const allowDevFallback = isStrictLocalDevelopmentRequest(request);

    // In production, require either S3 credentials OR a native R2 Worker binding.
    // Native bindings (PRIVATE_BUCKET) are preferred on Cloudflare Workers and do
    // not need separate API credentials — they are configured in wrangler.toml.
    if (process.env.NODE_ENV === "production") {
      const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
      const hasWritableStorage = await hasR2WriteAccess(privateBucket);

      if (!hasWritableStorage) {
        log.error("R2 storage is not available: check bucket binding and runtime storage config", {
          requestId,
          nodeEnv: process.env.NODE_ENV,
          privateBucket,
          runtime: process.env.NEXT_RUNTIME ?? "unknown",
        });
        return jsonError(
          { error: "Document upload temporarily unavailable", code: "storage_unavailable" },
          { status: 503 }
        );
      }
    }

    // ── Validate encryption keys upfront ─────────────────────
    const kycKey = process.env.KYC_ENCRYPTION_KEY;
    if (!kycKey || kycKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(kycKey)) {
      log.error("KYC_ENCRYPTION_KEY is missing or malformed", {
        requestId,
        present: Boolean(kycKey),
        length: kycKey?.length,
      });
      if (!allowDevFallback) {
        return jsonError(
          {
            error: "Document encryption is not configured. Please contact support.",
            code: "config_missing",
          },
          { status: 503 }
        );
      }
    }

    const originBlock = enforceSameOriginMutation(request, log);
    if (originBlock) {
      return originBlock;
    }

    const csrfBlock = enforceCsrfToken(request, log);
    if (csrfBlock) {
      return csrfBlock;
    }

    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return jsonError({ error: "Unauthorized" }, { status: 401 });
    }

    // Email confirmation gate — users must confirm their email before uploading
    if (!user.email_confirmed_at) {
      return jsonError(buildVerificationEmailConfirmationRequiredPayload(), {
        status: 403,
      });
    }

    // Feature flag check — must match session start route
    const v2Enabled = await isFeatureEnabled("kyc_v2_flow");
    if (!v2Enabled) {
      return jsonError(
        {
          error: "New verification flow is not yet enabled",
          code: "kyc_v2_disabled",
        },
        { status: 404 }
      );
    }

    const rateCheck = await checkRateLimit({
      key: getClientIp(request),
      action: "verification:upload",
      degradedMode: "block",
    });
    if (rateCheck.limited) {
      if (rateCheck.degraded) {
        return jsonError(
          { error: "Verification upload protection is temporarily unavailable. Please try again." },
          { status: 503, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
        );
      }

      return jsonError(
        { error: "Too many verification upload attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    // ── Parse multipart form ─────────────────────────────────
    let formData: FormData;
    try {
      formData = await request.formData();
    } catch {
      return jsonError({ error: "Invalid form data. Send multipart/form-data." }, { status: 400 });
    }

    const file = formData.get("file");
    if (!file || !(file instanceof File) || file.size === 0) {
      return jsonError({ error: "File is required" }, { status: 400 });
    }

    // ── Validate metadata fields ─────────────────────────────
    const metaParsed = parseAndValidateFormData(formData, fileUploadSchema, {
      validationErrorMessage: "Invalid upload metadata",
      includeValidationDetails: false,
    });

    if (!metaParsed.success) {
      return metaParsed.response;
    }

    const { docType, idNumber, captureMethod } = metaParsed.data;
    const firstName = metaParsed.data.firstName?.trim() || undefined;
    const lastName = metaParsed.data.lastName?.trim() || undefined;

    // firstName and lastName are required for id_document uploads
    if (docType === "id_document" && (!firstName || !lastName)) {
      return jsonError(
        { error: "First name and surname as shown on your ID are required." },
        { status: 400 }
      );
    }

    // ── Validate file type and size ──────────────────────────
    const allowPdf = docType === "id_document" || docType === "proof_of_address";
    const fileValidation = validateUploadedFile(
      { size: file.size, type: file.type, name: file.name },
      { allowPdf }
    );

    if (!fileValidation.valid) {
      return jsonError({ error: fileValidation.error }, { status: 400 });
    }

    // ── Get account profile ──────────────────────────────────
    const admin = createAdminClient();
    let { data: profile } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("id, phone")
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
        .select("id, phone")
        .single();

      if (createProfileError || !createdProfile) {
        log.error("Failed to auto-create account profile", {
          requestId,
          error: createProfileError?.message,
        });
        return jsonError(
          { error: "Failed to initialize account profile. Please try again." },
          { status: 500 }
        );
      }

      profile = createdProfile;
    }

    // Phone gate for API routes: the middleware phone gate only covers
    // page routes (not API routes), so we check here to prevent uploads
    // from accounts without a phone number.
    if (!profile.phone) {
      return jsonError(
        {
          error: "Please complete your profile with a phone number before starting verification.",
          code: "phone_required",
        },
        { status: 403 }
      );
    }

    // ── Check if phone is linked to a rejected/flagged account ──
    let phoneFlaggedUserId: string | null = null;
    {
      const { data: flaggedRows } = await admin
        .from("account_profiles")
        .select("id")
        .eq("phone", profile.phone)
        .neq("id", profile.id)
        .eq("account_verification_status", "rejected")
        .limit(1);
      if (flaggedRows && flaggedRows.length > 0) {
        phoneFlaggedUserId = flaggedRows[0].id;
      }
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
    const { data: existingStep, error: existingStepErr } = await admin
      .from("verification_steps")
      .select("status, risk_score, risk_level, auto_status")
      .eq("user_id", user.id)
      .eq("step_type", stepType)
      .maybeSingle();

    if (existingStepErr) {
      log.error("Failed to read existing verification step", {
        error: existingStepErr.message,
        userId: user.id,
        stepType,
      });
      return jsonError(
        { error: "Unable to verify step status. Please try again." },
        { status: 500 }
      );
    }

    if (existingStep?.status === "approved") {
      return jsonError(
        {
          error: "This verification step has already been approved.",
          code: "step_already_approved",
        },
        { status: 409 }
      );
    }

    // ── Read file bytes once for SHA-256 and upload ───────────
    let fileBuffer = Buffer.from(await file.arrayBuffer());

    // ── Server-side magic-byte MIME validation ────────────────
    const integrity = validateBufferIntegrity(fileBuffer, file.type);
    if (!integrity.valid) {
      log.warn("File MIME mismatch detected", {
        declared: file.type,
        detected: integrity.detectedMime,
        userId: user.id,
      });
      return NextResponse.json(
        {
          error: "File type does not match its content. Please upload a valid image or document.",
          requestId,
        },
        { status: 400 }
      );
    }

    // ── Malware scan ──────────────────────────────────────────
    const scanResult = scanForMalware(fileBuffer, file.type);
    if (!scanResult.safe) {
      log.warn("Malware detected in KYC upload", {
        threat: scanResult.threat,
        userId: user.id,
        fileName: file.name,
      });
      return NextResponse.json(
        {
          error:
            "This file was rejected because it contains suspicious content. Please upload a clean photo.",
          requestId,
        },
        { status: 400 }
      );
    }

    // ── Inspect EXIF metadata for fraud signals (before stripping) ──
    let exifSignals: ExifSignals | null = null;
    if (file.type === "image/jpeg" || integrity.detectedMime === "image/jpeg") {
      exifSignals = inspectJpegExif(fileBuffer);
    }

    // ── Image dimension validation ───────────────────────────
    const isImageFile = file.type.startsWith("image/");
    if (isImageFile) {
      const dims = getImageDimensions(fileBuffer);
      if (dims) {
        const shortest = Math.min(dims.width, dims.height);
        const longest = Math.max(dims.width, dims.height);
        if (shortest < MIN_IMAGE_DIMENSION) {
          return NextResponse.json(
            {
              error: `Image is too small (${dims.width}×${dims.height}). Minimum ${MIN_IMAGE_DIMENSION}px on shortest side.`,
              requestId,
            },
            { status: 400 }
          );
        }
        if (longest > MAX_IMAGE_DIMENSION) {
          return NextResponse.json(
            {
              error: `Image is too large (${dims.width}×${dims.height}). Maximum ${MAX_IMAGE_DIMENSION}px on longest side.`,
              requestId,
            },
            { status: 400 }
          );
        }
      }
    }

    // ── Blur detection (best-effort, requires sharp) ─────────
    let blurScore: number | null = null;
    if (isImageFile) {
      try {
        const pixels = await decodeImageToPixels(fileBuffer, file.type);
        if (pixels) {
          blurScore = computeLaplacianVariance(pixels.data, pixels.width, pixels.height);
        }
      } catch {
        // Blur detection is best-effort — skip on failure
      }
    }

    // ── Strip EXIF metadata from JPEG files (POPIA data minimization) ──
    if (file.type === "image/jpeg" || integrity.detectedMime === "image/jpeg") {
      fileBuffer = Buffer.from(stripExifFromJpeg(fileBuffer));
    } else if (file.type === "image/png" || integrity.detectedMime === "image/png") {
      fileBuffer = Buffer.from(stripMetadataFromPng(fileBuffer));
    }

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
        requestId,
        error: errMsg,
        stack: errStack,
        category: isEncryptionError ? "encryption" : isCredentialError ? "credentials" : "storage",
      });

      if (!allowDevFallback) {
        const userMessage = isEncryptionError
          ? "Document encryption failed. Please contact support."
          : "Failed to upload document. Please try again in a moment.";
        const code = isEncryptionError ? "encryption_failed" : "storage_failed";
        return jsonError({ error: userMessage, code }, { status: 500 });
      }

      // Local dev fallback when R2 is not configured/reachable.
      const devKey = `dev://${docType}/${profile.id}/${Date.now()}-local.bin`;
      uploadResult = {
        url: devKey,
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
      log.error("Failed to record artifact", { error: artifactError, requestId });

      // Rollback orphaned R2 file only if upload reached R2.
      if (uploadedToR2) {
        try {
          const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
          await deleteFromR2(privateBucket, uploadResult.key);
        } catch (cleanupError) {
          log.error("CRITICAL: Failed to clean up orphaned R2 file:", { error: cleanupError });
        }
      }

      return jsonError(
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
      log.error("Failed to supersede prior KYC artifacts — duplicates may confuse review", {
        error: supersedeError.message,
        userId: user.id,
        stepType,
      });
    }

    // ── Phone linked to flagged/rejected account signal ──────
    if (phoneFlaggedUserId) {
      log.warn("Phone linked to flagged account", {
        userId: user.id,
        flaggedProfileId: phoneFlaggedUserId,
      });
      await admin.from("kyc_risk_signals").insert({
        user_id: user.id,
        artifact_id: artifact.id,
        signal_code: "phone_linked_to_flagged_account",
        severity: "block",
        value_json: { flaggedProfileId: phoneFlaggedUserId },
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
      captureMethod: captureMethod ?? undefined,
      exifSignals,
      blurScore,
      phoneFlagged: !!phoneFlaggedUserId,
    });

    // ── Patch artifact with sha256 and provider_ref ───────────
    const { error: patchErr } = await admin
      .from("kyc_artifacts")
      .update({
        sha256: engineResult.sha256,
        provider_ref: engineResult.providerRef ?? null,
      })
      .eq("id", artifact.id);
    if (patchErr) {
      log.error("Failed to patch artifact with sha256/provider_ref (non-fatal)", {
        error: patchErr.message,
        artifactId: artifact.id,
      });
    }

    // ── Build verification step data ──────────────────────────
    // Auto-approve low-risk steps where the provider approved and no
    // block-level signals fired (R1: streamline verification for low-risk users).
    const isAutoApproved =
      engineResult.autoStatus === "approved" && engineResult.riskLevel === "low";

    const stepData = isAutoApproved
      ? buildVerificationStep(
          {
            user_id: user.id,
            step_type: stepType,
            auto_status: engineResult.autoStatus,
            risk_score: engineResult.riskScore,
            risk_level: engineResult.riskLevel,
            submitted_at: new Date().toISOString(),
          },
          "approved"
        )
      : buildPendingVerificationStep({
          user_id: user.id,
          step_type: stepType,
          auto_status: engineResult.autoStatus,
          risk_score: engineResult.riskScore,
          risk_level: engineResult.riskLevel,
          submitted_at: new Date().toISOString(),
        });

    if (isAutoApproved) {
      log.info("Low-risk step auto-approved by engine", {
        userId: user.id,
        stepType,
        riskScore: engineResult.riskScore,
        autoStatus: engineResult.autoStatus,
      });
    }

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

      // Persist legal name from ID document for later propagation on approval
      if (firstName) stepData.first_name = firstName;
      if (lastName) stepData.last_name = lastName;
    }

    // CAS guard: only overwrite an existing step if it is still in a
    // "safe-to-overwrite" state. This prevents a concurrent upload from
    // overwriting a step that was approved between our earlier check and now.
    // Use conditional update + insert instead of upsert to avoid TOCTOU.
    let stepUpsertError: { message: string; code?: string; details?: string } | null = null;
    const { data: updatedStep, error: updateError } = await admin
      .from("verification_steps")
      .update(stepData)
      .eq("user_id", user.id)
      .eq("step_type", stepType)
      .neq("status", "approved")
      .select("id, risk_score")
      .maybeSingle();

    if (updateError) {
      stepUpsertError = updateError;
    } else if (!updatedStep) {
      // No row was updated — either no row exists yet, or it's approved.
      // Try inserting; if the row exists and is approved, the unique
      // constraint will cause a conflict and we return 409.
      const { data: _insertedStep, error: insertError } = await admin
        .from("verification_steps")
        .insert(stepData)
        .select("id, risk_score")
        .single();

      if (insertError) {
        // Unique constraint violation means the step was approved concurrently
        if (insertError.code === "23505") {
          return NextResponse.json(
            {
              error: "This verification step has already been approved.",
              code: "step_already_approved",
              requestId,
            },
            { status: 409 }
          );
        }
        stepUpsertError = insertError;
      }
    }
    const stepError = stepUpsertError;

    if (stepError) {
      log.error("Failed to update verification step", { error: stepError, requestId });

      // Clean up the orphaned artifact row and R2 file so they don't
      // accumulate without a matching verification_step record.
      try {
        await admin.from("kyc_artifacts").delete().eq("id", artifact.id);
      } catch (artifactCleanupErr) {
        log.error("CRITICAL: Failed to clean up orphaned kyc_artifact", {
          artifactId: artifact.id,
          error: artifactCleanupErr,
        });
      }
      if (uploadedToR2) {
        try {
          const privateBucket = process.env.R2_PRIVATE_BUCKET || "verifymzansi-private";
          await deleteFromR2(privateBucket, uploadResult.key);
        } catch (r2CleanupErr) {
          log.error("CRITICAL: Failed to clean up orphaned R2 file after step upsert failure", {
            r2Key: uploadResult.key,
            error: r2CleanupErr,
          });
        }
      }

      return jsonError(
        {
          error: "Failed to save verification step. Please retry the upload.",
          code: "step_upsert_failed",
        },
        { status: 500 }
      );
    }

    // If the pre-existing step had a higher (worse) risk score than the new
    // upload, restore the original risk posture. This prevents a benign
    // re-upload from silently erasing a previously flagged risk signal.
    // The new artifact is still saved so admins can review both.
    //
    // Re-read the step after upsert to avoid TOCTOU — a concurrent upload
    // may have written a higher score between our pre-read and now.
    const { data: currentStep, error: currentStepErr } = await admin
      .from("verification_steps")
      .select("risk_score, risk_level, auto_status")
      .eq("user_id", user.id)
      .eq("step_type", stepType)
      .maybeSingle();

    if (currentStepErr) {
      log.error("Failed to re-read step for risk-score restoration", {
        error: currentStepErr.message,
        userId: user.id,
        stepType,
      });
    }

    if (
      existingStep &&
      typeof existingStep.risk_score === "number" &&
      currentStep &&
      typeof currentStep.risk_score === "number" &&
      currentStep.risk_score < existingStep.risk_score
    ) {
      log.warn("Step upsert lowered risk score — restoring higher-risk record", {
        userId: user.id,
        stepType,
        existingScore: existingStep.risk_score,
        currentScore: currentStep.risk_score,
        newScore: engineResult.riskScore,
      });
      const { error: restoreErr } = await admin
        .from("verification_steps")
        .update({
          risk_score: existingStep.risk_score,
          risk_level: existingStep.risk_level,
          auto_status: existingStep.auto_status,
        })
        .eq("user_id", user.id)
        .eq("step_type", stepType);
      if (restoreErr) {
        log.error("Failed to restore higher risk score (non-fatal)", {
          error: restoreErr.message,
          userId: user.id,
          stepType,
        });
      }
    }

    // ── Update verification_sessions ──────────────────────────
    const sessionPatch: Record<string, unknown> = {};
    if (docType === "id_document") {
      sessionPatch.id_artifact_id = artifact.id;
    } else if (docType === "selfie") {
      sessionPatch.selfie_artifact_id = artifact.id;
    }

    const { error: sessionUpsertError } = await admin
      .from("verification_sessions")
      .upsert(buildVerificationSessionResumePatch(user.id, sessionPatch), {
        onConflict: "user_id",
      });

    if (sessionUpsertError) {
      log.error("Failed to update verification session — artifact saved, session out of sync", {
        requestId,
        error: sessionUpsertError.message,
        userId: user.id,
        artifactId: artifact.id,
      });
    }

    // ── Finalize session when all artifacts are present ───────
    const { data: currentSession } = await admin
      .from("verification_sessions")
      .select("id_artifact_id, selfie_artifact_id, location_submitted_at, finalized_at")
      .eq("user_id", user.id)
      .maybeSingle();

    // Check phone verification status from verification_steps
    const { data: phoneStep } = await admin
      .from("verification_steps")
      .select("phone_verified_at")
      .eq("user_id", user.id)
      .eq("step_type", "phone")
      .maybeSingle();

    if (
      currentSession &&
      !currentSession.finalized_at &&
      currentSession.id_artifact_id &&
      currentSession.selfie_artifact_id &&
      currentSession.location_submitted_at &&
      phoneStep?.phone_verified_at
    ) {
      const { error: finalizeErr } = await admin
        .from("verification_sessions")
        .update({ finalized_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("finalized_at", null); // CAS guard: prevent double finalization
      if (finalizeErr) {
        log.error("Failed to finalize verification session (non-fatal)", {
          error: finalizeErr.message,
          userId: user.id,
        });
      }
    }

    // ── Update account verification status based on risk engine result ─
    // Only promote to pending_review if the artifact was NOT hard-rejected
    // by the risk engine. This prevents the account from showing
    // "pending_review" when all steps have actually been rejected.
    const isHardReject = engineResult.autoStatus === "rejected";
    if (!isHardReject) {
      const { data: statusUpdated, error: statusErr } = await admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          account_verification_status: "pending_review",
        })
        .eq("id", profile.id)
        .in("account_verification_status", ["incomplete", "rejected"])
        .select("id");

      if (statusErr) {
        log.error("Failed to promote account to pending_review", {
          error: statusErr.message,
          profileId: profile.id,
        });
      } else if (statusUpdated?.length) {
        log.info("Account verification status promoted to pending_review", {
          profileId: profile.id,
        });
      }
    } else {
      log.info("Risk engine hard-rejected artifact — account status not promoted", {
        profileId: profile.id,
        autoStatus: engineResult.autoStatus,
        riskScore: engineResult.riskScore,
      });
    }

    // ── Auto-promote to verified when all steps are approved ──
    // If this step was auto-approved, check whether every required step
    // (phone, id_doc, selfie, location) is now approved. If so, skip
    // the admin queue entirely and promote the account to "verified".
    if (isAutoApproved) {
      const { data: allSteps, error: allStepsErr } = await admin
        .from("verification_steps")
        .select("step_type, status")
        .eq("user_id", user.id);

      if (allStepsErr) {
        log.error("Failed to read verification steps for auto-promote", {
          error: allStepsErr.message,
          userId: user.id,
        });
      }

      const stepMap = new Map((allSteps ?? []).map((s) => [s.step_type, s.status]));
      const allApproved =
        stepMap.get("phone") === "approved" &&
        stepMap.get("id_doc") === "approved" &&
        stepMap.get("selfie") === "approved" &&
        stepMap.get("location") === "approved";

      if (allApproved) {
        const { data: promoted, error: promoteErr } = await admin
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .update({ account_verification_status: "verified" })
          .eq("id", profile.id)
          .in("account_verification_status", ["incomplete", "pending_review"])
          .select("id");

        if (promoteErr) {
          log.error("Failed to auto-promote account to verified (non-fatal)", {
            error: promoteErr.message,
            profileId: profile.id,
          });
        } else if (promoted?.length) {
          log.info("Account auto-promoted to verified — all steps approved by engine", {
            profileId: profile.id,
            userId: user.id,
          });
        }
      }
    }

    // ── Audit log (best-effort) ────────────────────────────────
    try {
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
    } catch (auditErr) {
      log.error("Audit log failed (non-fatal)", {
        error: auditErr instanceof Error ? auditErr.message : "Unknown",
      });
    }

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
      requestId,
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

    return jsonError(
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
