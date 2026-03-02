import { NextResponse, type NextRequest } from "next/server";
import { parseJsonRequest } from "@/lib/utils/api";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { contactSellerSchema } from "@/lib/validations/contact";
import { verifyTurnstileToken } from "@/lib/utils/turnstile";
import { mapLegacyContactMethod } from "@/lib/utils/enum-compat";
import { createLogger } from "@/lib/utils/logger";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createNotification } from "@/lib/notifications";

const log = createLogger("ContactRoute");

export async function POST(request: NextRequest) {
  try {
    const body = await parseJsonRequest(request);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 });
    }
    const parsed = contactSellerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    // ── CAPTCHA verification ─────────────────────────────────
    if (process.env.TURNSTILE_SECRET_KEY) {
      const turnstileToken = body.turnstileToken;
      if (typeof turnstileToken !== "string") {
        return NextResponse.json({ error: "CAPTCHA verification required" }, { status: 400 });
      }
      const forwardedFor = request.headers.get("x-forwarded-for");
      const remoteIp = forwardedFor?.split(",")[0].trim() || undefined;
      const captchaResult = await verifyTurnstileToken({ token: turnstileToken, remoteIp });
      if (!captchaResult.success) {
        return NextResponse.json({ error: "CAPTCHA verification failed" }, { status: 400 });
      }
    } else if (process.env.NODE_ENV === "production") {
      log.error("TURNSTILE_SECRET_KEY not configured in production");
      return NextResponse.json({ error: "CAPTCHA service unavailable" }, { status: 503 });
    }

    // Rate limit by IP (or user ID if authenticated)
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const rateLimitKey = user?.id || getClientIp(request) || "unknown";
    const rl = await checkRateLimit({ key: rateLimitKey, action: "contact:send" });
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many contact requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    // Use admin client for lookups and inserts to bypass RLS on service-only tables
    const admin = createAdminClient();

    // Get the listing's seller (use admin client so unauthenticated users can still contact)
    const { data: listing } = await admin
      .from("listings")
      .select("seller_id")
      .eq("id", parsed.data.listingId)
      .single();

    if (!listing) {
      return NextResponse.json({ error: "Listing not found" }, { status: 404 });
    }

    // Check seller verification status
    const { data: sellerProfile } = await admin
      .from("seller_profiles")
      .select("seller_verification_status")
      .eq("user_id", listing.seller_id)
      .maybeSingle();

    const sellerVerified = sellerProfile?.seller_verification_status === "verified";

    // Map legacy contactMethod values to canonical contact_type
    const contactType = mapLegacyContactMethod(parsed.data.contactMethod);

    // Create canonical contact_events record
    const { error: contactError } = await admin.from("contact_events").insert({
      target_id: parsed.data.listingId,
      target_type: "listing",
      seller_id: listing.seller_id,
      seller_verified: sellerVerified,
      contact_type: contactType,
    });

    if (contactError) {
      log.error("Contact event insert error", { error: contactError.message });
      return NextResponse.json({ error: "Failed to send message" }, { status: 500 });
    }

    // Create leads row for buyer message content
    if (parsed.data.message) {
      // Sanitize message: strip HTML tags to prevent stored XSS
      const sanitizedMessage = parsed.data.message.replace(/<[^>]*>/g, "").trim();
      const { error: leadsError } = await admin.from("leads").insert({
        target_id: parsed.data.listingId,
        target_type: "listing",
        seller_id: listing.seller_id,
        buyer_name: null,
        buyer_email: user?.email || null,
        buyer_phone: null,
        message: sanitizedMessage,
        status: "new",
      });

      if (leadsError) {
        log.error("Leads insert failed (non-fatal)", { error: leadsError.message });
      }
    }

    // Notify the seller about the new lead/contact
    try {
      const { data: listingInfo } = await admin
        .from("listings")
        .select("title")
        .eq("id", parsed.data.listingId)
        .single();

      const listingTitle = listingInfo?.title?.slice(0, 40) || "your listing";

      await createNotification({
        userId: listing.seller_id,
        type: "info",
        title: "New lead received!",
        message: `Someone is interested in \"${listingTitle}\".`,
        href: "/dashboard/leads",
      });
    } catch {
      // Non-fatal — contact was already created successfully
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
