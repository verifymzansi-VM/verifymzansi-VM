import type { Metadata } from "next";
import { cache } from "react";
import {
  BusinessAffiliationsSection,
  loadBusinessAffiliations,
} from "@/components/organisations/business-affiliations-section";
import { ContactActionTracker } from "@/components/analytics/contact-action-tracker";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  type BusinessDetailRecord,
  type BusinessPromotionRecord,
} from "@/components/business/business-detail-content";
import { BusinessLayoutRouter } from "@/components/business/layouts/business-layout-router";
import {
  ACCOUNT_PROFILE_TABLE,
  getOwnerColumn,
  normalizeOwnerRecord,
  readAccountVerificationStatus,
  readOwnerId,
  withOwnerColumn,
} from "@/lib/account/compat";
import { computeTrustLevel } from "@/lib/constants/trust-scale";
import { buildViewerKey, ENGAGEMENT_VIEWER_COOKIE } from "@/lib/engagement";
import {
  getOptionalContentLikeSummaryMap,
  getOptionalContentViewCountMap,
} from "@/lib/engagement-server";
import { getOptionalCookieStore, readCookieValue } from "@/lib/utils/request-context";
import { applyVisibleExpiryFilter, isVisibleByExpiry } from "@/lib/posting/visibility";
import { selectBusinessWithFallback } from "@/lib/business/business-detail-select";
import { isTourismBusinessRecord } from "@/lib/presentation/business-facts";
import { ImmersiveDetailGate } from "@/components/immersive/immersive-detail-gate";
import { presentBusinessSlide } from "@/lib/feed/presenters";

export interface BusinessDetailPageProps {
  params: Promise<{ id: string }>;
}

interface LoadedBusinessDetail {
  business: BusinessDetailRecord;
  ownerProfile: {
    display_name: string | null;
    account_verification_status?: string | null;
  } | null;
  promotions: BusinessPromotionRecord[];
  isOwnerPreview: boolean;
}

type BusinessDetailSection = "business" | "tourism";

type BusinessDetailOwnerRecord = BusinessDetailRecord & {
  owner_id?: string | null;
  seller_id?: string | null;
  expires_at?: string | null;
};

const BUSINESS_PROMOTION_SELECT =
  "id, title, promotion_type, category, category_key, photos, videos, video_thumbnail, focal_x, focal_y, media_width, media_height, price_cents, price_negotiable, location_province, location_city, boost_until, featured_until, view_count, start_date, end_date, created_at";

// Deduped per request: generateMetadata and the page both need the same record.
const loadBusinessDetail = cache(async function loadBusinessDetail(
  id: string
): Promise<LoadedBusinessDetail | null> {
  const supabase = await createClient();
  const ownerColumn = await getOwnerColumn(supabase, "businesses");
  const { data: rawBusiness, error } = await selectBusinessWithFallback<Record<string, unknown>>(
    (selectClause) =>
      supabase
        .from("businesses")
        .select(withOwnerColumn(selectClause, ownerColumn))
        .eq("id", id)
        .maybeSingle()
  );

  if (error || !rawBusiness) {
    return null;
  }

  if (!rawBusiness.business_name || !rawBusiness.status) {
    return null;
  }

  const business = normalizeOwnerRecord(
    rawBusiness as unknown as BusinessDetailOwnerRecord
  ) as BusinessDetailRecord & { expires_at?: string | null };
  const businessCreatedAt = (business as { created_at?: string | null }).created_at;
  const isExpiredLivePost =
    business.status === "live" &&
    !isVisibleByExpiry(business.expires_at, new Date(), businessCreatedAt);
  const isOwnerPreview = business.status !== "live" || isExpiredLivePost;

  if (isOwnerPreview) {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user || user.id !== readOwnerId(business)) {
      return null;
    }
  }

  const ownerId = readOwnerId(business);
  const { data: ownerProfile } = ownerId
    ? await (tryCreateAdminClient() ?? supabase)
        .from(ACCOUNT_PROFILE_TABLE)
        .select("display_name, account_verification_status")
        .eq("user_id", ownerId)
        .maybeSingle()
    : { data: null };

  const { data: promotions } = await applyVisibleExpiryFilter(
    supabase
      .from("promotions")
      .select(BUSINESS_PROMOTION_SELECT)
      .eq("business_id", id)
      .eq("status", "live")
  )
    .order("created_at", { ascending: false })
    .limit(12);

  return {
    business,
    ownerProfile: ownerProfile ?? null,
    promotions: (promotions ?? []) as BusinessPromotionRecord[],
    isOwnerPreview,
  };
});

function getBreadcrumbs(
  isOwnerPreview: boolean,
  businessName: string,
  section: BusinessDetailSection
) {
  const sectionLabel = section === "tourism" ? "Tourism & Events" : "Mzansi Business";
  const dashboardHref =
    section === "tourism" ? "/dashboard/tourism-events" : "/dashboard/businesses";
  const publicHref = section === "tourism" ? "/tourism-events" : "/mzansi-business";

  return isOwnerPreview
    ? [
        { label: "Dashboard", href: "/dashboard" },
        { label: sectionLabel, href: dashboardHref },
        { label: businessName },
      ]
    : [
        { label: "Home", href: "/" },
        { label: sectionLabel, href: publicHref },
        { label: businessName },
      ];
}

function getPreviewLabel(status: string) {
  if (status === "draft") return "Draft";
  if (status === "rejected") return "Rejected";
  if (status === "pending_moderation") return "Pending moderation";
  return "Preview";
}

