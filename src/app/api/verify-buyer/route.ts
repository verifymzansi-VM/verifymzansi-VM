import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { parseJsonRequest } from "@/lib/utils/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";

const verifyBuyerSchema = z.object({
  token: z.string().uuid("Enter a valid buyer token"),
});

type BuyerVerificationStatus = "valid" | "expired" | "revoked";

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

    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }

    const parsed = verifyBuyerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Invalid token" },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("buyer_verifications")
      .select("first_name_initial, issued_at, expires_at, status")
      .eq("token", parsed.data.token)
      .maybeSingle();

    if (error) {
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
      return NextResponse.json({
        result: "valid" as const,
        buyerInfo: {
          displayName: data.first_name_initial?.trim() || "Buyer",
          verifiedAt: data.issued_at,
        },
      });
    }

    return NextResponse.json({ result: "not_found" as const });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
