import { notFound } from "next/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { BusinessLayoutRouter } from "@/components/business/layouts/business-layout-router";
import { ListingDetailContent } from "@/components/listings/listing-detail-content";
import { PromotionDetailContent } from "@/components/listings/promotion-detail-content";
import { isPlaywrightTestMode } from "@/lib/supabase/playwright-mode";
import {
  FIRST_SCREEN_ADVERTISER,
  FIRST_SCREEN_BUSINESS,
  FIRST_SCREEN_EVENT,
  FIRST_SCREEN_LISTING,
  FIRST_SCREEN_SELLER,
  FIRST_SCREEN_VIDEO_LISTING,
} from "./fixtures";

/**
 * Browser-test copy of the three post pages (404 in production; see
 * proxy-handler): the same header, breadcrumbs, wrappers and detail content
 * as /listing/[id], /mzansi-business/[id] and /tourism-events/[id], on fixed
 * posts, so the first phone screen can be measured without a database.
 */
export default async function PostFirstScreenPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string }>;
}) {
  if (process.env.NODE_ENV === "production" && !isPlaywrightTestMode()) notFound();
  const { type = "listing" } = await searchParams;

  let content: React.ReactNode;
  if (type === "listing" || type === "listing-video") {
    const listing = type === "listing" ? FIRST_SCREEN_LISTING : FIRST_SCREEN_VIDEO_LISTING;
    content = (
      <div className="container-page py-4 space-y-5">
        <Breadcrumbs
          items={[{ label: "Mzansi Market", href: "/mzansi-market" }, { label: listing.title }]}
        />
        <ListingDetailContent listing={listing} seller={FIRST_SCREEN_SELLER} trackView={false} />
      </div>
    );
  } else if (type === "business") {
    content = (
      <div className="container-page space-y-5 py-5 lg:space-y-6 lg:py-8">
        <Breadcrumbs
          items={[
            { label: "Mzansi Business", href: "/mzansi-business" },
            { label: FIRST_SCREEN_BUSINESS.business_name },
          ]}
        />
        <BusinessLayoutRouter
          business={FIRST_SCREEN_BUSINESS}
          trustLevel={null}
          ownerProfile={{ display_name: "Thando D." }}
          promotions={[]}
          showPublicActions
        />
      </div>
    );
  } else if (type === "event") {
    content = (
      <div className="container-page py-4 space-y-5">
        <Breadcrumbs
          items={[
            { label: "Tourism & Events", href: "/tourism-events" },
            { label: FIRST_SCREEN_EVENT.title },
          ]}
        />
        <PromotionDetailContent
          promotion={FIRST_SCREEN_EVENT}
          advertiserProfile={FIRST_SCREEN_ADVERTISER}
          linkedBusiness={null}
          trackView={false}
        />
      </div>
    );
  } else {
    notFound();
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main-content" className="flex-1 scroll-mt-24">
        {content}
      </main>
      <Footer />
    </div>
  );
}
