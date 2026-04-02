import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

const verifyBuyerSchema = z.object({
  token: z.string().uuid("Enter a valid buyer token"),
});

type BuyerVerificationStatus = "valid" | "expired" | "revoked";
const log = createLogger("VerifyBuyerRoute");

export async function POST(request: NextRequest) {
  try {
    // Rate limit by client IP to prevent token enumeration
    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({ key: ip, action: "verify-buyer" });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many verification attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const parsedBody = await parseAndValidateJsonRequest(request, verifyBuyerSchema, {
      validationErrorMessage: "Invalid token",
      includeValidationDetails: false,
    });
    if (!parsedBody.success) {
      return parsedBody.response;
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("buyer_verifications")
      .select("first_name_initial, issued_at, expires_at, status")
      .eq("token", parsedBody.data.token)
      .maybeSingle();

    if (error) {
      log.error("Failed to verify buyer token", { error: error.message });
      return NextResponse.json({ error: "Failed to verify token" }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json({ result: "not_found" as const });
    }

    const status = data.status as BuyerVerificationStatus;
    const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
    const isExpiredByDate = expiresAt ? expiresAt <= new Date() : false;

    if (status === "revoked") {
      return NextResponse.json({ result: "revoked" as const });
    }

    if (status === "expired" || isExpiredByDate) {
      return NextResponse.json({ result: "expired" as const });
    }

    if (status === "valid") {
      return NextResponse.json(
        {
          result: "valid" as const,
          buyerInfo: {
            displayName: data.first_name_initial?.trim() || "Buyer",
            verifiedAt: data.issued_at,
          },
        },
        {
          headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
        }
      );
    }

    return NextResponse.json({ result: "not_found" as const });
  } catch (error) {
    logApiError(log, "Unexpected buyer verification error", error);
    return internalApiError();
  }
}
