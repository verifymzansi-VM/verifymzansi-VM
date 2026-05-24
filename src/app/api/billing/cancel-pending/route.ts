import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceBillingMutationGuard } from "@/lib/billing/route-guard";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("CancelPendingPayment");

const cancelPendingSchema = z.object({
  paymentId: z.string().uuid("Invalid payment ID"),
});

function asProviderData(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: NextRequest) {
  try {
    const guard = await enforceBillingMutationGuard({
      request,
      log,
      rateLimitAction: "billing:cancel-pending",
      rateLimitKey: (userId, ip) => `${userId}:${ip}`,
      requireConfirmedEmailMessage: "Please confirm your email address before cancelling payments.",
      degradedMessage: "Payment cancellation is temporarily unavailable. Please try again shortly.",
      limitedMessage: "Too many cancellation attempts. Please try again later.",
    });
    if (!guard.success) return guard.response;

    const parsed = await parseAndValidateJsonRequest(request, cancelPendingSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid cancellation request",
      includeValidationDetails: false,
    });
    if (!parsed.success) return parsed.response;

    const { user } = guard;
    const admin = createAdminClient();
    const { paymentId } = parsed.data;

    const { data: payment, error: fetchError } = await admin
      .from("payments")
      .select("id, status, provider_data")
      .eq("id", paymentId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (fetchError) {
      log.error("Failed to fetch pending payment for cancellation", {
        paymentId,
        userId: user.id,
        error: fetchError.message,
      });
      return NextResponse.json({ error: "Unable to cancel pending payment" }, { status: 500 });
    }

    if (!payment) {
      return NextResponse.json({ error: "Pending payment not found" }, { status: 404 });
    }

    if (payment.status !== "pending") {
      return NextResponse.json(
        {
          error:
            "This payment is already being processed. Check the payment status before starting a new checkout.",
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const { error: updateError } = await admin
      .from("payments")
      .update({
        status: "failed",
        provider_data: {
          ...asProviderData(payment.provider_data),
          failure_reason: "user_cancelled",
          cancelled_at: now,
        },
      })
      .eq("id", paymentId)
      .eq("user_id", user.id)
      .eq("status", "pending");

    if (updateError) {
      log.error("Failed to cancel pending payment", {
        paymentId,
        userId: user.id,
        error: updateError.message,
      });
      return NextResponse.json({ error: "Unable to cancel pending payment" }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      paymentId,
      status: "failed",
    });
  } catch (error) {
    log.error("Unexpected pending payment cancellation error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json({ error: "Unable to cancel pending payment" }, { status: 500 });
  }
}
