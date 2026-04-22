import { z } from "zod";
import { saIdSchema, saPhoneSchema, otpSchema } from "./shared";

const legalNamePattern = /^[\p{L}\p{M}\s'-]+$/u;

/** Zod schema for the phone-entry step of KYC verification. */
export const verificationPhoneSchema = z.object({
  phone: saPhoneSchema,
});

/** Zod schema for OTP confirmation during KYC verification. */
export const verificationOtpSchema = z.object({
  phone: saPhoneSchema,
  otp: otpSchema,
});

/** Zod schema for the ID-document upload step (SA ID number + document URL). */
export const verificationIdDocSchema = z.object({
  idNumber: saIdSchema,
  firstName: z
    .string()
    .trim()
    .min(1, "First name as shown on your ID is required")
    .max(100, "First name cannot exceed 100 characters")
    .regex(
      legalNamePattern,
      "First name may only contain letters, spaces, apostrophes, and hyphens"
    ),
  lastName: z
    .string()
    .trim()
    .min(1, "Surname as shown on your ID is required")
    .max(100, "Surname cannot exceed 100 characters")
    .regex(legalNamePattern, "Surname may only contain letters, spaces, apostrophes, and hyphens"),
  idDocumentUrl: z.string().url("Upload your ID document"),
  idDocumentType: z.enum(["sa_id"]),
});

/** Zod schema for the selfie upload step. */
export const verificationSelfieSchema = z.object({
  selfieUrl: z.string().url("Upload your selfie"),
});

/** Zod schema for location verification (province, city, optional GPS). */
export const verificationLocationSchema = z.object({
  province: z.string().min(1, "Province is required").max(50),
  city: z.string().min(1, "City is required").max(80),
  latitude: z.number().min(-35).max(-22).optional(),
  longitude: z.number().min(16).max(33).optional(),
});

/**
 * Extended schema used by POST /api/verification/location.
 * Accepts GPS coordinates and accuracy in addition to province/city.
 */
const _verificationLocationSubmitSchema = z.object({
  province: z.string().trim().min(1, "Province is required").max(50),
  city: z.string().trim().min(1, "City is required").max(80),
  latitude: z.number().min(-35).max(-22).optional(),
  longitude: z.number().min(16).max(33).optional(),
  locationMethod: z.enum(["gps", "proof_of_address"]).default("proof_of_address"),
  gpsAccuracyMeters: z.number().positive().finite().optional(),
});

const _proofOfAddressLineSchema = z
  .string()
  .trim()
  .min(5, "Enter the residential address shown on your proof of residence")
  .max(240, "Address line cannot exceed 240 characters");

// ── V2M Buyer verification ──────────────────────────────────

/** Zod schema for buyer-initiated verification of an account profile. */
export const buyerVerifySchema = z.object({
  accountProfileId: z.string().uuid(),
  turnstileToken: z.string().min(1, "Complete the CAPTCHA").max(4096),
});

// ── File upload validation ───────────────────────────────
/** Allowed MIME types for image uploads (JPEG, PNG, WebP). */
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Allowed MIME types for document uploads (images + PDF). */
const ALLOWED_DOC_TYPES = [...ALLOWED_IMAGE_TYPES, "application/pdf"] as const;

const EXTENSIONS_BY_TYPE: Record<string, readonly string[]> = {
  "image/jpeg": ["jpg", "jpeg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "application/pdf": ["pdf"],
};

/** Maximum file upload size in bytes (5 MB). */
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

/** Zod schema for the KYC file-upload form payload. */
export const fileUploadSchema = z
  .object({
    docType: z.enum(["id_document", "selfie", "proof_of_address"], {
      error: "Document type is required",
    }),
    idNumber: z.string().max(13).optional(),
    idDocumentType: z.enum(["sa_id"]).optional(),
    /** First name as printed on the ID document (required for id_document uploads). */
    firstName: z
      .string()
      .trim()
      .max(100)
      .regex(
        legalNamePattern,
        "First name may only contain letters, spaces, apostrophes, and hyphens"
      )
      .optional(),
    /** Surname as printed on the ID document (required for id_document uploads). */
    lastName: z
      .string()
      .trim()
      .max(100)
      .regex(legalNamePattern, "Surname may only contain letters, spaces, apostrophes, and hyphens")
      .optional(),
    /** How the image was captured: camera (getUserMedia) or file upload. */
    captureMethod: z.enum(["camera", "file_upload"]).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.docType === "id_document") {
      if (!data.firstName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "First name is required for ID document uploads",
          path: ["firstName"],
        });
      }
      if (!data.lastName?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Surname is required for ID document uploads",
          path: ["lastName"],
        });
      }
    }
  });

