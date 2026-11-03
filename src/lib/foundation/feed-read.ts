import "server-only";
import type { FeedBrowse } from "../feed/browse";
import type { FeedRef, FeedSlide } from "../feed/types";
import { refKey } from "../feed/refs";
import { presentBusinessSlide, presentEventSlide, presentListingSlide } from "../feed/presenters";
import { foundationServerPublicApi } from "./server-public";
import {
  readRestoredCollection,
  restoredPublicRow,
  type PublicCollection,
} from "./marketplace-read";
import { restoredPublicDetail } from "./marketplace-server";

export async function foundationFeedSlides(refs: FeedRef[]) {
  return new Map(
    await Promise.all(
      refs.map(async (ref): Promise<[string, FeedSlide | null]> => {
        const post = await restoredPublicDetail(ref.id);
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
        const engagement = { views: 0, likes: 0, viewerHasLiked: false };
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
      const params = new URLSearchParams({ limit: "50", sort: browse.sort });
      if (browse.province) params.set("province", browse.province);
      if (browse.query) params.set("q", browse.query);
      if (browse.condition) params.set("condition", browse.condition);
      if (browse.vertical === "tourism" && collection === "businesses") {
        params.set("category", "tourism_hospitality");
        if (browse.category) params.set("subcategory", browse.category);
      } else if (browse.category) params.set("category", browse.category);
      if (browse.eventType) params.set("event_type", browse.eventType);
      const api = foundationServerPublicApi();
      const refs: FeedRef[] = [];
      let total = 0;
      for (let page = 1; page <= 4; page++) {
        params.set("page", String(page));
        const result = await readRestoredCollection(api, collection, params);
        total = result.total;
        refs.push(
          ...result.rows.map((row): FeedRef => ({
            kind: collection === "listings" ? "l" : collection === "businesses" ? "b" : "p",
            id: row.id,
          }))
        );
        if (page * 50 >= total) break;
      }
      return { refs, total };
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
  const post = await restoredPublicDetail(ref.id);
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
