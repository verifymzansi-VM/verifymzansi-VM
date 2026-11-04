import "server-only";
import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  handleFoundationOwnerRoute,
  type FoundationRefusal,
} from "@/app/api/foundation/_lib/owner-route";
import { readFoundationAccountContext, FoundationAccountContextError } from "./account-context";
import { readFoundationOwnerDashboard } from "./owner-dashboard";
import { createFoundationServiceApi } from "./service-api";
import { buildRestoredPostInput, RestoredPostInputError } from "./restored-post-input";
import { LocalityInputError } from "./restored-locality";
import { resolveOwnedMedia, OwnedMediaError } from "./owned-media";
import { readRestoredOwnerPost, restoredOwnerPostRow } from "./restored-owner-posts";
import { restoredPublicDetail } from "./marketplace-server";
import { restoredPublicRow, type PublicCollection } from "./marketplace-read";
import { createLogger } from "../utils/logger";
import type { Json } from "../../../database/foundation/api.types";
const log = createLogger("RestoredPostCommands");
class PostRefusal extends Error {
  constructor(readonly refusal: FoundationRefusal) {
    super(refusal.error);
  }
}
function fail(
  error: { code?: string; details?: string | null },
  collection: PublicCollection
): never {
  if (error.details === "posting_verification_required")
    throw new PostRefusal({
      status: 403,
      error: "Verification required",
      code: "verification_required",
      reason: "Complete verification before posting.",
    });
  if (error.code === "42501")
    throw new PostRefusal({
      status: 403,
      error: "Post access is unavailable",
      reason: "post_access_unavailable",
    });
  if (error.details === "slug_conflict")
    throw new PostRefusal({
      status: 409,
      error: "Business slug already in use",
      reason: "Choose a different URL slug for this business.",
      details: { slug: "This URL slug is already taken." },
    });
  if (error.details === "posting_terms_required" || error.details === "posting_terms_changed")
    throw new PostRefusal({
      status: 409,
      error: "Review and accept the current posting terms before submitting",
      reason: "posting_terms_required",
    });
  if (error.code === "PT402")
    throw new PostRefusal({
      status: 403,
      error: "An active posting plan is required",
      reason: "Choose a posting plan to continue.",
      redirectUrl: `/pricing?area=${collection === "listings" ? "MZANSI_MARKET" : collection === "businesses" ? "MZANSI_BUSINESS" : "PROMOTIONS_EVENTS"}`,
    });
  if (error.code === "PT409")
    throw new PostRefusal({
      status: 409,
      error: "Your post or posting allowance changed. Reload your posts before retrying.",
      reason: "post_changed",
    });
  if (error.code === "PT429")
    throw new PostRefusal({
      status: 429,
      error: "Your posting allowance has been reached",
      reason: "posting_limit",
    });
  if (error.code === "22023" || error.code === "23514")
    throw new PostRefusal({
      status: 422,
      error: "Check the category, dates, media and posting allowance before submitting",
      reason: "invalid_post",
    });
  throw new Error("Post command unavailable");
}
function refusal(error: unknown): FoundationRefusal | null {
  if (error instanceof OwnedMediaError)
    return { status: error.status, error: error.message, reason: "media_unavailable" };
  if (error instanceof PostRefusal) return error.refusal;
  if (error instanceof z.ZodError)
    return {
      status: 422,
      error: error.issues[0]?.message ?? "Check your post details",
      reason: "invalid_post",
      issues: error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    };
  if (error instanceof RestoredPostInputError || error instanceof LocalityInputError)
    return { status: 422, error: error.message, reason: "invalid_post" };
  if (error instanceof FoundationAccountContextError && error.reason === "forbidden")
    return {
      status: 403,
      error: "Account access is unavailable",
      reason: "account_access_unavailable",
    };
  return null;
}
export function handleRestoredPostMutation(
  request: NextRequest,
  collection: PublicCollection,
  id?: string
) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action:
      collection === "listings"
        ? "listing_create"
        : collection === "businesses"
          ? "business_create"
          : "promotion:create",
    mutate: true,
    maxBytes: 131072,
    unavailableMessage: "Your post could not be confirmed. Reload your posts before trying again.",
    signInMessage: "Sign in to manage your posts",
    refusal,
    command: async (api, input) => {
      if (id && !z.uuid().safeParse(id).success)
        throw new PostRefusal({ status: 404, error: "Post not found", reason: "post_not_found" });
      const account = await readFoundationAccountContext(api);
      const record = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
      let fallback: { province: string; city: string } | undefined;
      if (collection === "businesses" && (!record.location_province || !record.location_city)) {
        const snapshot = await readFoundationOwnerDashboard(api, account.account_id);
        const province = snapshot.profile_facts.location_province,
          city = snapshot.profile_facts.location_city;
        if (province && city) fallback = { province, city };
      }
      const normalized = buildRestoredPostInput(collection, input, fallback, !!id);
      const references = await resolveOwnedMedia(api, {
        keys: [...normalized.media, ...normalized.presentation_media].map((m) => m.object_key),
      });
      const byKey = new Map(references.map((m) => [m.object_key, m]));
      const bind = <T extends { object_key: string; purpose: string }>(items: T[]) =>
        items.map(({ object_key, ...item }) => {
          const found = byKey.get(object_key);
          if (!found || (item.purpose === "video") !== (found.kind === "video"))
            throw new RestoredPostInputError(
              "Use your own finished uploads of the correct media type"
            );
          return { ...item, object_id: found.object_id };
        });
      const target = id?.toLowerCase();
      const payload = {
        ...normalized,
        media: bind(normalized.media),
        presentation_media: bind(normalized.presentation_media),
        ...(target ? { target_id: target } : {}),
      };
      const digest = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
      const service = createFoundationServiceApi();
      const staged = await service.rpc("stage_frontend_post_command", {
        p_owner: account.account_id,
        p_request: normalized.request_id,
        p_digest: digest,
        p_payload: payload as unknown as Json,
      });
      if (staged.error) fail(staged.error, collection);
      if (staged.data !== true) throw new Error("Post stage unavailable");
      // A lost completion reply is resolved by the persisted receipt on an
      // explicit retry. Neither command is automatically replayed here.
      const consumed = await api.rpc(
        "consume_frontend_post_command",
        { p_request: normalized.request_id },
        { get: false }
      );
      if (consumed.error) fail(consumed.error, collection);
      const result = z
        .strictObject({
          id: z.uuid(),
          status: z.literal("pending_moderation"),
          revision: z.number().int().positive(),
          original_id: z.uuid(),
          edit_of: z.uuid().nullable(),
        })
        .parse(consumed.data);
      if (target && result.original_id !== target) throw new Error("Post command changed");
      return {
        success: true,
        id: result.original_id,
        status: result.status,
        revision: result.revision,
        editId: result.edit_of ? result.id : null,
        ...(collection === "businesses" ? { business: { id: result.original_id } } : {}),
        ...(collection === "promotions" ? { promotion: { id: result.original_id } } : {}),
      };
    },
  });
}
export async function handleRestoredPostRead(
  request: NextRequest,
  collection: PublicCollection,
  id: string
) {
  const kind =
    collection === "listings" ? "listing" : collection === "businesses" ? "business" : "event";
  const key =
    collection === "listings" ? "listing" : collection === "businesses" ? "business" : "promotion";
  if (collection !== "listings" && request.nextUrl.searchParams.get("owner") !== "1") {
    if (!z.uuid().safeParse(id).success)
      return NextResponse.json({ error: "Post not found" }, { status: 404 });
    try {
      const post = await restoredPublicDetail(id);
      if (!post || post.kind !== kind)
        return NextResponse.json({ error: "Post not found" }, { status: 404 });
      return NextResponse.json({ [key]: restoredPublicRow(post, post) });
    } catch {
      return NextResponse.json({ error: "Post is temporarily unavailable" }, { status: 503 });
    }
  }
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "inbox:read",
    mutate: false,
    unavailableMessage: "Your post is temporarily unavailable",
    signInMessage: "Sign in to manage your posts",
    refusal,
    command: async (api) => {
      if (!z.uuid().safeParse(id).success)
        throw new PostRefusal({ status: 404, error: "Post not found", reason: "post_not_found" });
      const account = await readFoundationAccountContext(api),
        post = await readRestoredOwnerPost(api, id);
      if (!post || post.kind !== kind)
        throw new PostRefusal({ status: 404, error: "Post not found", reason: "post_not_found" });
      return { [key]: restoredOwnerPostRow(post, account.account_id) };
    },
  });
}