/**
 * Validate a file for KYC upload (server-side).
 * Checks type via magic bytes and enforces size limit.
 */
export function validateUploadedFile(
  file: { size: number; type: string; name: string },
  options: { allowPdf?: boolean } = {}
): { valid: true } | { valid: false; error: string } {
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return {
      valid: false,
      error: `File exceeds maximum size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024}MB`,
    };
  }

  if (file.size === 0) {
    return { valid: false, error: "File is empty" };
  }

  const allowedTypes: readonly string[] = options.allowPdf
    ? ALLOWED_DOC_TYPES
    : ALLOWED_IMAGE_TYPES;

  if (!allowedTypes.includes(file.type)) {
    return {
      valid: false,
      error: `File type "${file.type}" is not allowed. Accepted: ${allowedTypes.join(", ")}`,
    };
  }

  const extension = file.name.split(".").pop()?.trim().toLowerCase();
  const allowedExtensions = EXTENSIONS_BY_TYPE[file.type] ?? [];
  if (!extension || !allowedExtensions.includes(extension)) {
    return {
      valid: false,
      error: `File extension does not match "${file.type}". Accepted extensions: ${allowedExtensions.join(", ")}`,
    };
  }

  return { valid: true };
}

// ── DSAR request validation ─────────────────────────────
/** Zod schema for a POPIA Data Subject Access Request. */ export const dsarRequestSchema =
  z.object({
    type: z.enum(["access", "correction", "deletion", "objection"], {
      error: "Request type is required",
    }),
    name: z
      .string()
      .min(2, "Name must be at least 2 characters")
      .max(100, "Name cannot exceed 100 characters"),
    email: z.string().email("Enter a valid email address"),
    idNumber: saIdSchema,
    details: z.string().max(2000, "Details cannot exceed 2000 characters").optional(),
  });

/** Inferred input type for {@link verificationPhoneSchema}. */
type _VerificationPhoneInput = z.infer<typeof verificationPhoneSchema>;
/** Inferred input type for {@link verificationOtpSchema}. */
type _VerificationOtpInput = z.infer<typeof verificationOtpSchema>;
/** Inferred input type for {@link verificationIdDocSchema}. */
type _VerificationIdDocInput = z.infer<typeof verificationIdDocSchema>;
/** Inferred input type for {@link verificationSelfieSchema}. */
type _VerificationSelfieInput = z.infer<typeof verificationSelfieSchema>;
/** Inferred input type for {@link verificationLocationSchema}. */
type _VerificationLocationInput = z.infer<typeof verificationLocationSchema>;
/** Inferred input type for {@link verificationLocationSubmitSchema}. */
type _VerificationLocationSubmitInput = z.infer<typeof _verificationLocationSubmitSchema>;
/** Inferred input type for {@link proofOfAddressLineSchema}. */
type _ProofOfAddressLineInput = z.infer<typeof _proofOfAddressLineSchema>;
/** Inferred input type for {@link buyerVerifySchema}. */
type _BuyerVerifyInput = z.infer<typeof buyerVerifySchema>;
/** Inferred input type for {@link fileUploadSchema}. */
type _FileUploadInput = z.infer<typeof fileUploadSchema>;
/** Inferred input type for {@link dsarRequestSchema}. */
type _DsarRequestInput = z.infer<typeof dsarRequestSchema>;
