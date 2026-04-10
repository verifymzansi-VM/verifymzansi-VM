import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/layout/page-header";
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

type BusinessDetailOwnerRecord = BusinessDetailRecord & {
  owner_id?: string | null;
  seller_id?: string | null;
};

const BUSINESS_DETAIL_SELECT = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area, layout_template,
  created_at, updated_at
`;

const BUSINESS_DETAIL_SELECT_LEGACY = `
  id, owner_id, business_type, business_name, slug, description, category, subcategory, category_details,
  logo_url, cover_photo, cover_video, video_thumbnail, gallery_photos, location_province,
  location_city, store_number, map_directions, phone, whatsapp, email, website, social_links,
  services_offered, service_areas, business_details, operating_hours, payment_methods_accepted,
  delivery_options, boost_until, featured_until, published_at, status, area,
  created_at, updated_at
`;

const BUSINESS_PROMOTION_SELECT =
  "id, title, promotion_type, category, category_key, photos, videos, video_thumbnail, focal_x, focal_y, media_width, media_height, price_cents, price_negotiable, location_province, location_city, boost_until, featured_until, view_count, start_date, end_date, created_at";

function isMissingLayoutTemplateColumnError(
  error: { code?: string | null; message?: string | null } | null
) {
  if (!error) {
    return false;
  }

  if (error.code === "42703") {
    const message = (error.message ?? "").toLowerCase();
    return message.includes("layout_template");
  }

  return false;
}

async function loadBusinessDetail(id: string): Promise<LoadedBusinessDetail | null> {
  const supabase = await createClient();
  const ownerColumn = await getOwnerColumn(supabase, "businesses");
  let { data: rawBusiness, error } = await supabase
    .from("businesses")
    .select(withOwnerColumn(BUSINESS_DETAIL_SELECT, ownerColumn))
    .eq("id", id)
    .maybeSingle();

  if (isMissingLayoutTemplateColumnError(error)) {
    const legacyResult = await supabase
      .from("businesses")
      .select(withOwnerColumn(BUSINESS_DETAIL_SELECT_LEGACY, ownerColumn))
      .eq("id", id)
      .maybeSingle();

    rawBusiness = legacyResult.data;
    error = legacyResult.error;
  }

  if (error || !rawBusiness) {
    return null;
  }

  const business = normalizeOwnerRecord(
    rawBusiness as unknown as BusinessDetailOwnerRecord
  ) as BusinessDetailRecord;
  const isOwnerPreview = business.status !== "live";

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

  const { data: promotions } = await supabase
    .from("promotions")
    .select(BUSINESS_PROMOTION_SELECT)
    .eq("business_id", id)
    .eq("status", "live")
    .order("created_at", { ascending: false })
    .limit(12);

  return {
    business,
    ownerProfile: ownerProfile ?? null,
    promotions: (promotions ?? []) as BusinessPromotionRecord[],
    isOwnerPreview,
  };
}

function getBreadcrumbs(isOwnerPreview: boolean, businessName: string) {
  return isOwnerPreview
    ? [
        { label: "Dashboard", href: "/dashboard" },
        { label: "Mzansi Business", href: "/dashboard/businesses" },
        { label: businessName },
      ]
    : [
        { label: "Home", href: "/" },
        { label: "Mzansi Business", href: "/mzansi-business" },
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

export async function generateMetadata({ params }: BusinessDetailPageProps): Promise<Metadata> {
  const { id } = await params;
  const detail = await loadBusinessDetail(id);

  if (!detail) {
    return { title: "Business Not Found" };
  }

  return {
    title: `${detail.business.business_name} | Mzansi Business`,
    description: detail.business.description?.slice(0, 160),
  };
}

export default async function BusinessDetailPage({ params }: BusinessDetailPageProps) {
  const { id } = await params;
  const detail = await loadBusinessDetail(id);

  if (!detail) {
    notFound();
  }

  const { business, ownerProfile, promotions, isOwnerPreview } = detail;
  const trustLevel = ownerProfile
    ? computeTrustLevel(readAccountVerificationStatus(ownerProfile))
    : null;
  const breadcrumbs = getBreadcrumbs(isOwnerPreview, business.business_name);

  return (
    <div className="bg-muted/30">
      <div className="container-page space-y-5 py-4">
        <PageHeader
          title={business.business_name}
          description={
            isOwnerPreview
              ? "Previewing a business profile that is still pending moderation."
              : "Verified business profile."
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
          business={business}
          trustLevel={trustLevel}
          ownerProfile={ownerProfile}
          promotions={promotions}
          showPublicActions={!isOwnerPreview}
        />
      </div>
    </div>
  );
}
