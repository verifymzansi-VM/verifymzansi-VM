import { z } from "zod";
import { optionalTrimmedStringSchema, uuidSchema } from "@/lib/validations/shared";
import { OVERRIDE_REASON_CODES, REASON_CODES } from "@/lib/constants/verification";

/**
 * Zod schemas for admin API route input validation
 */

export const adminContentDecideSchema = z
  .object({
    itemId: uuidSchema,
    area: z.enum(["MZANSI_MARKET", "MZANSI_BUSINESS", "PROMOTIONS_EVENTS"], {
      message: "area must be MZANSI_MARKET, MZANSI_BUSINESS, or PROMOTIONS_EVENTS",
    }),
    decision: z.enum(["approve", "reject"], {
      message: "decision must be approve or reject",
    }),
    contentType: z.enum(["listing", "business", "promotion"]).optional(),
    reason: optionalTrimmedStringSchema.pipe(z.string().max(500).optional()),
  })
  .refine((data) => data.decision === "approve" || (data.reason && data.reason.trim().length > 0), {
    message: "A reason is required when rejecting content",
    path: ["reason"],
  })
  .refine(
    (data) => {
      // Cross-validate: when contentType is supplied it must agree with the
      // marketplace area (a business cannot live in MZANSI_MARKET, etc.).
      if (!data.contentType) return true;
      const areaForType: Record<string, string> = {
        listing: "MZANSI_MARKET",
        business: "MZANSI_BUSINESS",
        promotion: "PROMOTIONS_EVENTS",
      };
      return areaForType[data.contentType] === data.area;
    },
    {
      message: "contentType does not match the marketplace area",
      path: ["contentType"],
    }
  );

export const adminContentEditDecideSchema = z
  .object({
    requestId: uuidSchema,
    decision: z.enum(["approve", "reject"], {
      message: "decision must be approve or reject",
    }),
    reason: optionalTrimmedStringSchema.pipe(z.string().max(500).optional()),
  })
  .refine((data) => data.decision === "approve" || (data.reason && data.reason.trim().length > 0), {
    message: "A reason is required when rejecting an edit",
    path: ["reason"],
  });

export const adminVerificationDecideSchema = z
  .object({
    stepId: uuidSchema,
    decision: z
      .enum(["approved", "rejected", "needs_resubmission", "resubmit"], {
        message: "decision must be approved, rejected, or needs_resubmission",
      })
      .transform(
        (v) => (v === "resubmit" ? "needs_resubmission" : v) as Exclude<typeof v, "resubmit">
      ),
    reasonCode: optionalTrimmedStringSchema.pipe(z.enum(REASON_CODES).optional()),
    reasonNote: optionalTrimmedStringSchema.pipe(z.string().max(500).optional()),
    overrideReasonCode: optionalTrimmedStringSchema.pipe(z.enum(OVERRIDE_REASON_CODES).optional()),
  })
  .refine((data) => data.decision === "approved" || data.reasonCode, {
    message: "Reason code is required for rejection or resubmission",
    path: ["reasonCode"],
  })
  .refine(
    (data) =>
      data.decision === "approved" || (data.reasonNote && data.reasonNote.trim().length > 0),
    {
      message: "A written explanation is required when rejecting or requesting resubmission",
      path: ["reasonNote"],
    }
  );

export const adminFlaggingActionSchema = z
  .object({
    reportId: uuidSchema,
    action: z.enum(["warn", "hide", "suspend", "ban", "dismiss"], {
      message: "action must be warn, hide, suspend, ban, or dismiss",
    }),
    reason: optionalTrimmedStringSchema.pipe(z.string().max(500).optional()),
    durationDays: z.number().int().positive().max(365).optional(),
  })
  .refine((data) => data.action !== "dismiss" || data.reason, {
    message: "Reason is required when dismissing a report",
    path: ["reason"],
  });

export const adminDsarDecideSchema = z.object({
  requestId: uuidSchema,
  decision: z.enum(["approve", "reject", "verify_identity"], {
    message: "decision must be approve, reject, or verify_identity",
  }),
  notes: optionalTrimmedStringSchema.pipe(z.string().max(2000).optional()),
});

export const adminDsarCompleteSchema = z.object({
  requestId: uuidSchema,
  notes: optionalTrimmedStringSchema.pipe(z.string().max(2000).optional()),
  // Required for deletion-type DSARs: an explicit operator confirmation that
  // the underlying data deletion was actually performed (manual process).
  deletionAttestation: optionalTrimmedStringSchema.pipe(z.string().max(2000).optional()),
});
