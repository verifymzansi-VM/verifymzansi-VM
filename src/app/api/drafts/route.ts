import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { unauthorizedResponse, badRequestResponse, internalApiError } from "@/lib/utils/api";

const logger = createLogger("Drafts");

const VALID_FLOWS = new Set(["listing", "promotion", "business"]);

/** Maximum draft request body size (64 KiB). */
const MAX_DRAFT_BODY_BYTES = 64 * 1024;

/**
 * GET /api/drafts?flow=listing
 * Load the authenticated user's draft for the given flow.
 */
export async function GET(request: NextRequest) {
  const flow = request.nextUrl.searchParams.get("flow");
  if (!flow || !VALID_FLOWS.has(flow)) {
    return badRequestResponse("Invalid flow");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { data, error } = await supabase
    .from("listing_drafts")
    .select("step, data, saved_at")
    .eq("user_id", user.id)
    .eq("flow", flow)
    .maybeSingle();

  if (error) {
    logger.error("Failed to load draft", { error: error.message, flow });
    return NextResponse.json({ error: "Failed to load draft" }, { status: 500 });
  }

  return NextResponse.json(
    { draft: data },
    {
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    }
  );
}

/**
 * PUT /api/drafts
 * Upsert the authenticated user's draft for a flow.
 * Body: { flow, step, data }
 */
export async function PUT(request: NextRequest) {
  const originBlock = enforceSameOriginMutation(request, logger);
  if (originBlock) return originBlock;
  const csrfBlock = enforceCsrfToken(request, logger);
  if (csrfBlock) return csrfBlock;

  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > MAX_DRAFT_BODY_BYTES) {
      return NextResponse.json({ error: "Payload too large" }, { status: 413 });
    }
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { flow, step, data } = body as Record<string, unknown>;

  if (typeof flow !== "string" || !VALID_FLOWS.has(flow)) {
    return NextResponse.json({ error: "Invalid flow" }, { status: 400 });
  }
  if (typeof step !== "number" || step < 0) {
    return NextResponse.json({ error: "Invalid step" }, { status: 400 });
  }
  if (!data || typeof data !== "object") {
    return badRequestResponse("Invalid data");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { error } = await supabase
    .from("listing_drafts")
    .upsert(
      { user_id: user.id, flow, step, data, saved_at: new Date().toISOString() },
      { onConflict: "user_id,flow" }
    );

  if (error) {
    logger.error("Failed to save draft", { error: error.message, flow });
    return internalApiError("Failed to save draft");
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/drafts?flow=listing
 * Remove the authenticated user's draft for the given flow.
 */
export async function DELETE(request: NextRequest) {
  const originBlock = enforceSameOriginMutation(request, logger);
  if (originBlock) return originBlock;
  const csrfBlock = enforceCsrfToken(request, logger);
  if (csrfBlock) return csrfBlock;

  const flow = request.nextUrl.searchParams.get("flow");
  if (!flow || !VALID_FLOWS.has(flow)) {
    return badRequestResponse("Invalid flow");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return unauthorizedResponse();
  }

  const { error } = await supabase
    .from("listing_drafts")
    .delete()
    .eq("user_id", user.id)
    .eq("flow", flow);

  if (error) {
    logger.error("Failed to delete draft", { error: error.message, flow });
    return internalApiError("Failed to delete draft");
  }

  return NextResponse.json({ ok: true });
}
