import { publicPersonName } from "@/lib/account/public-name";
import { restoredListingDetail, restoredPublicDetail } from "@/lib/foundation/marketplace-server";
import { readRestoredCollection } from "@/lib/foundation/marketplace-read";
import { foundationServerPublicApi } from "@/lib/foundation/server-public";
import { notFound } from "next/navigation";
import { ContactActionTracker } from "@/components/analytics/contact-action-tracker";
import { createClient } from "@/lib/supabase/server";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import {
  ListingDetailContent,
  type SimilarListingRow,
  type SimilarSellerRow,
} from "@/components/listings/listing-detail-content";
import type { Metadata } from "next";
import { normalizeOwnerRecord, normalizeOwnerRecords, readOwnerId } from "@/lib/account/compat";
import { ImmersiveDetailGate } from "@/components/immersive/immersive-detail-gate";
import { publicPageMetadata } from "@/lib/sharing/page-metadata";
import { presentListingSlide } from "@/lib/feed/presenters";

interface ListingDetailPageProps {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: ListingDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const listing = await restoredListingDetail(id);

  if (!listing) {
    return { title: "Listing Not Found" };
  }

  return publicPageMetadata({
    title: `${listing.title} | Mzansi Market`,
    description: listing.description,
    path: `/listing/${id}`,
    image: listing.video_thumbnail || listing.photos?.[0],
    video: listing.videos?.[0],
    width: listing.media_width,
    height: listing.media_height,
  });
}

export default async function ListingDetailPage({ params }: ListingDetailPageProps) {
  const { id } = await params;
  const supabase = await createClient();

  // Check if visitor is authenticated
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch listing
  const rawListing = await restoredListingDetail(id);

  const listing = rawListing ? normalizeOwnerRecord(rawListing) : null;

  if (!listing) notFound();

  const listingOwnerId = readOwnerId(listing);
  const publicPost = await restoredPublicDetail(id);
  const seller = publicPost
    ? {
        id: null,
        display_name: publicPost.seller.public_name,
        account_verification_status: publicPost.seller.identity_verified
          ? ("verified" as const)
          : null,
        phone: null,
      }
    : null;

  // Publish phone only when the poster explicitly selected a phone contact method.
  const publishesPhone = listing.contact_methods?.some((method: string) =>
    ["call", "whatsapp"].includes(method)
  );
  // The number reaches the page only for the seller; everyone else taps
  // "Show contact number" (signed in, rate-limited) to get it.
  const viewerIsSeller = Boolean(user && user.id === listingOwnerId);
  const safeSeller = seller
    ? {
        ...seller,
        display_name: publicPersonName(seller.display_name),
        phone: publishesPhone && viewerIsSeller ? seller.phone : null,
        has_phone: Boolean(publishesPhone),
        masked_phone_public: null,
        // Use the location selected for this post, never a private account location.
        location_city: listing.location_city,
        location_province: listing.location_province,
      }
    : null;

  // Fetch similar listings (same category, excluding current)
  const similarListings = (
    await readRestoredCollection(
      foundationServerPublicApi(),
      "listings",
      new URLSearchParams({ category: listing.category ?? "", limit: "5" })
    )
  ).rows
    .filter((row) => row.id !== id)
    .slice(0, 4);

  // Similar listings for the cards below the post
  const similarItems = (
    normalizeOwnerRecords(
      similarListings as unknown as Array<
        SimilarListingRow & {
          owner_id?: string | null;
          seller_id?: string | null;
          featured_until?: string | null;
        }
      >
    ) as Array<SimilarListingRow & { featured_until?: string | null }>
  ).map(({ featured_until, ...item }) => ({
    ...item,
    // The stored flag stays true after the paid window ends; trust the date.
    featured: Boolean(featured_until && new Date(featured_until) > new Date()),
  })) as SimilarListingRow[];
  const similarSellers = new Map<string, SimilarSellerRow>();
  const listingViewCount = listing.view_count ?? 0;

  const immersiveSlide = presentListingSlide(
    listing,
    seller
      ? {
          display_name: publicPersonName(seller.display_name),
          account_verification_status: seller.account_verification_status,
          phone: seller.phone,
        }
      : null,
    {
      views: listingViewCount,
      likes: 0,
      viewerHasLiked: false,
      shares: null,
    }
  );

  // A job with no disclosed salary must not be published as a free (R0) offer.
  const hidesPrice = listing.category === "jobs_services" && !listing.price_cents;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: listing.title,
    description: listing.description?.slice(0, 300),
    ...(listing.photos?.[0] && { image: listing.photos[0] }),
    ...(!hidesPrice && {
      offers: {
        "@type": "Offer",
        priceCurrency: "ZAR",
        price: listing.price_cents ? (listing.price_cents / 100).toFixed(2) : "0",
        availability: "https://schema.org/InStock",
        seller: safeSeller ? { "@type": "Person", name: safeSeller.display_name } : undefined,
      },
    }),
  };

  const page = (
    <div className="flex min-h-screen flex-col">
      <Header />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/<\//g, "<\\/") }}
      />

      <main id="main-content" className="flex-1">
        <div className="container-page py-4 space-y-5">
          <Breadcrumbs
            items={[{ label: "Mzansi Market", href: "/mzansi-market" }, { label: listing.title }]}
          />
          <ContactActionTracker table="listings" id={listing.id} />
          <ListingDetailContent
            listing={{
              ...listing,
              view_count: listingViewCount,
            }}
            seller={safeSeller}
            similarItems={similarItems.map((item) => ({
              ...item,
              view_count: null,
              like_count: null,
              viewer_has_liked: false,
            }))}
            similarSellers={similarSellers}
            showContactActions={true}
          />
        </div>
      </main>

      <Footer />
    </div>
  );

  // Desktop opens the post viewer; phones, search engines and no-JS visitors get `page`.
  return <ImmersiveDetailGate initialSlide={immersiveSlide}>{page}</ImmersiveDetailGate>;
}
