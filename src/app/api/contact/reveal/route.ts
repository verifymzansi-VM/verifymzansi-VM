import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { readAccountVerificationStatus } from "@/lib/account/compat";
import { isVisibleByExpiry } from "@/lib/posting/visibility";
import { withAllPrivateFields } from "@/lib/content/private-fields";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("ContactReveal");

const schema = z.object({
  targetType: z.enum(["listing", "business", "promotion"]),
  targetId: z.string().uuid(),
});

type Target = {
  id: string;
  owner_id: string;
  status: string;
  expires_at: string | null;
  created_at: string | null;
  contact_methods: string[] | null;
};

const TABLES = { listing: "listings", business: "businesses", promotion: "promotions" } as const;

/**
 * POST /api/contact/reveal
 * Tap-to-reveal for a post's contact details. Numbers and emails are never in
 * public pages or readable through the database API; a signed-in visitor gets
 * them here, rate-limited and recorded, and only for the methods the poster
 * chose on a live post.
 */
export async function POST(request: NextRequest) {
  try {
    const blocked = enforceMutationRequest(request, log);
    if (blocked) return blocked;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to see contact details.", code: "sign_in_required" },
        { status: 401 }
      );
    }

    const limit = await checkRateLimit({ key: user.id, action: "contact:reveal" });
    if (limit.limited) {
      return NextResponse.json(
        { error: "You've revealed a lot of numbers. Please try again later." },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter ?? 60) } }
      );
    }

    const body = await parseAndValidateJsonRequest(request, schema, {
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;
    const { targetType, targetId } = body.data;

    const admin = createAdminClient();
    const columns =
      targetType === "business"
        ? "id, owner_id, status, expires_at, created_at, contact_methods:category_details->contact_methods"
        : "id, owner_id, status, expires_at, created_at, contact_methods";
    const { data, error } = await admin
      .from(TABLES[targetType])
      .select(columns)
      .eq("id", targetId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const target = data as unknown as Target | null;
    if (
      !target ||
      target.status !== "live" ||
      !isVisibleByExpiry(target.expires_at, new Date(), target.created_at)
    ) {
      return NextResponse.json({ error: "This post isn't available." }, { status: 404 });
    }

    const methods = Array.isArray(target.contact_methods) ? target.contact_methods : null;
    const allows = (method: string) => methods === null || methods.includes(method);

    let phone: string | null = null;
    let whatsapp: string | null = null;
    let email: string | null = null;
    const { data: owner } = await admin
      .from("account_profiles")
      .select("phone, account_verification_status")
      .eq("user_id", target.owner_id)
      .maybeSingle();
    if (targetType === "business") {
      // Contact details live in the server-only business_private table.
      const [business] = await withAllPrivateFields("businesses", [{ id: target.id }]);
      phone = business.phone ?? null;
      whatsapp = business.whatsapp ?? null;
      email = allows("email") ? (business.email ?? null) : null;
    } else {
      // Listings and events use the account holder's verified number.
      const accountPhone = (owner?.phone as string | null) ?? null;
      phone = allows("call") ? accountPhone : null;
      whatsapp = allows("whatsapp") ? accountPhone : null;
    }

    if (user.id !== target.owner_id) {
      const { error: eventError } = await admin.from("contact_events").insert({
        target_id: target.id,
        target_type: targetType,
        owner_id: target.owner_id,
        member_verified: readAccountVerificationStatus(owner) === "verified",
        contact_type: "reveal",
        sender_user_id: user.id,
      });
      if (eventError) log.warn("Reveal not recorded", { error: eventError.message });
    }

    return NextResponse.json(
      { phone, whatsapp, email },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch (error) {
    logApiError(log, "Contact reveal failed", error);
    return internalApiError();
  }
}
