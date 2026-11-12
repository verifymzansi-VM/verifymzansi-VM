import "server-only";
import { cache } from "react";
import { z } from "zod";
import { foundationServerPublicApi } from "./server-public";
import {
  readRestoredCollection,
  readRestoredPublicDetail,
  restoredPublicRow,
  type PublicCollection,
} from "./marketplace-read";
import { readPublicBusinessStickers } from "./business-seen";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import type {
  LinkedBusinessRecord,
  PromotionDetailRecord,
} from "@/components/listings/promotion-detail-content";
import { createLogger } from "../utils/logger";
import { readFoundationProgrammeShowcases } from "./organisation-sponsorships";
import {
  readFoundationOrganisationDirectory,
  readFoundationPublicOrganisation,
} from "./organisations";
const log = createLogger("HomePublicPosts");

/** Public identities only; deduplicate the home strip/section within a render
 * and bound concurrent detail reads while retaining the approved directory order. */
export const restoredOrganisationDirectory = cache(async () => {
  const api = foundationServerPublicApi();
  const entries = await readFoundationOrganisationDirectory(api);
  const rows = [];
  for (let offset = 0; offset < entries.length; offset += 8) {
    const batch = await Promise.all(
      entries.slice(offset, offset + 8).map(async (entry) => {
        const detail = await readFoundationPublicOrganisation(api, { slug: entry.slug });
        return detail ? { ...entry, ...detail } : null;
      })
    );
    rows.push(...batch.filter((row) => row !== null));
  }
  return rows;
});

export async function restoredProgrammeShowcases(
  placement: "home" | "business" | "tourism" | "market"
) {
  try {
    return await readFoundationProgrammeShowcases(foundationServerPublicApi(), { placement });
  } catch (error) {
    log.warn("Programme showcase unavailable", {
      placement,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return [];
  }
}

export async function restoredHomeCollection(collection: PublicCollection, tourism = false) {
  const params = new URLSearchParams({ limit: "8" });
  if (tourism) params.set("category", "tourism_hospitality");
  try {
    const result = await readRestoredCollection(foundationServerPublicApi(), collection, params);
    return { data: result.rows, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Posts unavailable";
    log.warn("Home preview unavailable", { collection, error: message });
    return { data: null, error: { message } };
  }
}

export const restoredPublicDetail = cache(async (id: string) => {
  if (!z.uuid().safeParse(id).success) return null;
  return readRestoredPublicDetail(foundationServerPublicApi(), id);
});

export const restoredListingDetail = cache(async (id: string) => {
  const post = await restoredPublicDetail(id);
  return post?.kind === "listing" ? restoredPublicRow(post, post) : null;
});

export const restoredBusinessDetail = cache(async (id: string) => {
  const post = await restoredPublicDetail(id);
  if (post?.kind !== "business") return null;
  const sticker = (await readPublicBusinessStickers(foundationServerPublicApi(), [id])).get(id);
  const business: BusinessDetailRecord = {
    ...restoredPublicRow(post, post),
    ...sticker,
    owner_id: "",
  };
  return {
    business,
    ownerProfile: {
      display_name: post.seller.public_name,
      account_verification_status: post.seller.identity_verified ? "verified" : null,
    },
    promotions: [],
    isOwnerPreview: false,
  };
});

export const restoredEventDetail = cache(async (id: string) => {
  const post = await restoredPublicDetail(id);
  if (post?.kind !== "event") return null;
  const promotion: PromotionDetailRecord = {
    ...restoredPublicRow(post, post),
    owner_id: "",
    category_key: null,
  };
  return promotion;
});

const stickerText = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * The business an event names as its host (saved with the event; the database
 * accepted only the poster's own business post), for the event page's host
 * card. Public reads only: null unless that business is publicly live, and null
 * when a read fails, so the event page still renders without the card. Only the
 * card's fields leave here; the owner id stays hidden (null), so the card never
 * claims the advertiser's verified position. The expiry dates let the page's
 * toPublicVerification recheck the CIPC and Seen stickers.
 */
export async function restoredEventHostBusiness(
  id: unknown
): Promise<
  (LinkedBusinessRecord & { cipc_expires_at: string | null; seen_expires_at: string | null }) | null
> {
  if (typeof id !== "string" || !z.uuid().safeParse(id).success) return null;
  try {
    const post = await restoredPublicDetail(id);
    if (post?.kind !== "business") return null;
    const row = restoredPublicRow(post, post);
    const sticker = ((
      await readPublicBusinessStickers(foundationServerPublicApi(), [post.id], {
        withExpiry: true,
      })
    ).get(post.id) ?? {}) as Record<string, unknown>;
    return {
      id: post.id,
      owner_id: null,
      business_name: row.business_name,
      logo_url: row.logo_url ?? null,
      cipc_verified_at: stickerText(sticker.cipc_verified_at),
      cipc_expires_at: stickerText(sticker.cipc_expires_at),
      seen_verified_at: stickerText(sticker.seen_verified_at),
      seen_expires_at: stickerText(sticker.seen_expires_at),
      seen_method: stickerText(sticker.seen_method),
      seen_city: stickerText(sticker.seen_city),
      owner_verified_role: stickerText(sticker.owner_verified_role),
      owner_position_title: stickerText(sticker.owner_position_title),
    };
  } catch {
    log.warn("Event host business unavailable");
    return null;
  }
}
