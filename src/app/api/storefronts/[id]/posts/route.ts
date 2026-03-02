import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { storefrontPostSchema } from "@/lib/validations/storefront";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("StorefrontPosts");

/**
 * GET /api/storefronts/[id]/posts
 *
 * List all posts for a storefront. Public for live posts.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: storefrontId } = await params;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(storefrontId)) {
      return NextResponse.json({ error: "Invalid storefront ID" }, { status: 400 });
    }

    const admin = createAdminClient();

    const { data: posts, error } = await admin
      .from("storefront_posts")
      .select(
        "id, type, title, body, media, media_urls, description, valid_until, status, created_at"
      )
      .eq("storefront_id", storefrontId)
      .eq("status", "live")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      log.error("Failed to fetch storefront posts", { error: error.message });
      return NextResponse.json({ error: "Failed to fetch posts" }, { status: 500 });
    }

    return NextResponse.json({ posts: posts || [] });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

/**
 * POST /api/storefronts/[id]/posts
 *
 * Create a new post for a storefront. Requires authenticated owner.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id: storefrontId } = await params;

    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_RE.test(storefrontId)) {
      return NextResponse.json({ error: "Invalid storefront ID" }, { status: 400 });
    }

    // ── Authenticate ─────────────────────────────────────────
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const admin = createAdminClient();

    // ── Verify ownership ─────────────────────────────────────
    const { data: storefront } = await admin
      .from("storefronts")
      .select("id, seller_id, status")
      .eq("id", storefrontId)
      .maybeSingle();

    if (!storefront) {
      return NextResponse.json({ error: "Storefront not found" }, { status: 404 });
    }

    if (storefront.seller_id !== user.id) {
      return NextResponse.json({ error: "You don't own this storefront" }, { status: 403 });
    }

    // ── Parse and validate input ─────────────────────────────
    const body = await request.json();
    const parsed = storefrontPostSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { title, body: postBody, media_urls, post_type } = parsed.data;

    // ── Insert post ──────────────────────────────────────────
    const { data: post, error: insertError } = await admin
      .from("storefront_posts")
      .insert({
        storefront_id: storefrontId,
        seller_id: user.id,
        type: post_type,
        title,
        body: postBody || null,
        media: media_urls?.[0] || "",
        media_urls: media_urls || [],
        status: "live",
      })
      .select("id, type, title, created_at")
      .single();

    if (insertError) {
      log.error("Failed to create storefront post", { error: insertError.message });
      return NextResponse.json({ error: "Failed to create post" }, { status: 500 });
    }

    await logAuditEvent({
      actorId: user.id,
      actorRole: "seller",
      action: "storefront_post_created",
      targetType: "storefront_post",
      targetId: post.id,
      metadata: { storefrontId, type: post_type },
    });

    log.info("Storefront post created", {
      postId: post.id,
      storefrontId,
      type: post_type,
    });

    return NextResponse.json({ success: true, post }, { status: 201 });
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "Unknown error",
    });
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
