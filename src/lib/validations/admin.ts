import { z } from "zod";

/**
 * Zod schemas for admin API route input validation
 */

export const adminContentDecideSchema = z
  .object({
    itemId: z.string().uuid("itemId must be a valid UUID"),
    area: z.enum(["MZANSI_MARKET", "BUSINESS_ADS", "MALL_SHOPS", "MZANSI_BUSINESS"], {
      message: "area must be MZANSI_MARKET, BUSINESS_ADS, MALL_SHOPS, or MZANSI_BUSINESS",
    }),
    decision: z.enum(["approve", "reject"], {
      message: "decision must be approve or reject",
    }),
    reason: z.string().max(500).optional(),
  })
  .refine((data) => data.decision === "approve" || (data.reason && data.reason.trim().length > 0), {
    message: "A reason is required when rejecting content",
    path: ["reason"],
  });

export const adminVerificationDecideSchema = z
  .object({
    stepId: z.string().uuid("stepId must be a valid UUID"),
    decision: z
      .enum(["approved", "rejected", "needs_resubmission", "resubmit"], {
        message: "decision must be approved, rejected, or needs_resubmission",
      })
      .transform(
        (v) => (v === "resubmit" ? "needs_resubmission" : v) as Exclude<typeof v, "resubmit">
      ),
    reasonCode: z.string().max(100).optional(),
    reasonNote: z.string().max(500).optional(),
    overrideReasonCode: z.string().max(100).optional(),
  })
  .refine((data) => data.decision === "approved" || data.reasonCode, {
    message: "Reason code is required for rejection or resubmission",
    path: ["reasonCode"],
  });

export const adminFlaggingActionSchema = z
  .object({
    reportId: z.string().uuid("reportId must be a valid UUID"),
    action: z.enum(["warn", "hide", "suspend", "ban", "dismiss"], {
      message: "action must be warn, hide, suspend, ban, or dismiss",
    }),
    reason: z.string().max(500).optional(),
    durationDays: z.number().int().positive().max(365).optional(),
  })
  .refine((data) => data.action !== "dismiss" || data.reason, {
    message: "Reason is required when dismissing a report",
    path: ["reason"],
  });

export const adminDsarDecideSchema = z.object({
  requestId: z.string().uuid("requestId must be a valid UUID"),
  decision: z.enum(["approve", "reject"], {
    message: "decision must be approve or reject",
  }),
  notes: z.string().max(2000).optional(),
});
