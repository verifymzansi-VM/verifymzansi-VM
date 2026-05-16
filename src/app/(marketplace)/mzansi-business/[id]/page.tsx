import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { tryCreateAdminClient } from "@/lib/supabase/admin";
import { PageHeader } from "@/components/layout/page-header";
import { ContentViewCountText } from "@/components/listings/content-view-count-text";
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

interface BusinessDetailPageProps {
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

const BUSINESS_DETAIL_SELECT = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area, layout_template, view_count,
  expires_at, created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area, view_count,
  expires_at, created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_VIEW_COUNT_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area, layout_template,
  expires_at, created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_MIN_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area,
  expires_at, created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_MIN_SCHEMA_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area,
  created_at, updated_at
`;

const BUSINESS_PROMOTION_SELECT =
  "id, title, promotion_type, category, category_key, photos, videos, video_thumbnail, focal_x, focal_y, media_width, media_height, price_cents, price_negotiable, location_province, location_city, boost_until, featured_until, view_count, start_date, end_date, created_at";

function isTourismBusinessRecord(business: { area?: string | null; category?: string | null }) {
  return business.area === "PROMOTIONS_EVENTS" || business.category === "tourism_hospitality";
}

function isMissingBusinessOptionalColumnError(
  error: { code?: string | null; message?: string | null } | null
) {
  if (!error) {
    return false;
  }

  if (error.code === "42703") {
    const message = (error.message ?? "").toLowerCase();
    return (
      message.includes("layout_template") ||
      message.includes("view_count") ||
      message.includes("expires_at")
    );
  }

  return false;
}

async function loadBusinessDetail(id: string): Promise<LoadedBusinessDetail | null> {
  const supabase = await createClient();
  const ownerColumn = await getOwnerColumn(supabase, "businesses");
  const selectCandidates = [
    BUSINESS_DETAIL_SELECT,
    BUSINESS_DETAIL_SELECT_LEGACY,
    BUSINESS_DETAIL_SELECT_VIEW_COUNT_LEGACY,
    BUSINESS_DETAIL_SELECT_MIN_LEGACY,
    BUSINESS_DETAIL_SELECT_MIN_SCHEMA_LEGACY,
  ];

  let rawBusiness: Record<string, unknown> | null = null;
  let error: { code?: string | null; message?: string | null } | null = null;

  for (const selectClause of selectCandidates) {
    const result = await supabase
      .from("businesses")
      .select(withOwnerColumn(selectClause, ownerColumn))
      .eq("id", id)
      .maybeSingle();

    rawBusiness = (result.data as Record<string, unknown> | null) ?? null;
    error = (result.error as { code?: string | null; message?: string | null } | null) ?? null;

    if (!error || !isMissingBusinessOptionalColumnError(error)) {
      break;
    }
  }

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
    ? await supabase
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
}

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
  };
}

export async function generateMetadata({ params }: BusinessDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  return (await generateBusinessDetailMetadata(id)) ?? { title: "Business Not Found" };
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
  const viewerKey = buildViewerKey(
    readCookieValue(cookieStore, ENGAGEMENT_VIEWER_COOKIE) ?? null,
    user?.id
  );
  const engagementAdmin = tryCreateAdminClient();
  const promotionIds = promotions.map((promotion) => promotion.id);
  const [businessViewSummary, promotionViewSummary, promotionLikeSummary] = await Promise.all([
    getOptionalContentViewCountMap(engagementAdmin, "business", [business.id]),
    getOptionalContentViewCountMap(engagementAdmin, "promotion", promotionIds),
    getOptionalContentLikeSummaryMap(engagementAdmin, "promotion", promotionIds, viewerKey),
  ]);
  const trustLevel = ownerProfile
    ? computeTrustLevel(readAccountVerificationStatus(ownerProfile))
    : null;
  const breadcrumbs = getBreadcrumbs(isOwnerPreview, business.business_name, resolvedSection);
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
  const businessProfileDescription = `Representative-managed ${
    resolvedSection === "tourism" ? "tourism" : "business"
  } profile.`;
  const businessViewDescription = (
    <ContentViewCountText
      targetId={business.id}
      targetType="business"
      initialCount={businessViewCount}
    />
  );

  return (
    <div className="bg-muted/30">
      <div className="container-page space-y-5 py-4">
        <PageHeader
          title={business.business_name}
          description={
            isOwnerPreview ? (
              <>
                {businessViewDescription}
                {" · "}
                {`Previewing a representative-managed ${
                  resolvedSection === "tourism" ? "tourism" : "business"
                } profile that is still pending moderation.`}
              </>
            ) : (
              <>
                {businessViewDescription}
                {" · "}
                {businessProfileDescription}
              </>
            )
          }
          breadcrumbs={breadcrumbs}
        />

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
      </div>
    </div>
  );
}

export default async function BusinessDetailPage({ params }: BusinessDetailPageProps) {
  const { id } = await params;
  return BusinessDetailPageContent({ id, redirectTourism: true });
}
