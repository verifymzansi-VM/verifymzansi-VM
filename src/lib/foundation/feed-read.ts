import "server-only";
import type { FeedBrowse } from "../feed/browse";
import type { FeedRef, FeedSlide } from "../feed/types";
import { refKey } from "../feed/refs";
import { presentBusinessSlide, presentEventSlide, presentListingSlide } from "../feed/presenters";
import { foundationServerPublicApi } from "./server-public";
import {
  restoredCollectionSearch,
  restoredPublicRow,
  type PublicCollection,
} from "./marketplace-read";
import { searchFoundationPostIds } from "./post-search";
import { restoredPostEngagement, restoredPublicDetailWithoutTotals } from "./marketplace-server";

export async function foundationFeedSlides(refs: FeedRef[]) {
  // One totals read for every slide (SHOW_ENGAGEMENT_TOTALS), not one per post.
  const totals = await restoredPostEngagement(refs.map((ref) => ref.id));
  return new Map(
    await Promise.all(
      refs.map(async (ref): Promise<[string, FeedSlide | null]> => {
        const post = await restoredPublicDetailWithoutTotals(ref.id);
        const accepts =
          post &&
          (ref.kind === "l"
            ? post.kind === "listing"
            : ref.kind === "b"
              ? post.kind === "business"
              : ref.kind === "p"
                ? post.kind === "event"
                : post.area === "tourism_events");
        if (!accepts || !post) return [refKey(ref), null];
        const owner = {
          display_name: post.seller.public_name,
          account_verification_status: post.seller.identity_verified ? "verified" : null,
          has_phone: post.contact_channels.some(
            (channel) => channel === "call" || channel === "whatsapp"
          ),
        };
        // Totals while SHOW_ENGAGEMENT_TOTALS is on; the like button reads the
        // browser's own likes itself.
        const engagement = {
          views: totals.get(post.id)?.views ?? 0,
          likes: totals.get(post.id)?.likes ?? 0,
          viewerHasLiked: false,
        };
        const row = { ...restoredPublicRow(post, post), owner_id: "", category_key: null };
        if (post.kind === "listing") {
          return [refKey(ref), presentListingSlide(row, owner, engagement)];
        }
        if (post.kind === "business") {
          return [refKey(ref), presentBusinessSlide(row, owner, [], engagement)];
        }
        return [refKey(ref), presentEventSlide(row, owner, null, engagement)];
      })
    )
  );
}

export async function foundationBrowseSequence(browse: FeedBrowse) {
  const collections: PublicCollection[] =
    browse.vertical === "market"
      ? ["listings"]
      : browse.vertical === "business"
        ? ["businesses"]
        : browse.kind === "events" || browse.eventType
          ? ["promotions"]
          : browse.kind === "stays" || browse.category
            ? ["businesses"]
            : ["businesses", "promotions"];
  const sequences = await Promise.all(
    collections.map(async (collection) => {
      const params = new URLSearchParams({ sort: browse.sort });
      if (browse.province) params.set("province", browse.province);
      if (browse.query) params.set("q", browse.query);
      if (browse.condition) params.set("condition", browse.condition);
      if (browse.vertical === "tourism" && collection === "businesses") {
        params.set("category", "tourism_hospitality");
        if (browse.category) params.set("subcategory", browse.category);
      } else if (browse.category) params.set("category", browse.category);
      if (browse.eventType) params.set("event_type", browse.eventType);
      // The first 200 in the list's order, ids only, in one database read.
      const { input } = restoredCollectionSearch(collection, params);
      if (!input) return { refs: [], total: 0 };
      const { ids, total } = await searchFoundationPostIds(foundationServerPublicApi(), {
        ...input,
        offset: 0,
        limit: 200,
      });
      const kind = collection === "listings" ? "l" : collection === "businesses" ? "b" : "p";
      return { refs: ids.map((id): FeedRef => ({ kind, id })), total };
    })
  );
  const refs: FeedRef[] = [];
  for (let i = 0; i < Math.max(0, ...sequences.map((row) => row.refs.length)); i++) {
    for (const sequence of sequences) if (sequence.refs[i]) refs.push(sequence.refs[i]!);
  }
  return {
    refs: refs.slice(0, 200),
    exhausted: sequences.reduce((total, row) => total + row.total, 0) <= 200,
  };
}

export async function foundationDirectSequence(ref: FeedRef) {
  const post = await restoredPublicDetailWithoutTotals(ref.id);
  if (
    !post ||
    (ref.kind === "l" && post.kind !== "listing") ||
    (ref.kind === "b" && post.kind !== "business") ||
    (ref.kind === "p" && post.kind !== "event") ||
    (ref.kind === "t" && post.area !== "tourism_events")
  )
    return null;
  const result = await foundationBrowseSequence({
    vertical: post.area === "tourism_events" ? "tourism" : post.area,
    province: null,
    category: null,
    condition: null,
    kind: "all",
    eventType: null,
    sort: "recommended",
    query: null,
  });
  return {
    ...result,
    refs: result.refs.filter((row) => row.id !== ref.id).slice(0, 120),
    exhausted: result.exhausted && result.refs.filter((row) => row.id !== ref.id).length <= 120,
  };
}