function getPreviewDescription(status: string) {
  if (status === "draft") {
    return "Draft — only visible to you. Submit to go live.";
  }

  if (status === "rejected") {
    return "Rejected — only visible to you. Update and resubmit.";
  }

  return "Awaiting moderation — only visible to you until approved.";
}

export async function generateBusinessDetailMetadata(
  id: string,
  section: BusinessDetailSection = "business"
): Promise<Metadata | null> {
  const detail = await loadBusinessDetail(id);

  if (!detail) {
    return null;
  }

  const isTourismBusiness = isTourismBusinessRecord(detail.business);
  if (section === "tourism" && !isTourismBusiness) {
    return null;
  }

  const resolvedSection = section === "tourism" || isTourismBusiness ? "tourism" : "business";
  const sectionTitle = resolvedSection === "tourism" ? "Tourism & Events" : "Mzansi Business";

  return {
    title: `${detail.business.business_name} | ${sectionTitle}`,
    description: detail.business.description?.slice(0, 160),
    alternates: {
      canonical: `${resolvedSection === "tourism" ? "/tourism-events" : "/mzansi-business"}/${detail.business.id}`,
    },
  };
}

export async function BusinessDetailPageContent({
  id,
  section = "business",
  redirectTourism = false,
  notFoundOnMissing = true,
}: {
  id: string;
  section?: BusinessDetailSection;
  redirectTourism?: boolean;
  notFoundOnMissing?: boolean;
}) {
  const cookieStore = await getOptionalCookieStore();
  const detail = await loadBusinessDetail(id);
  const supabase = await createClient();

  if (!detail) {
    if (notFoundOnMissing) {
      notFound();
    }
    return null;
  }

  const { business, ownerProfile, promotions, isOwnerPreview } = detail;
  const isTourismBusiness = isTourismBusinessRecord(business);
  if (section === "tourism" && !isTourismBusiness) {
    if (notFoundOnMissing) {
      notFound();
    }
    return null;
  }

  const resolvedSection = section === "tourism" || isTourismBusiness ? "tourism" : "business";

  if (redirectTourism && !isOwnerPreview && resolvedSection === "tourism") {
    redirect(`/tourism-events/${business.id}`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  const viewerId = readCookieValue(cookieStore, ENGAGEMENT_VIEWER_COOKIE) ?? null;
  const viewerKey = buildViewerKey(viewerId, user?.id);
  const engagementAdmin = tryCreateAdminClient();
  const promotionIds = promotions.map((promotion) => promotion.id);
  const [businessViewSummary, promotionViewSummary, promotionLikeSummary, businessLikeSummary] =
    await Promise.all([
      getOptionalContentViewCountMap(engagementAdmin, "business", [business.id]),
      getOptionalContentViewCountMap(engagementAdmin, "promotion", promotionIds),
      getOptionalContentLikeSummaryMap(engagementAdmin, "promotion", promotionIds, viewerKey),
      getOptionalContentLikeSummaryMap(engagementAdmin, "business", [business.id], viewerKey),
    ]);
  const trustLevel = ownerProfile
    ? computeTrustLevel(readAccountVerificationStatus(ownerProfile))
    : null;
  const breadcrumbs = getBreadcrumbs(isOwnerPreview, business.business_name, resolvedSection);
  const affiliations = isOwnerPreview ? [] : await loadBusinessAffiliations(supabase, business.id);
  const promotionsWithLikes = promotions.map((promotion) => ({
    ...promotion,
    view_count: promotionViewSummary.ok ? (promotionViewSummary.data.get(promotion.id) ?? 0) : null,
    like_count: promotionLikeSummary.ok
      ? (promotionLikeSummary.data.get(promotion.id)?.likeCount ?? null)
      : null,
    viewer_has_liked: promotionLikeSummary.ok
      ? (promotionLikeSummary.data.get(promotion.id)?.viewerHasLiked ?? false)
      : false,
  }));
  const businessViewCount = businessViewSummary.ok
    ? (businessViewSummary.data.get(business.id) ?? 0)
    : (business.view_count ?? 0);
  const ownLikes = businessLikeSummary.ok ? businessLikeSummary.data.get(business.id) : undefined;
  // Owner previews of drafts keep the classic page with its preview banner.
  const immersiveSlide = !isOwnerPreview
    ? presentBusinessSlide(business, ownerProfile, promotions, {
        views: businessViewCount,
        likes: ownLikes?.likeCount ?? 0,
        viewerHasLiked: ownLikes?.viewerHasLiked ?? false,
      })
    : null;

  const page = (
    <div>
      <div className="container-page space-y-5 py-5 lg:space-y-6 lg:py-8">
        <Breadcrumbs items={breadcrumbs} />

        {isOwnerPreview && (
          <Alert variant="warning">
            <div className="space-y-2">
              <Badge variant="secondary" className="w-fit">
                Owner preview
              </Badge>
              <AlertTitle>{getPreviewLabel(business.status)}</AlertTitle>
              <AlertDescription>{getPreviewDescription(business.status)}</AlertDescription>
            </div>
          </Alert>
        )}

        {!isOwnerPreview ? (
          <ContactActionTracker table="businesses" id={business.id} website={business.website} />
        ) : null}
        <BusinessLayoutRouter
          business={{
            ...business,
            view_count: businessViewCount,
          }}
          trustLevel={trustLevel}
          ownerProfile={ownerProfile}
          promotions={promotionsWithLikes}
          showPublicActions={!isOwnerPreview}
        />
        <BusinessAffiliationsSection affiliations={affiliations} />
      </div>
    </div>
  );

  return immersiveSlide ? (
    <ImmersiveDetailGate initialSlide={immersiveSlide}>{page}</ImmersiveDetailGate>
  ) : (
    page
  );
}
