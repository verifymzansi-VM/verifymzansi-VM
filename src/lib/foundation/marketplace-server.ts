import "server-only";
import { cache } from "react";
import { z } from "zod";
import { foundationServerPublicApi } from "./server-public";
import {
  readRestoredCollection,
  restoredPublicRow,
  type PublicCollection,
} from "./marketplace-read";
import { readFoundationPublicPost, readFoundationPublicContactChannels } from "./public-post";
import { searchFoundationPresentedCards } from "./public-cards";
import type { BusinessDetailRecord } from "@/components/business/business-detail-content";
import type { PromotionDetailRecord } from "@/components/listings/promotion-detail-content";
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
  const api = foundationServerPublicApi();
  const post = await readFoundationPublicPost(api, { id });
  if (!post) return null;
  const contact_channels = await readFoundationPublicContactChannels(api, { id });
  const presentation = (
    await searchFoundationPresentedCards(api, { post_id: id, offset: 0, limit: 1 })
  ).items[0]?.presentation;
  if (!presentation) return null;
  return {
    ...post,
    contact_channels,
    business_type: presentation.business_type,
    frontend: presentation.frontend,
  };
});

export const restoredListingDetail = cache(async (id: string) => {
  const post = await restoredPublicDetail(id);
  return post?.kind === "listing" ? restoredPublicRow(post, post) : null;
});

export const restoredBusinessDetail = cache(async (id: string) => {
  const post = await restoredPublicDetail(id);
  if (post?.kind !== "business") return null;
  const business: BusinessDetailRecord = { ...restoredPublicRow(post, post), owner_id: "" };
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
