import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PageHeader } from "@/components/layout/page-header";
import { ContentViewCountText } from "@/components/listings/content-view-count-text";
import {
  ListingDetailContent,
  type SimilarListingRow,
  type SimilarSellerRow,
} from "@/components/listings/listing-detail-content";
import type { Metadata } from "next";
import {
  ACCOUNT_PROFILE_TABLE,
  getOwnerColumn,
  normalizeOwnerRecord,
  normalizeOwnerRecords,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { buildViewerKey, ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import {
  getOptionalContentLikeSummaryMap,
  getOptionalContentViewCountMap,
} from "@/lib/engagement-server";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";

interface ListingDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ListingDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const supabase = await createClient();
  const { data: listing } = await supabase
    .from("listings")
    .select("title, description")
    .eq("id", id)
    .eq("status", "live")
    .single();

  if (!listing) {
    return { title: "Listing Not Found" };
  }

  return {
    title: `${listing.title} | Mzansi Market`,
    description: listing.description?.slice(0, 160),
  };
}

export default async function ListingDetailPage({ params }: ListingDetailPageProps) {
  const { id } = await params;
  const cookieStore = await getOptionalCookieStore();
  const supabase = await createClient();
  const engagementAdmin = tryCreateAdminClient();
  const listingOwnerColumn = await getOwnerColumn(supabase, "listings");

  // Check if visitor is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const isAuthenticated = Boolean(user);

  // Fetch listing
  const { data: rawListing } = await supabase
    .from("listings")
    .select("*")
    .eq("id", id)
    .eq("status", "live")
    .single();

  const listing = rawListing ? normalizeOwnerRecord(rawListing) : null;

  if (!listing) notFound();

  // Fetch listing owner profile (maybeSingle — the account may have been deleted)
  const listingOwnerId = readOwnerId(listing);
  const { data: seller } = listingOwnerId
    ? await supabase
        .from(ACCOUNT_PROFILE_TABLE)
        .select(
          "id, display_name, location_province, location_city, account_verification_status, phone, masked_phone_public"
        )
        .eq("user_id", listingOwnerId)
        .maybeSingle()
    : { data: null };

  // Strip seller phone data for anonymous visitors to prevent PII scraping
  const safeSeller = seller
    ? isAuthenticated
      ? seller
      : { ...seller, phone: null, masked_phone_public: null }
    : null;

  // Fetch similar listings (same category, excluding current)
  const { data: similarListings } = await supabase
    .from("listings")
    .select(
      withOwnerColumn(
        "id, title, price_cents, price_negotiable, condition, photos, videos, video_thumbnail, media_width, media_height, focal_x, focal_y, logo_url, location_province, location_city, category, attributes, created_at, boost_until, featured, owner_id",
        listingOwnerColumn
      )
    )
    .eq("status", "live")
    .eq("area", "MZANSI_MARKET")
    .eq("category", listing.category)
    .neq("id", listing.id)
    .order("created_at", { ascending: false })
    .limit(4);

  // Fetch owner profiles for similar listings
  const similarItems = normalizeOwnerRecords(
    (similarListings ?? []) as unknown as Array<
      SimilarListingRow & { owner_id?: string | null; seller_id?: string | null }
    >
  ) as SimilarListingRow[];
  let similarSellers = new Map<string, SimilarSellerRow>();
  if (similarItems.length > 0) {
    const ownerIds = Array.from(
      new Set(
        similarItems.map((item) => readOwnerId(item)).filter((id): id is string => Boolean(id))
      )
    );
    const { data: ownerData } = await supabase
      .from(ACCOUNT_PROFILE_TABLE)
      .select("user_id, display_name, account_verification_status")
      .in("user_id", ownerIds);
    similarSellers = new Map((ownerData ?? []).map((s) => [s.user_id, s]));
  }
  const viewerKey = buildViewerKey(
    readCookieValue(cookieStore, ENGAGEMENT_VIEWER_COOKIE) ?? null,
    user?.id
  );
  const similarListingIds = similarItems.map((item) => item.id);
  const [listingViewCounts, similarLikeSummary] = await Promise.all([
    getOptionalContentViewCountMap(engagementAdmin, "listing", [listing.id, ...similarListingIds]),
    getOptionalContentLikeSummaryMap(engagementAdmin, "listing", similarListingIds, viewerKey),
  ]);
  const listingViewCount = listingViewCounts.ok
    ? (listingViewCounts.data.get(listing.id) ?? 0)
    : (listing.view_count ?? 0);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description?.slice(0, 300),
    ...(listing.photos?.[0] && { image: listing.photos[0] }),
    offers: {
      "@type": "Offer",
      priceCurrency: "ZAR",
      price: listing.price_cents ? (listing.price_cents / 100).toFixed(2) : "0",
      availability: "https://schema.org/InStock",
      seller: safeSeller ? { "@type": "Person", name: safeSeller.display_name } : undefined,
    },
  };

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
      />

      <main className="flex-1">
        <div className="container-page py-4 space-y-5">
          <PageHeader
            title={listing.title}
            description={
              <ContentViewCountText
                targetId={listing.id}
                targetType="listing"
                initialCount={listingViewCount}
              />
            }
            breadcrumbs={[
              { label: "Mzansi Market", href: "/mzansi-market" },
              { label: listing.title },
            ]}
          />
          <ListingDetailContent
            listing={{
              ...listing,
              view_count: listingViewCount,
            }}
            seller={safeSeller}
            similarItems={similarItems.map((item) => ({
              ...item,
              view_count: listingViewCounts.ok
                ? (listingViewCounts.data.get(item.id) ?? null)
                : null,
              like_count: similarLikeSummary.ok
                ? (similarLikeSummary.data.get(item.id)?.likeCount ?? null)
                : null,
              viewer_has_liked: similarLikeSummary.ok
                ? (similarLikeSummary.data.get(item.id)?.viewerHasLiked ?? false)
                : false,
            }))}
            similarSellers={similarSellers}
            showContactActions={isAuthenticated}
          />
        </div>
      </main>

      <Footer />
    </div>
  );
}
