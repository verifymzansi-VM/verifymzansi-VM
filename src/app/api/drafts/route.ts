import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/utils/logger";

const logger = createLogger("Drafts");

const VALID_FLOWS = new Set(["listing", "promotion", "business"]);

/**
 * GET /api/drafts?flow=listing
 * Load the authenticated user's draft for the given flow.
 */
export async function GET(request: NextRequest) {
  const flow = request.nextUrl.searchParams.get("flow");
  if (!flow || !VALID_FLOWS.has(flow)) {
    return NextResponse.json({ error: "Invalid flow" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  return NextResponse.json({ draft: data });
}

/**
 * PUT /api/drafts
 * Upsert the authenticated user's draft for a flow.
 * Body: { flow, step, data }
 */
export async function PUT(request: NextRequest) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
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
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("listing_drafts")
    .upsert(
      { user_id: user.id, flow, step, data, saved_at: new Date().toISOString() },
      { onConflict: "user_id,flow" }
    );

  if (error) {
    logger.error("Failed to save draft", { error: error.message, flow });
    return NextResponse.json({ error: "Failed to save draft" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/drafts?flow=listing
 * Remove the authenticated user's draft for the given flow.
 */
export async function DELETE(request: NextRequest) {
  const flow = request.nextUrl.searchParams.get("flow");
  if (!flow || !VALID_FLOWS.has(flow)) {
    return NextResponse.json({ error: "Invalid flow" }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("listing_drafts")
    .delete()
    .eq("user_id", user.id)
    .eq("flow", flow);

  if (error) {
    logger.error("Failed to delete draft", { error: error.message, flow });
    return NextResponse.json({ error: "Failed to delete draft" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
